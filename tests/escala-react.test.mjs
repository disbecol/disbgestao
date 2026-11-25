import test from 'node:test';
import assert from 'node:assert/strict';
import {formsThemeHarness} from './helpers/forms-theme-harness.mjs';
import {escalaFixture} from '../modules/gestao/tests/escala-fixture.ts';
import {generateMonth} from '../modules/gestao/src/escala/engine.ts';
function harness(options={}){
 const state=structuredClone(options.state||escalaFixture());let api;
 const h=formsThemeHarness({...options,factory:'createEscala',openView:view=>{void api?.enter(view);},async rpc(name,args,context){
  if(options.rpc){const result=await options.rpc(name,args,context,state);if(result!==undefined)return result;}
  if(name==='escala_state')return {data:structuredClone(state),error:null};
  if(name==='escala_audit_page')return {data:[],error:null};
  if(name==='escala_command'){
   if(args.p_action==='MONTH_SAVE'){state.plan={...structuredClone(args.p_payload),id:state.plan?.id||'saved-month',revision:args.p_revision+1};return {data:structuredClone(state.plan),error:null};}
   if(args.p_action==='TEAM_SAVE'){const team=state.teams.find(t=>t.id===args.p_id);Object.assign(team,args.p_payload,{revision:team.revision+1});return {data:structuredClone(team),error:null};}
   if(args.p_action==='APPROVE'){state.plan.status='APPROVED';state.plan.revision++;return{data:structuredClone(state.plan),error:null};}
  }
 }});api=h.api;return {...h,state};
}
const clickText=async(h,text)=>{const button=[...h.document.querySelectorAll('.escala-app button')].find(b=>b.textContent.trim()===text);assert.ok(button,'Button '+text);button.click();await h.settle();};
test('Escala uses the shared React entry and displays a real monthly calendar without writing on load',async()=>{
 const h=harness();assert.equal(typeof h.globalApi.createEscala,'function');await h.enter('escala-calendar');
 assert.equal(h.document.querySelectorAll('[data-escala-day]').length,30);assert.equal(h.document.querySelectorAll('.escala-side-team').length,10);assert.equal(h.writes.length,0);assert.ok(h.reads.some(r=>r.name==='escala_state'));h.destroy();
});
test('generation is a reviewable local draft and Save sends a revisioned idempotent RPC, then survives reopening',async()=>{
 const h=harness();await h.enter('escala-calendar');await clickText(h,'✦ Gerar sorteio');assert.equal(h.writes.length,0);assert.ok(h.memory.size);await clickText(h,'Salvar escala •');
 const save=h.writes.find(w=>w.args.p_action==='MONTH_SAVE');assert.equal(save.args.p_revision,0);assert.ok(save.args.p_request_id);assert.equal(save.args.p_payload.days.length,30);assert.equal(h.state.plan.revision,1);assert.equal(h.memory.size,0);
 h.api.stop();await h.enter('escala-calendar');assert.match(h.get('.escala-statusbar').textContent,/Revisão 1/);h.destroy();
});
test('opening teams, staff, vehicles, holidays, reports and history remains read only',async()=>{
 const h=harness();for(const view of ['escala-teams','escala-staff','escala-trucks','escala-holidays','escala-reports','escala-history','escala-settings']){await h.enter(view);assert.ok(h.get('#view-'+view).textContent.includes('Escala'));}assert.equal(h.writes.length,0);h.destroy();
});
test('approved calendars prevent a redraw and read-only users cannot edit operational records',async()=>{
 const state=escalaFixture();state.plan=generateMonth(state,'2026-11-01','approved').plan;state.plan.status='APPROVED';
 const h=harness({state,permissions:['ESCALA_VIEW']});await h.enter('escala-calendar');const redraw=[...h.document.querySelectorAll('button')].find(b=>b.textContent.includes('Gerar novo sorteio'));assert.equal(redraw.disabled,true);await h.enter('escala-staff');const create=[...h.document.querySelectorAll('button')].find(b=>b.textContent==='Cadastrar pessoa');assert.equal(create.disabled,true);h.destroy();
});
test('a save conflict preserves the local calendar for retry and does not pretend it was saved',async()=>{
 const h=harness({rpc:(name,args)=>name==='escala_command'&&args.p_action==='MONTH_SAVE'?{data:null,error:{message:'ESCALA_VERSION_CONFLICT'}}:undefined});await h.enter('escala-calendar');await clickText(h,'✦ Gerar sorteio');await clickText(h,'Salvar escala •');assert.ok(h.memory.size);assert.match(h.get('.escala-error').textContent,/Outra pessoa alterou/);assert.equal(h.state.plan,null);h.destroy();
});

test('editing a staff record sends the typed values through the existing unit-scoped RPC',async()=>{
 let saved;
 const h=harness({rpc:(name,args)=>{if(name==='escala_command'&&args.p_action==='STAFF_SAVE'){saved=args;return {data:{id:'new-staff',...args.p_payload,revision:1},error:null};}}});
 await h.enter('escala-staff');await h.click('#view-escala-staff tbody tr:first-child button');
 const labels=[...h.document.querySelectorAll('.escala-record-form label')],name=labels.find(l=>l.textContent.startsWith('Nome completo')).querySelector('input');assert.ok(name.hasAttribute('readonly')||name.hasAttribute('readOnly'));const notes=h.get('.escala-record-form textarea');notes.value='Observação operacional';notes.dispatchEvent(new h.window.Event('input',{bubbles:true}));await h.settle();
 h.get('.escala-record-form').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));await h.settle();
 assert.equal(saved.p_payload.notes,'Observação operacional');assert.equal(saved.p_id,h.state.staff[0].id);assert.equal(saved.p_unit,'Matriz Caicó');assert.ok(saved.p_request_id);h.destroy();
});

test('a desktop drag opens a movement dialog with the complete team and keeps the source date',async()=>{
 const state=escalaFixture();state.plan=generateMonth(state,'2026-11-01','drag').plan;
 const h=harness({state});await h.enter('escala-calendar');
 const source=h.get('[data-escala-day="2026-11-03"] .escala-team-chip'),target=h.get('[data-escala-day="2026-11-04"]');const start=new h.window.Event('dragstart',{bubbles:true});start.dataTransfer={setData(){},effectAllowed:''};source.dispatchEvent(start);const drop=new h.window.Event('drop',{bubbles:true,cancelable:true});drop.dataTransfer={};target.dispatchEvent(drop);await h.settle();
 assert.match(h.get('.escala-dialog').textContent,/Movimentar folga da equipe completa/);assert.equal(h.get('.escala-dialog input[type="date"]').value,'2026-11-04');assert.ok(h.get('.escala-dialog select').value==='2026-11-03');assert.equal(h.writes.length,0);h.destroy();
});
