import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite(),editor=randomUUID(),viewer=randomUUID(),outsider=randomUUID();
const unit='Matriz Caicó',other='Filial Pau dos Ferros';
const migration=await readFile(new URL('../supabase/migrations/20261126120000_rating_site_comments.sql',import.meta.url),'utf8');
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
async function as(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function save(u,key,revision,comment){return (await query('select public.rating_save_comment($1,$2,$3,$4) as value',[u,key,revision,comment]))[0].value;}

before(async()=>{
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table profiles(id uuid primary key,active boolean default true);
    create table units(name text primary key);
    create table user_units(user_id uuid,unit_name text);
    create table permissions(code text primary key,module text,name text,description text,sort_order int,active boolean);
    create table role_permissions(role text,permission_code text,primary key(role,permission_code));
    create table user_permissions(user_id uuid,permission_code text);
    create function public.user_has_unit(p_unit text) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.user_units where user_id=auth.uid() and unit_name=p_unit)$$;
    create function public.has_permission(p_code text) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.user_permissions up join public.profiles p on p.id=up.user_id and p.active where up.user_id=auth.uid() and up.permission_code=p_code)$$;`);
  await query('insert into units values($1),($2)',[unit,other]);
  for(const id of [editor,viewer,outsider])await query('insert into profiles(id) values($1)',[id]);
  await query('insert into user_units values($1,$3),($2,$3)',[editor,viewer,unit]);
  await query("insert into user_permissions values($1,'RATING_EDIT'),($2,'RATING_VIEW'),($3,'RATING_EDIT')",[editor,viewer,outsider]);
  await db.exec(migration);
});
after(()=>db.close());

test('grava e lê tratativas por unidade, exige permissão e detecta conflito',async()=>{
  await as(editor);
  assert.deepEqual(await save(unit,'["data","101"]',0,'Primeira'),{comment:'Primeira',revision:1});
  await assert.rejects(()=>save(unit,'["data","101"]',0,'Sobrescrita'),/RATING_VERSION_CONFLICT/);
  assert.deepEqual(await save(unit,'["data","101"]',1,'Atualizada'),{comment:'Atualizada',revision:2});
  await assert.rejects(()=>save(other,'outra',0,'Inválida'),/FORBIDDEN/);
  await assert.rejects(()=>query("update public.rating_comments set comment='direto'"),/permission denied/);
  await as(viewer);
  assert.equal((await query('select comment from public.rating_comments'))[0].comment,'Atualizada');
  await assert.rejects(()=>save(unit,'outra',0,'Não permitido'),/FORBIDDEN/);
  await as(outsider);
  assert.equal((await query('select * from public.rating_comments')).length,0);
  await assert.rejects(()=>save(unit,'outra',0,'Não permitido'),/FORBIDDEN/);
  await db.exec('reset role');await db.exec('set role anon');
  await assert.rejects(()=>query('select * from public.rating_comments'),/permission denied/);
});
