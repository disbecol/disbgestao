import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite(),ids={admin:randomUUID(),d1:randomUUID(),d2:randomUUID(),other:randomUUID()};
const A='Matriz Caicó',B='Filial Pau dos Ferros';
const old=await readFile(new URL('../supabase/08_v1_1_0_modulo_puxada.sql',import.meta.url),'utf8');
const offline=await readFile(new URL('../supabase/25_v1_6_0_offline_sync_ativo_giro_auditoria.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/82_pull_step_delivery.sql',import.meta.url),'utf8');
const fn=(source,name)=>source.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\$\\$;','i'))[0];
const sql=async(text,args=[]) => (await db.query(text,args)).rows;
async function as(name){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]]);await db.exec('set role authenticated');}
async function trip({type='PULL',solo=false,unit=A}={}){
  await db.exec('reset role');
  const result=(await sql(`insert into public.pull_trips(trip_code,origin_unit,plate,factory,driver1_id,driver1_name,driver2_id,driver2_name,active_driver_id,start_latitude,start_longitude,cycle_type,solo_trip,week_trip_type)
    values($1,$2,'ABC1234','Fábrica',$3,'Um',$4,'Dois',$3,-6,-35,$5,$6,'ROUTINE') returning *`,['PUX-'+randomUUID(),unit,ids.d1,solo||type==='TRANSFER'?ids.d1:ids.d2,type,solo]))[0];
  const first=(await sql("select * from public.pull_steps where flow_type=$1 and step_type='MAIN' order by sort_order limit 1",[type]))[0];
  await sql(`insert into public.pull_events(trip_id,step_id,step_name,action_code,step_order,user_id,user_name,latitude,longitude,gps_accuracy) values($1,$2,$3,$4,$5,$6,'Um',-6,-35,20)`,[result.id,first.id,first.name,first.action_code,first.sort_order,ids.d1]);
  return result;
}
async function record(t,step,operation=randomUUID(),gps=[-6,-35,20]){
  return (await sql('select public.offline_sync_pull_step($1,$2,$3,$4,$5,$6,\'\',now()) as result',[operation,t.id,step.id,...gps]))[0].result;
}
async function mainSteps(type='PULL',solo=false){return sql("select * from public.pull_steps where step_type='MAIN' and flow_type=$1 and (not $2 or not skip_when_solo) order by sort_order",[type,solo]);}

before(async()=>{
  await db.exec(`create role authenticated;create role anon;create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
    create table public.profiles(id uuid primary key,name text,role text,active boolean default true);
    create table public.units(name text primary key);
    create table public.user_units(user_id uuid,unit_name text);
    create table public.factories(name text primary key,latitude double precision,longitude double precision,radius_meters integer);
    create function public.is_admin() returns boolean language sql stable security definer as $$select coalesce((select role='ADMIN' from public.profiles where id=auth.uid()),false)$$;
    create function public.has_permission(p text) returns boolean language sql stable security definer as $$select exists(select 1 from public.profiles where id=auth.uid() and active)$$;
    create function public.user_has_unit(p text) returns boolean language sql stable security definer as $$select exists(select 1 from public.user_units where user_id=auth.uid() and unit_name=p)$$;
    create function public.assert_user_unit(p text) returns void language plpgsql as $$begin if not public.user_has_unit(p) then raise exception 'UNIDADE_SEM_ACESSO';end if;end;$$;
    create function public.pull_distance_m(double precision,double precision,double precision,double precision) returns double precision language sql as $$select 10::float8$$;`);
  for(const [name,id] of Object.entries(ids)){
    await sql('insert into auth.users values($1)',[id]);
    await sql('insert into public.profiles values($1,$2,$3,true)',[id,name,name==='admin'?'ADMIN':'MOTORISTA_PUXADOR']);
    await sql('insert into public.user_units values($1,$2)',[id,A]);
  }
  for(const name of ['pull_settings','pull_steps','pull_trips','pull_events','pull_occurrences']){
    const table=old.match(new RegExp('create table if not exists public\\.'+name+' \\([\\s\\S]*?\\n\\);'));
    assert.ok(table,name);await db.exec(table[0]);
  }
  await db.exec(`alter table public.pull_trips add cycle_type text default 'PULL',add solo_trip boolean default false,add week_trip_type text;
    alter table public.pull_steps add flow_type text default 'PULL',add executor_driver integer,add skip_when_solo boolean default false;
    alter table public.pull_settings add checklist_enabled boolean default false;
    insert into public.pull_settings(singleton) values(true);
    create table public.pull_checklist_runs(id uuid,trip_id uuid,checkpoint_code text);
    create function public.pull_checklist_requirements(uuid) returns table(checkpoint_code text,gate_action text,sort_order integer) language sql as $$select 'TEST','ARRIVE_SUPPORT_OUT',1$$;
    alter table public.pull_trips enable row level security;alter table public.pull_events enable row level security;
    alter table public.pull_occurrences enable row level security;
    create policy trips_read on public.pull_trips for select to authenticated using(public.user_has_unit(origin_unit) and (auth.uid() in (driver1_id,driver2_id) or public.is_admin()));
    create policy events_read on public.pull_events for select to authenticated using(exists(select 1 from public.pull_trips where id=trip_id));
    create policy occurrences_read on public.pull_occurrences for select to authenticated using(exists(select 1 from public.pull_trips where id=trip_id));
    grant select on public.pull_trips,public.pull_events,public.pull_occurrences,public.pull_settings,public.pull_steps to authenticated;`);
  const toggle=await readFile(new URL('../supabase/72_pull_checklist_toggle.sql',import.meta.url),'utf8');
  await db.exec(fn(toggle,'guard_pull_checklist_step'));
  await db.exec('create trigger checklists before insert on public.pull_events for each row execute function public.guard_pull_checklist_step()');
  await db.exec(offline.match(/create table if not exists public\.offline_sync_receipts \([\s\S]*?\n\);/)[0]);
  await db.exec(fn(offline,'offline_sync_pull_step'));
  const permissions=await readFile(new URL('../supabase/18_v1_4_0_permissoes_avarias_vendas.sql',import.meta.url),'utf8');
  await db.exec(fn(permissions,'start_pull_occurrence'));
  await db.exec(fn(permissions,'end_pull_occurrence'));
  const occurrenceMigration=await readFile(new URL('../supabase/58_pull_occurrences_offline.sql',import.meta.url),'utf8');
  await db.exec(fn(occurrenceMigration,'offline_sync_pull_occurrence_start'));
  await db.exec(fn(occurrenceMigration,'offline_sync_pull_occurrence_end'));
  await db.exec('grant execute on function public.offline_sync_pull_step(uuid,uuid,uuid,double precision,double precision,double precision,text,timestamptz) to authenticated');
  const codes=['START_TRIP','ARRIVE_SUPPORT_OUT','DRIVER_SWAP_OUT','ARRIVE_FACTORY','LOADING','CONFERENCE','LEAVE_FACTORY','ARRIVE_SUPPORT_RETURN','DRIVER_SWAP_RETURN','ARRIVE_UNIT'];
  for(const [i,code] of codes.entries())await sql(`insert into public.pull_steps(name,action_code,step_type,sort_order,executor_driver,skip_when_solo) values($1,$1,'MAIN',$2,$3,$4)`,[code,(i+1)*10,i<=1||i>=8?1:2,[1,2,7,8].includes(i)]);
  for(const [i,code] of ['TRANSFER_START','TRANSFER_ARRIVE_BRANCH','TRANSFER_LEAVE_BRANCH','TRANSFER_ARRIVE_MATRIX'].entries())await sql(`insert into public.pull_steps(name,action_code,step_type,sort_order,executor_driver,flow_type) values($1,$1,'MAIN',$2,1,'TRANSFER')`,[code,(i+1)*10]);
  await db.exec(migration);
});
after(async()=>db.close());

test('banco percorre dez etapas com dois motoristas e checklist desligado',async()=>{
  const t=await trip(),steps=await mainSteps();
  for(const step of steps.slice(1)){
    await as(step.executor_driver===1?'d1':'d2');
    const result=await record(t,step);assert.equal(result.event.action_code,step.action_code);
    const next=steps.find(s=>s.sort_order>step.sort_order);
    assert.equal(result.trip.active_driver_id,next?.executor_driver===2?ids.d2:ids.d1);
  }
  const rows=await sql('select * from public.pull_events where trip_id=$1',[t.id]);assert.equal(rows.length,10);
  assert.equal((await sql('select status from public.pull_trips where id=$1',[t.id]))[0].status,'ARRIVED');
});
test('retry com mesmo ou novo identificador retorna o mesmo evento',async()=>{
  const t=await trip(),steps=await mainSteps();await as('d1');const op=randomUUID();
  const a=await record(t,steps[1],op),b=await record(t,steps[1],op),c=await record(t,steps[1]);
  assert.equal(a.event.id,b.event.id);assert.equal(a.event.id,c.event.id);
  assert.equal((await sql('select count(*)::int n from public.pull_events where trip_id=$1',[t.id]))[0].n,2);
});
test('celular do segundo motorista recebe a próxima etapa pela leitura atômica',async()=>{
  const t=await trip(),steps=await mainSteps();await as('d1');await record(t,steps[1]);await as('d2');
  const state=(await sql('select public.pull_driver_state($1) as state',[t.id]))[0].state;
  assert.equal(state.events.at(-1).action_code,'ARRIVE_SUPPORT_OUT');
  assert.equal(state.trip.active_driver_id,ids.d2);assert.equal(state.settings.checklist_enabled,false);
});
test('snapshot respeita atribuição e unidade, sem liberar viagens alheias',async()=>{
  const t=await trip();await as('other');
  assert.equal((await sql('select public.pull_driver_state($1) as state',[t.id]))[0].state.trip,null);
  const otherUnit=await trip({unit:B});await as('d1');
  assert.equal((await sql('select public.pull_driver_state($1) as state',[otherUnit.id]))[0].state.trip,null);
  const steps=await mainSteps();await assert.rejects(()=>record(otherUnit,steps[1]),/UNIDADE_SEM_ACESSO/);
});
test('motorista errado e etapa fora da sequência são rejeitados sem avanço',async()=>{
  const t=await trip(),steps=await mainSteps();await as('d2');
  await assert.rejects(()=>record(t,steps[1]),/ETAPA_MOTORISTA_1/);
  await as('d1');await assert.rejects(()=>record(t,steps[2]),/ETAPA_FORA_DE_SEQUENCIA/);
  assert.equal((await sql('select count(*)::int n from public.pull_events where trip_id=$1',[t.id]))[0].n,1);
});
test('ocorrência realmente aberta bloqueia etapa; checklist desligado não bloqueia',async()=>{
  const t=await trip(),steps=await mainSteps();await db.exec('reset role');
  await sql(`insert into public.pull_occurrences(trip_id,step_id,occurrence_name,action_code,duration_mode,started_by,started_by_name,start_latitude,start_longitude,status) values($1,$2,'Descanso','OCC_REST','INTERVAL',$3,'Um',-6,-35,'OPEN')`,[t.id,steps[0].id,ids.d1]);
  await as('d1');await assert.rejects(()=>record(t,steps[1]),/OCORRENCIA_EM_ANDAMENTO/);
  await db.exec('reset role');await sql("update public.pull_occurrences set status='CLOSED',ended_at=now() where trip_id=$1",[t.id]);
  await as('d1');assert.ok((await record(t,steps[1])).event.id);
});
test('transferência conclui as quatro etapas com o mesmo motorista',async()=>{
  const t=await trip({type:'TRANSFER'}),steps=await mainSteps('TRANSFER');await as('d1');let result;
  for(const step of steps.slice(1))result=await record(t,step);
  assert.equal(result.trip.status,'ARRIVED');assert.equal(result.trip.kpi_status,'CLOSED');
});
test('viagem solo pula os pontos de apoio e conclui sem checklist',async()=>{
  const t=await trip({solo:true}),steps=await mainSteps('PULL',true);await as('d1');let result;
  for(const step of steps.slice(1))result=await record(t,step);
  assert.equal(result.trip.status,'ARRIVED');assert.equal(steps.length,6);
});
test('GPS inválido ou precisão fora do limite conserva a etapa anterior',async()=>{
  const t=await trip(),steps=await mainSteps();await as('d1');
  await assert.rejects(()=>record(t,steps[1],randomUUID(),[null,-35,20]),/GPS_COORDENADAS_INVALIDAS/);
  await assert.rejects(()=>record(t,steps[1],randomUUID(),[-6,-35,999]),/GPS_PRECISAO_INSUFICIENTE/);
});
test('checklist reativado mantém sua regra, desligado libera sem apagar histórico',async()=>{
  const t=await trip(),steps=await mainSteps();await db.exec('reset role');
  await db.exec('update public.pull_settings set checklist_enabled=true');await as('d1');
  await assert.rejects(()=>record(t,steps[1]),/CHECKLIST_PENDENTE/);
  await db.exec('reset role');await db.exec('update public.pull_settings set checklist_enabled=false');
  await as('d1');assert.ok((await record(t,steps[1])).event.id);
});
test('migração pode ser reaplicada sem mudar etapas, viagens ou a opção do checklist',async()=>{
  await db.exec('reset role');const before=(await sql('select count(*)::int n from public.pull_events'))[0].n;
  await db.exec(migration);assert.equal((await sql('select count(*)::int n from public.pull_events'))[0].n,before);
  assert.equal((await sql('select checklist_enabled from public.pull_settings'))[0].checklist_enabled,false);
});

test('início e fim de refeição enviados depois liberam a próxima etapa da transferência',async()=>{
  const t=await trip({type:'TRANSFER'}),steps=await mainSteps('TRANSFER');
  await db.exec('reset role');
  const meal=(await sql("insert into public.pull_steps(name,action_code,step_type,duration_mode,flow_type) values('Refeição','OCC_MEAL_TEST','OCCURRENCE','INTERVAL','BOTH') returning id"))[0];
  await as('d1');
  const start=(await sql("select public.offline_sync_pull_occurrence_start($1,$2,$3,-6::float8,-35::float8,20::float8,'',now()) as value",[randomUUID(),t.id,meal.id]))[0].value;
  await assert.rejects(()=>record(t,steps[1]),/OCORRENCIA_EM_ANDAMENTO/);
  const endOp=randomUUID();
  const ended=(await sql('select public.offline_sync_pull_occurrence_end($1,$2,-6::float8,-35::float8,20::float8,now()) as value',[endOp,start.id]))[0].value;
  assert.equal(ended.status,'CLOSED');
  const repeated=(await sql("select public.offline_sync_pull_occurrence_end($1,$2,-6::float8,-35::float8,20::float8,now()+interval '1 minute') as value",[randomUUID(),start.id]))[0].value;
  assert.equal(repeated.ended_at,ended.ended_at);
  assert.equal(repeated.ended_by,ended.ended_by);
  assert.equal((await record(t,steps[1])).event.action_code,'TRANSFER_ARRIVE_BRANCH');
});
