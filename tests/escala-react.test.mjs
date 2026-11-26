import test from 'node:test';
import assert from 'node:assert/strict';
import {formsThemeHarness} from './helpers/forms-theme-harness.mjs';
import {escalaFixture} from '../modules/gestao/tests/escala-fixture.ts';
import {ALGORITHM,generateMonth,officialHolidays} from '../modules/gestao/src/escala/engine.ts';
function harness(options={}){
 const state=structuredClone(options.state||escalaFixture());let api;
 const h=formsThemeHarness({...options,factory:'createEscala',openView:view=>{void api?.enter(view);},async rpc(name,args,context){
  if(options.rpc){const result=await options.rpc(name,args,context,state);if(result!==undefined)return result;}
  if(name==='escala_state')return {data:{...structuredClone(state),plan:state.plan?.month===args.p_month?structuredClone(state.plan):null},error:null};
  if(name==='escala_audit_page')return {data:[],error:null};
  if(name==='escala_command'){
   if(args.p_action==='MONTH_SAVE'){state.plan={...structuredClone(args.p_payload),id:state.plan?.id||'saved-month',revision:args.p_revision+1};return {data:structuredClone(state.plan),error:null};}
   if(args.p_action==='TEAM_SAVE'){const team=state.teams.find(t=>t.id===args.p_id);Object.assign(team,args.p_payload,{revision:team.revision+1});return {data:structuredClone(team),error:null};}
   if(args.p_action==='APPROVE'){state.plan.status='APPROVED';state.plan.revision++;return{data:structuredClone(state.plan),error:null};}
  }
 }});api=h.api;return {...h,state};
}
const clickText=async(h,text)=>{const button=[...h.document.querySelectorAll('.escala-app button')].find(b=>b.textContent.trim()===text);assert.ok(button,'Button '+text);button.click();await h.settle();};
function individualState(){const s=escalaFixture();s.individual_enabled=true;s.teams=s.teams.slice(0,2).map(t=>({...t,fixed_group:true}));s.memberships=s.memberships.slice(0,6).map(m=>({...m,origin:'MANUAL',draw_month:null}));s.staff=s.staff.filter(p=>!['team-8-person-2','team-9-person-2','team-10-person-2'].includes(p.id));return s;}

test('a coluna tem só nomes: motoristas em ordem alfabética e depois ajudantes em ordem alfabética',async()=>{
 const state=individualState();state.staff[0].name='ZULU';state.staff[3].name='ABEL';state.staff[1].name='AAA AJUDANTE';state.plan=generateMonth(state,'2026-11-01','names-only').plan;const h=harness({state});await h.enter('escala-calendar');const rows=[...h.document.querySelectorAll('.escala-people-table tbody tr')],names=rows.map(r=>r.querySelector('th').textContent.trim()),expected=[...state.staff].sort((a,b)=>Number(!a.job.startsWith('Motorista'))-Number(!b.job.startsWith('Motorista'))||a.name.localeCompare(b.name,'pt-BR')).map(p=>p.name);assert.deepEqual(names,expected);for(const row of rows){assert.equal(row.querySelector('th small'),null);assert.equal(row.querySelector('th button'),null);}assert.match(h.get('.escala-calendar-actions').textContent,/27 colaboradores/);assert.equal(h.document.querySelectorAll('.escala-action-buttons button').length,2);assert.equal(h.writes.length,0);h.destroy();
});
test('o resumo diário mostra os sete dias na virada do mês e navega para a próxima semana inteira sem gravar',async()=>{
 const state=individualState();state.plan=generateMonth(state,'2026-11-01','month-boundary').plan;const h=harness({state});await h.enter('escala-calendar');await clickText(h,'Resumo por dia');await h.change('[aria-label="Semana exibida"]','2026-11-30');await h.settle();const cards=[...h.document.querySelectorAll('.escala-daily-card')];assert.deepEqual(cards.map(c=>c.dataset.date),['2026-11-30','2026-12-01','2026-12-02','2026-12-03','2026-12-04','2026-12-05','2026-12-06']);assert.equal(cards[1].querySelectorAll('li').length,27);assert.match(cards[1].textContent,/Prévia · não salva/);for(const c of cards){assert.ok(c.querySelector('details summary'));assert.equal(c.querySelectorAll('input[type="checkbox"]').length,2);}
 await clickText(h,'Próxima semana ›');assert.equal(h.get('input[type="month"]').value,'2026-12');assert.equal(h.get('[aria-label="Semana exibida"]').value,'2026-12-07');assert.deepEqual([...h.document.querySelectorAll('.escala-daily-card')].map(c=>c.dataset.date),['2026-12-07','2026-12-08','2026-12-09','2026-12-10','2026-12-11','2026-12-12','2026-12-13']);assert.equal(h.writes.length,0);h.destroy();
});
test('a contagem mensal tem somente os dias e o total, incluindo feriados no respectivo dia',async()=>{
 const state=individualState();state.holidays=officialHolidays(2026).map((h,i)=>({...h,id:'h'+i,revision:1}));state.plan=generateMonth(state,'2026-11-01','simple-totals').plan;const h=harness({state});await h.enter('escala-calendar');await clickText(h,'Folgas no mês');assert.deepEqual([...h.document.querySelectorAll('.escala-month-counts thead th')].map(t=>t.textContent),['Colaborador','Segundas','Terças','Quartas','Quintas','Sextas','Sábados','Domingos','Total']);for(const row of h.document.querySelectorAll('.escala-month-counts tbody tr')){const values=[...row.querySelectorAll('td')].map(c=>Number(c.textContent));assert.equal(values.length,8);assert.equal(values.slice(0,7).reduce((a,b)=>a+b,0),values[7]);assert.equal(row.querySelectorAll('small,button').length,0);}h.destroy();
});
test('duas equipes fixas, revezamento sem equipe e equilíbrio entre meses aparecem sem gerar novas equipes',async()=>{
 const state=individualState();state.plan=generateMonth(state,'2026-11-01','individual-ui').plan;const h=harness({state});await h.enter('escala-teams');assert.equal(h.document.querySelectorAll('.escala-fixed-card').length,2);assert.equal(h.document.querySelectorAll('.escala-pool-names>span').length,21);assert.ok(!h.get('.escala-fixed-view').textContent.includes('Sortear colaboradores'));
 await h.enter('escala-calendar');await clickText(h,'Equilíbrio entre meses');assert.ok(h.document.querySelector('.escala-balance-view'));assert.equal(h.document.querySelectorAll('.escala-balance-view tbody tr').length,8);await clickText(h,'Ajudantes');assert.equal(h.document.querySelectorAll('.escala-balance-view tbody tr').length,13);await clickText(h,'Por colaborador');await clickText(h,'Comparar meses');await h.change('[aria-label="Colaborador"]','team-3-person-0');await clickText(h,'Gerar prévia');assert.equal(h.document.querySelectorAll('.escala-compare-month')[1].querySelectorAll('.escala-compare-date:not(.outside-month)').length,31);assert.equal(h.writes.length,0);assert.equal(h.state.teams.length,2);h.destroy();
});

test('folga por feriado fica distinta nas quatro visões e a comparação não grava uma projeção futura',async()=>{
 const state=escalaFixture();state.holidays=officialHolidays(2026).map((h,i)=>({...h,id:'holiday-'+i,revision:1}));state.memberships.slice(0,6).forEach(m=>{m.origin='MANUAL';m.draw_month=null;});state.plan=generateMonth(state,'2026-11-01','holiday-colors').plan;const before=structuredClone(state);
 const h=harness({state,rpc:(name,args)=>name==='escala_state'&&args.p_month==='2026-12-01'?{data:{...structuredClone(state),plan:null,memberships:state.memberships.filter(m=>m.origin==='MANUAL')},error:null}:undefined});await h.enter('escala-calendar');await h.change('[aria-label="Semana exibida"]','2026-11-02');assert.equal(h.document.querySelectorAll('.escala-people-table .holiday-rest').length,30);assert.ok(h.document.querySelector('.escala-people-table .rest'));
 await clickText(h,'Resumo por dia');await h.change('[aria-label="Semana exibida"]','2026-11-02');await h.change('.escala-availability-head select','2026-11-02');assert.equal(h.document.querySelectorAll('.escala-person-group.holiday-rest li').length,30);assert.equal(h.document.querySelectorAll('.escala-person-group.rest').length,0);
 await clickText(h,'Calendário mensal');assert.equal(h.get('[data-escala-day="2026-11-02"]').querySelectorAll('.holiday-rest button').length,10);
 await clickText(h,'Folgas por equipe');assert.ok(h.document.querySelector('.escala-rest-dates .holiday-rest'));assert.ok(h.document.querySelector('.escala-rest-dates .rest'));
 await clickText(h,'Folgas no mês');assert.equal(h.document.querySelectorAll('.escala-month-counts tbody tr').length,30);assert.match(h.get('.escala-month-counts').textContent,/Segundas/);assert.deepEqual([...h.get('.escala-month-counts thead').querySelectorAll('th')].map(t=>t.textContent),['Colaborador','Segundas','Terças','Quartas','Quintas','Sextas','Sábados','Domingos','Total']);await h.change('.escala-count-filters select','ajudante');assert.equal(h.document.querySelectorAll('.escala-month-counts tbody tr').length,20);
 await clickText(h,'Por colaborador');await clickText(h,'Comparar meses');assert.match(h.get('.escala-dialog').textContent,/Comparar meses por colaborador/);assert.equal(h.document.querySelectorAll('.escala-compare-month').length,2);assert.ok(h.document.querySelector('.escala-compare-month .holiday-rest'));await clickText(h,'Gerar prévia');const next=h.document.querySelectorAll('.escala-compare-month')[1];assert.match(next.textContent,/Prévia · não salva/);assert.equal(next.querySelectorAll('.escala-compare-date:not(.outside-month)').length,31);assert.ok(next.querySelector('.holiday-rest'));assert.equal(h.writes.length,0);assert.equal(h.memory.size,0);assert.deepEqual(h.state,before);h.destroy();
});
test('Escala uses the shared React entry and displays a real monthly calendar without writing on load',async()=>{
 const h=harness();assert.equal(typeof h.globalApi.createEscala,'function');await h.enter('escala-calendar');
 assert.ok(h.document.querySelector('.escala-calendar-actions'));assert.equal(h.document.querySelectorAll('[data-view="escala-trucks"]').length,0);assert.match(h.get('.escala-empty').textContent,/Este mês ainda não tem escala/);assert.equal(h.writes.length,0);assert.ok(h.reads.some(r=>r.name==='escala_state'));h.destroy();
});
test('o comparador atualiza um rascunho antigo do segundo mês e confere semanas de segunda a domingo sem gravar',async()=>{
 const state=escalaFixture();state.memberships.slice(0,6).forEach(m=>{m.origin='MANUAL';m.draw_month=null;});state.plan=generateMonth(state,'2026-11-01','november').plan;
 const december={...generateMonth({...state,plan:null,rotation_history:state.plan.days},'2026-12-01','december').plan,id:'december',revision:2,algorithm_version:'escala-weekly-4-fair-rest'};
 for(const day of december.days)if(new Date(day.date+'T12:00:00Z').getUTCDay()===0)day.duties.forEach(d=>d.mode='ROUTE');
 const key='disb_escala_draft_v1_admin|Matriz Caicó_2026-12-01',memory=new Map([[key,JSON.stringify(december)]]),h=harness({state,memory,rpc:(name,args)=>name==='escala_state'&&args.p_month==='2026-12-01'?{data:{...structuredClone(state),plan:structuredClone(december)},error:null}:undefined});
 await h.enter('escala-calendar');const stored=memory.get(key);await clickText(h,'Comparar meses');await h.change('[aria-label="Colaborador"]','team-3-person-0');const next=h.document.querySelectorAll('.escala-compare-month')[1];assert.match(next.textContent,/Rascunho atualizado/);
 for(const row of next.querySelectorAll('.escala-compare-week')){assert.deepEqual([...row.querySelectorAll('.weekday')].map(c=>c.textContent),['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']);assert.equal(row.querySelectorAll('.escala-compare-date').length,7);}
 for(const day of next.querySelectorAll('.escala-compare-date[data-weekday="0"]:not(.outside-month)'))assert.ok(day.classList.contains('rest'));
 assert.match(next.querySelector('[data-week-start="2026-11-30"]').textContent,/2 folgas/);assert.match(next.querySelector('[data-week-start="2026-12-28"]').textContent,/Semana incompleta · 3/);assert.equal(next.querySelectorAll('.escala-compare-week.invalid').length,0);assert.equal(memory.get(key),stored);assert.equal(h.writes.length,0);h.destroy();
});
test('generation is a reviewable local draft and Save sends a revisioned idempotent RPC, then survives reopening',async()=>{
 const h=harness();await h.enter('escala-calendar');await clickText(h,'Sortear folgas');assert.equal(h.writes.length,0);assert.ok(h.memory.size);await clickText(h,'Salvar escala •');
 const save=h.writes.find(w=>w.args.p_action==='MONTH_SAVE');assert.equal(save.args.p_revision,0);assert.ok(save.args.p_request_id);assert.equal(save.args.p_payload.days.length,30);assert.equal(h.state.plan.revision,1);assert.equal(h.memory.size,0);
 h.api.stop();await h.enter('escala-calendar');assert.match(h.get('.escala-statusbar').textContent,/Revisão 1/);h.destroy();
});
test('opening teams, staff, vehicles, holidays, reports and history remains read only',async()=>{
 const h=harness();for(const view of ['escala-teams','escala-staff','escala-holidays','escala-reports','escala-history','escala-settings']){await h.enter(view);assert.ok(h.get('#view-'+view).textContent.includes('Escala'));}assert.equal(h.writes.length,0);h.destroy();
});
test('rascunho recuperado da versão anterior permite sortear novas folgas sem gravar automaticamente',async()=>{
 const state=escalaFixture();state.memberships.slice(0,6).forEach(m=>{m.origin='MANUAL';m.draw_month=null;});state.plan={...generateMonth(state,'2026-11-01','previous').plan,id:'saved-month',revision:3,algorithm_version:'escala-balanced-1'};
 const local=structuredClone(state.plan);local.days[4].manual=true;local.days[4].notes='Ajuste manual a preservar';
 const h=harness({state,memory:new Map([['disb_escala_draft_v1_admin|Matriz Caicó_2026-11-01',JSON.stringify(local)]])});await h.enter('escala-calendar');
 assert.match(h.get('.escala-statusbar').textContent,/alterações neste aparelho/);
 const redraw=[...h.document.querySelectorAll('button')].find(b=>b.textContent==='Sortear novas folgas');assert.equal(redraw.disabled,false);await clickText(h,'Sortear novas folgas');
 assert.equal(h.document.querySelector('.escala-error')?.textContent||'','');const next=JSON.parse([...h.memory.values()][0]);assert.equal(next.algorithm_version,ALGORITHM);assert.equal(next.days[4].notes,'Ajuste manual a preservar');
 for(const day of next.days)for(const team of state.teams.slice(0,2)){const weekend=[0,6].includes(new Date(day.date+'T12:00:00Z').getUTCDay());assert.equal(day.duties.find(d=>d.team_id===team.id).mode,weekend?'REST':'ROUTE');}
 assert.equal(h.writes.length,0);assert.equal(h.state.plan.algorithm_version,'escala-balanced-1');h.destroy();
});
test('o motivo do bloqueio de sorteio fica visível para consulta e escala protegida',async()=>{
 const state=escalaFixture();state.plan={...generateMonth(state,'2026-11-01','protected').plan,status:'APPROVED'};
 for(const permissions of [['ESCALA_VIEW'],['ESCALA_VIEW','ESCALA_MANAGE']]){const h=harness({state,permissions});await h.enter('escala-calendar');const step=h.document.querySelector('.escala-calendar-actions'),redraw=step.querySelector('button');assert.equal(redraw.disabled,true);assert.match(step.textContent,permissions.includes('ESCALA_MANAGE')?/administrador precisa desbloqueá-la/:/perfil não tem permissão/);assert.equal(h.writes.length,0);h.destroy();}
});
test('approved calendars prevent a redraw and read-only users cannot edit operational records',async()=>{
 const state=escalaFixture();state.plan=generateMonth(state,'2026-11-01','approved').plan;state.plan.status='APPROVED';
 const h=harness({state,permissions:['ESCALA_VIEW']});await h.enter('escala-calendar');const redraw=[...h.document.querySelectorAll('button')].find(b=>b.textContent.includes('Sortear novas folgas'));assert.equal(redraw.disabled,true);await h.enter('escala-staff');const create=[...h.document.querySelectorAll('button')].find(b=>b.textContent==='Cadastrar pessoa');assert.equal(create.disabled,true);h.destroy();
});
test('a save conflict preserves the local calendar for retry and does not pretend it was saved',async()=>{
 const h=harness({rpc:(name,args)=>name==='escala_command'&&args.p_action==='MONTH_SAVE'?{data:null,error:{message:'ESCALA_VERSION_CONFLICT'}}:undefined});await h.enter('escala-calendar');await clickText(h,'Sortear folgas');await clickText(h,'Salvar escala •');assert.ok(h.memory.size);assert.match(h.get('.escala-error').textContent,/Outra pessoa alterou/);assert.equal(h.state.plan,null);h.destroy();
});

test('editing a staff record sends the typed values through the existing unit-scoped RPC',async()=>{
 let saved;
 const h=harness({rpc:(name,args)=>{if(name==='escala_command'&&args.p_action==='STAFF_SAVE'){saved=args;return {data:{id:'new-staff',...args.p_payload,revision:1},error:null};}}});
 await h.enter('escala-staff');await h.click('#view-escala-staff tbody tr:first-child button');
 const labels=[...h.document.querySelectorAll('.escala-record-form label')],name=labels.find(l=>l.textContent.startsWith('Nome completo')).querySelector('input');assert.ok(name.hasAttribute('readonly')||name.hasAttribute('readOnly'));const notes=h.get('.escala-record-form textarea');notes.value='Observação operacional';notes.dispatchEvent(new h.window.Event('input',{bubbles:true}));await h.settle();
 h.get('.escala-record-form').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));await h.settle();
 assert.equal(saved.p_payload.notes,'Observação operacional');assert.equal(saved.p_id,h.state.staff[0].id);assert.equal(saved.p_unit,'Matriz Caicó');assert.ok(saved.p_request_id);h.destroy();
});

test('funcionários aparecem sem importação manual e podem ser filtrados por nome e área',async()=>{
 const state=escalaFixture();state.staff[0].area='Entrega';state.staff[1].area='Armazém';
 const h=harness({state});await h.enter('escala-staff');assert.match(h.get('#view-escala-staff').textContent,/aparecem automaticamente/);
 assert.ok(![...h.document.querySelectorAll('#view-escala-staff button')].some(b=>b.textContent==='Vincular pessoas'));
 await h.input('#view-escala-staff input[type="search"]',state.staff[0].name);assert.equal(h.document.querySelectorAll('#view-escala-staff tbody tr').length,1);assert.match(h.get('#view-escala-staff tbody').textContent,new RegExp(state.staff[0].name));
 await h.input('#view-escala-staff input[type="search"]','');await h.change('#view-escala-staff .escala-form-grid select','Armazém');assert.equal(h.document.querySelectorAll('#view-escala-staff tbody tr').length,1);assert.match(h.get('#view-escala-staff tbody').textContent,/Armazém/);assert.equal(h.writes.length,0);h.destroy();
});

test('funcionários inativos ficam disponíveis no filtro próprio sem se misturar à equipe atual',async()=>{
 const state=escalaFixture();state.staff[0].status='INACTIVE';const h=harness({state});await h.enter('escala-staff');assert.equal(h.document.querySelectorAll('#view-escala-staff tbody tr').length,state.staff.length-1);
 await h.change('#view-escala-staff .escala-form-grid label:last-child select','INACTIVE');assert.equal(h.document.querySelectorAll('#view-escala-staff tbody tr').length,1);assert.match(h.get('#view-escala-staff tbody').textContent,/Inativo/);assert.equal(h.writes.length,0);h.destroy();
});

test('a visão principal mostra cada pessoa e seus dias; o resumo diário tem cores e a navegação troca os meses sem gravar',async()=>{
 const state=escalaFixture();state.trucks=[];state.plan=generateMonth(state,'2026-11-01','people').plan;
 const h=harness({state});await h.enter('escala-calendar');assert.equal(h.document.querySelectorAll('.escala-people-table tbody tr').length,30);assert.ok(h.document.querySelector('.escala-people-table button.available'));assert.ok(h.document.querySelector('.escala-people-table button.rest'));assert.equal(h.document.querySelectorAll('.escala-side').length,0);
 assert.equal(h.document.querySelectorAll('.escala-people-table thead th').length,8);await h.change('[aria-label="Semana exibida"]','2026-11-30');assert.match(h.get('.escala-people-view').textContent,/Semana parcial/);assert.equal([...h.get('.escala-people-table tbody tr').querySelectorAll('td button')].filter(b=>b.disabled).length,6);await h.change('[aria-label="Semana exibida"]','2026-11-23');
 await h.input('.escala-availability-head input[type="search"]',state.staff[0].name);assert.equal(h.document.querySelectorAll('.escala-people-table tbody tr').length,1);
 await clickText(h,'Resumo por dia');assert.equal(h.document.querySelectorAll('.escala-daily-card').length,7);assert.ok(h.document.querySelector('.escala-person-group.available'));assert.ok(h.document.querySelector('.escala-person-group.rest'));
 await clickText(h,'Calendário mensal');assert.equal(h.document.querySelectorAll('[data-escala-day]').length,30);const workday=h.get('[data-escala-day="2026-11-03"]');assert.equal(workday.querySelectorAll('.escala-day-group button').length,10);assert.ok(!h.document.querySelector('.escala-app').textContent.includes('Lista de dias'));assert.ok(!h.document.querySelector('.escala-tabs').textContent.includes('Caminhões'));
 await clickText(h,'Próximo mês ›');assert.equal(h.get('input[type="month"]').value,'2026-12');await clickText(h,'‹ Mês anterior');assert.equal(h.get('input[type="month"]').value,'2026-11');assert.equal(h.writes.length,0);h.destroy();
});
