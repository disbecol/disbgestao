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
    pullStepActionPending:false,
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

test('falha de sincronização online preserva a etapa salva no aparelho',async()=>{
  const from=app.indexOf('recordPullNextStep = async function(){');
  const to=app.indexOf('const renderPullDriverV151=',from);
  const step={id:'step-4',name:'Chegada à fábrica',action_code:'ARRIVE_FACTORY',sort_order:40};
  const next={id:'step-5',name:'Entrou para carregar',sort_order:50,executor_driver:2};
  const button={disabled:false,textContent:''};
  const hint={textContent:'Etapa 4/10'};
  const events=[];
  const trip={id:'trip-86',driver1_id:'driver-1',driver2_id:'driver-2',driver2_name:'Motorista 2'};
  let queued=null,loads=0,usedGpsLimit=null;
  const context={
    pullStepActionPending:false,pullActiveTrip:trip,pullDriverEvents:events,pullDriverOccurrences:[],pullMainSteps:[step,next],
    pullNextStep:()=>step,pullCanExecuteStep:()=>true,$:id=>id==='btnPullNextStep'?button:hint,
    refreshPullGpsTarget:async()=>125,captureGps:async options=>{usedGpsLimit=options.maxAccuracy;return gps;},pendingPullStepOperation:async()=>null,
    offlineQueueAdd:async(type,payload)=>queued={id:'operation-86',type,payload},
    offlineGet:async()=>queued,offlineLocalId:()=> 'local-event-86',
    authUser:{id:'driver-2'},profile:{name:'Motorista 2'},
    cachePullOfflineSnapshot:async()=>{},renderPullDriver:()=>{},syncPullTracking:async()=>{},
    syncOfflineQueue:async()=>false,withDeadline:promise=>promise,loadPullActiveTrip:async()=>{loads++;},
    navigator:{onLine:true},toast:()=>{},console,Date
  };
  vm.createContext(context);
  vm.runInContext(app.slice(from,to),context);
  await context.recordPullNextStep();
  assert.equal(queued.type,'PULL_STEP');
  assert.equal(usedGpsLimit,125);
  assert.equal(events.length,1);
  assert.equal(events[0]._offline,true);
  assert.equal(loads,0);
  assert.equal(button.disabled,false);
});

test('recarga mantém etapas pendentes e não volta à etapa anterior',async()=>{
  const from=app.indexOf('async function pullEventsWithPendingSteps(');
  const to=app.indexOf('const loadPullReferenceDataV151=',from);
  const step={id:'step-4',name:'Chegada à fábrica',action_code:'ARRIVE_FACTORY',sort_order:40,executor_driver:2};
  const next={id:'step-5',sort_order:50,executor_driver:2};
  const trip={id:'trip-86',cycle_type:'PULL',driver2_id:'driver-2',driver2_name:'Motorista 2',active_driver_id:'driver-1'};
  const context={
    offlineQueueRows:async()=>[{id:'operation-86',type:'PULL_STEP',created_at:'2026-10-27T15:17:00Z',payload:{p_trip_id:'trip-86',p_step_id:'step-4',p_device_at:'2026-10-27T15:17:00Z',p_latitude:-6.4,p_longitude:-35.4,p_accuracy:75}}],
    pullActiveTrip:trip,pullDriverEvents:[],pullAllMainSteps:[step,next],
    pullStepsForCycle:()=>[step,next],authUser:{id:'driver-2'},profile:{name:'Motorista 2'}
  };
  vm.createContext(context);
  vm.runInContext(app.slice(from,to),context);
  const events=await context.pullEventsWithPendingSteps(trip,[{id:'server-3',step_id:'step-3',step_order:30}]);
  assert.equal(events.map(event=>event.step_order).join(','),'30,40');
  assert.equal(events[1]._offline,true);
  assert.equal(trip.active_driver_id,'driver-2');
});

test('resposta antiga da viagem não substitui a recarga mais recente',async()=>{
  const from=app.indexOf('loadPullActiveTrip = async function(silent=false){');
  const to=app.indexOf('async function pendingPullStepOperation(',from);
  const resolutions=[];
  const tripQuery={select(){return this;},in(){return this;},eq(){return this;},or(){return this;},order(){return this;},limit(){return this;},maybeSingle(){return new Promise(resolve=>resolutions.push(resolve));}};
  const childQuery={select(){return this;},eq(){return this;},order(){return Promise.resolve({data:[],error:null});}};
  let rendered=0;
  const context={
    pullTripLoadGeneration:0,pullActiveTrip:null,pullMainSteps:[],pullDriverEvents:[],pullDriverOccurrences:[],pullTripAttachments:[],
    isPullDriver:()=>true,navigator:{onLine:true},loadPullReferenceData:async()=>{},
    sb:{from:table=>table==='pull_trips'?tripQuery:childQuery},myUnits:['Matriz Caicó'],authUser:{id:'driver-1'},
    pullEventsWithPendingSteps:async(_trip,events)=>events,pullStepsForCycle:()=>[],
    renderPullDriver:()=>{rendered++;},syncPullTracking:()=>{},
    $:()=>({dataset:{tripId:null}}),loadPullTripAttachments:async()=>{},cachePullOfflineSnapshot:async()=>{},
    offlineIsNetworkError:()=>false,toast:()=>{},console,activeView:'puxada-viagem',loadAssignedPullPlans:async()=>{}
  };
  vm.createContext(context);
  vm.runInContext(app.slice(from,to),context);
  const older=context.loadPullActiveTrip(true);
  const newer=context.loadPullActiveTrip(true);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(resolutions.length,2);
  resolutions[1]({data:{id:'trip-new',cycle_type:'PULL'},error:null});
  await newer;
  resolutions[0]({data:{id:'trip-old',cycle_type:'PULL'},error:null});
  await older;
  assert.equal(context.pullActiveTrip.id,'trip-new');
  assert.equal(rendered,1);
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
