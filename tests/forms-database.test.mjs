import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const ids={admin:randomUUID(),manager:randomUUID(),a:randomUUID(),b:randomUUID(),review:randomUUID(),outsider:randomUUID()};
const A='Matriz Caicó',B='Filial Pau dos Ferros';
const schema={sections:[{id:'s1',title:'Verificação',fields:[
 {id:'q1',label:'Veículo em condições?',type:'BOOLEAN',required:true,scored:true,expected:'YES',allow_na:true,require_note:true},
 {id:'q2',label:'Equipamento',type:'BOOLEAN',scored:true,expected:'YES',allow_na:true},
 {id:'q3',label:'Quantidade',type:'NUMBER',required:true,min:0,max:100},
 {id:'q4',label:'Nome',type:'TEXT',required:true},
 {id:'q5',label:'Estado',type:'SINGLE_CHOICE',options:['Bom','Ruim'],scored:true,expected:'Bom'}]}]};
const payload=(overrides={})=>({name:'Inspeção',description:'',area:'Logística',form_type:'CHECKLIST',units:[A],apply_everyone:false,apply_roles:['VENDEDOR'],apply_user_ids:[],report_roles:['GERENTE_VENDAS'],report_user_ids:[],status:'PUBLISHED',schema:structuredClone(schema),...overrides});
const validAnswers=()=>({q1:{value:'YES'},q2:{value:'NA'},q3:{value:0},q4:{value:'Operador'},q5:{value:'Ruim',observation:'Peça solta',plan:'Revisar a peça'},__sections:{s1:'Inspeção no pátio'}});
async function as(user){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[user]||user||'']);await db.exec('set role authenticated');}
async function sql(text,args=[]){return (await db.query(text,args)).rows;}
async function createForm(overrides={}){await as('admin');return (await sql('select to_jsonb(public.save_form_definition(null,0,$1::jsonb)) as value',[JSON.stringify(payload(overrides))]))[0].value;}
async function startResponse(form,unit=A,assignment=null,id=randomUUID()){return (await sql('select to_jsonb(public.start_form_response($1::uuid,$2,$3::uuid,$4::uuid)) as value',[form.id,unit,id,assignment]))[0].value;}
async function saveResponse(row,answers=validAnswers(),final=true,revision=row.revision){return (await sql('select to_jsonb(public.save_form_response($1::uuid,$2,$3::jsonb,$4)) as value',[row.id,revision,JSON.stringify(answers),final]))[0].value;}

before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table public.profiles(id uuid primary key,name text,role text,active boolean default true);
 create table public.units(name text primary key,active boolean default true);
 create table public.user_units(user_id uuid,unit_name text);
 create table public.permissions(code text primary key,module text,name text,description text,sort_order int,active boolean);
 create table public.role_permissions(role text,permission_code text,primary key(role,permission_code));
 create table public.user_permissions(user_id uuid,permission_code text,allowed boolean);
 create table public.module_settings(module_name text primary key,active boolean default true,updated_at timestamptz default now());
 create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select coalesce((select role='ADMIN' and active from public.profiles where id=auth.uid()),false) $$;`);
 const permissionSource=await readFile(new URL('../supabase/18_v1_4_0_permissoes_avarias_vendas.sql',import.meta.url),'utf8');
 const unitSource=await readFile(new URL('../supabase/26_v1_6_0_unidades_por_usuario.sql',import.meta.url),'utf8');
 await db.exec(permissionSource.match(/create or replace function public\.has_permission\([\s\S]*?\$\$;/)[0]);
 await db.exec(unitSource.match(/create or replace function public\.user_has_unit\([\s\S]*?\$\$;/)[0]);
 await db.query('insert into public.units(name) values($1),($2)',[A,B]);
 for(const [user,role] of Object.entries({admin:'ADMIN',manager:'CONFERENTE',a:'VENDEDOR',b:'VENDEDOR',review:'GERENTE_VENDAS',outsider:'MOTORISTA_PUXADOR'})){
  await db.query('insert into public.profiles(id,name,role) values($1,$2,$3)',[ids[user],user,role]);
  await db.query('insert into public.user_units values($1,$2)',[ids[user],user==='b'?B:A]);
 }
 await db.query('insert into public.user_units values($1,$2)',[ids.admin,B]);
 const migration=await readFile(new URL('../supabase/79_forms_module.sql',import.meta.url),'utf8');
 try{await db.exec(migration);}catch(e){throw Error(`${e.message}; linha ${migration.slice(0,Number(e.position||1)).split('\n').length}; ${e.where||''}`);}
 await db.query("insert into public.user_permissions values($1,'FORMS_MANAGE',true)",[ids.manager]);
});
after(async()=>{await db.close();});

test('migração pode ser aplicada novamente sem apagar modelos ou permissões',async()=>{
 const form=await createForm();await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/79_forms_module.sql',import.meta.url),'utf8'));
 assert.equal((await sql('select count(*)::int as n from public.form_definitions where id=$1',[form.id]))[0].n,1);
 assert.equal((await sql("select count(*)::int as n from public.user_permissions where permission_code='FORMS_MANAGE'"))[0].n,1);
});
test('RLS e RPC isolam unidades mesmo para administradores com unidade limitada',async()=>{
 const formA=await createForm(),formB=await createForm({units:[B]});await as('a');
 const rows=await sql('select id from public.form_definitions');assert.ok(rows.some(r=>r.id===formA.id));assert.ok(!rows.some(r=>r.id===formB.id));
 await assert.rejects(()=>startResponse(formB,B),/FORBIDDEN/);
 await as('manager');await assert.rejects(()=>sql('select public.save_form_definition($1,1,$2::jsonb)',[formB.id,JSON.stringify(payload({units:[B]}))]),/FORBIDDEN|UNIDADE_SEM_ACESSO/);
});
test('somente cargo ou pessoa selecionada pode preencher, sem tornar o modelo público',async()=>{
 const form=await createForm({apply_roles:[],apply_user_ids:[ids.a]});await as('outsider');
 assert.equal((await sql('select id from public.form_definitions where id=$1',[form.id])).length,0);
 await assert.rejects(()=>startResponse(form),/FORBIDDEN/);await as('a');assert.equal((await startResponse(form)).respondent_id,ids.a);
});
test('acompanhamento exige autorização do modelo; participante vê apenas suas respostas',async()=>{
 const form=await createForm();await as('a');const row=await startResponse(form);await saveResponse(row);
 await as('outsider');assert.equal((await sql('select id from public.form_responses where id=$1',[row.id])).length,0);
 await as('review');assert.equal((await sql('select id from public.form_responses where id=$1',[row.id])).length,1);
 await assert.rejects(()=>saveResponse(row),/FORBIDDEN/);
});
test('não é possível gravar diretamente, editar finalizados ou chamar helpers internos',async()=>{
 const form=await createForm();await as('a');const row=await startResponse(form);await saveResponse(row);
 await assert.rejects(()=>sql("update public.form_responses set answers='{}' where id=$1",[row.id]),/permission denied/);
 await assert.rejects(()=>sql("insert into public.form_definitions(name) values('ataque')"),/permission denied/);
 await assert.rejects(()=>sql("select public.forms_subject_allowed($1,$2,'REPORT',null)",[form.id,ids.admin]),/permission denied/);
 await assert.rejects(()=>saveResponse(row,validAnswers(),false),/FORM_RESPONSE_CLOSED/);
});
test('autor, início, resultado e revisão vêm do servidor; zero é válido e N/A fica fora do cálculo',async()=>{
 const form=await createForm();await as('a');const row=await startResponse(form);const saved=await saveResponse(row);
 assert.equal(saved.respondent_name,'a');assert.equal(saved.status,'COMPLETED');assert.equal(saved.score,50);
 assert.equal(saved.ok_count,1);assert.equal(saved.nok_count,1);assert.equal(saved.na_count,1);
 assert.equal(saved.answers.q3.value,0);assert.equal(saved.answers.__sections.s1,'Inspeção no pátio');assert.ok(saved.completed_at);
});
test('o início e a finalização são idempotentes e não duplicam plano ou histórico',async()=>{
 const form=await createForm();await as('a');const row=await startResponse(form);assert.equal((await startResponse(form)).id,row.id);
 const saved=await saveResponse(row);const repeated=await saveResponse(row);assert.equal(repeated.revision,saved.revision);
 assert.equal((await sql('select count(*)::int as n from public.form_action_plans where response_id=$1',[row.id]))[0].n,1);
 await as('admin');assert.equal((await sql("select count(*)::int as n from public.form_audit where response_id=$1 and action='COMPLETE_RESPONSE'",[row.id]))[0].n,1);
});
test('schema da aplicação é imutável mesmo depois de editar perguntas e resposta conforme',async()=>{
 const form=await createForm();await as('a');const row=await startResponse(form);await as('admin');
 const changed=payload();changed.name='Título novo';changed.schema.sections[0].fields[0].label='Pergunta nova';changed.schema.sections[0].fields[0].expected='NO';
 await sql('select public.save_form_definition($1,$2,$3::jsonb)',[form.id,form.version,JSON.stringify(changed)]);
 await as('a');const saved=await saveResponse(row);assert.equal(saved.form_name,'Inspeção');assert.equal(saved.form_version,1);assert.equal(saved.schema_snapshot.sections[0].fields[0].expected,'YES');assert.equal(saved.score,50);
});
test('concorrência de rascunho e edição do modelo não pode omitir revisão',async()=>{
 const form=await createForm();await as('a');const row=await startResponse(form);const saved=await saveResponse(row,validAnswers(),false);
 await assert.rejects(()=>saveResponse(row,validAnswers(),false),/FORM_VERSION_CONFLICT/);
 await assert.rejects(()=>saveResponse(saved,validAnswers(),false,null),/FORM_VERSION_CONFLICT/);
 await as('admin');await assert.rejects(()=>sql('select public.save_form_definition($1,null,$2::jsonb)',[form.id,JSON.stringify(payload())]),/FORM_VERSION_CONFLICT/);
});
test('validação no banco bloqueia obrigatórias, escolha inválida, data inválida e NOK sem observação',async()=>{
 const form=await createForm();await as('a');const row=await startResponse(form);
 const missing=validAnswers();delete missing.q4;await assert.rejects(()=>saveResponse(row,missing),/FORM_REQUIRED/);
 const note=validAnswers();note.q1={value:'NO'};await assert.rejects(()=>saveResponse(row,note),/FORM_NOK_NOTE_REQUIRED/);
 const choice=validAnswers();choice.q5.value='Inventado';await assert.rejects(()=>saveResponse(row,choice),/FORM_ANSWER_INVALID/);
 const number=validAnswers();number.q3.value=-1;await assert.rejects(()=>saveResponse(row,number),/FORM_ANSWER_INVALID/);
 const na=validAnswers();na.q1.value='NA';assert.equal((await saveResponse(row,na)).score,0);
});
test('admin pode arquivar, preservando histórico e bloqueando novas respostas',async()=>{
 const form=await createForm();await as('a');const row=await startResponse(form);const saved=await saveResponse(row);
 await as('admin');await sql('select public.save_form_definition($1,$2,$3::jsonb)',[form.id,form.version,JSON.stringify(payload({status:'ARCHIVED'}))]);
 await as('a');await assert.rejects(()=>startResponse(form),/FORBIDDEN/);assert.equal((await sql('select status from public.form_responses where id=$1',[saved.id]))[0].status,'COMPLETED');
});
test('agendamento semanal gera datas corretas e não duplica atribuições',async()=>{
 const form=await createForm();await as('manager');const args=[form.id,A,`{${ids.a}}`,'2026-10-30','2026-11-06','WEEKLY','{1,3,5}'];
 assert.equal((await sql('select public.create_form_schedule($1,$2,$3::uuid[],$4::date,$5::date,$6,$7::int[]) as n',args))[0].n,4);
 assert.equal((await sql('select public.create_form_schedule($1,$2,$3::uuid[],$4::date,$5::date,$6,$7::int[]) as n',args))[0].n,0);
 const rows=await sql('select due_date::text from public.form_assignments where form_id=$1 order by due_date',[form.id]);assert.deepEqual(rows.map(r=>r.due_date),['2026-10-30','2026-11-02','2026-11-04','2026-11-06']);
});
test('agendamento exige criador autorizado e participante com acesso ao formulário e unidade',async()=>{
 const form=await createForm();await as('a');await assert.rejects(()=>sql("select public.create_form_schedule($1,$2,$3::uuid[],'2026-10-30','2026-10-30','ONCE','{}')",[form.id,A,`{${ids.a}}`]),/FORBIDDEN/);
 await as('manager');await assert.rejects(()=>sql("select public.create_form_schedule($1,$2,$3::uuid[],'2026-10-30','2026-10-30','ONCE','{}')",[form.id,A,`{${ids.b}}`]),/FORM_SCHEDULE_USER_FORBIDDEN/);
});
test('finalizar aplicação agendada conclui o agendamento na mesma transação',async()=>{
 const form=await createForm();await as('manager');await sql("select public.create_form_schedule($1,$2,$3::uuid[],'2026-10-30','2026-10-30','ONCE','{}')",[form.id,A,`{${ids.a}}`]);
 const a=(await sql('select * from public.form_assignments where form_id=$1',[form.id]))[0];await as('a');const row=await startResponse(form,A,a.id);await saveResponse(row);
 const done=(await sql('select status,response_id from public.form_assignments where id=$1',[a.id]))[0];assert.equal(done.status,'COMPLETED');assert.equal(done.response_id,row.id);
});
test('cancelar agenda bloqueia a finalização do rascunho sem apagar respostas',async()=>{
 const form=await createForm();await as('manager');await sql("select public.create_form_schedule($1,$2,$3::uuid[],'2026-10-30','2026-10-30','ONCE','{}')",[form.id,A,`{${ids.a}}`]);
 const a=(await sql('select * from public.form_assignments where form_id=$1',[form.id]))[0];await as('a');const row=await startResponse(form,A,a.id);await as('manager');await sql('select public.cancel_form_assignment($1)',[a.id]);await as('a');await assert.rejects(()=>saveResponse(row),/FORM_ASSIGNMENT_INVALID/);
});
test('planos são ligados somente a NOK, exigem conclusão e preservam auditoria',async()=>{
 const form=await createForm();await as('a');const row=await saveResponse(await startResponse(form));await as('review');
 const plan=(await sql('select * from public.form_action_plans where response_id=$1',[row.id]))[0];
 const p={description:'Trocar a peça',responsible_id:ids.a,due_date:'2026-11-02',status:'DONE',completion_note:''};
 await assert.rejects(()=>sql('select public.save_form_action_plan($1,$2,$3,$4::jsonb)',[row.id,'q5',plan.revision,JSON.stringify(p)]),/FORM_PLAN_INVALID/);
 p.completion_note='Peça substituída';const saved=(await sql('select to_jsonb(public.save_form_action_plan($1,$2,$3,$4::jsonb)) as p',[row.id,'q5',plan.revision,JSON.stringify(p)]))[0].p;assert.equal(saved.status,'DONE');
 await assert.rejects(()=>sql('select public.save_form_action_plan($1,$2,0,$3::jsonb)',[row.id,'q1',JSON.stringify(p)]),/FORM_ISSUE_INVALID/);
});
test('desativar módulo ou usuário bloqueia leituras e escrita sem excluir dados',async()=>{
 const form=await createForm();await as('a');const row=await startResponse(form);await db.exec('reset role');await db.exec("update public.module_settings set active=false where module_name='Formulários'");
 await as('a');assert.equal((await sql('select id from public.form_responses where id=$1',[row.id])).length,0);await assert.rejects(()=>saveResponse(row),/FORBIDDEN/);
 await db.exec('reset role');await db.exec("update public.module_settings set active=true where module_name='Formulários'");await db.query('update public.profiles set active=false where id=$1',[ids.a]);await as('a');await assert.rejects(()=>startResponse(form),/FORBIDDEN/);
 await db.exec('reset role');await db.query('update public.profiles set active=true where id=$1',[ids.a]);
});
test('anônimo não pode ler modelos nem usar as rotinas do módulo',async()=>{
 await db.exec('reset role;set role anon');await assert.rejects(()=>sql('select * from public.form_definitions'),/permission denied/);await assert.rejects(()=>sql('select public.forms_people()'),/permission denied/);
});
