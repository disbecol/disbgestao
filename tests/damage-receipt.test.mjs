import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import PDFLib from '../vendor/pdf-lib.min.js';
import { createDamageReceiptPdf, loadReceiptCatalogImages, receiptFileName, receiptGreeting, receiptTemplateComponents, receiptSha256, receiptSnapshot } from '../supabase/functions/send-damage-receipt/receipt-pdf.mjs';

const signatureBytes=readFileSync(new URL('./fixtures/receipt-signature.png',import.meta.url));
const code='DGB-11111111-22224444-88889999-AAAAAAAA';
const requestId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';

function harness({ configured = true, contactCode = '42', eligible = true, replies = [], mediaReplies = [], items = null, createdAt = '2026-10-05T13:00:00Z', logError = null, registryError = false, sealError = false, signatureError = false, reservedPhone = '5584999999999' } = {}) {
  const logs = [], registry = [];
  const requests = [];
  const uploads = [], generated = [], catalogRequests = [];
  const env = {
    SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    WHATSAPP_ACCESS_TOKEN: configured ? 'secret' : '',
    WHATSAPP_PHONE_NUMBER_ID: configured ? '98765' : '',
  };
  const rows = {
    damage_requests: { id: requestId, created_by: userId, created_at: createdAt, unit:'Matriz Caicó', signature_path: userId+'/signature.jpg', customer_code: '42', customer_name: 'Cliente Teste', map_number: '125', occurrence_date: '2026-10-05' },
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
      is() { return builder; }, in() { return builder; }, order() { return builder; }, limit() { return builder; },
      insert(value) { state.op = 'insert'; state.value = value; return builder; },
      update(value) { state.op = 'update'; state.value = value; return builder; },
      async result() {
        if(table==='damage_receipts'){
          if(state.op==='insert'){if(registryError)return {data:null,error:{code:'42501'}};const row={...state.value,id:'registry-'+(registry.length+1),receipt_code:code.slice(0,-1)+(registry.length+1)};registry.push(row);return {data:row,error:null};}
          if(state.op==='update'){if(sealError)return {data:null,error:{code:'42501'}};const row=registry.find(x=>x.id===state.filters.find(([k])=>k==='id')?.[1]);Object.assign(row,state.value);return {data:row,error:null};}
          return {data:registry.find(row=>state.filters.every(([key,value])=>row[key]===value))||null,error:null};
        }
        if (table === 'damage_receipt_sends') {
          if (state.op === 'insert') {
            if (logError) return { data: null, error: logError };
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
    async rpc(name,args){
      assert.equal(name,'reserve_damage_receipt_send');
      if(logError)return {data:null,error:logError};
      const {p_request_id:request_id,p_contact_id:contact_id,p_requested_by:requested_by,p_operation_id:operation_id,p_resend:resend}=args;
      const operation=logs.find(row=>row.operation_id===operation_id);
      if(operation){
        if(operation.request_id!==request_id||operation.contact_id!==contact_id||operation.requested_by!==requested_by||!!operation.resend_of!==resend)return {data:null,error:{message:'OPERATION_ID_CONFLICT'}};
        return {data:{...operation,reserved:false},error:null};
      }
      const pair=logs.filter(row=>row.request_id===request_id&&row.contact_id===contact_id);
      const inflight=pair.find(row=>['PROCESSING','UNKNOWN'].includes(row.status));
      if(inflight)return {data:{...inflight,reserved:false},error:null};
      const accepted=pair.filter(row=>row.status==='ACCEPTED').at(-1);
      if(accepted&&!resend)return {data:{...accepted,reserved:false},error:null};
      if(!accepted&&resend)return {data:null,error:{message:'RESEND_NOT_AVAILABLE'}};
      const attempt={id:'attempt-'+(logs.length+1),request_id,contact_id,requested_by,operation_id,status:'PROCESSING',recipient_phone:reservedPhone,resend_of:resend?accepted.id:null};
      logs.push(attempt);return {data:{...attempt,reserved:true},error:null};
    },
    storage:{from:()=>({download:async()=>({data:signatureError?null:new Blob([signatureBytes],{type:'image/png'}),error:signatureError?{message:'denied'}:null})})},
  });
  const source = readFileSync(new URL('../supabase/functions/send-damage-receipt/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\s*\n/gm, '');
  const js = stripTypeScriptTypes(source);
  vm.runInNewContext(js, {
    createClient, PDFLib, loadReceiptCatalogImages, receiptFileName, receiptGreeting, receiptTemplateComponents, receiptSha256, receiptSnapshot, Uint8Array, Map,
    createDamageReceiptPdf(damage, activeItems, library, images, verification) {
      generated.push({ damage, items: activeItems, verification });
      return createDamageReceiptPdf(damage, activeItems, library, images, verification);
    },
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
    Response, Date, Intl, console, FormData, Blob, AbortSignal,crypto:{randomUUID},
    async fetch(url, options) {
      if (url.startsWith('https://disbecol.github.io/disbgestao/imagens_produtos/')) {
        catalogRequests.push(url);
        return new Response(null, { status: 404 });
      }
      if (url.endsWith('/media')) {
        uploads.push({ url, options });
        const reply = mediaReplies.shift();
        if (reply === 'network') throw new Error('network');
        if (reply === 'reject') return new Response(JSON.stringify({ error: { code: 131053 } }), { status: 400 });
        return new Response(JSON.stringify({ id: '123456' }), { status: 200 });
      }
      providerCalls++;
      requests.push({ url, options });
      const reply = replies.shift();
      if (reply === 'network') throw new Error('network');
      if (reply === 'reject') return new Response(JSON.stringify({ error: { code: 132001 } }), { status: 400 });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 });
    },
  });

  async function send(auth = true, extra = {}) {
    const response = await handler(new Request('https://test/functions/v1/send-damage-receipt', {
      method: 'POST', headers: auth ? { Authorization: 'Bearer test' } : {},
      body: JSON.stringify({ request_id: requestId, contact_id: contactId,...extra }),
    }));
    return { status: response.status, body: await response.json() };
  }
  return { send, logs, registry, requests, uploads, generated, catalogRequests, get providerCalls() { return providerCalls; } };
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
  assert.deepEqual(app.generated[0].items.map(item => item.product_text), ['Produto válido']);
  const file = app.uploads[0].options.body.get('file');
  assert.equal(file.type, 'application/pdf');
  assert.equal((await PDFLib.PDFDocument.load(await file.arrayBuffer())).getPageCount(), 1);
});

test('envia modelo com dados do banco e não duplica após aceite', async () => {
  const app = harness();
  const first = await app.send();
  assert.equal(first.status, 200);
  assert.equal(first.body.accepted, true);
  assert.equal(app.logs[0].status, 'ACCEPTED');
  const payload = JSON.parse(app.requests[0].options.body);
  assert.equal(payload.to, '5584999999999');
  assert.equal(payload.template.name, 'comprovante_avaria_pdf');
  assert.deepEqual(payload.template.components[0], { type: 'header', parameters: [{ type: 'document', document: { id: '123456', filename: 'Comprovante_avaria_PDV_42_2026-10-05.pdf' } }] });
  assert.deepEqual(payload.template.components[1].parameters, [{ type: 'text', text: 'bom dia' }, { type: 'text', text: '05/10/2026' }]);
  const again = await app.send();
  assert.equal(again.body.already_sent, true);
  assert.equal(app.providerCalls, 1);
  assert.equal(app.uploads.length, 1);
});

test('PDF contém todos os produtos; apresentação não envia dados do produto como variável de texto', async () => {
  const app = harness({ items: [
    { product_text: 'Brahma\nChopp\t600ml', quantity: 2, quantity_unit: 'UNIDADE', item_order: 1, status: 'APROVADO' },
    { product_text: 'Skol 300ml', quantity: 1, quantity_unit: 'CAIXA', item_order: 2, status: 'PENDENTE' },
  ] });
  assert.equal((await app.send()).status, 200);
  const parameters = JSON.parse(app.requests[0].options.body).template.components[0].parameters;
  assert.equal(parameters[0].type, 'document');
  assert.equal(app.generated[0].items.length, 2);
  assert.deepEqual(JSON.parse(app.requests[0].options.body).template.components[1].parameters, [
    { type: 'text', text: 'bom dia' }, { type: 'text', text: '05/10/2026' },
  ]);
});

test('sem permissão de histórico não gera PDF nem chama a Meta', async () => {
  const app = harness({ logError: { code: '42501' } });
  assert.equal((await app.send()).body.error, 'SEND_LOG_FAILED');
  assert.equal(app.generated.length, 0);
  assert.equal(app.uploads.length, 0);
  assert.equal(app.providerCalls, 0);
});

test('falha no upload permite repetir, sem enviar mensagem de texto como alternativa', async () => {
  for (const failure of ['reject', 'network']) {
    const app = harness({ mediaReplies: [failure] });
    assert.equal((await app.send()).body.error, 'META_SEND_FAILED');
    assert.equal(app.logs[0].status, 'REJECTED');
    assert.equal(app.providerCalls, 0);
    assert.equal((await app.send()).body.accepted, true);
    assert.equal(app.providerCalls, 1);
  }
});

test('horário do registro, e não do reenvio, determina a saudação', async () => {
  for (const [createdAt, expected] of [['2026-10-05T14:59:00Z', 'bom dia'], ['2026-10-05T15:00:00Z', 'boa tarde'], ['2026-10-05T21:00:00Z', 'boa noite']]) {
    const app = harness({ createdAt });
    assert.equal((await app.send()).body.accepted, true);
    assert.equal(JSON.parse(app.requests[0].options.body).template.components[1].parameters[0].text, expected);
  }
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


test('identificador e hash do PDF são preservados antes do upload e detectam alteração',async()=>{
 const app=harness();assert.equal((await app.send()).body.accepted,true);assert.equal(app.registry.length,1);
 const record=app.registry[0],file=app.uploads[0].options.body.get('file');
 assert.equal(record.receipt_code,app.generated[0].verification.code);
 assert.equal(record.pdf_sha256,await receiptSha256(await file.arrayBuffer()));
 assert.equal(record.snapshot.customer_name,'Cliente Teste');assert.equal(record.snapshot.items[0].quantity,2);
 assert.equal(record.snapshot.signature_sha256,await receiptSha256(signatureBytes));
 const modified=new Uint8Array(await file.arrayBuffer());modified[50]^=1;
 assert.notEqual(record.pdf_sha256,await receiptSha256(modified));
});
test('sem assinatura, reserva ou selo persistido não transmite PDF nem mensagem',async()=>{
 for(const options of [{signatureError:true},{registryError:true},{sealError:true}]){
  const app=harness(options);assert.equal((await app.send()).status,502);assert.equal(app.uploads.length,0);assert.equal(app.providerCalls,0);assert.equal(app.logs[0].status,'REJECTED');
 }
});
test('mais itens que uma folha comporta não são truncados nem enviados',async()=>{
 const app=harness({items:Array.from({length:80},(_,i)=>({product_text:'Produto '+i,quantity:1,quantity_unit:'UNIDADE'}))});
 assert.equal((await app.send()).body.error,'RECEIPT_LAYOUT_TOO_LARGE');assert.equal(app.uploads.length,0);assert.equal(app.providerCalls,0);
});

test('reenvio exige confirmação explícita com UUID válido e um aceite anterior',async()=>{
  const app=harness();
  for(const body of [{resend:true},{resend:true,operation_id:'invalid'},{resend:'true',operation_id:randomUUID()},{operation_id:null}]){
    assert.equal((await app.send(true,body)).status,400);
  }
  assert.equal((await app.send(true,{resend:true,operation_id:randomUUID()})).body.error,'RESEND_NOT_AVAILABLE');
  assert.equal(app.logs.length,0);assert.equal(app.providerCalls,0);
});

test('confirmação nova preserva aceite e PDF antigos, gera outro código e pode ser repetida sem cobrar novamente',async()=>{
  const app=harness(),initialId=randomUUID(),resendId=randomUUID();
  const first=await app.send(true,{operation_id:initialId});assert.equal(first.body.accepted,true);
  const previous=structuredClone(app.logs[0]),oldReceipt=structuredClone(app.registry[0]);
  const resent=await app.send(true,{resend:true,operation_id:resendId});
  assert.equal(resent.body.accepted,true);assert.equal(resent.body.already_sent,false);assert.equal(resent.body.resent,true);
  assert.equal(app.logs.length,2);assert.equal(app.providerCalls,2);assert.equal(app.registry.length,2);
  assert.deepEqual(app.logs[0],previous);assert.deepEqual(app.registry[0],oldReceipt);
  assert.equal(app.logs[1].resend_of,app.logs[0].id);assert.equal(app.logs[1].operation_id,resendId);
  assert.notEqual(resent.body.receipt_code,first.body.receipt_code);
  const replay=await app.send(true,{resend:true,operation_id:resendId});
  assert.equal(replay.body.already_sent,true);assert.equal(replay.body.receipt_code,resent.body.receipt_code);
  const originalReplay=await app.send(true,{operation_id:initialId});
  assert.equal(originalReplay.body.receipt_code,first.body.receipt_code,'replay belongs to its own sealed PDF');
  const legacy=await app.send();assert.equal(legacy.body.already_sent,true);
  assert.equal(app.providerCalls,2);assert.equal(app.uploads.length,2);assert.equal(app.registry.length,2);
});

test('UUID da confirmação não pode ser reutilizado para mudar o modo da operação',async()=>{
  const app=harness(),operation_id=randomUUID();await app.send(true,{operation_id});
  assert.equal((await app.send(true,{resend:true,operation_id})).body.error,'OPERATION_ID_CONFLICT');
  assert.equal(app.providerCalls,1);assert.equal(app.logs.length,1);
});

test('rejeição é terminal para o UUID; outra tentativa deliberada usa um novo UUID',async()=>{
  const app=harness({replies:['reject']}),operation_id=randomUUID();
  assert.equal((await app.send(true,{operation_id})).body.error,'META_SEND_FAILED');
  assert.equal((await app.send(true,{operation_id})).body.error,'META_SEND_FAILED');
  assert.equal(app.providerCalls,1);assert.equal(app.logs.length,1);
  assert.equal((await app.send(true,{operation_id:randomUUID()})).body.accepted,true);
  assert.equal(app.providerCalls,2);assert.equal(app.logs[0].status,'REJECTED');
});

test('confirmação nova nunca ultrapassa um resultado UNKNOWN',async()=>{
  const app=harness({replies:[undefined,'network']});await app.send();
  assert.equal((await app.send(true,{resend:true,operation_id:randomUUID()})).body.error,'SEND_STATUS_UNKNOWN');
  assert.equal((await app.send(true,{resend:true,operation_id:randomUUID()})).body.error,'SEND_STATUS_UNKNOWN');
  assert.equal(app.providerCalls,2);assert.equal(app.logs.length,2);assert.equal(app.logs[0].status,'ACCEPTED');
  assert.equal(app.logs[1].status,'UNKNOWN');
});

test('confirmações concorrentes só reservam um reenvio enquanto o destinatário está em processamento',async()=>{
  const app=harness();await app.send();
  const results=await Promise.all([1,2].map(()=>app.send(true,{resend:true,operation_id:randomUUID()})));
  assert.equal(results.filter(result=>result.body.accepted===true&&!result.body.already_sent).length,1);
  assert.ok(results.some(result=>result.body.error==='SEND_IN_PROGRESS'));
  assert.equal(app.providerCalls,2);assert.equal(app.logs.length,2);
});

test('mudança de telefone durante a reserva encerra a tentativa sem transmitir ao destino antigo ou novo',async()=>{
  const app=harness({reservedPhone:'5584888888888'});
  assert.equal((await app.send()).body.error,'CONTACT_NOT_FOUND');
  assert.equal(app.logs[0].status,'REJECTED');assert.equal(app.logs[0].provider_error_code,'CONTACT_NOT_FOUND');
  assert.equal(app.providerCalls,0);assert.equal(app.uploads.length,0);assert.equal(app.registry.length,0);
});
