import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import validation from '../receipt-validation.js';

test('normalização e comparação local recusam PDF modificado e código inválido',async()=>{
 const code='DGB-11111111-22224444-88889999-AAAAAAAA';
 assert.equal(validation.normalizeCode(code.toLowerCase().replaceAll('-',' ')),code);
 assert.equal(validation.normalizeCode('DGB-000'), '');
 const original=new Blob(['%PDF-1.7\noriginal']);
 const hash=(await validation.verifyFile(original,'')).hash;
 assert.equal((await validation.verifyFile(original,hash)).matches,true);
 assert.equal((await validation.verifyFile(new Blob(['%PDF-1.7\nalterado']),hash)).matches,false);
 await assert.rejects(()=>validation.verifyFile(new Blob(['not PDF']),hash),/não é um PDF/);
});

test('registro único, imutável, preservado após excluir avaria e consultável somente por unidade/permissão',async()=>{
 const db=new PGlite(),owner=randomUUID(),request=randomUUID(),send=randomUUID(),hash='a'.repeat(64);
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function public.user_has_unit(u text) returns boolean language sql stable as $$select u=current_setting('test.unit',true)$$;
   create function public.has_permission(p text) returns boolean language sql stable as $$select p=current_setting('test.permission',true)$$;
   grant usage on schema auth to authenticated;
   create table damage_requests(id uuid primary key);`);
  const sql=await readFile(new URL('../supabase/84_damage_receipt_verification.sql',import.meta.url),'utf8');
  await db.exec(sql);await db.exec(sql);
  const insert=`insert into damage_receipts(request_id,send_id,requested_by,unit,snapshot) values($1,$2,$3,'Matriz Caicó',$4) returning *`;
  const args=[request,send,owner,JSON.stringify({customer_code:'371',customer_name:'Teste',items:[{product_text:'988 - Brahma',quantity:2}]})];
  await db.exec('set role service_role');
  const receipt=(await db.query(insert,args)).rows[0];
  assert.match(receipt.receipt_code,/^DGB-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/);
  await assert.rejects(()=>db.query(insert,args),e=>e.code==='23505');
  await db.query('update damage_receipts set pdf_sha256=$1,generated_at=now() where id=$2',[hash,receipt.id]);
  await assert.rejects(()=>db.query('update damage_receipts set pdf_sha256=$1 where id=$2',['b'.repeat(64),receipt.id]),/RECEIPT_IMMUTABLE/);
  await assert.rejects(()=>db.query('update damage_receipts set snapshot=$1 where id=$2',['{}',receipt.id]),e=>e.code==='42501');
  await assert.rejects(()=>db.query('delete from damage_receipts where id=$1',[receipt.id]),e=>e.code==='42501');
  await db.exec('reset role');
  await db.query('insert into damage_requests values($1)',[request]);await db.query('delete from damage_requests where id=$1',[request]);
  await db.query("select set_config('test.unit','Matriz Caicó',false),set_config('test.permission','DELIVERY_DAMAGE_VIEW_ALL',false)");
  await db.exec('set role authenticated');
  assert.equal((await db.query('select * from find_damage_receipt($1,$2)',[receipt.receipt_code.toLowerCase(),'Matriz Caicó'])).rows[0].request_id,request);
  await assert.rejects(()=>db.query(insert,args),e=>e.code==='42501');
  await db.query("select set_config('test.unit','Filial Pau dos Ferros',false)");
  assert.equal((await db.query('select * from find_damage_receipt($1,$2)',[receipt.receipt_code,'Matriz Caicó'])).rows.length,0);
  await db.query("select set_config('test.unit','Matriz Caicó',false),set_config('test.permission','NRI_CREATE',false)");
  assert.equal((await db.query('select * from damage_receipts')).rows.length,0);
  await db.exec('reset role;set role anon');
  await assert.rejects(()=>db.query('select * from find_damage_receipt($1,$2)',[receipt.receipt_code,'Matriz Caicó']),e=>e.code==='42501');
 }finally{await db.close();}
});
