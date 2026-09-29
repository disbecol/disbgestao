import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'app.js'), 'utf8');
const marker = 'dispatchDamagePushV170=async function(kind,requestId){';
const start = source.lastIndexOf(marker);
const end = source.indexOf('\n};', start);
assert.ok(start >= 0 && end > start, 'rotina de dispatch nao encontrada');
const implementation = source.slice(start, end + 3);

async function dispatchWith(response) {
  const context = {
    authUser: { id: 'user-1' },
    navigator: { onLine: true },
    window: {},
    console: { log() {}, warn() {} },
    pushOnlineSessionV171: async () => ({ access_token: 'session-token' }),
    sb: { functions: { invoke: async () => response } },
  };
  vm.runInNewContext(`var dispatchDamagePushV170;\n${implementation}`, context);
  const ok = await context.dispatchDamagePushV170('delivery', 'request-1');
  return { ok, diagnostic: context.window.__lastPushDispatchV170 };
}

test('nenhum destinatario nao e informado como push enviado', async () => {
  const { ok, diagnostic } = await dispatchWith({ data: { recipients: 0, sent: 0, failed: 0 }, error: null });
  assert.equal(ok, false);
  assert.match(diagnostic.error, /SEM_DESTINATARIOS/);
});

test('falha parcial de entrega aparece no diagnostico', async () => {
  const { ok, diagnostic } = await dispatchWith({ data: { recipients: 2, sent: 1, failed: 1, errors: ['FCM_404'] }, error: null });
  assert.equal(ok, false);
  assert.match(diagnostic.error, /FCM_404/);
});

test('sucesso exige pelo menos uma entrega e nenhuma falha', async () => {
  const { ok, diagnostic } = await dispatchWith({ data: { recipients: 1, sent: 1, failed: 0 }, error: null });
  assert.equal(ok, true);
  assert.equal(diagnostic.error, null);
});

test('erro da Edge Function nao e ocultado', async () => {
  const { ok, diagnostic } = await dispatchWith({ data: { error: 'UNIDADE_DA_SOLICITACAO_AUSENTE' }, error: null });
  assert.equal(ok, false);
  assert.match(diagnostic.error, /UNIDADE_DA_SOLICITACAO_AUSENTE/);
});

test('resposta HTTP de erro mostra a mensagem enviada pelo servidor', async () => {
  const error = {
    message: 'Edge Function returned a non-2xx status code',
    context: { clone: () => ({ json: async () => ({ error: 'SOLICITACAO_NAO_ENCONTRADA' }) }) },
  };
  const { ok, diagnostic } = await dispatchWith({ data: null, error });
  assert.equal(ok, false);
  assert.equal(diagnostic.error, 'SOLICITACAO_NAO_ENCONTRADA');
});
