import test from 'node:test';import assert from 'node:assert/strict';
import {formsThemeHarness} from './helpers/forms-theme-harness.mjs';import {escalaFixture} from '../modules/gestao/tests/escala-fixture.ts';
import {generateMonth} from '../modules/gestao/src/escala/engine.ts';
function fixture(){const s=escalaFixture();s.staff.forEach(p=>p.area='Entrega');s.memberships=s.memberships.filter(m=>s.teams.slice(0,2).some(t=>t.id===m.team_id));s.composition_token='fixture-token';return s;}
function harness(options={}){const state=structuredClone(options.state||fixture());return {...formsThemeHarness({...options,factory:'createEscala',async rpc(name,args){if(options.rpc){const r=await options.rpc(name,args);if(r!==undefined)return r;}if(name==='escala_state')return {data:structuredClone(state),error:null};if(name==='escala_save_composition'){for(const a of args.p_assignments)for(const id of a.members)state.memberships.push({id:'auto-'+id,team_id:a.team_id,staff_id:id,starts_on:args.p_month,ends_on:'2026-11-30',origin:'AUTO',draw_month:args.p_month,override_reason:'',revision:1});state.composition_token='next-token';if(state.plan)state.plan.revision++;return {data:{ok:true},error:null};}}}),state};}
async function button(h,text){const b=[...h.document.querySelectorAll('.escala-app button')].find(b=>b.textContent.trim()===text);assert.ok(b,text);if(b.getAttribute('type')==='submit')b.closest('form').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));else b.click();await h.settle();}
test('prévia mantém equipes definidas, mostra as demais e só grava ao salvar',async()=>{
 const h=harness();await h.enter('escala-teams');await button(h,'Sortear colaboradores');assert.equal(h.writes.length,0);assert.match(h.get('.escala-dialog').textContent,/2 equipe\(s\) preservada/);assert.equal(h.document.querySelectorAll('.escala-dialog .escala-team-grid article').length,8);
 await button(h,'Salvar equipes sorteadas');const save=h.writes.find(w=>w.name==='escala_save_composition');assert.equal(save.args.p_assignments.length,8);assert.equal(save.args.p_helpers,2);assert.equal(save.args.p_area,'Entrega');assert.ok(save.args.p_request_id);assert.equal(h.state.memberships.length,30);assert.ok(!h.document.querySelector('.escala-dialog'));h.destroy();
});
test('Gerar sorteio preenche equipes vazias antes de gerar as folgas e mantém o calendário em rascunho',async()=>{
 const h=harness();await h.enter('escala-calendar');await button(h,'✦ Gerar sorteio');assert.ok(h.document.querySelector('.escala-dialog'));assert.equal(h.writes.length,0);await button(h,'Salvar equipes e gerar folgas');assert.equal(h.writes.filter(w=>w.name==='escala_save_composition').length,1);assert.ok(h.get('.escala-statusbar').textContent.includes('Rascunho'));assert.ok(h.get('.escala-statusbar').textContent.includes('alterações neste aparelho'));assert.equal(h.document.querySelectorAll('[data-escala-day]').length,30);h.destroy();
});
test('falta de pessoal é informada sem gravar uma composição incompleta',async()=>{
 const state=fixture();state.staff[7].status='INACTIVE';const h=harness({state});await h.enter('escala-teams');await button(h,'Sortear colaboradores');assert.match(h.get('.escala-dialog').textContent,/Faltam 1 ajudante/);const save=[...h.document.querySelectorAll('.escala-dialog button')].find(b=>b.textContent==='Salvar equipes sorteadas');assert.equal(save.disabled,true);assert.equal(h.writes.length,0);h.destroy();
});
test('conflito de revisão deixa a prévia aberta e não afirma que o sorteio foi salvo',async()=>{
 const h=harness({rpc:name=>name==='escala_save_composition'?{data:null,error:{message:'ESCALA_VERSION_CONFLICT'}}:undefined});await h.enter('escala-teams');await button(h,'Sortear colaboradores');await button(h,'Salvar equipes sorteadas');assert.match(h.get('.escala-dialog [role="alert"]').textContent,/Outra pessoa alterou/);assert.equal(h.state.memberships.length,6);h.destroy();
});

for(const view of ['escala-teams','escala-calendar'])test('rascunho local não impede sortear em '+view+' e mantém alterações após salvar as equipes',async()=>{
 const state=fixture();state.plan={...generateMonth(state,'2026-11-01','server').plan,id:'saved-month',revision:2};
 const local=structuredClone(state.plan);local.notes='Anotação local a preservar';local.days[4].notes='Folga ajustada neste aparelho';local.days[4].manual=true;
 const memory=new Map([['disb_escala_draft_v1_admin|Matriz Caicó_2026-11-01',JSON.stringify(local)]]);
 const h=harness({state,memory});await h.enter(view);
 const sort=[...h.document.querySelectorAll('.escala-app button')].find(b=>b.textContent==='Sortear colaboradores');assert.equal(sort.disabled,false);
 await button(h,'Sortear colaboradores');assert.equal(h.writes.length,0);await button(h,'Cancelar');assert.equal(memory.size,1);assert.equal(JSON.parse([...memory.values()][0]).notes,local.notes);
 await button(h,'Sortear colaboradores');await button(h,'Salvar equipes sorteadas');assert.equal(h.writes.filter(w=>w.name==='escala_save_composition').length,1);
 const kept=JSON.parse([...memory.values()][0]);assert.equal(kept.revision,3);assert.equal(kept.notes,local.notes);assert.equal(kept.days[4].notes,local.days[4].notes);assert.equal(kept.days[4].manual,true);assert.match(h.document.querySelector('.escala-notice').textContent,/alterações de folgas foram mantidas/);h.destroy();
});

test('rota realizada com equipe ainda vazia permite completar as equipes sem alterar seu registro anterior',async()=>{
 const state=fixture();state.plan=generateMonth(state,'2026-11-01','completed').plan;const d=state.plan.days.find(d=>d.duties.some(a=>a.team_id==='team-5'&&a.mode==='ROUTE'));d.duties.find(a=>a.team_id==='team-5').completed=true;
 const h=harness({state});await h.enter('escala-teams');await button(h,'Sortear colaboradores');assert.equal(h.document.querySelectorAll('.escala-dialog .escala-team-grid article').length,8);await button(h,'Salvar equipes sorteadas');assert.equal(h.writes.length,1);h.destroy();
});

test('escala aprovada continua protegida com orientação visível',async()=>{
 const state=fixture();state.plan={...generateMonth(state,'2026-11-01','approved').plan,status:'APPROVED'};const h=harness({state});await h.enter('escala-teams');const sort=[...h.document.querySelectorAll('.escala-app button')].find(b=>b.textContent==='Sortear colaboradores');assert.equal(sort.disabled,true);assert.match(h.get('#view-escala-teams').textContent,/Abra o Calendário para desbloqueá-la/);assert.equal(h.writes.length,0);h.destroy();
});
