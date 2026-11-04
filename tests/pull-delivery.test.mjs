import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const copy=value=>structuredClone(value);
const gps={latitude:-6.4,longitude:-35.4,accuracy:20,capturedAt:new Date().toISOString()};
const steps=['START_TRIP','ARRIVE_SUPPORT_OUT','DRIVER_SWAP_OUT','ARRIVE_FACTORY','LOADING','CONFERENCE','LEAVE_FACTORY','ARRIVE_SUPPORT_RETURN','DRIVER_SWAP_RETURN','ARRIVE_UNIT'].map((code,i)=>({
  id:'s'+(i+1),name:code,action_code:code,sort_order:(i+1)*10,step_type:'MAIN',active:true,flow_type:'PULL',executor_driver:i<=1||i>=8?1:2,required:true
}));
function server(){
  const state={trip:{id:'trip',trip_code:'PUX-TEST',cycle_type:'PULL',status:'IN_PROGRESS',driver1_id:'d1',driver1_name:'Um',driver2_id:'d2',driver2_name:'Dois',active_driver_id:'d1',week_trip_type:'ROUTINE'},events:[],steps,occurrences:[],settings:{checklist_enabled:false,gps_max_accuracy_m:200}};
  state.events=[{id:'e1',trip_id:'trip',step_id:'s1',step_order:10,action_code:'START_TRIP',user_id:'d1'}];
  const receipts=new Map();
  const api={state,calls:[],failAfterCommit:false,failEndOnce:false,stallType:null,read:null};
  api.rpc=async(name,p)=>{
    api.calls.push(name);
    if(name==='offline_sync_pull_occurrence_start'){
      if(receipts.has(p.p_operation_id))return {data:copy(receipts.get(p.p_operation_id))};
      const row={id:randomUUID(),trip_id:p.p_trip_id,status:'OPEN',started_at:p.p_device_at,occurrence_name:'Refeição'};
      state.occurrences.push(row);receipts.set(p.p_operation_id,row);return {data:copy(row)};
    }
    if(name==='offline_sync_pull_occurrence_end'){
      if(api.failEndOnce){api.failEndOnce=false;throw Error('Failed to fetch');}
      const row=state.occurrences.find(row=>row.id===p.p_occurrence_id);
      if(!row)throw Error('OCORRENCIA_NAO_ENCONTRADA');
      row.status='CLOSED';row.ended_at ||= p.p_device_at;return {data:copy(row)};
    }
    if(api.read&&name==='pull_driver_state')return {data:await api.read(),error:null};
    if(name==='pull_driver_state')return {data:copy({...state,trip:state.trip.status==='IN_PROGRESS'?state.trip:null}),error:null};
    if(name==='offline_sync_pull_step'){
      const step=steps.find(s=>s.id===p.p_step_id);
      let event=state.events.find(e=>e.step_id===step.id);
      if(!event){
        const next=steps.find(s=>s.sort_order>Math.max(...state.events.map(e=>e.step_order)));
        if(next.id!==step.id)return {error:{message:'ETAPA_FORA_DE_SEQUENCIA'}};
        event={id:randomUUID(),trip_id:'trip',step_id:step.id,step_order:step.sort_order,action_code:step.action_code,user_id:step.executor_driver===1?'d1':'d2'};
        state.events.push(event);
        const after=steps.find(s=>s.sort_order>step.sort_order);
        state.trip.active_driver_id=after?.executor_driver===2?'d2':'d1';
        if(!after)state.trip.status='ARRIVED';
      }
      if(api.failAfterCommit){api.failAfterCommit=false;throw Error('Failed to fetch');}
      return {data:copy({event,trip:state.trip}),error:null};
    }
    if(name==='submit_pull_checklist')throw Error('Checklist desligado foi consultado');
    throw Error('RPC inesperada '+name);
  };
  api.from=table=>{
    const filters=[];let single=false;
    const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},limit(){return q;},order(){return q;},maybeSingle(){single=true;return q;},then(resolve,reject){
      let data=table==='pull_events'?state.events:table==='pull_trips'?[state.trip]:[];
      data=copy(data.filter(row=>filters.every(([k,v])=>row[k]===v)));
      return Promise.resolve({data:single?(data[0]||null):data,error:null}).then(resolve,reject);
    }};return q;
  };
  return api;
}
function device(backend,user='d1'){
  const stores={queue:new Map(),state:new Map()},elements=new Map(),messages=[],timers=[];
  elements.set('btnPullNextStep',{disabled:false,textContent:''});
  elements.set('pullNextStepHint',{textContent:''});
  const window={APP_CONFIG:{},addEventListener(){}};
  const context={window,document:{addEventListener(){},readyState:'loading',getElementById:id=>elements.get(id)||null,hidden:false},navigator:{onLine:true},prompt:()=>'',
    structuredClone,crypto:{randomUUID},console:{warn(){},info(){},error(){}},Date,Promise,AbortController,
    setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout,clearTimeout,
    backend,stores,elements,messages,testUser:user,testGps:gps,copy};
  const injected=`
    sb=backend;authUser={id:testUser};profile={id:testUser,name:testUser,role:'MOTORISTA_PUXADOR'};
    myUnits=['Matriz Caicó'];activeUnit=myUnits[0];activeView='puxada-viagem';
    pullActiveTrip=copy(backend.state.trip);pullDriverEvents=copy(backend.state.events);
    pullAllMainSteps=copy(backend.state.steps);pullMainSteps=pullAllMainSteps;
    pullOccurrenceTypes=[{id:'meal',name:'Refeição',duration_mode:'INTERVAL',action_code:'OCC_MEAL'}];
    pullSettings=copy(backend.state.settings);
    offlineGetAll=async store=>[...stores[store].values()].map(copy);
    offlineGet=async(store,key)=>copy(stores[store].get(key)||null);
    offlinePut=async(store,value)=>{stores[store].set(value.id||value.key,copy(value));return value;};
    offlineDelete=async(store,key)=>{stores[store].delete(key);};
    updateOnlineStatus=()=>{};renderPullDriver=()=>{};syncPullTracking=async()=>{};
    loadAssignedPullPlans=async()=>{};loadPullTripAttachments=async()=>{};
    refreshPullInvoiceDriver=async()=>{};populatePullReferenceInputs=()=>{};
    captureGps=async()=>testGps;refreshPullGpsTarget=async()=>200;
    isPullDriver=()=>true;hasPerm=code=>code==='PULL_TRIP';
    toast=(...args)=>messages.push(args);
    const deadline=withDeadline;withDeadline=(promise,ms,code)=>deadline(promise,Math.max(10,ms/150),code);
    window.flowTest={
      record:()=>recordPullNextStep(),load:()=>loadPullActiveTrip(true),sync:pullOnly=>syncOfflineQueue({silent:true,pullOnly}),
      startMeal:()=>onPullOccurrenceClick({target:{closest:()=>({dataset:{occ:'meal'},disabled:false})}}),
      endMeal:()=>onPullOpenOccurrenceClick({target:{closest:()=>({dataset:{endOcc:pullDriverOccurrences[0]?.id},disabled:false})}}),
      next:()=>pullNextStep(),queue:()=>offlineQueueRows(),merge:(trip,events)=>pullEventsWithPendingSteps(trip,events),
      restore:options=>restorePullOfflineSnapshot(options),snapshot:()=>cachePullOfflineSnapshot(),
      state:()=>copy({trip:pullActiveTrip,events:pullDriverEvents,occurrences:pullDriverOccurrences,busy:pullStepActionPending}),
      setCapture:fn=>{captureGps=fn;},setRead:fn=>{fetchPullDriverState=fn;},
      setProcess:fn=>{processOfflineRecord=fn;},setRefresh:fn=>{refreshPullGpsTarget=fn;},
      setChecklist:enabled=>{pullSettings.checklist_enabled=enabled;},
      setTrip:trip=>{pullActiveTrip=copy(trip);},setOccurrences:rows=>{pullDriverOccurrences=copy(rows);},
      mergeOccurrences:rows=>pullOccurrencesWithPending(pullActiveTrip,rows),
      rawProcess:processOfflineRecord,rawRead:fetchPullDriverState,
      reconcile:row=>reconcilePullStepQueueRow(row),queueAdd:(type,payload)=>offlineQueueAdd(type,payload),
      pending:()=>offlinePendingCount(),revision:()=>pullFlowRevision
    };
  `;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,injected+'})();'),context,{timeout:3000});
  return {api:window.flowTest,context,stores,backend,messages,timers};
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));

test('dois celulares percorrem as dez etapas e liberam cada troca com checklist desativado',async()=>{
  const backend=server(),one=device(backend),two=device(backend,'d2');
  for(let i=1;i<steps.length;i++){
    const d=steps[i].executor_driver===1?one:two;
    assert.equal(await d.api.load(),true);
    assert.equal(d.api.next().id,steps[i].id);
    await d.api.record();
    assert.equal(d.stores.queue.size,0);
    assert.equal(d.api.state().busy,false);
    assert.equal(backend.state.events.length,i+1);
  }
  assert.equal(backend.state.trip.status,'ARRIVED');
  assert.ok(!backend.calls.includes('submit_pull_checklist'));
  assert.ok(!backend.calls.includes('pull_checklist_requirements'));
});
test('salva offline, preserva após recarga e libera o outro celular depois do envio',async()=>{
  const backend=server(),one=device(backend),two=device(backend,'d2');
  one.context.navigator.onLine=false;await one.api.record();
  assert.equal(one.api.next().id,'s3');assert.equal(one.stores.queue.size,1);
  await one.api.restore();assert.equal(one.api.next().id,'s3');
  await two.api.load();assert.equal(two.api.next().id,'s2');
  one.context.navigator.onLine=true;await one.api.sync(true);await two.api.load();
  assert.equal(two.api.next().id,'s3');assert.equal(one.stores.queue.size,0);
});
test('resposta perdida após commit confirma a mesma etapa e não duplica',async()=>{
  const backend=server(),one=device(backend);backend.failAfterCommit=true;
  await one.api.record();
  assert.equal(backend.state.events.length,2);assert.equal(one.stores.queue.size,0);
  assert.equal(one.api.next().id,'s3');assert.ok(!one.api.state().events.at(-1)._offline);
});
test('sincronização de fotos presa não bloqueia envio de etapa',async()=>{
  const backend=server(),one=device(backend);
  await one.api.queueAdd('PULL_ATTACHMENT',{trip_id:'trip'});
  const real=one.api.rawProcess;
  one.api.setProcess(row=>row.type==='PULL_ATTACHMENT'?new Promise(()=>{}):real(row));
  const photos=one.api.sync(false);await pause();
  await one.api.record();assert.equal(backend.state.events.length,2);
  assert.ok(!(await one.api.queue()).some(row=>row.type==='PULL_STEP'));
  await photos;
});
test('fila antiga de checklist desligado não é enviada nem impede as etapas',async()=>{
  const backend=server(),one=device(backend);
  await one.api.queueAdd('PULL_CHECKLIST',{p_trip_id:'trip',p_checkpoint_code:'D1_START'});
  assert.equal(await one.api.pending(),0);
  await one.api.record();assert.equal(backend.state.events.length,2);
  assert.equal(one.stores.queue.size,1);assert.equal(await one.api.pending(),0);
  one.api.setChecklist(true);assert.equal(await one.api.pending(),1);
});
test('recarga antiga iniciada antes do clique não faz a etapa regressar',async()=>{
  const backend=server(),one=device(backend),stale=copy(backend.state);let resolve;
  one.api.setRead(()=>new Promise(r=>{resolve=r;}));
  const read=one.api.load();await pause();
  one.context.navigator.onLine=false;await one.api.record();
  resolve(stale);await read;assert.equal(one.api.next().id,'s3');
  assert.equal(one.api.state().events.length,2);
});
test('duplo clique durante captura registra um único envelope',async()=>{
  const backend=server(),one=device(backend);let resolve;
  one.api.setCapture(()=>new Promise(r=>{resolve=r;}));
  const first=one.api.record();await pause();await one.api.record();resolve(gps);await first;
  assert.equal(backend.calls.filter(x=>x==='offline_sync_pull_step').length,1);
});
test('troca da viagem durante GPS não atribui a etapa a outro ciclo',async()=>{
  const backend=server(),one=device(backend);let resolve;
  one.api.setCapture(()=>new Promise(r=>{resolve=r;}));
  const first=one.api.record();await pause();one.api.setTrip({...backend.state.trip,id:'other'});
  resolve(gps);await first;assert.equal(one.stores.queue.size,0);
  assert.equal(backend.state.events.length,1);assert.equal(one.api.state().busy,false);
});
test('resposta vazia de RPC não faz desaparecer a etapa local',async()=>{
  const backend=server(),one=device(backend);
  const real=backend.rpc;backend.rpc=(name,p)=>name==='offline_sync_pull_step'?Promise.resolve({data:null,error:null}):real(name,p);
  await one.api.record();assert.equal(one.stores.queue.size,1);
  assert.equal(one.api.next().id,'s3');assert.equal(one.api.state().busy,false);
});
test('falha ao atualizar o catálogo não restaura a etapa antiga da viagem',async()=>{
  const backend=server(),one=device(backend);await one.api.snapshot();
  one.context.navigator.onLine=false;await one.api.record();
  await one.api.restore({referencesOnly:true});assert.equal(one.api.next().id,'s3');
});
test('fim de ocorrência offline continua fechado após atualização do servidor',async()=>{
  const backend=server(),one=device(backend);
  const row={id:'occ1',trip_id:'trip',status:'OPEN',started_at:gps.capturedAt};
  await one.api.queueAdd('PULL_OCC_END',{p_occurrence_id:'occ1',p_device_at:gps.capturedAt});
  const merged=await one.api.mergeOccurrences([row]);assert.equal(merged[0].status,'CLOSED');
});
test('requisição que não responde libera o botão e conserva o envelope para tentar novamente',async()=>{
  const backend=server(),one=device(backend),real=backend.rpc;
  backend.rpc=(name,p)=>name==='offline_sync_pull_step'?new Promise(()=>{}):real(name,p);
  await one.api.record();assert.equal(one.api.state().busy,false);
  assert.equal(one.stores.queue.size,1);assert.equal(one.api.next().id,'s3');
  backend.rpc=real;await one.api.sync(true);assert.equal(one.stores.queue.size,0);
});
test('envelopes criados no mesmo milissegundo mantêm a ordem após reiniciar a leitura',async()=>{
  const one=device(server());
  const a=await one.api.queueAdd('PULL_OCC_START',{p_trip_id:'trip'});
  const b=await one.api.queueAdd('PULL_OCC_END',{p_occurrence_id:'local-occ'});
  const c=await one.api.queueAdd('PULL_STEP',{p_trip_id:'trip',p_step_id:'s2'});
  // IndexedDB devolve getAll em ordem de chave primária (UUID), não de inserção.
  one.stores.queue=new Map([[c.id,c],[a.id,a],[b.id,b]]);
  assert.equal((await one.api.queue()).map(row=>row.id).join(','),[a.id,b.id,c.id].join(','));
});
test('consulta automática detecta troca de motorista mesmo sem evento do websocket',async()=>{
  const backend=server(),one=device(backend),two=device(backend,'d2');
  await one.api.record();
  for(const tick of two.timers)await tick();
  assert.equal(two.api.next().id,'s3');
});
test('refeição iniciada e encerrada offline sincroniza antes da próxima etapa',async()=>{
  const backend=server(),one=device(backend);one.context.navigator.onLine=false;
  await one.api.startMeal();assert.equal(one.api.state().occurrences[0].status,'OPEN');
  await one.api.endMeal();assert.equal(one.api.state().occurrences[0].status,'CLOSED');
  await one.api.record();assert.equal(one.stores.queue.size,3);
  one.context.navigator.onLine=true;await one.api.sync(true);
  assert.equal(one.stores.queue.size,0);assert.equal(backend.state.occurrences[0].status,'CLOSED');
  assert.equal(backend.state.events.length,2);
});
test('falha ao enviar fim da refeição não reabre ocorrência ao atualizar',async()=>{
  const backend=server(),one=device(backend);
  await one.api.startMeal();backend.failEndOnce=true;await one.api.endMeal();
  assert.equal(backend.state.occurrences[0].status,'OPEN');
  await one.api.load();assert.equal(one.api.state().occurrences[0].status,'CLOSED');
  await one.api.record();
  assert.equal(one.stores.queue.size,0);assert.equal(backend.state.occurrences[0].status,'CLOSED');
  assert.equal(backend.state.events.length,2);
});
