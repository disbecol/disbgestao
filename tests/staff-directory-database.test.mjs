import test,{before,after,describe} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {drawCrew} from '../modules/gestao/src/escala/composition.ts';
const db=new PGlite(),A='Matriz Caicó',B='Filial Pau dos Ferros',ids={admin:randomUUID(),branch:randomUUID(),applicator:randomUUID(),employee:randomUUID()};
const q=async(s,a=[])=>(await db.query(s,a)).rows;
async function as(id=ids.admin){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const rpc=async(name,args,casts)=> (await q(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)+(casts?.[i]||'')).join(',')})) value`,args))[0]?.value;
const save=(payload,id=null,revision=0,unit=A)=>rpc('staff_directory_save',[unit,id,revision,JSON.stringify(payload)],['','::uuid','','::jsonb']);
const personPayload=(extra={})=>({name:'Pessoa sem conta',job:'Ajudante de entrega',area:'Entrega',active:true,units:[A],notes:'',...extra});
const formPayload={name:'DTO de teste',area:'Entrega',units:[A],description:'',form_type:'DTO',apply_everyone:true,apply_roles:[],apply_user_ids:[],report_roles:[],report_user_ids:[],status:'PUBLISHED',schema:{evaluation:{enabled:true,area:'Entrega',areas:['Entrega']},sections:[{id:'s',title:'DTO',fields:[{id:'q',label:'Usa EPI?',type:'BOOLEAN',required:true,scope:'INDIVIDUAL',scored:true,expected:'YES',allow_na:true}]}]}};
let form,historical,created,accountsBefore;
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;
 create table profiles(id uuid primary key,name text,role text,active bool default true);grant select on profiles to authenticated;create table units(name text primary key,active bool default true);create table user_units(user_id uuid,unit_name text);create table permissions(code text primary key,module text,name text,description text,sort_order int,active bool);create table role_permissions(role text,permission_code text,primary key(role,permission_code));create table user_permissions(user_id uuid,permission_code text,allowed bool);create table module_settings(module_name text primary key,active bool default true,updated_at timestamptz default now());
 create schema storage;create table storage.buckets(id text primary key,name text,public bool,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated,anon;
 create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select coalesce((select role='ADMIN' and active from profiles where id=auth.uid()),false)$$;`);
 await db.exec(read('supabase/18_v1_4_0_permissoes_avarias_vendas.sql').match(/create or replace function public\.has_permission\([\s\S]*?\$\$;/)[0]);
 await db.exec(read('supabase/26_v1_6_0_unidades_por_usuario.sql').match(/create or replace function public\.user_has_unit\([\s\S]*?\$\$;/)[0]);
 await q('insert into units values($1,true),($2,true)',[A,B]);
 for(const [key,id]of Object.entries(ids)){await q('insert into profiles values($1,$2,$3,true)',[id,key,key==='admin'||key==='branch'?'ADMIN':'MOTORISTA']);await q('insert into user_units values($1,$2)',[id,key==='branch'?B:A]);}
 for(const path of ['supabase/79_forms_module.sql','supabase/80_forms_evaluated_people.sql','supabase/81_forms_area_and_self_results.sql','supabase/migrations/20261125121851_dto_history_roles_and_multi_area_forms.sql','supabase/migrations/20261125165526_escala_team_planning.sql'])await db.exec(read(path));
 await q("update profiles set evaluation_area='Entrega' where id=$1",[ids.employee]);
 await as();form=await rpc('save_form_definition',[null,0,JSON.stringify(formPayload)],['::uuid','','::jsonb']);
 historical=await rpc('start_form_response_evaluated',[form.id,A,randomUUID(),[ids.employee],null],['::uuid','','::uuid','::uuid[]','::uuid']);
 historical=await rpc('save_form_response',[historical.id,historical.revision,JSON.stringify({__evaluations:{[ids.employee]:{q:{value:'YES'}}}}),true],['::uuid','','::jsonb','']);
 await db.exec('reset role');accountsBefore=(await q('select count(*)::int n from profiles'))[0].n;
 try{await db.exec(read('supabase/migrations/20261125180349_independent_staff_directory.sql'));await db.exec(read('supabase/migrations/20261125191110_escala_directory_auto_staff.sql'));await db.exec(read('supabase/migrations/20261125192341_staff_directory_archived_people.sql'));await db.exec(read('supabase/migrations/20261125194359_escala_random_team_members.sql'));await db.exec(read('supabase/migrations/20261125200715_escala_private_api_handlers.sql'));}catch(e){throw Error(`${e.message}; ${e.where||''}; posição ${e.position}`);}
 await as();
});
after(()=>db.close());
test('migração preserva IDs de avaliados, respostas e notas sem exigir conta nova',async()=>{
 const p=(await q('select * from staff_people where id=$1',[ids.employee]))[0];assert.equal(p.profile_id,ids.employee);assert.equal(p.area,'Entrega');
 const row=(await q('select * from form_responses where id=$1',[historical.id]))[0];assert.equal(Number(row.score),100);assert.deepEqual(row.answers,historical.answers);assert.equal(row.evaluated_people[0].id,ids.employee);
 created=await save(personPayload());assert.equal(created.profile_id,null);assert.equal((await q('select count(*)::int n from profiles'))[0].n,accountsBefore);
});
test('pessoa sem login pode ser avaliada e histórico continua estável após renomear ou inativar',async()=>{
 const targets=await q('select * from forms_evaluation_people($1,$2)',[form.id,A]);assert.ok(targets.some(p=>p.id===created.id));
 let row=await rpc('start_form_response_evaluated',[form.id,A,randomUUID(),[created.id],null],['::uuid','','::uuid','::uuid[]','::uuid']);
 row=await rpc('save_form_response',[row.id,row.revision,JSON.stringify({__evaluations:{[created.id]:{q:{value:'YES'}}}}),true],['::uuid','','::jsonb','']);assert.equal(Number(row.score),100);
 created=await save(personPayload({name:'Nome revisado',active:false}),created.id,created.revision);assert.equal(created.revision,2);
 assert.ok(!(await q('select * from forms_evaluation_people($1,$2)',[form.id,A])).some(p=>p.id===created.id));
 const stored=(await q('select * from form_responses where id=$1',[row.id]))[0];assert.equal(stored.evaluated_people[0].name,'Pessoa sem conta');assert.equal(Number(stored.score),100);
 assert.equal((await q('select * from forms_staff_people() where id=$1',[created.id]))[0].name,'Nome revisado');
 await assert.rejects(()=>save(personPayload(),created.id,1),/STAFF_VERSION_CONFLICT/);
});
test('RLS e RPC impedem acesso anônimo, edição direta e alteração de outra unidade',async()=>{
 await db.exec('reset role;set role anon');await assert.rejects(()=>q('select * from staff_people'),/permission denied/);await assert.rejects(()=>rpc('staff_directory_state',[A]),/permission denied/);
 await as(ids.branch);assert.equal((await q('select * from staff_people where id=$1',[created.id])).length,0);await assert.rejects(()=>rpc('staff_directory_state',[A]),/FORBIDDEN/);await assert.rejects(()=>save(personPayload()),/FORBIDDEN/);
 await as(ids.applicator);await assert.rejects(()=>save(personPayload()),/FORBIDDEN/);await assert.rejects(()=>q("update staff_people set name='Forjado'"),/permission denied/);assert.ok((await q('select * from forms_staff_people()')).length>0);
 await as();await assert.rejects(()=>save(personPayload({units:[A,B]})),/UNIDADE_SEM_ACESSO/);
});
test('a Escala vincula o cadastro independente e mantém snapshots anteriores intactos',async()=>{
 await as();created=await save(personPayload({active:true,name:'Nome na equipe'}),created.id,created.revision);
 const request=randomUUID(),args=[A,'STAFF_IMPORT',null,0,JSON.stringify({ids:[created.id]}),request];const first=await rpc('escala_command',args,['','','::uuid','','::jsonb','::uuid']);assert.equal(first.selected,1);
 assert.deepEqual(await rpc('escala_command',args,['','','::uuid','','::jsonb','::uuid']),first);
 let staff=(await q('select * from escala_staff where person_id=$1',[created.id]))[0];assert.equal(staff.name,'Nome na equipe');assert.equal(staff.profile_id,null);
 created=await save(personPayload({name:'Nome corrigido'}),created.id,created.revision);staff=(await q('select * from escala_staff where id=$1',[staff.id]))[0];assert.equal(staff.name,'Nome corrigido');
 await assert.rejects(()=>rpc('escala_command',[A,'STAFF_SAVE',null,0,JSON.stringify({name:'Outro nome',job:'Motorista'}),randomUUID()],['','','::uuid','','::jsonb','::uuid']),/STAFF_USE_DIRECTORY/);
 created=await save(personPayload({name:'Nome corrigido',active:false}),created.id,created.revision);assert.equal((await q('select status from escala_staff where id=$1',[staff.id]))[0].status,'INACTIVE');
});
test('desvincular conta arquivada mantém o histórico e o cadastro de pessoas',async()=>{
 await db.exec('reset role');await q('update staff_people set profile_id=null where id=$1',[ids.employee]);await q("update profiles set active=false,access_archived_at=now(),access_archive_reason='Teste' where id=$1",[ids.employee]);
 await as();assert.equal((await q('select count(*)::int n from form_responses where id=$1',[historical.id]))[0].n,1);assert.equal((await q('select * from staff_people where id=$1',[ids.employee]))[0].active,true);
 const targets=await q('select * from forms_evaluation_people($1,$2)',[form.id,A]);assert.ok(targets.some(p=>p.id===ids.employee));assert.equal((await q('select count(*)::int n from profiles'))[0].n,accountsBefore);
});

test('Escala mostra as pessoas da unidade automaticamente, sem vinculação manual ou conta de acesso',async()=>{
 await as();const state=await rpc('escala_state',[A,'2026-11-01'],['','::date']);
 const all=await q('select p.id,p.area from staff_people p join staff_people_units u on u.person_id=p.id where u.unit=$1 and p.active',[A]);
 for(const p of all){const s=state.staff.find(s=>s.person_id===p.id&&!s.deleted_at);assert.ok(s,'Pessoa cadastrada deve estar na Escala');assert.equal(s.area,p.area);}
 const added=await save(personPayload({name:'Cadastro automático',job:'Ajudante de armazém',area:'Armazém'}));
 const staff=(await q('select * from escala_staff where person_id=$1 and unit=$2',[added.id,A]))[0];assert.equal(staff.profile_id,null);assert.equal(staff.job,'Ajudante de armazém');
 await db.exec('reset role');await q('select staff_private.ensure_escala_person($1)',[added.id]);await as();assert.equal((await q('select count(*)::int n from escala_staff where person_id=$1',[added.id]))[0].n,1);
});

test('atualizar o cadastro central mantém férias, observações, integrantes e snapshots de escalas',async()=>{
 await as();let p=await save(personPayload({name:'Pessoa com férias'}));const s=(await q('select * from escala_staff where person_id=$1',[p.id]))[0];
 const saved=await rpc('escala_command',[A,'STAFF_SAVE',s.id,s.revision,JSON.stringify({status:'VACATION',vacation_start:'2026-12-01',vacation_end:'2026-12-20',notes:'Observação da escala'}),randomUUID()],['','','::uuid','','::jsonb','::uuid']);assert.equal(saved.status,'VACATION');
 const t=(await q('select id from escala_teams where unit=$1 limit 1',[A]))[0];await rpc('escala_command',[A,'MEMBERSHIP_SAVE',null,0,JSON.stringify({team_id:t.id,staff_id:s.id,starts_on:'2026-01-01'}),randomUUID()],['','','::uuid','','::jsonb','::uuid']);
 await db.exec('reset role');const month=(await q("insert into escala_months(unit,month) values($1,'2026-11-01') returning id",[A]))[0];const day=(await q("insert into escala_days(unit,month_id,date,kind,required) values($1,$2,'2026-11-01','SUNDAY',0) returning id",[A,month.id]))[0];await q("insert into escala_duties(unit,day_id,team_id,mode,members) values($1,$2,$3,'REST',jsonb_build_array(jsonb_build_object('id',$4::text,'name','Pessoa com férias')))",[A,day.id,t.id,s.id]);await as();
 p=await save(personPayload({name:'Nome corrigido',job:'Função atualizada',area:'Armazém'}),p.id,p.revision);
 const current=(await q('select * from escala_staff where id=$1',[s.id]))[0];assert.equal(current.name,'Nome corrigido');assert.equal(current.status,'VACATION');assert.equal(current.notes,'Observação da escala');assert.equal(new Date(current.vacation_end).toISOString().slice(0,10),'2026-12-20');
 assert.equal((await q('select count(*)::int n from escala_memberships where staff_id=$1',[s.id]))[0].n,1);assert.equal((await q('select members from escala_duties where day_id=$1',[day.id]))[0].members[0].name,'Pessoa com férias');
});

test('novos vínculos de unidade alimentam a Escala correspondente e remoções preservam o registro inativo',async()=>{
 await db.exec('reset role');await q('insert into user_units values($1,$2)',[ids.admin,B]);await as();let p=await save(personPayload({name:'Pessoa de duas unidades',units:[A,B]}));
 assert.equal((await q('select count(*)::int n from escala_staff where person_id=$1',[p.id]))[0].n,2);
 p=await save(personPayload({name:p.name,units:[A]}),p.id,p.revision);const rows=await q('select unit,status from escala_staff where person_id=$1',[p.id]);assert.equal(rows.find(s=>s.unit===B).status,'INACTIVE');assert.equal(rows.find(s=>s.unit===A).status,'ACTIVE');
 await db.exec('reset role;set role anon');await assert.rejects(()=>q('select staff_private.ensure_escala_person($1)',[p.id]),/permission denied/);await as(ids.applicator);await assert.rejects(()=>q('select staff_private.ensure_escala_person($1)',[p.id]),/permission denied/);await as();
});

test('retirar um cadastro genérico oculta a pessoa sem apagar as suas aplicações anteriores',async()=>{
 await db.exec('reset role');await q('update staff_people set active=false,archived_at=now() where id=$1',[ids.employee]);await as();
 const state=await rpc('staff_directory_state',[A]);assert.ok(!state.people.some(p=>p.id===ids.employee));assert.equal((await q('select * from staff_people where id=$1',[ids.employee])).length,0);
 await assert.rejects(()=>save(personPayload(),ids.employee,1),/FORBIDDEN/);
 const row=(await q('select * from form_responses where id=$1',[historical.id]))[0];assert.equal(Number(row.score),100);assert.equal(row.evaluated_people[0].id,ids.employee);
});

describe('composição mensal das equipes com integrantes sorteados',()=>{
 const C='Unidade fictícia de sorteio',month='2027-02-01';let firstArgs,firstResult;
 const state=()=>rpc('escala_state',[C,month],['','::date']);
 const command=(action,payload={},id=null,revision=0)=>rpc('escala_command',[C,action,id,revision,JSON.stringify(payload),randomUUID()],['','','::uuid','','::jsonb','::uuid']);
 const args=(s,p,seed='crew-db',id=randomUUID())=>[C,month,s.composition_token,seed,JSON.stringify(p.assignments),2,'Entrega',id];
 const persist=a=>rpc('escala_save_composition',a,['','::date','','','::jsonb','','','::uuid']);
 before(async()=>{
  await db.exec('reset role');await q('insert into units values($1,true)',[C]);await q('insert into user_units values($1,$2)',[ids.admin,C]);await as();await command('SETUP',{teams:10,trucks:9});
  for(let n=0;n<30;n++)await save(personPayload({name:'Pessoa fictícia do sorteio '+n,job:n%3?'Ajudante':'Motorista',units:[C]}),null,0,C);
  const s=await state(),drivers=s.staff.filter(p=>p.job==='Motorista'),helpers=s.staff.filter(p=>p.job==='Ajudante');
  for(let n=0;n<2;n++)for(const p of [drivers[n],helpers[n*2],helpers[n*2+1]])await command('MEMBERSHIP_SAVE',{team_id:s.teams[n].id,staff_id:p.id,starts_on:'2026-01-01'});
 });
 test('salva somente as equipes não definidas e mantém as equipes 1 e 2 intactas',async()=>{
  const s=await state(),manual=structuredClone(s.memberships),p=drawCrew(s,month,'crew-db');assert.deepEqual(p.errors,[]);assert.equal(p.fixed.length,2);assert.equal(p.assignments.length,8);
  firstArgs=args(s,p);firstResult=await persist(firstArgs);assert.equal(firstResult.teams,8);const after=await state();assert.equal(after.memberships.length,30);
  for(const m of manual)assert.deepEqual(after.memberships.find(x=>x.id===m.id),m);
  assert.equal(new Set(after.memberships.map(m=>m.staff_id)).size,30);assert.equal(after.memberships.filter(m=>m.origin==='AUTO').length,24);assert.ok(after.memberships.filter(m=>m.origin==='AUTO').every(m=>m.ends_on==='2027-02-28'));
 });
 test('reenvio é idempotente e uma prévia antiga não sobrescreve alterações de outro usuário',async()=>{
  assert.deepEqual(await persist(firstArgs),firstResult);assert.equal((await state()).memberships.length,30);const stale=[...firstArgs];stale[7]=randomUUID();await assert.rejects(()=>persist(stale),/ESCALA_VERSION_CONFLICT/);
 });
 test('outro sorteio substitui apenas os vínculos automáticos e mantém o histórico da composição anterior',async()=>{
  const s=await state(),p=drawCrew(s,month,'new-draw');await persist(args(s,p,'new-draw'));const after=await state();assert.equal(after.memberships.length,30);assert.equal(new Set(after.memberships.map(m=>m.staff_id)).size,30);
  const audit=await rpc('escala_audit_detail',[C,after.audit.find(a=>a.action==='COMPOSITION_DRAW').id],['','::uuid']);assert.equal(audit.before.length,24);assert.equal(audit.after.assignments.length,8);
 });
 test('o servidor recusa pessoas repetidas, outra função, ausências e tentativa de modificar equipe fixa',async()=>{
  let s=await state(),p=drawCrew(s,month,'invalid'),bad=structuredClone(p);bad.assignments[1].members[0]=bad.assignments[0].members[0];await assert.rejects(()=>persist(args(s,bad,'duplicate')),/ESCALA_DUPLICATE_MEMBERSHIP/);
  bad=structuredClone(p);bad.assignments[0].team_id=p.fixed[0].id;await assert.rejects(()=>persist(args(s,bad,'fixed')),/ESCALA_COMPOSITION_TEAMS/);
  const excluded=p.assignments[0].members[1],row=s.staff.find(p=>p.id===excluded);await command('STAFF_SAVE',{status:'LEAVE'},row.id,row.revision);s=await state();await assert.rejects(()=>persist(args(s,p,'leave')),/ESCALA_COMPOSITION_PERSON/);const current=s.staff.find(p=>p.id===excluded);await command('STAFF_SAVE',{status:'ACTIVE'},current.id,current.revision);
  assert.equal((await state()).memberships.length,30);
 });
 test('uma alteração manual de integrante passa a proteger aquela equipe nos sorteios seguintes',async()=>{
  let s=await state();const m=s.memberships.find(m=>m.origin==='AUTO');await command('MEMBERSHIP_SAVE',{team_id:m.team_id,staff_id:m.staff_id,starts_on:m.starts_on,ends_on:m.ends_on},m.id,m.revision);s=await state();assert.equal(s.memberships.find(x=>x.id===m.id).origin,'MANUAL');const p=drawCrew(s,month,'manual');assert.equal(p.fixed.length,3);assert.ok(!p.assignments.some(a=>a.team_id===m.team_id));
 });
 test('escalas aprovadas, dias bloqueados e rotas realizadas impedem outro sorteio de integrantes',async()=>{
  await db.exec('reset role');const cal=(await q('insert into escala_months(unit,month) values($1,$2::date) returning id',[C,month]))[0];const day=(await q("insert into escala_days(unit,month_id,date,kind,required,locked) values($1,$2,$3::date,'NORMAL',0,true) returning id",[C,cal.id,month]))[0];await as();let s=await state(),p=drawCrew({...s,plan:null},month,'protected');await assert.rejects(()=>persist(args(s,p,'locked')),/ESCALA_COMPOSITION_LOCKED/);
  await db.exec('reset role');await q('update escala_days set locked=false where id=$1',[day.id]);await q("insert into escala_duties(unit,day_id,team_id,mode,completed) values($1,$2,$3,'ROUTE',true)",[C,day.id,s.teams[0].id]);await as();s=await state();await assert.rejects(()=>persist(args(s,p,'completed')),/ESCALA_COMPOSITION_LOCKED/);
  await db.exec('reset role');await q('update escala_duties set completed=false where day_id=$1',[day.id]);await q("update escala_months set status='APPROVED' where id=$1",[cal.id]);await as();s=await state();await assert.rejects(()=>persist(args(s,p,'approved')),/ESCALA_COMPOSITION_LOCKED/);
 });
 test('consulta e gravação continuam isoladas por unidade e inacessíveis a anônimos',async()=>{
  await as(ids.branch);await assert.rejects(()=>state(),/FORBIDDEN/);await assert.rejects(()=>persist(firstArgs),/FORBIDDEN/);await db.exec('reset role;set role anon');await assert.rejects(()=>persist(firstArgs),/permission denied/);await as();
 });
 test('API usa invoker e os manipuladores privados mantêm autorização mesmo fora da API',async()=>{
  const functions=await q("select n.nspname schema,p.proname name,p.prosecdef definer,has_function_privilege('anon',p.oid,'EXECUTE') anonymous from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','escala_private') and p.proname in('escala_state','escala_command','escala_save_composition')");
  assert.equal(functions.length,6);for(const f of functions){assert.equal(f.definer,f.schema==='escala_private');assert.equal(f.anonymous,false);}
  await as(ids.branch);await assert.rejects(()=>q('select escala_private.escala_state($1,$2::date)',[C,month]),/FORBIDDEN/);
  await as(ids.applicator);await assert.rejects(()=>persist(firstArgs),/FORBIDDEN/);await assert.rejects(()=>q('select escala_private.escala_save_composition($1,$2::date,$3,$4,$5::jsonb,$6,$7,$8::uuid)',firstArgs),/FORBIDDEN/);
  await as('');await assert.rejects(()=>state(),/FORBIDDEN/);await assert.rejects(()=>persist(firstArgs),/FORBIDDEN/);await assert.rejects(()=>command('SETUP',{teams:1,trucks:1}),/FORBIDDEN/);
  await db.exec('reset role;set role anon');await assert.rejects(()=>q('select escala_private.escala_state($1,$2::date)',[C,month]),/permission denied/);await as();
 });
});
