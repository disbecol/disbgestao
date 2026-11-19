import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),A='Matriz Caicó',B='Filial Pau dos Ferros';
const admin=randomUUID(),seller=randomUUID(),other=randomUUID(),analyst=randomUUID(),second=randomUUID(),viewer=randomUUID();
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const rpc=async(name,p)=>(await q(`select ${name}(${p.map((_,i)=>'$'+(i+1)).join(',')}) v`,p))[0].v;
async function as(id){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role authenticated');}
const settingsData={restricted_hours:false,morning_start:510,morning_end:690,afternoon_start:840,afternoon_end:960,route_sla:30,bypass_sla:2880};
let today,request;
const data=()=>({kind:'FORA_ROTA',customer_code:'123',customer_name:'Nome falso',desired_date:today,weekdays:[],reason:'FEFO',notes:'Atender evento'});
const create=(payload=data(),op=randomUUID(),unit=A)=>rpc('orders_create',[unit,op,JSON.stringify(payload)]);
const action=(r,name,response='',op=randomUUID())=>rpc('orders_action',[A,r.id,r.revision,op,name,response]);
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table profiles(id uuid primary key,name text,role text,active boolean default true);
 create table units(name text primary key,active boolean default true);create table user_units(user_id uuid,unit_name text);
 create table permissions(code text primary key,module text,name text,description text,sort_order int,active boolean);
 create table role_permissions(role text,permission_code text,primary key(role,permission_code));
 create table user_permissions(user_id uuid,permission_code text,allowed boolean);
 create table module_settings(module_name text primary key,active boolean default true);
 create table customers(id uuid primary key default gen_random_uuid(),code text,name text,city text,branch text);`);
 for(const [file,fn] of [['18_v1_4_0_permissoes_avarias_vendas.sql','has_permission'],['26_v1_6_0_unidades_por_usuario.sql','user_has_unit']]){
  const s=await readFile(new URL('../supabase/'+file,import.meta.url),'utf8');await db.exec(s.match(new RegExp('create or replace function public\\.'+fn+'\\([\\s\\S]*?\\$\\$;'))[0]);
 }
 await q('insert into units values($1,true),($2,true)',[A,B]);
 for(const [id,name,role] of [[admin,'Admin','ADMIN'],[seller,'Vendedor','VENDEDOR'],[other,'Outro vendedor','VENDEDOR'],[analyst,'Analista','CONFERENTE'],[second,'Outro analista','CONFERENTE'],[viewer,'Consulta','CONFERENTE']]){
  await q('insert into profiles values($1,$2,$3,true)',[id,name,role]);await q('insert into user_units values($1,$2)',[id,A]);
 }
 await q("insert into customers(code,name,city,branch) values('123','Cliente Matriz','Caicó','Caicó'),('123','Cliente Filial','Pau dos Ferros','Pau dos Ferros')");
 await db.exec(await readFile(new URL('../supabase/migrations/20261119143241_orders_requests.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261119162929_orders_strict_request_hours.sql',import.meta.url),'utf8'));
 for(const id of [analyst,second])await q("insert into user_permissions values($1,'ORDERS_REVIEW',true)",[id]);
 await q("insert into user_permissions values($1,'ORDERS_VIEW_ALL',true)",[viewer]);
 today=(await q("select (now() at time zone 'America/Sao_Paulo')::date::text d"))[0].d;
 await as(admin);await rpc('orders_save_settings',[A,0,randomUUID(),JSON.stringify(settingsData)]);
});
after(()=>db.close());
test('usa identidade do servidor, cliente da unidade e cria histórico sem duplicar em retry',async()=>{
 await as(seller);const op=randomUUID(),d=data();request=await create(d,op);const retry=await create(d,op);
 assert.equal(request.id,retry.id);assert.equal(request.customer_name,'Cliente Matriz');assert.equal(request.created_by,seller);assert.equal(request.created_by_name,'Vendedor');assert.equal(request.requester_role,'VENDEDOR');assert.equal(request.status,'PENDENTE');
 assert.equal((await rpc('orders_history',[A,request.id,today,today])).length,1);
 await assert.rejects(()=>create({...d,notes:'Outro conteúdo'},op),/OPERATION_CONFLICT/);
 await assert.rejects(()=>create({...d,customer_code:'inexistente'}),/CUSTOMER_NOT_FOUND/);
 await assert.rejects(()=>create(d,randomUUID(),B),/FORBIDDEN/);
});
test('cliente novo aceita nome manual; bipasse exige dias úteis e data não pode ser passada',async()=>{
 const r=await create({...data(),kind:'CLIENTE_NOVO',customer_code:'novo',customer_name:'Cliente a cadastrar'});assert.equal(r.customer_name,'Cliente a cadastrar');assert.equal(r.sla_minutes,30);
 const b=await create({...data(),kind:'BIPASSE',desired_date:null,weekdays:[3,1,3]});assert.deepEqual(b.weekdays,[1,3]);assert.equal(b.desired_date,null);assert.equal(b.sla_minutes,2880);
 for(const weekdays of [[],[6],null])await assert.rejects(()=>create({...data(),kind:'BIPASSE',weekdays}),/INVALID_WEEKDAYS/);
 await assert.rejects(()=>create({...data(),desired_date:'2020-01-01'}),/INVALID_DATE/);
 await assert.rejects(()=>create({...data(),reason:''}),/INVALID_REQUEST/);
 await assert.rejects(()=>create({...data(),notes:'  '}),/INVALID_REQUEST/);
});
test('consulta própria e RLS não revelam pedidos de outros vendedores nem permitem escrita direta',async()=>{
 await as(other);const own=await create();const s=await rpc('orders_snapshot',[A,today,today,'OWN']);assert.deepEqual(s.requests.map(r=>r.id),[own.id]);
 await assert.rejects(()=>rpc('orders_snapshot',[A,today,today,'ALL']),/FORBIDDEN/);
 await assert.rejects(()=>rpc('orders_history',[A,request.id,today,today]),/FORBIDDEN/);
 assert.deepEqual((await q('select id from order_requests')).map(r=>r.id),[own.id]);
 await assert.rejects(()=>q("update order_requests set status='APROVADO'"),/permission denied/);
 await assert.rejects(()=>q("insert into order_request_operations values($1,$2,'{}','{}')",[other,randomUUID()]),/permission denied/);
 await as(viewer);assert.ok((await rpc('orders_snapshot',[A,today,today,'ALL'])).requests.length>=3);await assert.rejects(()=>action(request,'CLAIM'),/FORBIDDEN/);
});
test('assumir é atômico; outro analista não pode finalizar e versão obsoleta é rejeitada',async()=>{
 await as(analyst);request=await action(request,'CLAIM');assert.equal(request.analyst_id,analyst);assert.equal(request.status,'EM_ANALISE');
 await as(second);await assert.rejects(()=>action(request,'APPROVE'),/ANOTHER_ANALYST/);await assert.rejects(()=>action({...request,revision:1},'CLAIM'),/ORDER_VERSION_CONFLICT/);
 await as(analyst);await assert.rejects(()=>action(request,'REJECT'),/RESPONSE_REQUIRED/);
 const created=request.created_at;request=await action(request,'RETURN');assert.equal(request.status,'PENDENTE');assert.equal(request.analyst_id,null);assert.equal(request.created_at,created);
});
test('SLA usa criação e não reinicia ao devolver à fila; decisão tem justificativa e retry seguro',async()=>{
 await as(admin);request=await action(request,'CLAIM');await db.exec('reset role');await q("update order_requests set created_at=now()-interval '31 minutes' where id=$1",[request.id]);await as(admin);
 const op=randomUUID();const r=await action(request,'REJECT','Fora da região',op);assert.equal(r.status,'REPROVADO');assert.equal(r.within_sla,false);assert.ok(r.resolution_minutes>=31);
 assert.equal((await action(request,'REJECT','Fora da região',op)).id,r.id);await assert.rejects(()=>action(r,'RETURN'),/INVALID_ORDER_TRANSITION/);
 const history=await rpc('orders_history',[A,r.id,today,today]);assert.deepEqual(history.map(r=>r.event),['REJECTED','CLAIMED','RETURNED','CLAIMED','CREATED']);
});
test('regras têm revisão, auditoria e não alteram o SLA de solicitações já criadas',async()=>{
 let s=await rpc('orders_settings',[A]);const op=randomUUID();const changed={...settingsData,route_sla:45};s=await rpc('orders_save_settings',[A,s.revision,op,JSON.stringify(changed)]);assert.equal(s.route_sla,45);
 assert.equal((await rpc('orders_save_settings',[A,s.revision-1,op,JSON.stringify(changed)])).revision,s.revision);
 await assert.rejects(()=>rpc('orders_save_settings',[A,0,randomUUID(),JSON.stringify(changed)]),/ORDER_VERSION_CONFLICT/);
 await assert.rejects(()=>rpc('orders_save_settings',[A,s.revision,randomUUID(),JSON.stringify({...changed,morning_end:900})]),/check constraint/);
 assert.equal((await q('select sla_minutes from order_requests where id=$1',[request.id]))[0].sla_minutes,30);
 await as(seller);assert.equal((await create()).sla_minutes,45);await assert.rejects(()=>rpc('orders_save_settings',[A,2,randomUUID(),JSON.stringify(changed)]),/FORBIDDEN/);
});
test('horários são aplicados no servidor inclusive para Admin',async()=>{
 await as(admin);const current=(await q("select extract(hour from now() at time zone 'America/Sao_Paulo')::int*60+extract(minute from now() at time zone 'America/Sao_Paulo')::int m"))[0].m;
 const closed=current>4?{morning_start:0,morning_end:1,afternoon_start:2,afternoon_end:3}:{morning_start:10,morning_end:11,afternoon_start:12,afternoon_end:13};
 const s=await rpc('orders_settings',[A]);await rpc('orders_save_settings',[A,s.revision,randomUUID(),JSON.stringify({...settingsData,...closed,restricted_hours:true})]);
 await as(seller);await assert.rejects(()=>create(),/OUTSIDE_REQUEST_WINDOW/);await as(admin);await assert.rejects(()=>create(),/OUTSIDE_REQUEST_WINDOW/);
});
test('isolamento por unidade, perfil ativo, módulo ativo e bloqueio de anônimos são obrigatórios',async()=>{
 await as(viewer);await assert.rejects(()=>rpc('orders_snapshot',[B,today,today,'ALL']),/FORBIDDEN/);await assert.rejects(()=>rpc('orders_snapshot',[A,'2020-01-01',today,'ALL']),/INVALID_PERIOD/);
 await db.exec('reset role');await q('update profiles set active=false where id=$1',[viewer]);await as(viewer);await assert.rejects(()=>rpc('orders_settings',[A]),/FORBIDDEN/);
 await db.exec('reset role');await q("update module_settings set active=false where module_name='Pedidos'");await as(admin);await assert.rejects(()=>rpc('orders_settings',[A]),/FORBIDDEN/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>rpc('orders_snapshot',[A,today,today,'OWN']),/permission denied/);
});
