import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
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
 try{await db.exec(read('supabase/migrations/20261125180349_independent_staff_directory.sql'));}catch(e){throw Error(`${e.message}; ${e.where||''}; posição ${e.position}`);}
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
