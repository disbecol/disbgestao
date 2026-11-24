import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/estoque/fefo-reports.js', import.meta.url), 'utf8');

test('módulo é carregado antes do aplicativo e está no cache offline', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const moduleUrl = 'src/estoque/fefo-reports.js?v=1.7.111-fefo-reports';
  const appUrl = 'app.js?v=1.7.111-devolucoes-reincidentes';
  assert.ok(html.indexOf(moduleUrl) >= 0);
  assert.ok(html.indexOf(moduleUrl) < html.indexOf(appUrl));
  assert.ok(sw.includes(moduleUrl));
  assert.ok(sw.includes(appUrl));
});

function harness({ allowed = true, fail = false } = {}) {
  const fields = new Map([
    ['tbodyFefoReports', { innerHTML: '' }],
    ['fefoReportSearch', { value: '' }],
    ['fefoReportUnit', { value: '' }],
    ['fefoReportFrom', { value: '' }],
    ['fefoReportTo', { value: '' }]
  ]);
  const counts = [
    { id: 'one', count_code: 'FEFO-1', unit: 'Matriz', counter_name: 'Ana', status: 'COMPLETED', completed_at: '2026-10-14T19:32:00Z' },
    { id: 'two', count_code: 'FEFO-2', unit: 'Filial', counter_name: 'Bia', status: 'COMPLETED', completed_at: '2026-10-15T19:32:00Z' }
  ];
  const items = [
    { count_id: 'one', product_code: '2', product_name: 'Água; "azul"', lot: 'L123', validity_date: '2027-01-02' },
    { count_id: 'one', product_code: '1', product_name: 'Bebida', validity_date: '2026-12-01' }
  ];
  const state = { reports: [], items: new Map(), modal: null, opened: [], notices: [], downloads: [] };
  const context = vm.createContext({
    Blob,
    URL: { createObjectURL(blob) { state.blob = blob; return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout() {}
  });
  vm.runInContext(source, context);
  const feature = context.DISB_FEFO_REPORTS.create({
    document: { createElement: () => ({ click() { state.downloads.push(this.download); } }) },
    getElement: id => fields.get(id),
    getReports: () => state.reports, setReports: rows => { state.reports = rows; },
    getActiveCounts: () => [{ id: 'active', count_code: 'FEFO-A', status: 'IN_PROGRESS' }],
    getItemsByCount: () => state.items,
    getClient: () => ({}), hasPermission: () => allowed,
    fetchCounts: async () => { if (fail) throw new Error('falha'); return counts; },
    fetchItemsForCounts: async () => items,
    rememberItems(rows, ids) { for (const id of ids) state.items.set(id, rows.filter(item => item.count_id === id)); },
    sortItems: (a, b) => a.validity_date.localeCompare(b.validity_date),
    validityInfo: () => ({ className: 'ok', label: 'válido' }),
    escapeHtml: value => String(value ?? ''), formatDate: value => String(value ?? ''),
    formatDateTime: value => String(value ?? ''), localIsoDate: () => '2026-10-14',
    timeZone: 'America/Fortaleza',
    openModal: (...args) => { state.modal = args; }, closeModal() {},
    onReportOpened: id => state.opened.push(id),
    toast: (...args) => state.notices.push(args), humanError: error => error.message
  });
  return { feature, fields, state };
}

test('carrega relatórios, filtra por lote e abre contagens finalizadas e ativas', async () => {
  const { feature, fields, state } = harness();
  await feature.load();
  fields.get('fefoReportSearch').value = 'l123';
  feature.render();
  assert.match(fields.get('tbodyFefoReports').innerHTML, /FEFO-1/);
  assert.doesNotMatch(fields.get('tbodyFefoReports').innerHTML, /FEFO-2/);
  feature.open('one');
  assert.match(state.modal[2], /Água/);
  feature.open('active');
  assert.equal(state.modal[1], 'Contagem em andamento');
  assert.deepEqual(state.opened, ['one', 'active']);
});

test('exporta CSV ordenado e preserva caracteres especiais', async () => {
  const { feature, state } = harness();
  await feature.load();
  feature.open('one');
  state.modal[3][0].onClick();
  assert.equal(state.downloads[0], 'contagem_20261014_1632.csv');
  const csv = await state.blob.text();
  assert.match(csv, /1;Bebida;2026-12-01/);
  assert.match(csv, /2;"Água; ""azul""";2027-01-02/);
  assert.ok(csv.indexOf('1;Bebida') < csv.indexOf('2;"Água'));
});

test('respeita permissões e apresenta erros de carregamento', async () => {
  const denied = harness({ allowed: false });
  await denied.feature.load();
  assert.equal(denied.state.reports.length, 0);
  const broken = harness({ fail: true });
  await broken.feature.load();
  assert.deepEqual(broken.state.notices, [['falha', 'error']]);
});
