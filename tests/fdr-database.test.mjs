import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite(),A='Matriz Caicó',B='Filial Pau dos Ferros';
const ids={admin:randomUUID(),editor:randomUUID(),viewer:randomUUID(),outsider:randomUUID()};
const migration=await readFile(new URL('../supabase/89_apontamento_fora_raio.sql',import.meta.url),'utf8');
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
async function as(user='admin'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[user]]);await db.exec('set role authenticated');}
async function rpc(name,args){return (await query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args))[0].value;}

before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table public.profiles(id uuid primary key,name text,role text,active boolean default true);
 create table public.units(name text primary key,active boolean default true);
 create table public.user_units(user_id uuid,unit_name text);
 create table public.permissions(code text primary key,module text,name text,description text,sort_order int,active boolean);
 create table public.role_permissions(role text,permission_code text,primary key(role,permission_code));
 create table public.user_permissions(user_id uuid,permission_code text,allowed boolean,primary key(user_id,permission_code));
 create table public.module_settings(module_name text primary key,active boolean default true);
 create table public.customers(id uuid primary key default gen_random_uuid(),code text,name text,city text,branch text);
 create table public.maps(id uuid primary key default gen_random_uuid(),map_number text,map_date date,city text,driver text);
 create table public.delivery_return_records(unit text,kind text,row_key text,operation_date date,data jsonb,updated_at timestamptz default now(),primary key(unit,kind,row_key));
 create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select coalesce((select role='ADMIN' and active from profiles where id=auth.uid()),false)$$;`);
 for(const [file,name] of [['18_v1_4_0_permissoes_avarias_vendas.sql','has_permission'],['26_v1_6_0_unidades_por_usuario.sql','user_has_unit']]){
  const source=await readFile(new URL('../supabase/'+file,import.meta.url),'utf8');
  await db.exec(source.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\$\\$;'))[0]);
 }
 await query('insert into public.units(name) values($1),($2)',[A,B]);
 for(const [user,role] of [['admin','ADMIN'],['editor','CONFERENTE'],['viewer','CONFERENTE'],['outsider','CONFERENTE']]){
  await query('insert into public.profiles(id,name,role) values($1,$2,$3)',[ids[user],user,role]);
  if(user!=='outsider')await query('insert into public.user_units values($1,$2)',[ids[user],A]);
 }
 await db.exec(migration);
 for(const code of ['FDR_VIEW','FDR_EDIT'])await query('insert into public.user_permissions values($1,$2,true)',[ids.editor,code]);
 await query("insert into public.user_permissions values($1,'FDR_VIEW',true)",[ids.viewer]);
});
after(()=>db.close());

const entry=(overrides={})=>({
 report_date:'2026-11-20',customer_code:'42',map_number:'9',branch:'MATRIZ',
 city:'Caicó',customer_name:'Mercado Exemplo',driver:'Ana Motorista',
 seller:'João Vendedor',driver_treatment:'Esqueceu de apontar no PDV',
 justified:false,observations:'Verificar o GPS',...overrides
});
const save=(id,revision,data,unit=A)=>rpc('fdr_save',[id,unit,revision,JSON.stringify(data)]);

test('migração pode ser aplicada novamente e conserva permissões e registros',async()=>{
 await as();const id=randomUUID();await save(id,0,entry());
 await db.exec('reset role');await db.exec(migration);
 assert.equal((await query("select count(*)::int as n from public.permissions where code like 'FDR_%'"))[0].n,2);
 assert.equal((await query('select count(*)::int as n from public.delivery_radius_reports where id=$1',[id]))[0].n,1);
});

test('consulta combina PDV, mapa, motorista e vendedor do dia e mantém alternativas de mapa',async()=>{
 await db.exec('reset role');
 await query("insert into customers(code,name,city,branch) values('42','Mercado Matriz','Caicó','Caicó')");
 await query("insert into maps(map_number,map_date,city,driver) values('9','2026-11-20','Caicó','Ana Motorista'),('10','2026-11-20','Caicó','Bia Motorista')");
 for(const [map,seller] of [['9','João Vendedor'],['10','Maria Vendedora']])await query(
  "insert into delivery_return_records(unit,kind,row_key,operation_date,data) values($1,'ORDERS',$2,$3,$4::jsonb)",
  [A,map,'2026-11-20',JSON.stringify({map_number:map,customer_code:'42',seller})]);
 await as('editor');const matches=await rpc('fdr_lookup',[A,'42','2026-11-20']);
 assert.equal(matches.length,2);
 assert.equal(matches.find(row=>row.map_number==='9').customer_name,'Mercado Matriz');
 assert.equal(matches.find(row=>row.map_number==='9').driver,'Ana Motorista');
 assert.equal(matches.find(row=>row.map_number==='10').seller,'Maria Vendedora');
});

test('mapa compartilhado com colisão entre unidades não fornece equipe de outra revenda',async()=>{
 await db.exec('reset role');
 await query("insert into public.maps(map_number,map_date,city,driver) values('12','2026-11-22','Cidade','Equipe compartilhada')");
 for(const [unit,key,map] of [[A,'a',12],[B,'b',12]])await query(
  "insert into delivery_return_records(unit,kind,row_key,operation_date,data) values($1,'ORDERS',$2,'2026-11-22',$3::jsonb)",
  [unit,key,JSON.stringify({map_number:String(map),customer_code:'42',seller:'Vendedor'})]);
 await as('editor');let matches=await rpc('fdr_lookup',[A,'42','2026-11-22']);
 assert.equal(matches[0].driver,'');
 await db.exec('reset role');
 await query("insert into delivery_return_records(unit,kind,row_key,operation_date,data) values($1,'JOURNEYS','a-route','2026-11-22',$2::jsonb)",
  [A,JSON.stringify({map_number:'12',driver:'Equipe da Matriz'})]);
 await as('editor');matches=await rpc('fdr_lookup',[A,'42','2026-11-22']);
 assert.equal(matches[0].driver,'Equipe da Matriz');
});

test('salvar e editar validam campos, isolamento por unidade e revisão concorrente',async()=>{
 await as('editor');const id=randomUUID(),first=await save(id,0,entry());
 assert.equal(first.revision,1);assert.equal(first.updated_by,ids.editor);
 const second=await save(id,1,entry({justified:true}));
 assert.equal(second.revision,2);assert.equal(second.justified,true);
 await assert.rejects(()=>save(id,1,entry()),/FDR_VERSION_CONFLICT/);
 await assert.rejects(()=>save(id,2,entry(),B),/FORBIDDEN/);
 await assert.rejects(()=>save(randomUUID(),0,entry({branch:'OUTRA'})),/INVALID_FDR/);
});

test('consulta e gravação são protegidas por permissão, unidade e RLS',async()=>{
 await as('viewer');assert.ok((await query('select id from public.delivery_radius_reports')).length>0);
 await assert.rejects(()=>save(randomUUID(),0,entry()),/FORBIDDEN/);
 await assert.rejects(()=>rpc('fdr_lookup',[B,'42','2026-11-20']),/FORBIDDEN/);
 await db.exec('reset role');await db.exec('set role anon');
 await assert.rejects(()=>query('select * from public.delivery_radius_reports'),/permission denied/);
 await as('outsider');await assert.rejects(()=>rpc('fdr_lookup',[A,'42','2026-11-20']),/FORBIDDEN/);
});
