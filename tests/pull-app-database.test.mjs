import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),A='Matriz Caicó',B='Filial Pau dos Ferros';
const users={admin:randomUUID(),one:randomUUID(),two:randomUUID(),other:randomUUID(),analyst:randomUUID()};
const read=p=>fs.readFile(new URL('../'+p,import.meta.url),'utf8');
const fn=(source,name)=>source.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\$\\$;','i'))[0];
const sql=async(s,args=[])=>(await db.query(s,args)).rows;
const rpc=async(method,path,body={},query={})=>(await sql('select public.pull_app_request($1,$2,$3,$4) data',[method,path,JSON.stringify(query),JSON.stringify(body)]))[0].data;
async function as(who){await db.exec('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[users[who]||who]);await db.exec('set role authenticated');}
const command=(kind,extra={})=>({commandId:randomUUID(),deviceId:'test',deviceSequence:1,kind,occurredAt:new Date(Date.now()-30000).toISOString(),dependsOnCommandIds:[],location:null,locationStatus:'TimedOut',...extra});
let vehicle,legacy,legacyStamp;
async function createPlan({type='PULL',solo=false,unit=A,drivers=['one','two']}={}){
 await as('admin');return rpc('POST','/plans',{type,solo:type==='TRANSFER'||solo,unitId:unit,vehicleId:vehicle.id,factoryId:'Fábrica exemplo',destination:'Filial Pau dos Ferros',driver1Id:users[drivers[0]],driver2Id:solo||type==='TRANSFER'?null:users[drivers[1]],appointmentAt:new Date().toISOString(),weekPosition:'ROUTINE'});
}
async function start(plan,who='one'){await as(who);return rpc('POST',`/plans/${plan.id}/start`,command('START_TRIP',{occurredAt:new Date(Date.now()-60000).toISOString()}));}
async function cancelAll(){await db.exec("reset role;update public.pull_trips set status='CANCELLED' where status='IN_PROGRESS'");}
before(async()=>{
 try{
 await db.exec(await read('tests/fixtures/pull-app-base.sql'));
 await db.exec("insert into public.units(name) values('Matriz Caicó'),('Filial Pau dos Ferros');insert into public.pull_settings(singleton,checklist_enabled) values(true,false);insert into public.factories(name,active) values('Fábrica exemplo',true)");
 for(const [key,id] of Object.entries(users)){
  await sql('insert into auth.users values($1)',[id]);await sql('insert into public.profiles(id,username,name,role) values($1,$2,$2,$3)',[id,key,key==='admin'?'ADMIN':key==='analyst'?'CONFERENTE':'MOTORISTA_PUXADOR']);
  await sql('insert into public.user_units(user_id,unit_name) values($1,$2)',[id,key==='other'?B:A]);
  if(key!=='admin')await sql('insert into public.test_permissions values($1,$2)',[id,key==='analyst'?'PULL_FAROL':'PULL_TRIP']);
 }
 vehicle=(await sql("insert into public.pull_vehicles(plate,carrier,active) values('ABC1D23','Transportadora',true) returning *"))[0];
 const codes=['START_TRIP','ARRIVE_SUPPORT_OUT','DRIVER_SWAP_OUT','ARRIVE_FACTORY','LOADING','CONFERENCE','LEAVE_FACTORY','ARRIVE_SUPPORT_RETURN','DRIVER_SWAP_RETURN','ARRIVE_UNIT'];
 for(const [i,code] of codes.entries())await sql("insert into public.pull_steps(name,step_type,sort_order,action_code,active,executor_driver,flow_type,skip_when_solo) values($1,'MAIN',$2,$1,true,$3,'PULL',$4)",[code,(i+1)*10,i<2||i>=8?1:2,[1,2,7,8].includes(i)]);
 for(const [i,code] of ['TRANSFER_START','TRANSFER_ARRIVE_BRANCH','TRANSFER_LEAVE_BRANCH','TRANSFER_ARRIVE_MATRIX'].entries())await sql("insert into public.pull_steps(name,step_type,sort_order,action_code,active,executor_driver,flow_type) values($1,'MAIN',$2,$1,true,1,'TRANSFER')",[code,(i+1)*10]);
 await db.exec("insert into public.pull_steps(name,step_type,sort_order,action_code,active,flow_type) values('Refeição','OCCURRENCE',1,'OCC_REFEICAO',true,'BOTH');insert into public.pull_checklist_questions(question,critical,active,sort_order) values('Freios estão OK?',true,true,1)");
 await db.exec(fn(await read('supabase/68_pull_checklist_sequence.sql'),'pull_checklist_requirements'));
 await db.exec(fn(await read('supabase/45_pull_plans_and_attachments.sql'),'save_pull_trip_plan'));
 await db.exec(fn(await read('supabase/77_pull_plan_week_optional_when_checklist_off.sql'),'save_pull_trip_plan'));
 legacy=(await sql("insert into public.pull_trips(trip_code,origin_unit,plate,carrier,factory,driver1_id,driver1_name,driver2_id,driver2_name,start_latitude,start_longitude,status) values('PUX-000001',$1,'OLD1234','Antiga','Fábrica exemplo',$2,'Um',$3,'Dois',-6,-35,'ARRIVED') returning *",[A,users.one,users.two]))[0];legacyStamp=legacy.started_at;
 await db.exec(await read('supabase/migrations/20261123171055_puxada_isolated_integration.sql'));
 await db.exec(await read('supabase/migrations/20261124112300_pull_tma_permission_access.sql'));
 await db.exec('create trigger guard_checklist before insert on public.pull_events for each row execute function public.guard_pull_checklist_step()');
 }catch(error){const at=Number(error.position||error.internalPosition||0);throw Error([error.message,error.detail,error.where,at&&String(error.query||error.internalQuery||'').slice(Math.max(0,at-200),at+200)].filter(Boolean).join('\n'));}
});
after(async()=>{
 if(process.env.DISB_PULL_PREVIEW==='1'){
  await as('admin');const session=await rpc('GET','/auth/session'),catalog=await rpc('GET','/catalog'),plans=await rpc('GET','/plans'),trips=await rpc('GET','/trips',{}, {scope:'history'}),analytics=await rpc('GET','/_analytics'),goal=await rpc('GET','/goals/2026');
  await fs.writeFile(new URL('../tmp/puxada-preview-state.json',import.meta.url),JSON.stringify({session,catalog,plans,trips,analytics,goal}));
 }
 await db.close();
});
test('migration preserves legacy IDs/timestamps and rejects access to helpers and private tables',async()=>{
 await as('admin');const state=await rpc('GET',`/trips/${legacy.id}`);assert.equal(new Date(state.startedAt).getTime(),new Date(legacyStamp).getTime());assert.equal(state.id,legacy.id);
 await assert.rejects(sql('select * from public.pull_app_runtime'),/permission denied/);
 await assert.rejects(sql('select public.pull_app_snapshot($1)',[legacy.id]),/permission denied/);
 await as('other');await assert.rejects(rpc('GET',`/trips/${legacy.id}`),/UNIDADE_SEM_ACESSO/);
 await as('admin');await assert.rejects(rpc('POST','/plans',{unitId:B,vehicleId:vehicle.id,type:'PULL'}));
});
test('start without GPS commits once, retries expired requests, and freezes workflow',async()=>{
 await cancelAll();const plan=await createPlan({solo:true});await as('one');const body=command('START_TRIP',{occurredAt:new Date(Date.now()-60000).toISOString()});
 const first=await rpc('POST',`/plans/${plan.id}/start`,body);const again=await rpc('POST',`/plans/${plan.id}/start`,body);
 assert.equal(first.state.events.length,1);assert.equal(again.duplicate,true);assert.equal(first.tripId,again.tripId);assert.equal(first.state.events[0].location,null);assert.equal(first.state.solo,true);assert.equal(first.state.driver2Id,null);assert.equal(first.state.steps.length,6);
 await assert.rejects(rpc('POST',`/plans/${plan.id}/start`,{...body,note:'changed'}),e=>e.detail.includes('COMMAND_ID_REUSED'));
 await db.exec("reset role;update public.pull_steps set name='Novo texto' where action_code='ARRIVE_FACTORY'");await as('one');
 const state=await rpc('GET',`/trips/${first.tripId}`);assert.equal(state.steps.find(s=>s.key==='ARRIVE_FACTORY').label,'ARRIVE_FACTORY');
});
test('two-driver handoff validates driver, sequence, dependencies and stable command receipts',async()=>{
 await cancelAll();const plan=await createPlan();const started=await start(plan);const id=started.tripId;
 const next=command('RECORD_STEP',{stageKey:'ARRIVE_SUPPORT_OUT'});
 await as('two');await assert.rejects(rpc('POST',`/trips/${id}/commands`,next),e=>e.detail.includes('WRONG_DRIVER'));
 await as('one');await assert.rejects(rpc('POST',`/trips/${id}/commands`,{...next,commandId:randomUUID(),dependsOnCommandIds:[randomUUID()]}),e=>e.detail.includes('DEPENDENCY_PENDING'));
 const receipt=await rpc('POST',`/trips/${id}/commands`,next);assert.equal(receipt.state.nextStep.responsibleUserId,users.two);assert.ok(receipt.revision>started.revision);
 const retry=await rpc('POST',`/trips/${id}/commands`,next);assert.equal(retry.eventId,receipt.eventId);assert.equal(retry.duplicate,true);
 await as('two');const swap=await rpc('POST',`/trips/${id}/commands`,command('RECORD_STEP',{stageKey:'DRIVER_SWAP_OUT'}));assert.equal(swap.state.events.length,3);
 await as('analyst');await assert.rejects(rpc('POST',`/trips/${id}/commands`,command('RECORD_STEP',{stageKey:'ARRIVE_FACTORY'})),e=>e.detail.includes('FORBIDDEN'));
});
test('open occurrence blocks a stage and duplicate closing preserves its first timestamp',async()=>{
 await cancelAll();const plan=await createPlan({solo:true});const started=await start(plan);const id=started.tripId,oid=randomUUID();
 const open=command('START_OCCURRENCE',{occurrenceId:oid,occurrenceType:'MEAL'});await rpc('POST',`/trips/${id}/commands`,open);
 await assert.rejects(rpc('POST',`/trips/${id}/commands`,command('RECORD_STEP',{stageKey:'ARRIVE_FACTORY'})),e=>e.detail.includes('OCCURRENCE_OPEN'));
 const close=command('END_OCCURRENCE',{occurrenceId:oid});const ended=await rpc('POST',`/trips/${id}/commands`,close);
 const retry=await rpc('POST',`/trips/${id}/commands`,{...close,commandId:randomUUID(),occurredAt:new Date().toISOString()});assert.equal(ended.state.occurrences[0].endedAt,retry.state.occurrences[0].endedAt);
});
test('active trip conflict covers the plate and both driver roles',async()=>{
 await cancelAll();const first=await createPlan();await start(first);const second=await createPlan({drivers:['two','one']});
 await assert.rejects(start(second,'two'),e=>e.detail.includes('ACTIVE_TRIP_CONFLICT'));
});
test('manual location appends audit without overwriting original GPS or the recorded time',async()=>{
 await cancelAll();const plan=await createPlan({solo:true});const started=await start(plan);await as('admin');
 const e=started.state.events[0];const corrected=await rpc('POST',`/events/${e.id}/location`,{latitude:-6,longitude:-35,reason:'Complemento informado pela equipe'});
 assert.equal(corrected.events[0].location.source,'Manual');assert.equal(corrected.events[0].occurredAt,e.occurredAt);assert.equal(corrected.events[0].locationCorrections.length,1);
 await db.exec('reset role');assert.equal((await sql('select latitude from public.pull_events where id=$1',[e.id]))[0].latitude,null);
});
test('late GPS tracks retry without duplicating and cannot use another actor identity',async()=>{
 await cancelAll();const plan=await createPlan({solo:true});const started=await start(plan);const point={id:randomUUID(),latitude:-6,longitude:-35,accuracy:20,capturedAt:new Date().toISOString(),source:'GPS'};
 await rpc('POST',`/trips/${started.tripId}/tracks`,{points:[point]});await rpc('POST',`/trips/${started.tripId}/tracks`,{points:[point]});
 await db.exec('reset role');assert.equal((await sql('select count(*)::int n from public.pull_track_points where trip_id=$1',[started.tripId]))[0].n,1);
});
test('a plan prepared with checklist off is not retroactively blocked after enabling it',async()=>{
 await cancelAll();const plan=await createPlan({solo:true});await as('admin');await rpc('PUT','/settings',{checklistEnabled:true});
 const receipt=await start(plan);assert.equal(receipt.state.checklistRequired,false);assert.equal(receipt.state.pendingChecklist,null);
 await as('admin');await rpc('PUT','/settings',{checklistEnabled:false});
});
test('two support checklists preserve frozen questions and require each responsible driver',async()=>{
 await cancelAll();await as('admin');await rpc('PUT','/settings',{checklistEnabled:true});const plan=await createPlan();const receipt=await start(plan),id=receipt.tripId;
 const arrived=await rpc('POST',`/trips/${id}/commands`,command('RECORD_STEP',{stageKey:'ARRIVE_SUPPORT_OUT'}));assert.equal(arrived.state.pendingChecklist.checkpoint,'D1_SUPPORT_OUT');
 const questions=arrived.state.checklistQuestions;await as('admin');await rpc('PUT','/questions',questions.map(q=>({...q,text:'Pergunta alterada após a saída'})));
 await as('one');await assert.rejects(rpc('POST',`/trips/${id}/commands`,command('RECORD_STEP',{stageKey:'DRIVER_SWAP_OUT'})),e=>e.detail.includes('WRONG_DRIVER'));
 const answers=questions.map(q=>({questionId:q.id,answer:'OK',observation:''}));
 const d1=await rpc('POST',`/trips/${id}/commands`,command('SUBMIT_CHECKLIST',{checkpoint:'D1_SUPPORT_OUT',odometerKm:100,answers}));assert.equal(d1.state.pendingChecklist.checkpoint,'D2_SUPPORT_OUT');
 assert.equal(d1.state.checklists[0].answers[0].question,'Freios estão OK?');
 await assert.rejects(rpc('POST',`/trips/${id}/commands`,command('SUBMIT_CHECKLIST',{checkpoint:'D2_SUPPORT_OUT',odometerKm:100,answers})),e=>e.detail.includes('WRONG_DRIVER'));
 await as('two');const d2=await rpc('POST',`/trips/${id}/commands`,command('SUBMIT_CHECKLIST',{checkpoint:'D2_SUPPORT_OUT',odometerKm:100,answers}));assert.equal(d2.state.pendingChecklist,null);
 await rpc('POST',`/trips/${id}/commands`,command('RECORD_STEP',{stageKey:'DRIVER_SWAP_OUT',occurredAt:new Date().toISOString()}));
 await as('admin');await rpc('PUT','/settings',{checklistEnabled:false});
});
test('invalid departure checklist rolls back trip, event, receipt and plan status together',async()=>{
 await cancelAll();await as('admin');await rpc('PUT','/settings',{checklistEnabled:true});const plan=await createPlan({solo:true});await as('one');
 await assert.rejects(rpc('POST',`/plans/${plan.id}/start`,command('START_TRIP')),e=>e.detail.includes('INVALID_ODOMETER'));
 await db.exec('reset role');assert.equal((await sql('select status,trip_id from public.pull_trip_plans where id=$1',[plan.id]))[0].status,'PLANNED');
 assert.equal((await sql("select count(*)::int n from public.pull_trips where status='IN_PROGRESS'"))[0].n,0);
 await as('admin');await rpc('PUT','/settings',{checklistEnabled:false});
});
test('solo completion sums correct workflow and opens NRI; transfer closes its cycle immediately',async()=>{
 for(const type of ['PULL','TRANSFER']){
  await cancelAll();const plan=await createPlan({type,solo:true});await as('one');const started=await rpc('POST',`/plans/${plan.id}/start`,command('START_TRIP',{occurredAt:new Date().toISOString()}));let receipt=started;
  for(const step of started.state.steps.slice(1))receipt=await rpc('POST',`/trips/${started.tripId}/commands`,command('RECORD_STEP',{stageKey:step.key,occurredAt:new Date().toISOString()}));
  assert.equal(receipt.state.status,'ARRIVED');assert.equal(receipt.state.nextStep,null);
  await db.exec('reset role');const row=(await sql('select nri_status,kpi_status from public.pull_trips where id=$1',[started.tripId]))[0];
  assert.equal(row.nri_status,type==='PULL'?'PENDING':'NOT_READY');assert.equal(row.kpi_status,type==='PULL'?'WAITING_NEXT_START':'CLOSED');
 }
});
test('media registers one stable ID and rejects wrong ownership/path and the eleventh photo',async()=>{
 await cancelAll();const plan=await createPlan({solo:true});const started=await start(plan);const id=started.tripId;
 for(let i=0;i<10;i++){
  const clientId=randomUUID(),path=`${id}/${users.one}/${clientId}.jpg`,body={clientId,path,sha256:'a'.repeat(64),size:100};
  await db.exec('reset role');await sql("insert into storage.objects values('puxada-anexos',$1,'{\"size\":100}')",[path]);await as('one');
  const first=await rpc('POST',`/trips/${id}/attachments`,body),again=await rpc('POST',`/trips/${id}/attachments`,body);assert.equal(first.id,again.id);
 }
 const clientId=randomUUID(),path=`${id}/${users.one}/${clientId}.jpg`;await db.exec('reset role');await sql("insert into storage.objects values('puxada-anexos',$1,'{\"size\":100}')",[path]);await as('one');
 await assert.rejects(rpc('POST',`/trips/${id}/attachments`,{clientId,path,sha256:'a'.repeat(64),size:100}),e=>e.detail.includes('PHOTO_LIMIT'));
 await assert.rejects(rpc('POST',`/trips/${id}/invoices`,{clientId:randomUUID(),path,sha256:'a'.repeat(64),size:100}),e=>e.detail.includes('INVALID_MEDIA'));
});
test('goals are saved only by permitted staff and module deactivation is enforced by the server',async()=>{
 await as('analyst');await assert.rejects(rpc('PUT','/goals/2026',{tmvOutTargetMinutes:60}),e=>e.detail.includes('FORBIDDEN'));
 await as('admin');const g=await rpc('PUT','/goals/2026',{tmvOutTargetMinutes:60,tmvOutAdherence:90});assert.equal(g.tmvOutTargetMinutes,60);assert.equal(g.tmvOutAdherence,90);
 await db.exec("reset role;update public.module_settings set active=false where module_name='Puxada'");await as('one');await assert.rejects(rpc('GET','/catalog'),e=>e.detail.includes('MODULE_DISABLED'));
 await db.exec("reset role;update public.module_settings set active=true where module_name='Puxada'");
});

test('staff with only TMA adjustment can enter history without gaining planning or settings access',async()=>{
 await db.exec('reset role');await sql('delete from public.test_permissions where user_id=$1',[users.analyst]);await sql('insert into public.test_permissions values($1,$2)',[users.analyst,'PULL_TMA_ADJUST']);await as('analyst');
 try{const session=await rpc('GET','/auth/session');assert.equal(session.user.allowedPages.includes('history'),true);assert.equal(session.user.allowedPages.includes('plans'),false);assert.ok(await rpc('GET','/catalog'));assert.ok(Array.isArray(await rpc('GET','/trips',{}, {scope:'history'})));await assert.rejects(rpc('PUT','/settings',{checklistRequired:true}),e=>e.detail.includes('FORBIDDEN'));}
 finally{await db.exec('reset role');await sql('delete from public.test_permissions where user_id=$1',[users.analyst]);await sql('insert into public.test_permissions values($1,$2)',[users.analyst,'PULL_FAROL']);}
});
