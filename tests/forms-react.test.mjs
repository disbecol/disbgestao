import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import F from '../src/forms/forms.js';
import { formsThemeHarness } from './helpers/forms-theme-harness.mjs';
import { definition, person, responses, unit } from './helpers/forms-theme-fixtures.mjs';

const copy = value => structuredClone(value);
const draft = () => copy(responses.find(row => row.status === 'DRAFT'));
function editable(options = {}) {
  return formsThemeHarness({ ...options, async rpc(name, args, state) {
    if (options.rpc) { const custom = await options.rpc(name, args, state); if (custom !== undefined) return custom; }
    if (name === 'save_form_response') {
      const index = state.db.form_responses.findIndex(row => row.id === args.p_id);
      const row = state.db.form_responses[index];
      assert.equal(args.p_expected_revision, row.revision);
      const updated = { ...row, answers: copy(args.p_answers), revision: row.revision + 1, status: args.p_finalize ? 'COMPLETED' : 'DRAFT', completed_at: args.p_finalize ? '2026-11-24T12:00:00Z' : null };
      const score = F.score(updated.schema_snapshot, updated.answers);
      Object.assign(updated, { score: score.percent, ok_count: score.ok, nok_count: score.nok, na_count: score.na });
      state.db.form_responses[index] = updated;
      return { data: copy(updated), error: null };
    }
    if (name === 'save_form_definition') {
      const saved = { ...copy(args.p_payload), id: args.p_id || 'saved-form', version: args.p_expected_version + 1 };
      state.db.form_definitions = [saved];
      return { data: copy(saved), error: null };
    }
  } });
}
const clickAction = (h, action, suffix = '') => h.click(`[data-fm-action="${action}"]${suffix}`);

test('Forms uses its compiled React entry, shares the session and remains in the offline build', () => {
  const html = fs.readFileSync('index.html', 'utf8'), sw = fs.readFileSync('sw.js', 'utf8');
  const url = html.match(/<script src="(src\/gestao-app\/forms-react.js\?v=[^"]+)"/)[1];
  assert.ok(sw.includes(url));
  assert.ok(html.indexOf(url) < html.indexOf('<script src="app.js?'));
  assert.ok(!html.includes('src/forms/forms-ui.js'));
  const main = fs.readFileSync('modules/gestao/src/main.ts', 'utf8');
  assert.ok(!/createClient|signInWithPassword|localStorage.*token/.test(main));
  const h = formsThemeHarness();
  assert.equal(h.engine, 'react-typescript');
  h.destroy();
});

test('React catalog preserves available, draft and completed lists and local filters', async () => {
  const h = formsThemeHarness();
  await h.enter('forms-fill');
  assert.equal(h.document.querySelectorAll('.fm-model').length, 1);
  await h.input('#formsCatalogSearch', 'inexistente');
  assert.equal(h.get('.fm-model').classList.contains('hidden'), true);
  await h.input('#formsCatalogSearch', 'inspeção');
  assert.equal(h.get('.fm-model').classList.contains('hidden'), false);
  await clickAction(h, 'application-tab', '[data-id="drafts"]');
  assert.equal(h.get('#formsApplicationDrafts').classList.contains('hidden'), false);
  assert.match(h.get('#formsApplicationDrafts').textContent, /FORM-draft/);
  await clickAction(h, 'application-tab', '[data-id="completed"]');
  assert.equal(h.get('#formsApplicationCompleted').querySelectorAll('tbody tr').length, 4);
  assert.equal(h.writes.length, 0);
  h.destroy();
});

test('React builder preserves entered data across tabs, question controls and publication', async () => {
  const h = editable();
  await h.enter('forms-manage');
  await clickAction(h, 'edit', '[data-id="theme-form"]');
  const name = 'Inspeção "A" <equipe> & revisão';
  await h.input('[data-fm-meta="name"]', name);
  await h.input('[data-fm-meta="description"]', 'Detalhes preenchidos manualmente.');
  assert.equal(h.get('[data-fm-meta="form_type"]').value, 'DTO');
  assert.ok(h.document.querySelector('#formsAreas'), 'The datalist next to a field must remain in the DOM');
  assert.equal(h.get('[data-fm-meta="area"]').getAttribute('list'), 'formsAreas');
  await clickAction(h, 'builder-tab', '[data-id="questions"]');
  await h.change('[data-fm-q="type"][data-id="q0"]', 'SINGLE_CHOICE');
  await h.change('[data-fm-q="options"][data-id="q0"]', 'Aprovado\nRevisar');
  await h.change('[data-fm-q="scored"][data-id="q0"]', true);
  await h.input('[data-fm-q="label"][data-id="q0"]', 'O veículo está liberado?');
  await clickAction(h, 'builder-tab', '[data-id="preview"]');
  assert.match(h.get('#formsBuilderContent').textContent, /O veículo está liberado/);
  assert.match(h.get('#formsBuilderContent').textContent, /Aprovado \/ Revisar/);
  await clickAction(h, 'builder-tab', '[data-id="data"]');
  assert.equal(h.get('[data-fm-meta="name"]').value, name);
  await clickAction(h, 'publish');
  const save = h.writes.find(call => call.name === 'save_form_definition');
  assert.equal(save.args.p_expected_version, 1);
  assert.equal(save.args.p_payload.name, name);
  assert.equal(save.args.p_payload.schema.sections[0].fields[0].type, 'SINGLE_CHOICE');
  assert.equal(save.args.p_payload.schema.sections[0].fields[0].expected, 'Aprovado');
  assert.equal(h.memory.has(`disb_forms_builder_v1_admin_${unit}`), false);
  assert.match(h.get('#view-forms-manage').textContent, /Publicado/);
  assert.deepEqual(h.messages.filter(([, kind]) => kind === 'error'), []);
  h.destroy();
});

test('publication conflict keeps the local builder, selected controls and original revision', async () => {
  const h = editable({ rpc: name => name === 'save_form_definition' ? { data: null, error: { message: 'FORM_VERSION_CONFLICT' } } : undefined });
  await h.enter('forms-manage'); await clickAction(h, 'edit', '[data-id="theme-form"]');
  await h.input('[data-fm-meta="name"]', 'Alteração ainda não publicada');
  await clickAction(h, 'publish');
  assert.equal(h.get('[data-fm-meta="name"]').value, 'Alteração ainda não publicada');
  assert.match(h.messages.at(-1)[0], /alterado em outra tela/);
  assert.equal(h.writes.at(-1).args.p_expected_version, 1);
  assert.ok(h.memory.has(`disb_forms_builder_v1_admin_${unit}`));
  h.destroy();
});

test('typed controls preserve text, dates, numbers and choice answers through autosave', async () => {
  const row = draft();
  row.schema_snapshot = { sections: [{ id: 'fields', title: 'Campos', fields: [
    { id: 'text', label: 'Texto', type: 'TEXT', required: true },
    { id: 'long', label: 'Descrição', type: 'LONG_TEXT', required: true },
    { id: 'number', label: 'Quantidade', type: 'NUMBER', required: true },
    { id: 'date', label: 'Dia', type: 'DATE', required: true },
    { id: 'single', label: 'Opção', type: 'SINGLE_CHOICE', options: ['Primeira', 'Segunda'], required: true },
    { id: 'multiple', label: 'Itens', type: 'MULTIPLE_CHOICE', options: ['A', 'B'], required: true }
  ] }] }; row.evaluated_people = []; row.answers = {};
  const h = editable({ db: { form_responses: [row] } });
  await h.enter('forms-fill'); await clickAction(h, 'resume', '[data-id="draft"]');
  for (const [id, value] of [['text', 'Texto <literal> & acentos'], ['long', 'Uma linha\nOutra linha'], ['number', '12.5'], ['date', '2026-11-24']]) await h.input(`[data-fm-answer="${id}"]`, value);
  await h.change('[data-fm-answer="single"]', 'Segunda');
  await h.change('[data-fm-multiple="multiple"][value="B"]', true);
  await h.autosave();
  const saved = h.writes.find(call => call.name === 'save_form_response');
  assert.equal(saved.args.p_answers.text.value, 'Texto <literal> & acentos');
  assert.equal(saved.args.p_answers.long.value, 'Uma linha\nOutra linha');
  assert.equal(saved.args.p_answers.number.value, 12.5);
  assert.equal(saved.args.p_answers.date.value, '2026-11-24');
  assert.equal(saved.args.p_answers.single.value, 'Segunda');
  assert.deepEqual(saved.args.p_answers.multiple.value, ['B']);
  assert.equal(saved.args.p_finalize, false);
  assert.match(h.get('#formsSaveStatus').textContent, /salvo no servidor/);
  h.destroy();
});

test('offline draft survives stopping and reopening the React module, without a server write', async () => {
  const h = formsThemeHarness({ confirm: () => false });
  await h.enter('forms-fill'); await clickAction(h, 'resume', '[data-id="draft"]');
  h.online.onLine = false;
  await h.input('[data-fm-answer="text"]', 'Guardado enquanto estava sem conexão');
  assert.equal(h.api.canChangeUnit(), false);
  await clickAction(h, 'save-response');
  assert.equal(h.writes.length, 0);
  const memory = h.memory;
  h.destroy();
  const next = formsThemeHarness({ memory });
  await next.enter('forms-fill'); await clickAction(next, 'resume', '[data-id="draft"]');
  assert.equal(next.get('[data-fm-answer="text"]').value, 'Guardado enquanto estava sem conexão');
  assert.equal(next.writes.length, 0);
  next.destroy();
});

test('finalization keeps one revisioned RPC, clears the draft and opens the completed answers', async () => {
  const h = editable();
  await h.enter('forms-fill'); await clickAction(h, 'resume', '[data-id="draft"]');
  await clickAction(h, 'finish');
  const saves = h.writes.filter(call => call.name === 'save_form_response');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].args.p_finalize, true);
  assert.equal(saves[0].args.p_expected_revision, 1);
  assert.equal(h.memory.has('disb_forms_response_v1_admin_draft'), false);
  assert.match(h.get('#modalBody').textContent, /Todos estão usando EPIs/);
  assert.match(h.get('#view-forms-fill').textContent, /Preencher formulários/);
  await clickAction(h, 'export-one', '[data-id="draft"]');
  assert.equal(h.downloads.length, 1);
  assert.match(await h.downloads[0].blob.text(), /FORM-draft/);
  h.destroy();
});

test('start evaluation selects people in the React modal and preserves the existing RPC payload', async () => {
  const h = editable({ async rpc(name, args) {
    if (name !== 'start_form_response_evaluated') return;
    assert.deepEqual(Array.from(args.p_people), ['worker']);
    return { data: { ...draft(), answers: {}, evaluated_people: [copy(person)] }, error: null };
  } });
  await h.enter('forms-fill'); await clickAction(h, 'start', '[data-id="theme-form"]');
  await h.change('[data-fm-list="start_people"][value="worker"]', true);
  await clickAction(h, 'start-evaluated');
  assert.equal(h.writes.filter(call => call.name === 'start_form_response_evaluated').length, 1);
  assert.ok(h.document.querySelector('#fm-answer-q0-worker'));
  assert.equal(h.get('#modal').classList.contains('open'), false);
  h.destroy();
});

test('calendar and schedule people list can mount and unmount without stale React roots', async () => {
  const h = formsThemeHarness({ db: { form_assignments: [{ id: 'pending', form_id: definition.id, unit, user_id: 'admin', user_name: 'Aplicador de exemplo', due_date: '2026-11-24', status: 'PENDING' }] } });
  await h.enter('forms-schedule');
  await clickAction(h, 'schedule-view', '[data-id="calendar"]');
  assert.ok(h.document.querySelectorAll('.fm-calendar-day').length >= 28);
  await clickAction(h, 'calendar-assignment', '[data-id="pending"]');
  assert.match(h.get('#modalBody').textContent, /Aplicador de exemplo/);
  await clickAction(h, 'new-schedule');
  await h.change('#formsScheduleModel', definition.id);
  assert.equal(h.get('#formsSchedulePeople').querySelectorAll('input').length, 1);
  await clickAction(h, 'schedule-view', '[data-id="list"]');
  assert.ok(h.document.querySelector('#formsSchedulePeople'));
  assert.deepEqual(h.messages.filter(([, kind]) => kind === 'error'), []);
  h.destroy();
});

test('own evaluations remain read only and CSV contains only the server-provided evaluation', async () => {
  const row = copy(responses[3]);
  row._self_view = true; row.evaluated_user_id = person.id; row.evaluated_name = person.name; row.evaluated_area = person.area;
  row.answers = F.evaluationAnswers(row.schema_snapshot, row.answers, person.id);
  row.score = 100; row.ok_count = 10; row.nok_count = 0; row.na_count = 0;
  const h = formsThemeHarness({ context: { user: { id: person.id }, profile: person }, permissions: ['FORMS_SELF_VIEW'], selfResults: [row] });
  await h.enter('forms-self');
  await clickAction(h, 'self-detail', '[data-id="good"]');
  assert.match(h.get('#modalBody').textContent, /Todos estão usando EPIs/);
  assert.equal(h.document.querySelector('#modalBody [data-fm-action="plan"]'), null);
  await clickAction(h, 'self-export-one', '[data-id="good"]');
  const csv = await h.downloads[0].blob.text();
  assert.match(csv, /FORM-good/); assert.doesNotMatch(csv, /FORM-bad|FORM-draft/);
  assert.equal(h.writes.length, 0);
  assert.ok(h.reads.some(call => call.name === 'my_form_evaluations'));
  h.destroy();
});

test('model content stays literal and cannot add HTML or change action attributes', async () => {
  const model = copy(definition), label = `" ><img src=x onerror="alert(1)"> &lt;texto&gt;`;
  model.name = label; model.schema.sections[0].fields[0].label = label;
  const h = formsThemeHarness({ db: { form_definitions: [model] } });
  await h.enter('forms-manage');
  assert.equal(h.get('.fm-model h2').textContent, label);
  assert.equal(h.document.querySelector('.fm-model img'), null);
  await clickAction(h, 'preview', '[data-id="theme-form"]');
  assert.equal(h.get('#modalBody h2').textContent, label);
  assert.equal(h.document.querySelector('#modalBody img'), null);
  h.destroy();
});

test('generic modal replacement releases React content and reopening creates a working view', async () => {
  const h = formsThemeHarness();
  await h.enter('forms-manage'); await clickAction(h, 'preview', '[data-id="theme-form"]');
  const body = h.get('#modalBody'), actions = h.get('#modalActions');
  const modals = h.appModals();
  modals.open('Outro módulo', '', '<p>Conteúdo de outro módulo</p>', []);
  assert.match(body.textContent, /outro módulo/);
  await clickAction(h, 'preview', '[data-id="theme-form"]');
  assert.match(body.textContent, /Prévia do formulário/);
  assert.doesNotMatch(body.textContent, /outro módulo/);
  modals.close();
  assert.equal(body.children.length, 0);
  await clickAction(h, 'preview', '[data-id="theme-form"]');
  assert.match(body.textContent, /Prévia do formulário/);
  const app = fs.readFileSync('app.js', 'utf8');
  for (const name of ['openModal', 'closeModal']) {
    const block = app.slice(app.indexOf(`function ${name}(`), app.indexOf('\n', app.indexOf(`function ${name}(`)));
    assert.match(block, /DISB_FORMS_UI\?\.release\?\.\(\$\('modalBody'\)\)/);
    assert.match(block, /DISB_FORMS_UI\?\.release\?\.\(\$\('modalActions'\)\)/);
  }
  h.destroy();
});

test('destroy removes lifecycle listeners and clears mounted pages for a different user or unit', async () => {
  const h = formsThemeHarness();
  await h.enter('forms-manage');
  assert.equal(h.events.get('online').size, 1);
  h.destroy();
  assert.equal(h.get('#view-forms-manage').children.length, 0);
  for (const handlers of h.events.values()) assert.equal(handlers.size, 0);
  await h.emit('online');
  assert.equal(h.writes.length, 0);
});

test('monthly charts retain separate SVG lines, labels and twelve bars after JSX conversion', async () => {
  const h = formsThemeHarness();
  await h.enter('forms-report'); await clickAction(h, 'report-tab', '[data-id="conformity"]');
  const svg = h.get('.fm-chart svg');
  assert.equal(svg.getAttribute('viewBox'), '0 0 990 280');
  assert.equal(svg.querySelectorAll('line').length, 5);
  assert.equal(svg.querySelectorAll('rect').length, 12);
  assert.equal(svg.querySelectorAll('line text, rect text, polyline text').length, 0);
  assert.equal(svg.querySelectorAll('polyline').length, 1);
  assert.doesNotMatch(svg.outerHTML, /NaN|\[object Object\]/);
  h.destroy();
});

test('a unit switch clears the previous React pages and only queries the newly selected unit', async () => {
  const h = formsThemeHarness({ context: { units: [unit, 'Filial Pau dos Ferros'] } });
  await h.enter('forms-fill');
  assert.match(h.get('#view-forms-fill').textContent, /Inspeção da equipe/);
  h.api.stop(); h.context.unit = 'Filial Pau dos Ferros';
  await h.enter('forms-fill');
  assert.match(h.get('#view-forms-fill').textContent, /Filial Pau dos Ferros/);
  assert.doesNotMatch(h.get('#view-forms-fill').textContent, /Inspeção da equipe|FORM-draft/);
  assert.equal(h.writes.length, 0);
  h.destroy();
});

test('a stale save result cannot repaint a previous user or unit after the module stops', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = editable({ rpc(name) { if (name === 'save_form_response') return pending; } });
  await h.enter('forms-fill'); await clickAction(h, 'resume', '[data-id="draft"]');
  await h.input('[data-fm-answer="text"]', 'Resposta da unidade anterior');
  await clickAction(h, 'save-response');
  h.api.stop(); h.context.unit = 'Filial Pau dos Ferros';
  release({ data: { ...draft(), answers: { text: { value: 'Resposta antiga' } }, revision: 2 }, error: null });
  await h.settle();
  assert.equal(h.get('#view-forms-fill').children.length, 0);
  assert.ok(h.memory.has('disb_forms_response_v1_admin_draft'));
  h.destroy();
});

test('an answer-save conflict keeps the local response available for recovery', async () => {
  const h = editable({ rpc: name => name === 'save_form_response' ? { data: null, error: { message: 'FORM_VERSION_CONFLICT' } } : undefined });
  await h.enter('forms-fill'); await clickAction(h, 'resume', '[data-id="draft"]');
  await h.input('[data-fm-answer="text"]', 'Resposta preservada');
  await clickAction(h, 'save-response');
  assert.equal(h.get('[data-fm-answer="text"]').value, 'Resposta preservada');
  assert.match(h.messages.at(-1)[0], /alterado em outra tela/);
  assert.equal(JSON.parse(h.memory.get('disb_forms_response_v1_admin_draft')).answers.text.value, 'Resposta preservada');
  h.destroy();
});
