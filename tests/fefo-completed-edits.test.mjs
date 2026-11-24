import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const moduleSource = fs.readFileSync(new URL('../src/estoque/fefo-completed-edits.js', import.meta.url), 'utf8');

function createFeature({ isAdmin = false, reports = [], calls = [], notices = [] } = {}) {
  const count = {
    id: 'count-id', status: 'COMPLETED', count_code: 'FEFO-000016',
    unit: 'Matriz Caicó', counter_id: 'person-id',
    started_at: '2026-10-14T17:04:00.000Z', completed_at: '2026-10-14T19:32:00.000Z'
  };
  const rows = reports.length ? reports : [count];
  const fields = new Map();
  const buttons = [];
  for (const [id, value] of Object.entries({
    fefoCorrectionReason: '', fefoCorrectionStart: '2026-10-14T14:05',
    fefoCorrectionEnd: '2026-10-14T16:32', fefoCorrectionUnit: 'Matriz Caicó',
    fefoCorrectionCounter: 'person-id', fefoCorrectionSaveHeader: ''
  })) {
    fields.set(id, { value, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, focus() {}, querySelector() { return { disabled: false }; } });
  }
  const getElement = id => {
    if (id === 'modalActions') return { prepend: button => buttons.push(button) };
    if (!fields.has(id)) fields.set(id, { value: '', innerHTML: '', handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, focus() {}, prepend() {}, querySelector() { return { disabled: false }; } });
    return fields.get(id);
  };
  const client = {
    from(table) {
      const query = {
        select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
        single() { return Promise.resolve({ data: count, error: null }); },
        then(resolve, reject) {
          const data = table === 'profiles' ? [{ id: 'person-id', name: 'Pessoa', username: 'pessoa' }]
            : table === 'units' ? [{ name: 'Matriz Caicó' }] : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };
      return query;
    },
    async rpc(name, args) { calls.push({ name, args }); return { error: null }; }
  };
  const context = vm.createContext({});
  vm.runInContext(moduleSource, context);
  const feature = context.DISB_FEFO_COMPLETED_EDITS.create({
    document: { createElement: () => ({ addEventListener() {} }) },
    getElement, getReports: () => rows, getActiveCounts: () => [],
    getItemsByCount: () => new Map([['count-id', []]]), getProductsByCode: () => new Map(),
    getClient: () => client, getActiveUnit: () => 'Matriz Caicó', timeZone: 'America/Fortaleza',
    isAdmin: () => isAdmin, hasPermission: () => true, sortItems: () => 0,
    loadReports: async () => {}, fetchItemsForCount: async () => [], rememberItems() {}, renderReports() {},
    openModal() {}, closeModal() {}, toast: (...args) => notices.push(args),
    humanError: error => error.message, escapeHtml: value => String(value ?? ''),
    formatDate: value => String(value ?? ''), formatDateTime: value => String(value ?? ''),
    confirm: () => true
  });
  return { feature, fields, getElement, buttons };
}

test('aplicativo principal oferece edição somente ao abrir um relatório finalizado', () => {
  const buttons = [];
  const document = {
    addEventListener() {},
    createElement: () => ({ addEventListener() {} }),
    getElementById: id => id === 'modalActions' ? { prepend: button => buttons.push(button) } : null
  };
  const context = vm.createContext({ document, navigator: { onLine: true }, addEventListener() {}, setInterval() {}, setTimeout() {} });
  context.window = context;
  vm.runInContext(moduleSource, context);
  const hooked = app.replace(/\}\)\(\);\s*$/, `window.fefoEditSmoke=()=>{
    profile={role:'ADMIN'};
    fefoReports=[{id:'count-id',status:'COMPLETED',count_code:'FEFO-000016',unit:'Matriz Caicó',counter_name:'José Alves',started_at:'2026-10-19T12:05:14Z',completed_at:'2026-10-19T12:05:29Z'}];
    fefoItemsByCount.set('count-id',[]);
    openModal=()=>{};
    openFefoReport('count-id');
  };})();`);
  vm.runInContext(hooked, context, { timeout: 3000 });
  context.fefoEditSmoke();
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, 'Editar contagem');
});

test('botão de correção aparece somente para administrador em contagem finalizada', () => {
  const denied = createFeature({
    reports: [{ id: 'finished', status: 'COMPLETED' }, { id: 'active', status: 'IN_PROGRESS' }]
  });
  denied.feature.onReportOpened('finished');
  denied.feature.onReportOpened('active');
  assert.equal(denied.buttons.length, 0);
  const allowed = createFeature({
    isAdmin: true,
    reports: [{ id: 'finished', status: 'COMPLETED' }]
  });
  allowed.feature.onReportOpened('finished');
  assert.equal(allowed.buttons.length, 1);
});

test('cabeçalho exige justificativa e envia horário local corretamente ao backend', async () => {
  const calls = [], notices = [];
  const { feature, getElement } = createFeature({ isAdmin: true, calls, notices });
  await feature.openCorrection('count-id');
  const saveButton = getElement('fefoCorrectionSaveHeader');
  await saveButton.handlers.click();
  assert.equal(calls.length, 0);
  getElement('fefoCorrectionReason').value = 'Correção do relatório';
  await saveButton.handlers.click();
  assert.equal(calls[0].name, 'edit_completed_fefo_header_v2');
  assert.equal(calls[0].args.p_started_at, '2026-10-14T17:05:00.000Z');
  assert.equal(calls[0].args.p_completed_at, '2026-10-14T19:32:00.000Z');
  assert.equal(calls[0].args.p_reason, 'Correção do relatório');
  assert.ok(notices.some(([message]) => message.includes('Cabeçalho corrigido')));
});
