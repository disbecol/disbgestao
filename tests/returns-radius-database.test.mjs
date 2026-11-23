import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),A='Matriz Caicó',B='Filial Pau dos Ferros',user=randomUUID();
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const directory=new URL('../supabase/migrations/',import.meta.url);
const file=(await readdir(directory)).find(name=>name.endsWith('_returns_radius_analytics.sql'));
const sql=await readFile(new URL(file,directory),'utf8');
async function role(value='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);if(value)await db.exec('set role '+value);}
const snapshot=async(unit=A,from='2026-11-01',to='2026-11-30')=>(await query('select returns_radius_snapshot($1,$2,$3) as v',[unit,from,to]))[0].v;
const record=async(code,map,note,unit=A)=>query("insert into delivery_return_records values($1,'REPORT',$2,'2026-11-20',$3::jsonb)",[unit,randomUUID(),JSON.stringify({customer_code:code,map_number:map,invoice_number:note})]);
const fdr=async(code,map,justified,unit=A)=>query("insert into delivery_radius_reports(unit,report_date,customer_code,map_number,justified) values($1,'2026-11-20',$2,$3,$4)",[unit,code,map,justified]);
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table profiles(id uuid primary key,active boolean);create table user_units(user_id uuid,unit_name text);
 create table user_permissions(user_id uuid,permission_code text,allowed boolean);
 create table module_settings(module_name text primary key,active boolean);
 create table delivery_return_records(unit text,kind text,row_key text,operation_date date,data jsonb);
 create table delivery_radius_reports(id uuid primary key default gen_random_uuid(),unit text,report_date date,customer_code text,map_number text default '',justified boolean);
 alter table delivery_radius_reports enable row level security;
 create function user_has_unit(unit text) returns boolean language sql security definer set search_path=public as $$select exists(select 1 from user_units where user_id=auth.uid() and unit_name=unit)$$;
 create function has_permission(code text) returns boolean language sql security definer set search_path=public as $$select exists(select 1 from user_permissions where user_id=auth.uid() and permission_code=code and allowed)$$;
 insert into module_settings values('Devoluções',true),('Apontamento Fora do Raio',true);`);
 await query('insert into profiles values($1,true)',[user]);await query('insert into user_units values($1,$2)',[user,A]);await query("insert into user_permissions values($1,'RETURNS_VIEW',true)",[user]);
 const base=await readFile(new URL('../supabase/87_delivery_returns.sql',import.meta.url),'utf8');
 await db.exec(base.match(/create or replace function public\.returns_can\([\s\S]*?\$\$;/)[0]);await db.exec(sql);
});
after(()=>db.close());
test('cruzamento respeita mapa, cliente, dia e unidade, sem multiplicar por notas ou por FDR',async()=>{
 await role('');await record('42','1','a');await record('42','1','b');await record('42','2','c');await record('43','1','d');await record('44','1','e');
 await fdr('42','1',true);await fdr('42','1',false);await fdr('43','1',true,B);
 await role();const result=await snapshot();assert.equal(result.available,true);assert.equal(result.matches.length,4);
 const outside=result.matches.find(r=>r.customer_code==='42'&&r.map_number==='1');assert.equal(outside.state,'OUTSIDE');assert.equal(outside.match_count,2);assert.equal(outside.justified,false);
 assert.equal(result.matches.find(r=>r.customer_code==='42'&&r.map_number==='2').state,'INSIDE');
 assert.equal(result.matches.find(r=>r.customer_code==='43').state,'INSIDE');assert.equal(result.matches.find(r=>r.customer_code==='44').state,'INSIDE');
});
test('sem mapa só vincula uma ocorrência; duas rotas permanecem pendentes mesmo com várias notas',async()=>{
 await role('');await record('45','3','a');await record('45','3','b');await fdr('45','',true);await fdr('42','',true);
 await role();const result=await snapshot();assert.equal(result.matches.find(r=>r.customer_code==='45').state,'OUTSIDE');assert.equal(result.matches.find(r=>r.customer_code==='45').justified,true);
 assert.equal(result.matches.find(r=>r.customer_code==='42'&&r.map_number==='1').state,'OUTSIDE');assert.equal(result.matches.find(r=>r.customer_code==='42'&&r.map_number==='2').state,'PENDING');
});
test('derivação permite RETURNS_VIEW sem expor tabela ou textos internos do FDR',async()=>{
 await role();await assert.rejects(()=>query('select * from delivery_radius_reports'),/permission denied/);
 const result=await snapshot();assert.deepEqual(Object.keys(result.matches[0]).sort(),['customer_code','justified','map_number','match_count','operation_date','state']);
 await assert.rejects(()=>snapshot(B),/FORBIDDEN/);await role('anon');await assert.rejects(()=>snapshot(),/permission denied/);
});
test('indisponibilidade do FDR não produz classificação dentro do raio',async()=>{
 await role('');await db.exec("update module_settings set active=false where module_name='Apontamento Fora do Raio'");await role();
 assert.deepEqual((await snapshot()).matches,[]);assert.equal((await snapshot()).reason,'FDR_INACTIVE');
 await role('');await db.exec("update module_settings set active=true where module_name='Apontamento Fora do Raio'");
});
test('valida período e bloqueia perfil inativo ou permissão retirada',async()=>{
 await role();await assert.rejects(()=>snapshot(A,'2026-12-01','2026-11-01'),/INVALID_PERIOD/);await assert.rejects(()=>snapshot(A,'2024-01-01','2026-11-01'),/INVALID_PERIOD/);
 await role('');await db.exec('update profiles set active=false');await role();await assert.rejects(()=>snapshot(),/FORBIDDEN/);
 await role('');await db.exec('update profiles set active=true;update user_permissions set allowed=false');await role();await assert.rejects(()=>snapshot(),/FORBIDDEN/);
 await role('');await db.exec('update user_permissions set allowed=true');
});
test('migração reaplicada não altera registros e período sem devoluções permanece vazio',async()=>{
 await role('');const before=await query('select count(*)::int as n from delivery_radius_reports');await db.exec(sql);assert.deepEqual(await query('select count(*)::int as n from delivery_radius_reports'),before);
 await role();assert.deepEqual((await snapshot(A,'2026-10-01','2026-10-31')).matches,[]);
});
