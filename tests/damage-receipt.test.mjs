import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const requestId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';

function harness({ configured = true, contactCode = '42', eligible = true, replies = [], items = null } = {}) {
  const logs = [];
  const requests = [];
  const env = {
    SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    WHATSAPP_ACCESS_TOKEN: configured ? 'secret' : '',
    WHATSAPP_PHONE_NUMBER_ID: configured ? '98765' : '',
  };
  const rows = {
    damage_requests: { id: requestId, created_by: userId, customer_code: '42', customer_name: 'Cliente Teste', map_number: '125', occurrence_date: '2026-10-05' },
    customer_contacts: { id: contactId, customer_id: customerId, customer_code: contactCode, phone_normalized: '5584999999999', whatsapp_receipt_eligible: eligible, whatsapp_receipt_verified_at: eligible ? '2026-10-06T12:00:00Z' : null, whatsapp_receipt_verified_by: eligible ? userId : null },
    customers: { id: customerId, code: '42', name: 'Cliente Teste' },
    damage_items: items || [{ product_text: 'Produto X', quantity: 2, quantity_unit: 'CAIXA', item_order: 1, status: 'PENDENTE' }],
  };
  let handler;
  let providerCalls = 0;

  function query(table) {
    const state = { op: 'select', value: null, filters: [] };
    const builder = {
      select() { return builder; },
      eq(key, value) { state.filters.push([key, value]); return builder; },
      in() { return builder; }, order() { return builder; }, limit() { return builder; },
      insert(value) { state.op = 'insert'; state.value = value; return builder; },
      update(value) { state.op = 'update'; state.value = value; return builder; },
      async result() {
        if (table === 'damage_receipt_sends') {
          if (state.op === 'insert') {
            if (logs.some(x => x.request_id === state.value.request_id && x.contact_id === state.value.contact_id && ['PROCESSING', 'ACCEPTED', 'UNKNOWN'].includes(x.status))) {
              return { data: null, error: { code: '23505' } };
            }
            const row = { ...state.value, id: `attempt-${logs.length + 1}` };
            logs.push(row);
            return { data: row, error: null };
          }
          if (state.op === 'update') {
            Object.assign(logs.find(x => x.id === state.filters.find(([key]) => key === 'id')?.[1]), state.value);
            return { data: null, error: null };
          }
          return { data: logs.find(x => ['PROCESSING', 'ACCEPTED', 'UNKNOWN'].includes(x.status)) || null, error: null };
        }
        if (table === 'damage_items') return { data: rows.damage_items, error: null };
        const row = rows[table];
        const allowed = row && state.filters.every(([key, value]) => row[key] === value);
        return { data: allowed ? row : null, error: null };
      },
      maybeSingle() { return builder.result(); },
      single() { return builder.result(); },
      then(resolve, reject) { return builder.result().then(resolve, reject); },
    };
    return builder;
  }
  const createClient = (_url, key) => ({
    auth: { async getUser() { return { data: { user: { id: userId } }, error: null }; } },
    from: query,
  });
  const source = readFileSync(new URL('../supabase/functions/send-damage-receipt/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\s*\n/, 'const { createClient } = globalThis.__testSupabase;\n');
  const js = stripTypeScriptTypes(source);
  vm.runInNewContext(js, {
    __testSupabase: { createClient },
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
    Response, Date, Intl, console,
    async fetch(url, options) {
      providerCalls++;
      requests.push({ url, options });
      const reply = replies.shift();
      if (reply === 'network') throw new Error('network');
      if (reply === 'reject') return new Response(JSON.stringify({ error: { code: 132001 } }), { status: 400 });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 });
    },
  });

  async function send(auth = true) {
    const response = await handler(new Request('https://test/functions/v1/send-damage-receipt', {
      method: 'POST', headers: auth ? { Authorization: 'Bearer test' } : {},
      body: JSON.stringify({ request_id: requestId, contact_id: contactId }),
    }));
    return { status: response.status, body: await response.json() };
  }
  return { send, logs, requests, get providerCalls() { return providerCalls; } };
}

test('exige configuração e autenticação sem chamar a Meta', async () => {
  const missing = harness({ configured: false });
  assert.equal((await missing.send()).body.error, 'WHATSAPP_NOT_CONFIGURED');
  const configured = harness();
  assert.equal((await configured.send(false)).status, 401);
  assert.equal(configured.providerCalls, 0);
});

test('não envia para contato de outro cliente', async () => {
  const app = harness({ contactCode: '99' });
  assert.equal((await app.send()).body.error, 'CONTACT_NOT_FOUND');
  assert.equal(app.providerCalls, 0);
});

test('bloqueia contato sem consentimento e maioridade confirmados', async () => {
  const app = harness({ eligible: false });
  const result = await app.send();
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'CONTACT_NOT_ELIGIBLE');
  assert.equal(app.providerCalls, 0);
  assert.equal(app.logs.length, 0);
});

test('não envia comprovante de avaria totalmente cancelada', async () => {
  const app = harness({ items: [{ product_text: 'Produto cancelado', quantity: 1, quantity_unit: 'UNIDADE', item_order: 1, status: 'CANCELADO' }] });
  const result = await app.send();
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'RECEIPT_CANCELLED');
  assert.equal(app.providerCalls, 0);
  assert.equal(app.logs.length, 0);
});

test('comprovante de ocorrência parcial omite produto cancelado', async () => {
  const app = harness({ items: [
    { product_text: 'Produto cancelado', quantity: 1, quantity_unit: 'UNIDADE', item_order: 1, status: 'CANCELADO' },
    { product_text: 'Produto válido', quantity: 2, quantity_unit: 'CAIXA', item_order: 2, status: 'APROVADO' },
  ] });
  assert.equal((await app.send()).status, 200);
  const text = JSON.parse(app.requests[0].options.body).template.components[0].parameters[4].text;
  assert.equal(text, '• Produto válido — 2 caixas');
});

test('envia modelo com dados do banco e não duplica após aceite', async () => {
  const app = harness();
  const first = await app.send();
  assert.equal(first.status, 200);
  assert.equal(first.body.accepted, true);
  assert.equal(app.logs[0].status, 'ACCEPTED');
  const payload = JSON.parse(app.requests[0].options.body);
  assert.equal(payload.to, '5584999999999');
  assert.equal(payload.template.name, 'comprovante_avaria_entrega');
  assert.equal(payload.template.components[0].parameters[4].text, '• Produto X — 2 caixas');
  const again = await app.send();
  assert.equal(again.body.already_sent, true);
  assert.equal(app.providerCalls, 1);
});

test('rejeição explícita permite nova tentativa; falha de rede bloqueia duplicidade', async () => {
  const rejected = harness({ replies: ['reject'] });
  assert.equal((await rejected.send()).body.error, 'META_SEND_FAILED');
  assert.equal(rejected.logs[0].status, 'REJECTED');
  assert.equal((await rejected.send()).body.accepted, true);
  assert.equal(rejected.providerCalls, 2);

  const unknown = harness({ replies: ['network'] });
  assert.equal((await unknown.send()).body.error, 'SEND_STATUS_UNKNOWN');
  assert.equal(unknown.logs[0].status, 'UNKNOWN');
  assert.equal((await unknown.send()).status, 409);
  assert.equal(unknown.providerCalls, 1);
});
