import test from 'node:test';import assert from 'node:assert/strict';
import {formsThemeHarness} from './helpers/forms-theme-harness.mjs';import {escalaFixture} from '../modules/gestao/tests/escala-fixture.ts';
import {generateMonth} from '../modules/gestao/src/escala/engine.ts';
function fixture(){const s=escalaFixture();s.staff.forEach(p=>p.area='Entrega');s.memberships=s.memberships.filter(m=>s.teams.slice(0,2).some(t=>t.id===m.team_id));s.composition_token='fixture-token';s.memberships.forEach(m=>{m.origin='MANUAL';m.draw_month=null;});return s;}
function harness(options={}){const state=structuredClone(options.state||fixture());return {...formsThemeHarness({...options,factory:'createEscala',async rpc(name,args){if(options.rpc){const r=await options.rpc(name,args);if(r!==undefined)return r;}if(name==='escala_state')return {data:structuredClone(state),error:null};if(name==='escala_save_composition'){for(const a of args.p_assignments)for(const id of a.members)state.memberships.push({id:'auto-'+id,team_id:a.team_id,staff_id:id,starts_on:args.p_month,ends_on:'2026-11-30',origin:'AUTO',draw_month:args.p_month,override_reason:'',revision:1});state.composition_token='next-token';if(state.plan)state.plan.revision++;return {data:{ok:true},error:null};}}}),state};}
async function button(h,text){const b=[...h.document.querySelectorAll('.escala-app button')].find(b=>b.textContent.trim()===text);assert.ok(b,text);if(b.getAttribute('type')==='submit')b.closest('form').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));else b.click();await h.settle();}
test('prévia mantém equipes definidas, mostra as demais e só grava ao salvar',async()=>{
 const h=harness();await h.enter('escala-teams');await button(h,'Sortear colaboradores');assert.equal(h.writes.length,0);assert.match(h.get('.escala-dialog').textContent,/2 equipe\(s\) preservada/);assert.equal(h.document.querySelectorAll('.escala-dialog .escala-team-grid article').length,8);
 await button(h,'Salvar equipes sorteadas');const save=h.writes.find(w=>w.name==='escala_save_composition');assert.equal(save.args.p_assignments.length,8);assert.equal(save.args.p_helpers,0);assert.equal(save.args.p_area,'Entrega');assert.ok(save.args.p_request_id);assert.equal(h.state.memberships.length,30);assert.ok(!h.document.querySelector('.escala-dialog'));h.destroy();
});
test('Gerar sorteio preenche equipes vazias antes de gerar as folgas e mantém o calendário em rascunho',async()=>{
 const h=harness();await h.enter('escala-calendar');await button(h,'Sortear folgas');assert.ok(h.document.querySelector('.escala-dialog'));assert.equal(h.writes.length,0);await button(h,'Salvar equipes e gerar folgas');assert.equal(h.writes.filter(w=>w.name==='escala_save_composition').length,1);assert.ok(h.get('.escala-statusbar').textContent.includes('Rascunho'));assert.ok(h.get('.escala-statusbar').textContent.includes('alterações neste aparelho'));assert.ok(h.document.querySelector('.escala-people-table'));h.destroy();
});
test('falta de pessoal é informada sem gravar uma composição incompleta',async()=>{
 const state=fixture();state.staff[7].status='INACTIVE';const h=harness({state});await h.enter('escala-teams');await button(h,'Sortear colaboradores');await h.change('.escala-dialog [aria-label="Distribuição dos ajudantes"]','2');assert.match(h.get('.escala-dialog').textContent,/Faltam 1 ajudante/);const save=[...h.document.querySelectorAll('.escala-dialog button')].find(b=>b.textContent==='Salvar equipes sorteadas');assert.equal(save.disabled,true);assert.equal(h.writes.length,0);h.destroy();
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

test('QLP é o padrão e permite salvar 8 equipes com os 13 ajudantes disponíveis',async()=>{
 const state=fixture();for(const n of [7,8,10])state.staff[n].status='INACTIVE';const h=harness({state});await h.enter('escala-teams');await button(h,'Sortear colaboradores');assert.equal(h.get('.escala-dialog [aria-label="Distribuição dos ajudantes"]').value,'0');assert.match(h.get('.escala-crew-distribution').textContent,/5 equipes com 2 ajudantes · 3 equipes com 1 ajudante/);await button(h,'Salvar equipes sorteadas');const saved=h.writes[0];assert.equal(saved.args.p_helpers,0);assert.equal(saved.args.p_assignments.flatMap(a=>a.members).length,21);h.destroy();
});

test('etapas separam equipes e folgas, e a visão por equipe permite buscar e abrir a troca sem gravar',async()=>{
 const state=fixture();state.memberships.push(...escalaFixture().memberships.filter(m=>!state.memberships.some(x=>x.id===m.id)));state.plan=generateMonth(state,'2026-11-01','planning').plan;const h=harness({state});await h.enter('escala-calendar');assert.ok(h.document.querySelector('.escala-calendar-actions'));await button(h,'Folgas por equipe');assert.equal(h.get('[aria-pressed="true"]').textContent,'Folgas por equipe');assert.equal(h.document.querySelectorAll('.escala-rest-team').length,10);
 await h.input('.escala-rest-filters input[type="search"]',state.staff[6].name);assert.equal(h.document.querySelectorAll('.escala-rest-team').length,1);const day=h.document.querySelector('.escala-rest-dates button');assert.ok(day);day.click();await h.settle();assert.ok(h.get('.escala-dialog [aria-label="Folga atual"]').value);assert.match(h.get('.escala-dialog').textContent,/Escolha a nova data/);assert.equal(h.writes.length,0);h.destroy();
});

test('visão por equipe orienta gerar a primeira escala quando o mês ainda está vazio',async()=>{
 const h=harness();await h.enter('escala-calendar');await button(h,'Folgas por equipe');assert.match(h.get('.escala-empty').textContent,/Use Sortear folgas/);assert.equal(h.writes.length,0);h.destroy();
});

function dragHelper(h,source,target){const data={effectAllowed:'',dropEffect:'',setData(){}};const start=new h.window.Event('dragstart',{bubbles:true,cancelable:true});start.dataTransfer=data;source.dispatchEvent(start);const drop=new h.window.Event('drop',{bubbles:true,cancelable:true});drop.dataTransfer=data;target.dispatchEvent(drop);}
function qlpState(){const s=fixture();for(const n of [7,8,10])s.staff[n].status='INACTIVE';return s;}
test('arrastar para outro cartão muda a prévia e o salvamento envia a equipe ajustada',async()=>{
 const h=harness({state:qlpState()});await h.enter('escala-teams');await button(h,'Sortear colaboradores');const cards=[...h.document.querySelectorAll('[data-crew-team]')],source=cards.find(c=>c.querySelectorAll('[data-helper-id]').length===2),target=cards.find(c=>c.querySelectorAll('[data-helper-id]').length===1),helper=source.querySelector('[data-helper-id]'),id=helper.dataset.helperId,origin=source.dataset.crewTeam,destination=target.dataset.crewTeam;
 dragHelper(h,helper,target);await h.settle();assert.equal(h.writes.length,0);assert.equal(source.querySelectorAll('[data-helper-id]').length,1);assert.ok(target.querySelector('[data-helper-id="'+id+'"]'));await button(h,'Salvar equipes sorteadas');const args=h.writes[0].args;assert.ok(args.p_assignments.find(a=>a.team_id===destination).members.includes(id));assert.ok(!args.p_assignments.find(a=>a.team_id===origin).members.includes(id));h.destroy();
});
test('soltar sobre outro ajudante troca os dois e mantém os motoristas',async()=>{
 const h=harness();await h.enter('escala-teams');await button(h,'Sortear colaboradores');const [a,b]=[...h.document.querySelectorAll('[data-crew-team]')],x=a.querySelector('[data-helper-id]'),y=b.querySelector('[data-helper-id]'),xId=x.dataset.helperId,yId=y.dataset.helperId,drivers=[...h.document.querySelectorAll('.escala-crew-driver')].map(p=>p.textContent);dragHelper(h,x,y);await h.settle();assert.ok(a.querySelector('[data-helper-id="'+yId+'"]'));assert.ok(b.querySelector('[data-helper-id="'+xId+'"]'));assert.deepEqual([...h.document.querySelectorAll('.escala-crew-driver')].map(p=>p.textContent),drivers);assert.equal(h.writes.length,0);h.destroy();
});
test('Mover funciona por seleção de destino e Desfazer ajustes recupera a prévia sem gravar',async()=>{
 const h=harness({state:qlpState()});await h.enter('escala-teams');await button(h,'Sortear colaboradores');const original=h.get('.escala-crew-board').textContent,cards=[...h.document.querySelectorAll('[data-crew-team]')],source=cards.find(c=>c.querySelectorAll('[data-helper-id]').length===2),target=cards.find(c=>c.querySelectorAll('[data-helper-id]').length===1),helper=source.querySelector('[data-helper-id]'),id=helper.dataset.helperId;helper.querySelector('.escala-helper-move').click();await h.settle();await h.change('[aria-label="Equipe de destino do ajudante"]',target.dataset.crewTeam);await button(h,'Aplicar ajuste');assert.ok(target.querySelector('[data-helper-id="'+id+'"]'));await button(h,'Desfazer ajustes');assert.equal(h.get('.escala-crew-board').textContent,original);assert.equal(h.writes.length,0);await button(h,'Cancelar');assert.equal(h.writes.length,0);h.destroy();
});
test('salvamento fica bloqueado somente enquanto houver equipe sem ajudante ou além do limite escolhido',async()=>{
 const h=harness({state:qlpState()});await h.enter('escala-teams');await button(h,'Sortear colaboradores');const cards=[...h.document.querySelectorAll('[data-crew-team]')],source=cards.find(c=>c.querySelectorAll('[data-helper-id]').length===1),target=cards.find(c=>c.querySelectorAll('[data-helper-id]').length===2);dragHelper(h,source.querySelector('[data-helper-id]'),target);await h.settle();assert.match(h.get('.escala-dialog [role="alert"]').textContent,/mantenha 1 ou 2 ajudantes/);assert.equal([...h.document.querySelectorAll('.escala-dialog button')].find(b=>b.textContent==='Salvar equipes sorteadas').disabled,true);assert.equal(h.document.querySelectorAll('.escala-crew-driver[draggable="true"]').length,0);await button(h,'Desfazer ajustes');assert.equal([...h.document.querySelectorAll('.escala-dialog button')].find(b=>b.textContent==='Salvar equipes sorteadas').disabled,false);assert.equal(h.writes.length,0);h.destroy();
});

test('erro ao salvar mantém o ajudante na equipe ajustada para não perder a revisão',async()=>{
 const h=harness({state:qlpState(),rpc:name=>name==='escala_save_composition'?{data:null,error:{message:'ESCALA_VERSION_CONFLICT'}}:undefined});await h.enter('escala-teams');await button(h,'Sortear colaboradores');const cards=[...h.document.querySelectorAll('[data-crew-team]')],source=cards.find(c=>c.querySelectorAll('[data-helper-id]').length===2),target=cards.find(c=>c.querySelectorAll('[data-helper-id]').length===1),helper=source.querySelector('[data-helper-id]'),id=helper.dataset.helperId;dragHelper(h,helper,target);await h.settle();await button(h,'Salvar equipes sorteadas');assert.match(h.get('.escala-dialog [role="alert"]').textContent,/Outra pessoa alterou/);assert.ok(target.querySelector('[data-helper-id="'+id+'"]'));assert.equal(h.state.memberships.length,6);h.destroy();
});

test('preservadas aparecem com folgas fixas e ficam fora das opções de troca e arraste',async()=>{
 const state=fixture();state.memberships.push(...escalaFixture().memberships.filter(m=>!state.memberships.some(x=>x.id===m.id)));state.plan=generateMonth(state,'2026-11-01','fixed-ui').plan;const h=harness({state});await h.enter('escala-calendar');assert.ok(h.document.querySelector('.escala-people-table'));assert.equal(h.document.querySelectorAll('.escala-side-team').length,0);
 await button(h,'Trocar folga');const teams=[...h.get('[aria-label="Equipe da troca de folga"]').querySelectorAll('option')];assert.equal(teams.length,8);assert.ok(!teams.some(o=>o.value==='team-1'||o.value==='team-2'));await button(h,'Cancelar');
 await button(h,'Folgas por equipe');const first=h.document.querySelector('.escala-rest-team');assert.match(first.textContent,/Preservada/);assert.ok([...first.querySelectorAll('.escala-rest-dates button')].every(b=>b.getAttribute('aria-label').startsWith('Ver folga')));assert.equal(h.writes.length,0);h.destroy();
});
