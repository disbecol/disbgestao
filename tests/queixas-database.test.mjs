import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite(), user=randomUUID(), other=randomUUID(), inactive=randomUUID();
const migration=await readFile(new URL('../supabase/migrations/20261127130000_complaints.sql',import.meta.url),'utf8');
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
async function as(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec('set role authenticated');
}
before(async()=>{
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table public.profiles(id uuid primary key,active boolean not null);`);
  await query('insert into public.profiles values ($1,true),($2,true),($3,false)',[user,other,inactive]);
  await db.exec(migration);
});
after(()=>db.close());

test('usuários ativos importam e acompanham cópias imutáveis; usuários inativos e anônimos não acessam',async()=>{
  const original={date:'01/02/2026',complaint:'Atraso',treatment_date:'',treatment:'Original',status:'Sem resposta',days:''};
  await as(user);
  assert.equal((await query('select public.complaints_import($1::jsonb) n',[JSON.stringify([original])]))[0].n,1);
  const [saved]=await query('select * from public.complaints');
  await assert.rejects(()=>query("update public.complaints set source='{}'"),/permission denied/);
  await as(other);
  await query('select public.complaints_update_treatment($1,1,$2,$3,$4)',[saved.id,'03/02/2026','Contato feito','Resolvida']);
  const [updated]=await query('select * from public.complaints');
  assert.deepEqual(updated.source,original);
  assert.equal(updated.treatment,'Contato feito');assert.equal(updated.revision,2);
  await assert.rejects(()=>query('select public.complaints_update_treatment($1,1,$2,$3,$4)',[saved.id,'','','']),/COMPLAINT_VERSION_CONFLICT/);
  await as(inactive);
  assert.equal((await query('select * from public.complaints')).length,0);
  await assert.rejects(()=>query('select public.complaints_import($1::jsonb)',[JSON.stringify([original])]),/FORBIDDEN/);
  await assert.rejects(()=>query('select public.complaints_update_treatment($1,2,$2,$3,$4)',[saved.id,'','','']),/FORBIDDEN/);
  await db.exec('reset role; set role anon');
  await assert.rejects(()=>query('select * from public.complaints'),/permission denied/);
});
