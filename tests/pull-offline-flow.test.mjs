import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const gps={latitude:-6.4,longitude:-35.4,accuracy:25,capturedAt:'2026-10-22T12:00:00.000Z'};

test('etapa sem checklist fica no aparelho e avança para o próximo motorista sem internet',async()=>{
  const from=app.indexOf('recordPullNextStep = async function(){');
  const to=app.indexOf('const renderPullDriverV151=',from);
  assert.ok(from>0&&to>from);
  const step={id:'step-1',name:'Chegada ao ponto de apoio',action_code:'ARRIVE_SUPPORT_OUT',sort_order:2};
  const next={id:'step-2',executor_driver:2,sort_order:3};
  const button={disabled:false,textContent:''};
  const hint={textContent:'Etapa 2/6'};
  const queued=[];
  const events=[];
  const trip={id:'trip-1',driver1_id:'driver-1',driver2_id:'driver-2',driver2_name:'Motorista 2'};
  const context={
    pullActiveTrip:trip,pullDriverEvents:events,pullDriverOccurrences:[],pullMainSteps:[step,next],
    pullNextStep:()=>step,pullCanExecuteStep:()=>true,$:id=>id==='btnPullNextStep'?button:hint,
    refreshPullGpsTarget:async()=>200,captureGps:async()=>gps,
    pendingPullStepOperation:async()=>null,
    offlineQueueAdd:async(type,payload)=>{const row={id:'operation-1',type,payload};queued.push(row);return row;},
    offlineLocalId:()=> 'local-event-1',authUser:{id:'driver-1'},profile:{name:'Motorista 1'},
    cachePullOfflineSnapshot:async()=>{},renderPullDriver:()=>{},syncPullTracking:async()=>{},
    navigator:{onLine:false},toast:()=>{},console,Date
  };
  vm.createContext(context);
  vm.runInContext(app.slice(from,to),context);
  await context.recordPullNextStep();
  assert.equal(queued.length,1);
  assert.equal(queued[0].type,'PULL_STEP');
  assert.equal(queued[0].payload.p_step_id,step.id);
  assert.equal(events[0]._offline,true);
  assert.equal(trip.active_driver_id,'driver-2');
  assert.equal(button.disabled,false);
});

test('ocorrência abre e encerra offline sem depender do servidor',async()=>{
  const from=app.indexOf('async function syncNewPullOccurrence(');
  const to=app.indexOf('async function offlineUploadDamageStorage(',from);
  assert.ok(from>0&&to>from);
  const queued=[];
  const occurrences=[];
  let local=0;
  const button={disabled:false,textContent:'Descanso',dataset:{occ:'occ-step'}};
  const context={
    navigator:{onLine:false},pullActiveTrip:{id:'trip-1'},pullDriverOccurrences:occurrences,
    pullOccurrenceTypes:[{id:'occ-step',name:'Descanso',duration_mode:'INTERVAL',action_code:'REST'}],
    pullNextStep:()=>({id:'next'}),pullIsActiveDriver:()=>true,
    prompt:()=>'',refreshPullGpsTarget:async()=>200,captureGps:async()=>gps,
    offlineLocalId:()=>`local-occ-${++local}`,
    offlineQueueAdd:async(type,payload)=>{queued.push({type,payload});return {id:`operation-${queued.length}`};},
    authUser:{id:'driver-1'},profile:{name:'Motorista 1'},
    cachePullOfflineSnapshot:async()=>{},renderPullDriver:()=>{},toast:()=>{},console
  };
  vm.createContext(context);
  vm.runInContext(app.slice(from,to),context);
  await context.onPullOccurrenceClick({target:{closest:()=>button}});
  assert.equal(occurrences[0].status,'OPEN');
  assert.equal(queued[0].type,'PULL_OCC_START');
  const endButton={disabled:false,textContent:'Encerrar',dataset:{endOcc:occurrences[0].id}};
  await context.onPullOpenOccurrenceClick({target:{closest:()=>endButton}});
  assert.equal(occurrences[0].status,'CLOSED');
  assert.equal(queued[1].type,'PULL_OCC_END');
  assert.equal(queued[1].payload.p_occurrence_id,'local-occ-1');
});
