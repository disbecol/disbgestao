import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/puxada/pull-cycle-delete.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function createFeature() {
  const calls = [], notices = [], farolButtons = [];
  let admin = false, actions;
  const input = { value: '' };
  const confirmButton = { disabled: false, textContent: '' };
  const farolDetail = { dataset: { pullDetail: 'transfer-id' }, parentElement: { appendChild(button) { farolButtons.push(button); } } };
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const feature = context.DISB_PULL_CYCLE_DELETE.create({
    document: { addEventListener() {}, createElement: () => ({ dataset: {} }) },
    getElement: id => id === 'pullDeleteConfirmCode' ? input : id === 'pullFarolCards' ? { querySelectorAll: () => [farolDetail] } : null,
    getHistory: () => [], getPlans: () => [],
    getClient: () => ({
      rpc: async name => {
        calls.push(name);
        return { data: name === 'preview_pull_cycle_deletion'
          ? { trip_code: 'PUX-0000041', cycle_type: 'TRANSFER', plate: 'ABC1234', events: 3, checklists: 2, files: 0, nris_preserved: 1 }
          : { files: [] } };
      },
      from: () => ({ select() { return this; }, limit() { return Promise.resolve({ data: [], error: null }); } }),
      storage: { from: () => ({ remove: async () => ({ error: null }) }) }
    }),
    isAdmin: () => admin, isOnline: () => true,
    escapeHtml: value => String(value), toast: (...args) => notices.push(args), humanError: error => error.message,
    openModal(_title, _subtitle, _body, nextActions) { actions = nextActions; },
    closeModal() {},
    loadHistory() {}, loadPlans() {}, loadFarol() {}
  });
  return {
    feature, calls, notices, farolButtons, confirmButton,
    setAdmin(value) { admin = value; },
    get actions() { return actions; },
    input
  };
}

test('excluir ciclo exige administrador e o código exato antes da RPC', async () => {
  const test = createFeature();
  await test.feature.openPullDeleteCycle('trip-id');
  assert.deepEqual(test.calls, []);

  test.setAdmin(true);
  test.feature.wrapRenderFarol(() => {})();
  assert.equal(test.farolButtons[0].dataset.pullDeleteCycle, 'transfer-id');
  assert.match(test.feature.wrapPlanCardHtml(() => '<article><div class="pull-plan-actions"></div></article>')(
    { id: 'planned-id', plate: 'ABC1234', cycle_type: 'TRANSFER' }, true
  ), /data-pull-delete-plan="planned-id"/);
  assert.match(test.feature.wrapPlanCardHtml(() => '<article><div class="pull-plan-actions"></div></article>')(
    { id: 'started-id', trip_id: 'transfer-id', cycle_type: 'TRANSFER' }, true
  ), /data-pull-delete-cycle="transfer-id"/);

  await test.feature.openPullDeleteCycle('trip-id');
  assert.deepEqual(test.calls, ['preview_pull_cycle_deletion']);
  test.input.value = 'PUX-ERRADO';
  await test.actions[1].onClick({ currentTarget: test.confirmButton });
  assert.deepEqual(test.calls, ['preview_pull_cycle_deletion']);
  test.input.value = 'PUX-0000041';
  await test.actions[1].onClick({ currentTarget: test.confirmButton });
  assert.deepEqual(test.calls, ['preview_pull_cycle_deletion', 'delete_pull_cycle']);
});

test('app.js conecta o módulo ao HTML das viagens planejadas', () => {
  const document = { addEventListener() {} };
  const context = vm.createContext({ document, navigator: { onLine: true }, addEventListener() {}, setInterval() {}, setTimeout() {} });
  context.window = context;
  vm.runInContext(source, context);
  const hooked = app.replace(/\}\)\(\);\s*$/, `window.pullDeleteIntegration=()=>{
    profile={role:'ADMIN'};
    return pullPlanCardHtml({id:'plan-id',cycle_type:'TRANSFER',status:'PLANNED',plate:'ABC1234',factory:'Caicó',origin_unit:'Matriz Caicó',driver1_name:'Motorista'},true);
  };})();`);
  vm.runInContext(hooked, context, { timeout: 3000 });
  assert.match(context.pullDeleteIntegration(), /data-pull-delete-plan="plan-id"/);
});
