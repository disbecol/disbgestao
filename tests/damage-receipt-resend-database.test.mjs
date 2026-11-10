import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

async function fixture() {
  const db = new PGlite();
  const owner = randomUUID(), other = randomUUID();
  const request = randomUUID(), request2 = randomUUID(), contact = randomUUID(), contact2 = randomUUID(), customer = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.damage_requests(id uuid primary key, unit text, created_by uuid, customer_code text, customer_name text);
    create table public.customers(id uuid primary key, code text, name text);
    create table public.customer_contacts(id uuid primary key, customer_id uuid, customer_code text, phone_normalized text,
      whatsapp_receipt_eligible boolean, whatsapp_receipt_verified_at timestamptz, whatsapp_receipt_verified_by uuid);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
    create function public.user_has_unit(text) returns boolean language sql as $$select false$$;
    create function public.has_permission(text) returns boolean language sql as $$select false$$;
    grant usage on schema auth to authenticated;
    grant select on public.damage_requests to authenticated;`);
  await db.query('insert into auth.users values ($1), ($2)', [owner, other]);
  await db.query("insert into public.damage_requests values ($1, 'Matriz Caicó', $3, '371', 'Cliente'), ($2, 'Matriz Caicó', $3, '371', 'Cliente')", [request, request2, owner]);
  await db.query("insert into public.customers values ($1, '371', 'Cliente')", [customer]);
  await db.query("insert into public.customer_contacts values ($1, $3, '371', '5584999999999', true, now(), $4), ($2, $3, '371', '5584999999998', true, now(), $4)", [contact, contact2, customer, owner]);
  for (const path of ['51_v1_7_20_whatsapp_comprovante_avaria.sql', '83_whatsapp_receipt_service_role_grants.sql', '86_damage_receipt_explicit_resend.sql']) {
    await db.exec(await readFile(new URL('../supabase/' + path, import.meta.url), 'utf8'));
  }
  const reserve = async (operation = randomUUID(), resend = false, overrides = {}) => (await db.query(
    'select public.reserve_damage_receipt_send($1,$2,$3,$4,$5) result',
    [overrides.request ?? request, overrides.contact ?? contact, overrides.owner ?? owner, operation, resend],
  )).rows[0].result;
  const status = async (id, value) => db.query("update public.damage_receipt_sends set status=$2,provider_message_id=case when $2='ACCEPTED' then 'wamid.test' else null end,updated_at=now() where id=$1", [id, value]);
  const row = async id => (await db.query('select * from public.damage_receipt_sends where id=$1', [id])).rows[0];
  await db.exec('set role service_role');
  return { db, owner, other, request, request2, contact, contact2, reserve, status, row };
}

test('reserva é exclusiva do servidor e não amplia escrita dos usuários', async () => {
  const h = await fixture();
  try {
    const privileges = (await h.db.query(`select
      has_function_privilege('service_role','public.reserve_damage_receipt_send(uuid,uuid,uuid,uuid,boolean)','EXECUTE') server,
      has_function_privilege('authenticated','public.reserve_damage_receipt_send(uuid,uuid,uuid,uuid,boolean)','EXECUTE') logged_in,
      has_function_privilege('anon','public.reserve_damage_receipt_send(uuid,uuid,uuid,uuid,boolean)','EXECUTE') anonymous,
      has_table_privilege('authenticated','public.damage_receipt_sends','INSERT') client_insert,
      has_any_column_privilege('authenticated','public.damage_receipt_sends','UPDATE') client_update,
      (select relrowsecurity from pg_class where oid='public.damage_receipt_sends'::regclass) rls`)).rows[0];
    assert.deepEqual(privileges, { server: true, logged_in: false, anonymous: false, client_insert: false, client_update: false, rls: true });
    for (const role of ['authenticated', 'anon']) {
      await h.db.exec('reset role; set role ' + role);
      await assert.rejects(() => h.reserve(), error => error.code === '42501');
    }
  } finally { await h.db.close(); }
});

test('somente reenvio confirmado cria nova tentativa e mantém os aceites anteriores', async () => {
  const h = await fixture();
  try {
    const op = randomUUID(), first = await h.reserve(op);
    assert.equal(first.reserved, true); assert.equal(first.status, 'PROCESSING');
    await h.status(first.id, 'ACCEPTED');
    const previous = await h.row(first.id);
    const retry = await h.reserve(op);
    assert.equal(retry.id, first.id); assert.equal(retry.reserved, false); assert.equal(retry.status, 'ACCEPTED');
    const ordinary = await h.reserve();
    assert.equal(ordinary.id, first.id); assert.equal(ordinary.reserved, false);
    const resendOp = randomUUID(), resend = await h.reserve(resendOp, true);
    assert.equal(resend.reserved, true); assert.notEqual(resend.id, first.id); assert.equal(resend.resend_of, first.id);
    await h.status(resend.id, 'ACCEPTED');
    assert.deepEqual(await h.row(first.id), previous, 'o primeiro aceite permanece intacto');
    const resendRetry = await h.reserve(resendOp, true);
    assert.equal(resendRetry.id, resend.id); assert.equal(resendRetry.reserved, false); assert.equal(resendRetry.status, 'ACCEPTED');
    assert.equal((await h.db.query('select count(*)::int n from public.damage_receipt_sends')).rows[0].n, 2);
    // Compatibilidade com a função antiga: INSERT direto não pode reenviar silenciosamente.
    await assert.rejects(() => h.db.query(`insert into public.damage_receipt_sends
      (request_id,contact_id,recipient_phone,requested_by,status)
      values ($1,$2,'5584999999999',$3,'PROCESSING')`, [h.request, h.contact, h.owner]), error => error.code === '23505');
    await assert.rejects(() => h.reserve(resendOp, false), /OPERATION_ID_CONFLICT/);
  } finally { await h.db.close(); }
});

test('mesma operação não duplica rejeição; nova operação pode repetir falha explícita', async () => {
  const h = await fixture();
  try {
    await assert.rejects(() => h.reserve(randomUUID(), true), /RESEND_NOT_AVAILABLE/);
    const op = randomUUID(), first = await h.reserve(op);
    const inflight = await h.reserve();
    assert.equal(inflight.id, first.id); assert.equal(inflight.reserved, false); assert.equal(inflight.status, 'PROCESSING');
    await h.status(first.id, 'REJECTED');
    const same = await h.reserve(op);
    assert.equal(same.id, first.id); assert.equal(same.reserved, false); assert.equal(same.status, 'REJECTED');
    const again = await h.reserve();
    assert.notEqual(again.id, first.id); assert.equal(again.reserved, true);
    await h.status(again.id, 'UNKNOWN');
    const blocked = await h.reserve();
    assert.equal(blocked.id, again.id); assert.equal(blocked.reserved, false); assert.equal(blocked.status, 'UNKNOWN');
    assert.equal((await h.db.query('select count(*)::int n from public.damage_receipt_sends')).rows[0].n, 2);
  } finally { await h.db.close(); }
});

test('operação é global e envio confirmado em andamento bloqueia outra confirmação', async () => {
  const h = await fixture();
  try {
    const op = randomUUID(), first = await h.reserve(op);
    await h.status(first.id, 'ACCEPTED');
    await assert.rejects(() => h.reserve(op, false, { request: h.request2 }), /OPERATION_ID_CONFLICT/);
    await assert.rejects(() => h.reserve(op, false, { contact: h.contact2 }), /OPERATION_ID_CONFLICT/);
    const resend = await h.reserve(randomUUID(), true);
    const blocked = await h.reserve(randomUUID(), true);
    assert.equal(blocked.id, resend.id); assert.equal(blocked.reserved, false); assert.equal(blocked.status, 'PROCESSING');
    await h.status(resend.id, 'UNKNOWN');
    const unknown = await h.reserve(randomUUID(), true);
    assert.equal(unknown.id, resend.id); assert.equal(unknown.reserved, false); assert.equal(unknown.status, 'UNKNOWN');
    assert.equal((await h.row(first.id)).status, 'ACCEPTED');
    await h.db.exec('reset role');
    await h.db.exec(await readFile(new URL('../supabase/86_damage_receipt_explicit_resend.sql', import.meta.url), 'utf8'));
    assert.equal((await h.db.query('select count(*)::int n from public.damage_receipt_sends')).rows[0].n, 2, 'reaplicar preserva o histórico');
  } finally { await h.db.close(); }
});
