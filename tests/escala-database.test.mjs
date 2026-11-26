import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {generateMonth as generatePeopleMonth} from '../modules/gestao/src/escala/engine.ts';
// This historical schema fixture retains its original vehicle requirement.
function generateMonth(state,month,seed){const result=generatePeopleMonth(state,month,seed);for(const day of result.plan.days){let n=0;for(const duty of day.duties)if(duty.mode==='ROUTE')duty.truck_id=state.trucks[n++]?.id||null;}return result;}
const db=new PGlite(),A='Matriz Caicó',B='Filial Pau dos Ferros',admin=randomUUID(),manager=randomUUID(),viewer=randomUUID(),other=randomUUID();
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
async function as(id=admin){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function cmd(action,payload={},id=null,revision=0,unit=A,request=randomUUID()){return(await q('select public.escala_command($1,$2,$3,$4,$5::jsonb,$6) value',[unit,action,id,revision,JSON.stringify(payload),request]))[0].value;}
const state=async(month='2027-02-01',unit=A)=>(await q('select public.escala_state($1,$2::date) value',[unit,month]))[0].value;
let baseline;
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;create table public.profiles(id uuid primary key,name text,role text,active bool default true);create table public.units(name text primary key,active bool default true);create table public.user_units(user_id uuid,unit_name text);create table public.permissions(code text primary key,module text,name text,description text,sort_order int,active bool);create table public.role_permissions(role text,permission_code text,primary key(role,permission_code));create table public.module_settings(module_name text primary key,active bool default true);create function public.is_admin() returns bool language sql stable security definer set search_path=public as $$select coalesce((select role='ADMIN' and active from profiles where id=auth.uid()),false)$$;create function public.has_permission(code text) returns bool language sql stable security definer set search_path=public as $$select coalesce((select p.active and (p.role='ADMIN' or exists(select 1 from role_permissions r where r.role=p.role and r.permission_code=code)) from profiles p where p.id=auth.uid()),false)$$;create function public.user_has_unit(u text) returns bool language sql stable security definer set search_path=public as $$select exists(select 1 from user_units where user_id=auth.uid() and unit_name=u)$$;`);
 await q('insert into units values($1,true),($2,true)',[A,B]);
 for(const [id,role,unit]of [[admin,'ADMIN',A],[manager,'MANAGER',A],[viewer,'VIEWER',A],[other,'ADMIN',B]]){await q('insert into profiles(id,name,role) values($1,$2,$3)',[id,role,role]);await q('insert into user_units values($1,$2)',[id,unit]);}
 const migration=await readFile(new URL('../supabase/migrations/20261125165526_escala_team_planning.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec("alter table escala_memberships add column origin text");
 for(const code of ['ESCALA_VIEW','ESCALA_MANAGE'])await q('insert into role_permissions values($1,$2)',['MANAGER',code]);await q("insert into role_permissions values('VIEWER','ESCALA_VIEW')");
 await as();baseline=await state();
 for(const t of baseline.trucks)await cmd('TRUCK_SAVE',{plate:'ABC1D'+String(baseline.trucks.indexOf(t)+1).padStart(2,'0'),status:'AVAILABLE'},t.id,t.revision);
 for(const team of baseline.teams){for(let i=0;i<3;i++){const person=await cmd('STAFF_SAVE',{name:`Pessoa fictícia ${team.code}-${i}`,job:i?'Ajudante':'Motorista',status:'ACTIVE'});await cmd('MEMBERSHIP_SAVE',{team_id:team.id,staff_id:person.id,starts_on:'2026-01-01'});}}
 await db.exec('reset role');await db.exec("update escala_memberships set origin='AUTO'");await as();
 const rules=(await state()).rules;await cmd('RULES_SAVE',{work_minutes:480,daily_limit:480,weekly_minutes:2400,collective_reference:'Regime 5x2 para teste',reviewed_on:'2026-11-25'},rules.id,rules.revision);baseline=await state();
});
after(async()=>db.close());
test('migração e configuração real são idempotentes e não concedem acesso anônimo',async()=>{
 await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/20261125165526_escala_team_planning.sql',import.meta.url),'utf8'));await as();
 assert.equal((await state()).teams.length,10);assert.equal((await state()).trucks.length,9);
 await assert.rejects(()=>cmd('SETUP',{teams:10,trucks:9}),/ESCALA_ALREADY_SETUP/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>q('select * from escala_staff'),/permission denied/);await assert.rejects(()=>state(),/permission denied/);await as();
});
test('RLS e RPC isolam unidades e separam consulta, organização e configuração',async()=>{
 await as(other);assert.equal((await q('select * from escala_teams where unit=$1',[A])).length,0);await assert.rejects(()=>state(),/FORBIDDEN/);await assert.rejects(()=>cmd('TEAM_SAVE',{code:'X',name:'Fora da unidade'}),/FORBIDDEN/);
 await as(viewer);assert.equal((await state()).teams.length,10);await assert.rejects(()=>cmd('TEAM_SAVE',{code:'X',name:'Sem permissão'}),/FORBIDDEN/);await assert.rejects(()=>q("update escala_teams set name='Forjado'"),/permission denied/);
 await as(manager);await assert.rejects(()=>cmd('HOLIDAYS_SYNC',{year:2027}),/FORBIDDEN/);await as();
});
test('conflitos de revisão e reenvios não duplicam gravações nem sobrescrevem outro usuário',async()=>{
 const request=randomUUID(),payload={name:'Cadastro de teste',job:'Ajudante'};
 const first=await cmd('STAFF_SAVE',payload,null,0,A,request),retry=await cmd('STAFF_SAVE',payload,null,0,A,request);assert.equal(first.id,retry.id);
 await assert.rejects(()=>cmd('STAFF_SAVE',{...payload,name:'Outra solicitação'},null,0,A,request),/ESCALA_REQUEST_CONFLICT/);
 const saved=await cmd('STAFF_SAVE',{notes:'Edição válida'},first.id,first.revision);
 await assert.rejects(()=>cmd('STAFF_SAVE',{notes:'Edição antiga'},first.id,first.revision),/ESCALA_VERSION_CONFLICT/);assert.equal(saved.revision,2);
});
test('integrantes não entram em duas equipes no mesmo período sem autorização administrativa justificada',async()=>{
 const person=baseline.staff[0],membership=baseline.memberships.find(m=>m.staff_id===person.id),otherTeam=baseline.teams.find(t=>t.id!==membership.team_id);
 await as(manager);await assert.rejects(()=>cmd('MEMBERSHIP_SAVE',{team_id:otherTeam.id,staff_id:person.id,starts_on:'2027-01-01'}),/ESCALA_DUPLICATE_MEMBERSHIP/);await assert.rejects(()=>cmd('MEMBERSHIP_SAVE',{team_id:otherTeam.id,staff_id:person.id,starts_on:'2027-01-01',override_reason:'Teste'}),/FORBIDDEN/);await as();
});
test('calendário persistido contém 9 equipes em rota nos dias úteis, 5 aos sábados e nenhuma aos domingos',async()=>{
 const data=await state(),{plan,issues}=generateMonth(data,'2027-02-01','seed-db');assert.deepEqual(issues,[]);
 const saved=await cmd('MONTH_SAVE',{...plan,generated:true});assert.equal(saved.days.length,28);
 for(const day of saved.days){const dow=new Date(day.date+'T12:00Z').getUTCDay();assert.equal(day.duties.filter(d=>d.mode==='ROUTE').length,dow===0?0:dow===6?5:9);}
 const reloaded=(await state()).plan;assert.equal(reloaded.id,saved.id);assert.equal(reloaded.days[0].duties.reduce((n,d)=>n+d.members.length,0),30);
});
test('aprovação recalcula conflitos no servidor, bloqueia alterações automáticas e exige administrador para desbloquear',async()=>{
 let plan=(await state()).plan;const approved=await cmd('APPROVE',{month:plan.month},plan.id,plan.revision);assert.equal(approved.status,'APPROVED');
 await assert.rejects(()=>cmd('MONTH_SAVE',{...approved},approved.id,approved.revision),/ESCALA_LOCKED/);
 await as(manager);await assert.rejects(()=>cmd('UNLOCK',{month:approved.month,reason:'Mudança'},approved.id,approved.revision),/FORBIDDEN/);await as();
 await assert.rejects(()=>cmd('UNLOCK',{month:approved.month},approved.id,approved.revision),/ESCALA_REASON_REQUIRED/);
 plan=await cmd('UNLOCK',{month:approved.month,reason:'Conferência de teste'},approved.id,approved.revision);assert.equal(plan.status,'DRAFT');
 const broken=structuredClone(plan);broken.days[0].duties.find(d=>d.mode==='ROUTE').truck_id=null;
 plan=await cmd('MONTH_SAVE',broken,plan.id,plan.revision);await assert.rejects(()=>cmd('APPROVE',{month:plan.month},plan.id,plan.revision),/ESCALA_APPROVAL_CONFLICT/);
});
test('feriados usam fontes oficiais, preservam ajustes e pontos facultativos não são inventados',async()=>{
 await cmd('HOLIDAYS_SYNC',{year:2027});await cmd('HOLIDAYS_SYNC',{year:2027});
 const holidays=(await state()).holidays.filter(h=>h.date.startsWith('2027'));assert.equal(holidays.filter(h=>h.kind==='NATIONAL').length,9);assert.equal(holidays.find(h=>h.name.startsWith('Sexta-feira')).enabled,false);
 const fixed=holidays.find(h=>h.date==='2027-01-01');await assert.rejects(()=>cmd('HOLIDAY_ARCHIVE',{reason:'Teste'},fixed.id,fixed.revision),/ESCALA_AUTOMATIC_HOLIDAY/);
 await cmd('HOLIDAY_SAVE',{operates:true,date:'2027-01-02'},fixed.id,fixed.revision);assert.ok((await state()).holidays.some(h=>h.id===fixed.id&&h.date==='2027-01-01'&&h.operates));
});

test('saldo inicial exige conferência, composição e revisão atual e passa a integrar o histórico',async()=>{
 await as();let data=await state('2027-09-01');const {plan}=generateMonth(data,'2027-09-01','opening');let saved=await cmd('MONTH_SAVE',plan);assert.ok(saved.issues.some(i=>i.code==='MISSING_HISTORY'));
 const days=['2027-08-30','2027-08-31'].map(date=>({date,duties:data.teams.filter(t=>t.active).map(t=>({team_id:t.id,mode:'REST',work_minutes:0}))}));
 await assert.rejects(()=>cmd('OPENING_SAVE',{month:plan.month,days,attested:false},data.rules.id,data.rules.revision),/ESCALA_OPENING_INVALID/);
 await cmd('OPENING_SAVE',{month:plan.month,days,attested:true},data.rules.id,data.rules.revision);
 await assert.rejects(()=>cmd('OPENING_SAVE',{month:plan.month,days,attested:true},data.rules.id,data.rules.revision),/ESCALA_VERSION_CONFLICT/);
 data=await state('2027-09-01');assert.equal(data.history.filter(d=>days.some(x=>x.date===d.date)).length,2);
 saved=await cmd('MONTH_SAVE',{...saved},saved.id,saved.revision);assert.ok(!saved.issues.some(i=>i.code==='MISSING_HISTORY'));
});

test('a transferência encerra o vínculo anterior, cria o novo e preserva a composição de escalas já salvas',async()=>{
 await as();const data=await state(),member=data.memberships[0],destination=data.teams.find(t=>t.id!==member.team_id);
 const before=(await q('select members from escala_duties where unit=$1 and team_id=$2 limit 1',[A,member.team_id]))[0].members;
 const moved=await cmd('MEMBERSHIP_TRANSFER',{team_id:destination.id,date:'2027-03-01',reason:'Reorganização de teste'},member.id,member.revision);
 assert.equal(moved.team_id,destination.id);assert.equal((await q('select ends_on::text from escala_memberships where id=$1',[member.id]))[0].ends_on,'2027-02-28');
 assert.deepEqual((await q('select members from escala_duties where unit=$1 and team_id=$2 limit 1',[A,member.team_id]))[0].members,before);
});

test('rotas futuras não podem ser confirmadas por nenhum caminho e a auditoria tem leitura paginada separada dos detalhes',async()=>{
 await as();const data=await state('2027-09-01'),plan=data.plan,duty=plan.days.flatMap(d=>d.duties).find(d=>d.mode==='ROUTE');
 await assert.rejects(()=>cmd('ROUTE_COMPLETE',{completed:true,reason:'Teste'},duty.id,duty.revision),/ESCALA_FUTURE_COMPLETION/);
 const forged=structuredClone(plan);forged.days[0].duties.find(d=>d.mode==='ROUTE').completed=true;await assert.rejects(()=>cmd('MONTH_SAVE',forged,plan.id,plan.revision),/ESCALA_FUTURE_COMPLETION/);
 const page=(await q('select * from public.escala_audit_page($1,0)',[A]));assert.ok(page.length>0);assert.equal(page[0].after,undefined);
 const detail=(await q('select public.escala_audit_detail($1,$2) value',[A,page[0].id]))[0].value;assert.equal(detail.id,page[0].id);assert.ok('after' in detail);
 await as(other);assert.equal((await q('select public.escala_audit_detail($1,$2) value',[B,page[0].id]))[0].value,null);await as();
});

test('excluir um funcionário preserva o registro e os integrantes congelados nas escalas',async()=>{
 await as();const data=await state(),person=data.staff.find(p=>data.plan.days.some(d=>d.duties.some(a=>a.members.some(m=>m.id===p.id))));
 const saved=await cmd('STAFF_ARCHIVE',{reason:'Exclusão de teste'},person.id,person.revision);assert.ok(saved.deleted_at);
 const snapshot=(await q('select members from escala_duties where unit=$1',[A])).some(row=>row.members.some(p=>p.id===person.id));assert.equal(snapshot,true);assert.equal((await q('select count(*)::int n from escala_staff where id=$1',[person.id]))[0].n,1);
});
