import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),user=randomUUID(),own=randomUUID(),A='Matriz Caicó',B='Filial Pau dos Ferros';
const q=async(s,p=[])=>(await db.query(s,p)).rows;
async function as(id){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
const dashboard=(unit=A,from='2026-11-01',to='2026-11-30')=>q('select delivery_damage_dashboard($1,$2,$3) v',[unit,from,to]).then(r=>r[0].v);
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table profiles(id uuid primary key,name text,role text,active boolean default true);create table units(name text primary key,active boolean default true);
 create table user_units(user_id uuid,unit_name text);create table permissions(code text primary key,module text,name text,description text,sort_order int,active boolean);
 create table role_permissions(role text,permission_code text);create table user_permissions(user_id uuid,permission_code text,allowed boolean);create table module_settings(module_name text primary key,active boolean default true);
 create table damage_requests(id uuid primary key,unit text,occurrence_date date,created_at timestamptz,delivery_user_id uuid,delivery_name text,customer_code text,customer_name text,city text,map_number text);
 create table damage_items(id uuid primary key,request_id uuid,item_order int,product_text text,lot text,quantity numeric,quantity_unit text,reason text,status text,created_at timestamptz,reviewed_at timestamptz,launched_at timestamptz,delivered_at timestamptz,latitude float);
 grant select on module_settings,damage_requests,damage_items to authenticated;
 alter table damage_requests enable row level security;alter table damage_items enable row level security;`);
 for(const [file,fn] of [['18_v1_4_0_permissoes_avarias_vendas.sql','has_permission'],['26_v1_6_0_unidades_por_usuario.sql','user_has_unit']]){const s=await readFile(new URL('../supabase/'+file,import.meta.url),'utf8');await db.exec(s.match(new RegExp('create or replace function public\\.'+fn+'\\([\\s\\S]*?\\$\\$;'))[0]);}
 await q("insert into profiles values($1,'Consulta','CONFERENTE',true),($2,'Motorista','COLABORADOR_ENTREGA',true)",[user,own]);await q('insert into units values($1,true),($2,true)',[A,B]);await q('insert into user_units values($1,$3),($2,$3)',[user,own,A]);
 await db.exec("insert into permissions(code,module,active) values('DELIVERY_DAMAGE_VIEW_ALL','Avarias de Entrega',true),('DELIVERY_DAMAGE_CREATE','Avarias de Entrega',true);insert into module_settings values('Avarias de Entrega',true)");
 await q("insert into user_permissions values($1,'DELIVERY_DAMAGE_VIEW_ALL',true),($2,'DELIVERY_DAMAGE_CREATE',true)",[user,own]);
 await db.exec("create policy request_read on damage_requests for select to authenticated using(user_has_unit(unit));create policy item_read on damage_items for select to authenticated using(exists(select 1 from damage_requests r where r.id=request_id));");
 for(const [unit,date] of [[A,'2026-11-12'],[A,'2025-11-12'],[B,'2026-11-12']]){const id=randomUUID();await q('insert into damage_requests(id,unit,occurrence_date,created_at,delivery_user_id,delivery_name,customer_code,customer_name,city,map_number) values($1,$2,$3,$3::date::timestamptz,$4,$5,$6,$7,$8,$9)',[id,unit,date,own,'Motorista','123','Cliente','Caicó','1234']);await q("insert into damage_items(id,request_id,item_order,product_text,quantity,quantity_unit,reason,status,latitude) values($1,$2,1,'Produto',2,'UNIDADE','Quebrado','PENDENTE',-6)",[randomUUID(),id]);}
 await db.exec(await readFile(new URL('../supabase/migrations/20261119165503_delivery_damage_dashboard.sql',import.meta.url),'utf8'));await as(user);
});
after(()=>db.close());
test('snapshot contém apenas unidade e período pedidos, com comparação do ano anterior',async()=>{
 const s=await dashboard();assert.equal(s.requests.length,1);assert.equal(s.previous.length,1);assert.equal(s.previous_from,'2025-11-01');assert.equal(s.requests[0].items.length,1);assert.ok(!JSON.stringify(s).includes('latitude'));assert.ok(!JSON.stringify(s).includes('signature'));
});
test('função é invoker e a leitura não grava ou modifica avarias',async()=>{
 const before=(await q('select count(*)::int n from damage_items'))[0].n;await dashboard();assert.equal((await q('select count(*)::int n from damage_items'))[0].n,before);assert.equal((await q("select prosecdef from pg_proc where proname='delivery_damage_dashboard'"))[0].prosecdef,false);
});
test('nega unidade não autorizada, período inválido, perfil de cadastro e anônimos',async()=>{
 await assert.rejects(()=>dashboard(B),/FORBIDDEN/);await assert.rejects(()=>dashboard(A,'2025-01-01','2026-12-31'),/INVALID_PERIOD/);await as(own);await assert.rejects(()=>dashboard(),/FORBIDDEN/);await db.exec('reset role;set role anon');await assert.rejects(()=>dashboard(),/permission denied/);await as(user);
});
test('módulo inativo e perfil inativo não conseguem consultar indicadores',async()=>{
 await db.exec('reset role');await q('update profiles set active=false where id=$1',[user]);await as(user);await assert.rejects(()=>dashboard(),/FORBIDDEN/);await db.exec('reset role');await q('update profiles set active=true where id=$1',[user]);await q("update module_settings set active=false where module_name='Avarias de Entrega'");await as(user);await assert.rejects(()=>dashboard(),/FORBIDDEN/);
});
