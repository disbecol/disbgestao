import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('histórico permite gravação pelo servidor e preserva RLS, autoria e duplicidade', async () => {
  const db = new PGlite();
  const owner = randomUUID(), other = randomUUID(), request = randomUUID(), contact = randomUUID();
  const migration = await readFile(new URL('../supabase/83_whatsapp_receipt_service_role_grants.sql', import.meta.url), 'utf8');
  const insert = `insert into public.damage_receipt_sends
    (request_id, contact_id, recipient_phone, requested_by, status)
    values ($1, $2, '5584999999999', $3, 'PROCESSING') returning id`;
  const args = [request, contact, owner];
  const denied = action => assert.rejects(action, error => error.code === '42501');
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create table public.damage_requests(id uuid primary key, unit text);
      create table public.customer_contacts(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
      create function public.user_has_unit(text) returns boolean language sql as $$select false$$;
      create function public.has_permission(text) returns boolean language sql as $$select false$$;
      grant usage on schema auth to authenticated;
      grant select on public.damage_requests to authenticated;`);
    await db.query('insert into auth.users values ($1), ($2)', [owner, other]);
    await db.query("insert into public.damage_requests values ($1, 'Matriz Caicó')", [request]);
    await db.query('insert into public.customer_contacts values ($1)', [contact]);
    await db.exec(await readFile(new URL('../supabase/51_v1_7_20_whatsapp_comprovante_avaria.sql', import.meta.url), 'utf8'));

    await db.exec('set role service_role');
    await denied(() => db.query(insert, args)); // Reproduz o erro real antes da correção.
    await db.exec('reset role');
    await db.exec(migration);
    await db.exec('set role service_role');
    const attempt = (await db.query(insert, args)).rows[0].id;
    await db.query(`update public.damage_receipt_sends set status='ACCEPTED',
      provider_message_id='wamid.test', provider_error_code=null, updated_at=now() where id=$1`, [attempt]);
    assert.equal((await db.query('select status from public.damage_receipt_sends where id=$1', [attempt])).rows[0].status, 'ACCEPTED');
    await assert.rejects(() => db.query(insert, args), error => error.code === '23505');
    await denied(() => db.query('update public.damage_receipt_sends set requested_by=$1 where id=$2', [other, attempt]));
    await denied(() => db.query('delete from public.damage_receipt_sends where id=$1', [attempt]));

    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select id from public.damage_receipt_sends')).rows.length, 1);
    await denied(() => db.query(insert, args));
    await denied(() => db.query("update public.damage_receipt_sends set status='REJECTED' where id=$1", [attempt]));
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
    assert.equal((await db.query('select id from public.damage_receipt_sends')).rows.length, 0);
    await db.exec('reset role; set role anon');
    await denied(() => db.query('select * from public.damage_receipt_sends'));

    await db.exec('reset role');
    await db.exec(migration); // Reaplicar não altera o histórico nem as políticas.
    assert.equal((await db.query('select count(*)::int n from public.damage_receipt_sends')).rows[0].n, 1);
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.damage_receipt_sends'::regclass")).rows[0].relrowsecurity, true);
    await db.exec('set role service_role');
    await db.query("update public.damage_receipt_sends set status='REJECTED' where id=$1", [attempt]);
    assert.equal((await db.query(insert, args)).rows.length, 1);
  } finally {
    await db.close();
  }
});
