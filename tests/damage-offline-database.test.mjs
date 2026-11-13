import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite(),owner=randomUUID();
before(async()=>{
  await db.exec(`create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select current_setting('request.jwt.claim.sub')::uuid$$;
    create table public.offline_sync_receipts(operation_id uuid primary key,user_id uuid,operation_type text,result jsonb);
    create table public.test_damage_requests(id uuid primary key default gen_random_uuid(),payload jsonb);
    create function public.create_damage_request(payload jsonb) returns uuid language plpgsql as $$
    declare request_id uuid;
    begin
      if payload->>'invalid'='true' then raise exception 'INVALID_REQUEST';end if;
      insert into public.test_damage_requests(payload) values(payload) returning id into request_id;
      return request_id;
    end;$$;`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const sql=await readFile(new URL('../supabase/25_v1_6_0_offline_sync_ativo_giro_auditoria.sql',import.meta.url),'utf8');
  const fn=sql.match(/create or replace function public\.offline_sync_damage_request\([\s\S]*?\$\$;/)?.[0];
  assert.ok(fn);await db.exec(fn);
});
after(()=>db.close());
const sync=async(id,payload)=>(await db.query('select public.offline_sync_damage_request($1::uuid,$2::jsonb) as result',[id,JSON.stringify(payload)])).rows[0].result;

test('the production SQL returns the same request after retries, including a changed retry payload',async()=>{
  const operation=randomUUID(),first=await sync(operation,{map:'offline-test',unit:'Matriz Caicó'});
  for(let n=0;n<3;n++)assert.deepEqual(await sync(operation,{map:'changed-retry',unit:'Filial Pau dos Ferros'}),first);
  const rows=(await db.query('select * from test_damage_requests where id=$1',[first.request_id])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].payload.map,'offline-test');assert.equal(rows[0].payload.unit,'Matriz Caicó');
  const receipts=(await db.query('select * from offline_sync_receipts where operation_id=$1',[operation])).rows;
  assert.equal(receipts.length,1);assert.equal(receipts[0].user_id,owner);assert.equal(receipts[0].operation_type,'DAMAGE_CREATE');
});

test('a failed creation stores no acknowledgement and the same operation can retry successfully',async()=>{
  const operation=randomUUID();await assert.rejects(()=>sync(operation,{invalid:true}),/INVALID_REQUEST/);
  assert.equal((await db.query('select * from offline_sync_receipts where operation_id=$1',[operation])).rows.length,0);
  const saved=await sync(operation,{map:'retry-success'});assert.ok(saved.request_id);assert.deepEqual(await sync(operation,{}),saved);
});
