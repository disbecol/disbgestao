import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const fix=await readFile(new URL('../supabase/migrations/20261123105236_module_settings_names_compatibility.sql',import.meta.url),'utf8');
const definition=db=>db.query("select pg_get_constraintdef(oid) rule,convalidated validated from pg_constraint where conrelid='public.module_settings'::regclass and conname='module_settings_name_valid'");

test('reproduz 23514 ao retirar Pedidos e a correção não modifica nenhuma linha',async()=>{
 const db=new PGlite();try{
  await db.exec("create table module_settings(module_name text primary key,active boolean not null);insert into module_settings values('Pedidos',false),('NRI',true);alter table module_settings add constraint module_settings_name_valid check(module_name in ('Pedidos','NRI'));");
  await assert.rejects(()=>db.exec("begin;alter table module_settings drop constraint module_settings_name_valid;alter table module_settings add constraint module_settings_name_valid check(module_name in ('NRI','Devoluções'));commit;"),e=>e.code==='23514');await db.exec('rollback');
  const before=(await db.query('select * from module_settings order by module_name')).rows;
  await db.exec(fix);assert.deepEqual((await db.query('select * from module_settings order by module_name')).rows,before);
  await db.exec("insert into module_settings values('Devoluções',true)");
  await assert.rejects(()=>db.exec("insert into module_settings values('Inexistente',true)"),e=>e.code==='23514');
  const first=(await definition(db)).rows;assert.equal(first[0].validated,true);await db.exec(fix);assert.deepEqual((await definition(db)).rows,first);
 }finally{await db.close();}
});

test('preserva módulos adicionais aceitos e não altera uma restrição já compatível',async()=>{
 const db=new PGlite();try{
  await db.exec("create table module_settings(module_name text primary key,active boolean not null);alter table module_settings add constraint module_settings_name_valid check(module_name in ('NRI','Modulo futuro'));insert into module_settings values('Modulo futuro',false);");
  await db.exec(fix);assert.equal((await db.query("select active from module_settings where module_name='Modulo futuro'")).rows[0].active,false);
  await db.exec("insert into module_settings values('Pedidos',false),('Devoluções',true)");const first=(await definition(db)).rows;
  await db.exec(fix);assert.deepEqual((await definition(db)).rows,first);await assert.rejects(()=>db.exec("insert into module_settings values('Qualquer nome',true)"),e=>e.code==='23514');
 }finally{await db.close();}
});

test('recria a validação ausente com os módulos do sistema, sem preencher ou ativar módulos',async()=>{
 const db=new PGlite();try{
  await db.exec("create table module_settings(module_name text primary key,active boolean not null);insert into module_settings values('Pedidos',false);");
  await db.exec(fix);assert.deepEqual((await db.query('select * from module_settings')).rows,[{module_name:'Pedidos',active:false}]);
  assert.equal((await definition(db)).rows[0].validated,true);await assert.rejects(()=>db.exec("insert into module_settings values('Inexistente',true)"),e=>e.code==='23514');
 }finally{await db.close();}
});

test('uma base com dados inválidos não fica sem restrição por falha da correção',async()=>{
 const db=new PGlite();try{
  await db.exec("create table module_settings(module_name text primary key,active boolean not null);insert into module_settings values('Inexistente',true);alter table module_settings add constraint module_settings_name_valid check(module_name in ('NRI')) not valid;");
  const before=(await definition(db)).rows;
  await assert.rejects(()=>db.exec(fix),e=>e.code==='23514');await db.exec('rollback');assert.deepEqual((await definition(db)).rows,before);
  await assert.rejects(()=>db.exec("insert into module_settings values('Outro invalido',true)"),e=>e.code==='23514');
 }finally{await db.close();}
});
