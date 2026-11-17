import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),A='Matriz Caicó',B='Filial Pau dos Ferros',admin=randomUUID(),editor=randomUUID(),viewer=randomUUID();
const migration=await readFile(new URL('../supabase/87_delivery_returns.sql',import.meta.url),'utf8');
const googleMigration=await readFile(new URL('../supabase/88_returns_google_sources.sql',import.meta.url),'utf8');
const cityMigration=await readFile(new URL('../supabase/migrations/20261117170852_returns_city_names.sql',import.meta.url),'utf8');
const partialMigration=await readFile(new URL('../supabase/migrations/20261117181315_returns_partial_status.sql',import.meta.url),'utf8');
const customerMigration=await readFile(new URL('../supabase/migrations/20261117203259_customer_catalog_csv.sql',import.meta.url),'utf8');
async function as(id=admin){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
const query=async(s,a=[])=> (await db.query(s,a)).rows;
const rpc=async(n,a)=> (await query(`select public.${n}(${a.map((_,i)=>'$'+(i+1)).join(',')}) as v`,a))[0].v;
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table profiles(id uuid primary key,name text,role text,active boolean default true);
 create table units(name text primary key,active boolean default true);
 create table user_units(user_id uuid,unit_name text);
 create table permissions(code text primary key,module text,name text,description text,sort_order int,active boolean);
 create table role_permissions(role text,permission_code text,primary key(role,permission_code));
 create table user_permissions(user_id uuid,permission_code text,allowed boolean);
 create table module_settings(module_name text primary key,active boolean default true);
 create table customers(id uuid primary key default gen_random_uuid(),code text,name text,city text,branch text);
 create table maps(id uuid primary key default gen_random_uuid(),map_number text,map_date date,driver text,helper1 text,helper2 text);
 create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select coalesce((select role='ADMIN' and active from profiles where id=auth.uid()),false)$$;`);
 for(const [file,fn] of [['18_v1_4_0_permissoes_avarias_vendas.sql','has_permission'],['26_v1_6_0_unidades_por_usuario.sql','user_has_unit']]){
  const s=await readFile(new URL('../supabase/'+file,import.meta.url),'utf8');await db.exec(s.match(new RegExp('create or replace function public\\.'+fn+'\\([\\s\\S]*?\\$\\$;'))[0]);
 }
 await query('insert into units(name) values($1),($2)',[A,B]);
 for(const [id,name,role] of [[admin,'Admin','ADMIN'],[editor,'Analista','CONFERENTE'],[viewer,'Leitura','CONFERENTE']]){await query('insert into profiles(id,name,role) values($1,$2,$3)',[id,name,role]);await query('insert into user_units values($1,$2)',[id,A]);}
 try{await db.exec(migration);}catch(e){throw Error(`${e.message}; linha ${migration.slice(0,Number(e.position||1)).split('\n').length}; ${e.where||''}`);}
 for(const code of ['RETURNS_VIEW','RETURNS_EDIT','RETURNS_IMPORT'])await query('insert into user_permissions values($1,$2,true)',[editor,code]);
 await query("insert into user_permissions values($1,'RETURNS_VIEW',true)",[viewer]);
});
after(()=>db.close());
const row=(over={})=>({row_key:'2026-11-01~1',operation_date:'2026-11-01',return_date:'2026-11-01',customer_code:'42',customer_name:'Cliente exemplo',map_number:'1',invoice_number:'11',amount_cents:4200,volume_hl:1.5,reason:'Recusa',...over});
async function start(kind='REPORT',count=1){const id=randomUUID();await rpc('returns_begin_import',[id,A,kind,'exemplo.csv','a'.repeat(64),count]);return id;}
async function publish(kind,rows){const id=await start(kind,rows.length);await rpc('returns_stage_import',[id,JSON.stringify(rows)]);await rpc('returns_finish_import',[id]);return id;}
const caseData=(over={})=>({operation_date:'2026-11-01',customer_code:'42',map_number:'1',customer_name:'Cliente exemplo',driver_reason:'Recusa',driver_treatment:'Retorno solicitado',client_reason:'Preço',client_statement:'Cliente explicou o motivo',status:'AGUARDANDO_REPASSE',order_amount_cents:4200,...over});
const save=(id,rev,data,op=randomUUID(),unit=A)=>rpc('returns_save_case',[id,unit,rev,op,JSON.stringify(data)]);

test('RLS e RPC recusam outra unidade inclusive para admin; anon não consulta',async()=>{
 await as();await publish('REPORT',[row()]);
 await assert.rejects(()=>rpc('returns_snapshot',[B,'2026-11-01','2026-11-30']),/FORBIDDEN/);
 await db.exec('reset role');await db.exec('set role anon');await assert.rejects(()=>query('select * from delivery_return_cases'),/permission denied/);
 await as(viewer);await assert.rejects(()=>start(),/FORBIDDEN/);await assert.rejects(()=>save(randomUUID(),0,caseData()),/FORBIDDEN/);
});
test('prévia parcial não aparece; publicação e repetição são atômicas e não duplicam',async()=>{
 await as(editor);const id=await start('REPORT',2);
 await rpc('returns_stage_import',[id,JSON.stringify([row({row_key:'stage-a'})])]);
 await assert.rejects(()=>rpc('returns_finish_import',[id]),/IMPORT_INCOMPLETE/);
 assert.equal((await query("select * from delivery_return_records where row_key='stage-a'")).length,0);
 await rpc('returns_stage_import',[id,JSON.stringify([row({row_key:'stage-a'}),row({row_key:'stage-b',invoice_number:'12'})])]);
 assert.equal(await rpc('returns_finish_import',[id]),2);assert.equal(await rpc('returns_finish_import',[id]),2);
 assert.equal((await query('select * from delivery_return_records where import_id=$1',[id])).length,2);
});
test('linhas inválidas, conflito de lote e escrita direta são bloqueados',async()=>{
 await as(editor);const id=await start();await assert.rejects(()=>rpc('returns_stage_import',[id,JSON.stringify([row({amount_cents:-1})])]),/INVALID_REPORT/);
 await rpc('returns_stage_import',[id,JSON.stringify([row()])]);await assert.rejects(()=>rpc('returns_stage_import',[id,JSON.stringify([row({amount_cents:999})])]),/IMPORT_ROW_CONFLICT/);
 await assert.rejects(()=>query("insert into delivery_return_records values('x','x','x',null,'{}',null,now())"),/permission denied/);
 await assert.rejects(()=>query("select public.returns_enrich($1,'{}')",[B]),/permission denied/);
});
test('edição mantém histórico e autoria; revisão impede sobrescrita; retry não duplica',async()=>{
 await as(editor);const id=randomUUID(),op=randomUUID(),data=caseData();const first=await save(id,0,data,op);
 assert.equal(first.revision,1);assert.equal((await save(id,0,data,op)).revision,1);
 await assert.rejects(()=>save(id,0,caseData({status:'REVERTIDO'})),/RETURN_VERSION_CONFLICT/);
 const second=await save(id,1,caseData({status:'REVERTIDO',created_by:admin,unit:B}));assert.equal(second.revision,2);assert.equal(second.created_by,editor);assert.equal(second.unit,A);
 assert.equal((await query('select * from delivery_return_audit where case_id=$1',[id])).length,2);
 await assert.rejects(()=>save(id,1,caseData(),op),/OPERATION_CONFLICT/);
});
test('consulta associa pedido e equipe da data exata, nunca altera MAPAS',async()=>{
 await as(editor);
 await publish('ORDERS',[{row_key:'order1',operation_date:'2026-11-04',map_number:'9',customer_code:'44',customer_name:'Loja',order_amount_cents:10000},{row_key:'order2',operation_date:'2026-11-04',map_number:'10',customer_code:'44',customer_name:'Loja',order_amount_cents:20000}]);
 await db.exec('reset role');await query('insert into maps(map_number,map_date,driver,helper1) values($1,$2,$3,$4)',['9','2026-11-04','Motorista','Ajudante']);await as(editor);
 const matches=await rpc('returns_lookup',[A,'44','2026-11-04']);assert.equal(matches.length,2);assert.equal(matches.find(r=>r.map_number==='9').driver,'Motorista');
 await db.exec('reset role');assert.equal((await query('select * from maps')).length,1);assert.equal((await query('select driver from maps'))[0].driver,'Motorista');await as(editor);
 const other=await rpc('returns_lookup',[A,'44','2026-11-05']);assert.equal(other[0].order_amount_cents,null);assert.equal(other[0].driver,'');
 const snap=await rpc('returns_snapshot',[A,'2026-11-01','2026-11-30']);assert.ok(Array.isArray(snap.reports));assert.ok(Array.isArray(snap.cases));
});
test('cadastro compartilhado distingue o mesmo PDV entre revendas',async()=>{
 await db.exec('reset role');await query("insert into customers(code,name,city,branch) values('66','Loja Matriz','Caicó','Caicó'),('66','Loja Filial','Pau dos Ferros','Pau dos Ferros')");await as(editor);
 const found=await rpc('returns_lookup',[A,'66','2026-11-06']);assert.equal(found[0].customer_name,'Loja Matriz');assert.equal(found[0].city,'Caicó');
});
test('classificação DROP editada na auditoria aparece na análise das notas correspondentes',async()=>{
 await as(editor);const c=(await query("select * from delivery_return_cases where customer_code='42' and map_number='1' limit 1"))[0];
 await save(c.id,c.revision,caseData({is_drop:true}));const s=await rpc('returns_snapshot',[A,'2026-11-01','2026-11-30']);assert.ok(s.reports.filter(r=>r.customer_code==='42'&&r.map_number==='1').every(r=>r.is_drop===true));
});
test('mapa compartilhado com colisão entre unidades não fornece equipe ambígua',async()=>{
 await as(editor);await publish('ORDERS',[{row_key:'collision-a',operation_date:'2026-11-07',map_number:'99',customer_code:'66',customer_name:'Loja',order_amount_cents:10000}]);
 await db.exec('reset role');await query("insert into maps(map_number,map_date,driver) values('99','2026-11-07','Equipe sem unidade')");
 await query("insert into delivery_return_records(unit,kind,row_key,operation_date,data,import_id) select $1,'ORDERS','collision-b','2026-11-07',$2::jsonb,id from delivery_return_imports limit 1",[B,JSON.stringify({map_number:'99',customer_code:'66'})]);
 await as(editor);const found=await rpc('returns_lookup',[A,'66','2026-11-07']);assert.equal(found[0].driver,'');
 await publish('JOURNEYS',[{row_key:'2026-11-07~99',operation_date:'2026-11-07',map_number:'99',driver:'Equipe confirmada',helper1:'A'}]);
 assert.equal((await rpc('returns_lookup',[A,'66','2026-11-07']))[0].driver,'Equipe confirmada');
});
test('módulo inativo revoga consultas e mutações, sem apagar dados',async()=>{
 await db.exec('reset role');await db.exec("update module_settings set active=false where module_name='Devoluções'");await as(editor);
 assert.equal((await query('select * from delivery_return_cases')).length,0);await assert.rejects(()=>rpc('returns_snapshot',[A,'2026-11-01','2026-11-30']),/FORBIDDEN/);
 await db.exec('reset role');await db.exec("update module_settings set active=true where module_name='Devoluções'");await db.exec(migration);
 assert.ok((await query('select * from delivery_return_cases')).length>0);
});

async function stageGoogle(kind,rows,filename,count=rows.length){const id=randomUUID();await rpc('returns_begin_import',[id,A,kind,filename,'c'.repeat(64),count]);await rpc('returns_stage_import',[id,JSON.stringify(rows)]);return id;}
const sync=(id,action,ids=[],result={})=>rpc('returns_google_sync',[A,id,action,ids,JSON.stringify(result)]);
test('migração Google preserva os registros existentes e limita concorrência por unidade/autor',async()=>{
 await db.exec('reset role');await db.exec(googleMigration);await as(editor);const id=randomUUID();assert.equal((await sync(id,'START')).acquired,true);
 await as(admin);assert.equal((await sync(randomUUID(),'START')).acquired,false);await assert.rejects(()=>sync(id,'COMMIT'),/SYNC_LEASE_CONFLICT/);
 await as(viewer);await assert.rejects(()=>sync(randomUUID(),'START'),/FORBIDDEN/);await as(editor);await sync(id,'FAIL',[],{error:'Leitura interrompida'});
 assert.ok((await query('select * from delivery_return_cases')).length>0);await assert.rejects(()=>query("update delivery_return_google_sync set last_error=''"),/permission denied/);
});
test('bases Google são publicadas juntas, sem dados parciais após falha',async()=>{
 await as(editor);const id=randomUUID();await sync(id,'START');const report=await stageGoogle('REPORT',[row({row_key:'atomic-g-report'})],'Google Planilhas / REPORT / atomic');
 const orders=await stageGoogle('ORDERS',[{row_key:'atomic-order-1',operation_date:'2026-11-01',customer_code:'42',map_number:'1',order_amount_cents:1000}],'Google Planilhas / ORDERS / atomic',2);
 await assert.rejects(()=>sync(id,'COMMIT',[report,orders],{sources:{REPORT:{state:'OK',count:1}}}),/IMPORT_INCOMPLETE/);
 assert.equal((await query("select * from delivery_return_records where row_key='atomic-g-report'")).length,0);
 await rpc('returns_stage_import',[orders,JSON.stringify([{row_key:'atomic-order-2',operation_date:'2026-11-01',customer_code:'43',map_number:'1',order_amount_cents:1000}])]);
 const cases=(await query('select count(*)::int as n from delivery_return_cases'))[0].n;const state=await sync(id,'COMMIT',[report,orders],{sources:{REPORT:{state:'OK',count:1},ORDERS:{state:'OK',count:2}}});assert.ok(state.last_synced_at);
 assert.equal((await query("select * from delivery_return_records where row_key='atomic-g-report'")).length,1);assert.equal((await query('select count(*)::int as n from delivery_return_cases'))[0].n,cases);
});
test('edição da planilha substitui apenas a versão da mesma origem Google',async()=>{
 await as(editor);const filename='Google Planilhas / REPORT / snapshot';const first=await stageGoogle('REPORT',[row({row_key:'snapshot-old'}),row({row_key:'snapshot-keep'})],filename);await rpc('returns_finish_import',[first]);
 await publish('REPORT',[row({row_key:'manual-preserved'})]);const next=await stageGoogle('REPORT',[row({row_key:'snapshot-keep',amount_cents:1500})],filename);await rpc('returns_finish_import',[next]);
 assert.equal((await query("select * from delivery_return_records where row_key='snapshot-old'")).length,0);assert.equal((await query("select (data->>'amount_cents')::int as v from delivery_return_records where row_key='snapshot-keep'"))[0].v,1500);assert.equal((await query("select * from delivery_return_records where row_key='manual-preserved'")).length,1);
});
test('lease expirada não publica e não pode encerrar a atualização de outro operador',async()=>{
 await as(editor);const old=randomUUID();await sync(old,'START');await db.exec('reset role');await query('update delivery_return_google_sync set lease_until=now()-interval \'1 second\' where unit=$1',[A]);await as(editor);await assert.rejects(()=>sync(old,'COMMIT'),/SYNC_LEASE_EXPIRED/);
 await as(admin);const next=randomUUID();assert.equal((await sync(next,'START')).acquired,true);await as(editor);await assert.rejects(()=>sync(old,'FAIL',[],{error:'atrasada'}),/SYNC_LEASE_CONFLICT/);await as(admin);await sync(next,'COMMIT',[],{sources:{REPORT:{state:'EMPTY'}}});
 await as(viewer);assert.equal((await query('select unit from delivery_return_google_sync')).length,1);
});
test('metadados dos pedidos complementam cidade existente sem apagar o cadastro compartilhado',async()=>{
 await as(editor);await publish('CUSTOMERS',[{row_key:'66',customer_code:'66',customer_name:'Loja Matriz',city:'',seller:'Vendedor Google',branch:A}]);const found=await rpc('returns_lookup',[A,'66','2026-11-06']);assert.equal(found[0].city,'Caicó');assert.equal(found[0].seller,'Vendedor Google');
});
test('troca de mês da planilha preserva os períodos anteriores',async()=>{
 await as(editor);const filename='Google Planilhas / REPORT / monthly';const oct=await stageGoogle('REPORT',[row({row_key:'archive-oct',operation_date:'2026-10-31',return_date:'2026-10-31'})],filename);await rpc('returns_finish_import',[oct]);const nov=await stageGoogle('REPORT',[row({row_key:'archive-nov'})],filename);await rpc('returns_finish_import',[nov]);assert.equal((await query("select * from delivery_return_records where row_key='archive-oct'")).length,1);
});
test('vendedor do relatório acompanha o pedido da nota/data, sem trocar pelo cadastro mais recente',async()=>{
 await as(editor);await publish('ORDERS',[{row_key:'historic-seller',operation_date:'2026-11-09',customer_code:'66',map_number:'100',invoice_number:'900',order_amount_cents:2000,city:'Caicó',seller:'Vendedor da nota'}]);await publish('REPORT',[row({row_key:'historic-note',operation_date:'2026-11-09',customer_code:'66',map_number:'100',invoice_number:'900',invoice_series:''})]);const snapshot=await rpc('returns_snapshot',[A,'2026-11-01','2026-11-30']);assert.equal(snapshot.reports.find(r=>r.row_key==='historic-note').seller,'Vendedor da nota');
});
test('código de cidade no pedido não prevalece sobre nome do cadastro; leitura não modifica os dados',async()=>{
 await db.exec('reset role');await db.exec(cityMigration);await as(editor);await publish('ORDERS',[{row_key:'coded-city',operation_date:'2026-11-10',customer_code:'66',map_number:'200',invoice_number:'901',order_amount_cents:2000,city:'RN00007148',seller:'Vendedor da nota'}]);const found=await rpc('returns_lookup',[A,'66','2026-11-10']);assert.equal(found[0].city,'Caicó');assert.equal(found[0].seller,'Vendedor da nota');const stored=await query("select data->>'city' city from delivery_return_records where row_key='coded-city'");assert.equal(stored[0].city,'RN00007148');
});
test('cidade de PDV sem cadastro é associada somente por código inequívoco da mesma unidade',async()=>{
 await db.exec('reset role');await query("insert into customers(code,name,city,branch) values('880','Referência','Santa Cruz','Caicó'),('881','Referência filial','Natal','Pau dos Ferros')");await as(editor);await publish('CUSTOMERS',[{row_key:'880',customer_code:'880',customer_name:'Referência',city:'RN00007254'},{row_key:'889',customer_code:'889',customer_name:'Sem cadastro',city:'RN00007254'}]);let found=await rpc('returns_lookup',[A,'889','2026-11-10']);assert.equal(found[0].city,'Santa Cruz');
 await db.exec('reset role');await query("insert into customers(code,name,city,branch) values('882','Conflito','Natal','Caicó')");await as(editor);await publish('CUSTOMERS',[{row_key:'882',customer_code:'882',customer_name:'Conflito',city:'RN00007254'}]);found=await rpc('returns_lookup',[A,'889','2026-11-10']);assert.equal(found[0].city,'');
});
test('helper de nomes não é exposto aos clientes nem ao acesso anônimo',async()=>{
 await db.exec('reset role');const privileges=(await query("select has_function_privilege('anon','public.returns_city_value(text[])','EXECUTE') anon,has_function_privilege('authenticated','public.returns_city_value(text[])','EXECUTE') client"))[0];assert.equal(privileges.anon,false);assert.equal(privileges.client,false);await as(viewer);assert.equal((await rpc('returns_lookup',[A,'66','2026-11-10']))[0].city,'Caicó');await assert.rejects(()=>query('select returns_city_value(array[\'RN00007148\',\'Caicó\'])'),/permission denied/);
});
test('devolução parcial salva com histórico e revisão sem ampliar o acesso de consulta',async()=>{
 await db.exec('reset role');await db.exec(partialMigration);await as(editor);const id=randomUUID(),data=caseData({customer_code:'partial-test',map_number:'partial-map',status:'PARCIAL'});const first=await save(id,0,data);assert.equal(first.status,'PARCIAL');const audit=(await query('select * from delivery_return_audit where case_id=$1',[id]))[0];assert.equal(audit.next.status,'PARCIAL');assert.equal(audit.actor_id,editor);await as(viewer);await assert.rejects(()=>save(id,first.revision,{...data,status:'DEVOLVIDO'}),/FORBIDDEN/);await as(editor);await assert.rejects(()=>save(id,0,{...data,status:'DEVOLVIDO'}),/RETURN_VERSION_CONFLICT/);await assert.rejects(()=>save(id,first.revision,{...data,status:'INVENTADO'}),/INVALID_CASE/);
});
test('importação do catálogo atualiza cadastro por filial, preserva ID, GPS e contatos e é idempotente',async()=>{
 await db.exec('reset role');await query("insert into permissions(code,module,name,description,sort_order,active) values('ADMIN_BASES','Administração','Bases','',10,true)");await query("insert into role_permissions values('ADMIN','ADMIN_BASES')");await query('insert into user_units values($1,$2)',[admin,B]);await db.exec('grant select on customers to authenticated');
 await db.exec('reset role');await db.exec('alter table customers add column latitude double precision;alter table customers add column longitude double precision;alter table customers add column updated_at timestamptz default now();create table test_contacts(id int primary key,customer_id uuid references customers(id));');await query("update customers set latitude=-6.4,longitude=-37.1 where code='66' and branch='Caicó'");await query("insert into test_contacts select 1,id from customers where code='66' and branch='Caicó'");const old=(await query("select id from customers where code='66' and branch='Caicó'"))[0].id;await db.exec(customerMigration);await as(admin);
 await db.exec('reset role');await db.exec('grant select on test_contacts to authenticated');await as(admin);
 const data=[{code:'66',name:'Nome atualizado',city:'Caicó',branch:'Caicó',registration_date:'2026-10-01'},{code:'9991',name:'Novo da filial',city:'Pau dos Ferros',branch:'Pau dos Ferros',registration_date:'2026-10-01'}];const result=await rpc('import_customer_catalog',[JSON.stringify(data)]);assert.equal(result.updated,1);assert.equal(result.inserted,1);const saved=(await query("select * from customers where code='66' and branch='Caicó'"))[0];assert.equal(saved.id,old);assert.equal(saved.latitude,-6.4);assert.equal(saved.longitude,-37.1);assert.equal((await query('select customer_id from test_contacts'))[0].customer_id,old);assert.equal((await rpc('import_customer_catalog',[JSON.stringify(data)])).unchanged,2);const found=await rpc('returns_lookup',[A,'66','2026-11-10']);assert.equal(found[0].registration_date,'2026-10-01');
});
test('catálogo recusa lote inválido sem alteração parcial e mantém autorização e unidade',async()=>{
 await as(admin);const before=(await query("select name from customers where code='66' and branch='Caicó'"))[0].name;await assert.rejects(()=>rpc('import_customer_catalog',[JSON.stringify([{code:'66',name:'Não deve gravar',city:'Caicó',branch:'Caicó'},{code:'9992',name:'Inválido',city:'Cidade',branch:'2'}])]),/CUSTOMER_IMPORT_INVALID/);assert.equal((await query("select name from customers where code='66' and branch='Caicó'"))[0].name,before);await as(viewer);await assert.rejects(()=>rpc('import_customer_catalog',[JSON.stringify([{code:'9992',name:'Bloqueado',city:'Cidade',branch:'Caicó'}])]),/FORBIDDEN/);await db.exec('reset role');await query("insert into user_permissions values($1,'ADMIN_BASES',true)",[editor]);await as(editor);await assert.rejects(()=>rpc('import_customer_catalog',[JSON.stringify([{code:'9992',name:'Outra unidade',city:'Cidade',branch:'Pau dos Ferros'}])]),/CUSTOMER_IMPORT_UNIT_FORBIDDEN/);
});
