import {describe,it,expect} from 'vitest';
import 'fake-indexeddb/auto';
import {TripStore,MemoryPersistence,IndexedDbPersistence,type Transport} from '../src/lib/offline';
import {ApiError} from '../src/lib/api';
import type {TripSnapshot,TripCommand,CommandReceipt} from '../src/lib/core';

const copy=<T>(v:T):T=>structuredClone(v);
const stages=['START_TRIP','ARRIVE_SUPPORT_OUT','DRIVER_SWAP_OUT','ARRIVE_FACTORY','LOADING','CONFERENCE','LEAVE_FACTORY','ARRIVE_SUPPORT_RETURN','DRIVER_SWAP_RETURN','ARRIVE_UNIT'];
function trip(id='trip'):TripSnapshot{
  const steps=stages.map((key,index)=>({key,label:key,order:(index+1)*10,executor:(index<2||index>7?1:2) as 1|2}));
  return {id,code:'PUX-TEST',unitId:'matrix',unitName:'Matriz Caicó',type:'PULL',status:'IN_PROGRESS',plate:'TEST123',carrier:'Teste',destination:'Fábrica',driver1Id:'a',driver1Name:'Um',driver2Id:'b',driver2Name:'Dois',solo:false,revision:1,workflowVersion:1,steps,
    events:[{id:'start',stageKey:stages[0],label:stages[0],order:10,userId:'a',userName:'Um',occurredAt:'2026-11-11T10:00:00Z',receivedAt:'2026-11-11T10:00:00Z',location:null,locationStatus:'Unavailable'}],
    occurrences:[],checklists:[],attachments:[],invoices:[],routePoints:[],nextStep:{...steps[1],responsibleUserId:'a',responsibleName:'Um'},pendingChecklist:null,checklistApplies:false,checklistRequired:false};
}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function until(test:()=>boolean){for(let n=0;n<100;n++){if(test())return;await new Promise(resolve=>setTimeout(resolve,0));}expect(test()).toBe(true);}
class Server {
  states=new Map<string,TripSnapshot>([['trip',trip()]]);receipts=new Map<string,CommandReceipt>();calls:TripCommand[]=[];lost=false;failTrip='';
  transport:Transport={load:async id=>copy(this.states.get(id)!),receipt:async id=>{if(!this.receipts.has(id))throw new ApiError('NOT_FOUND','Not found',undefined,404);return copy(this.receipts.get(id)!);},send:async(id,c)=>{
    this.calls.push(copy(c));if(this.failTrip===id)throw new ApiError('NETWORK','Sem sinal');
    if(this.receipts.has(c.commandId))return copy(this.receipts.get(c.commandId)!);
    const state=copy(this.states.get(id)!);
    if(c.kind==='START_OCCURRENCE')state.occurrences.push({id:c.occurrenceId!,type:c.occurrenceType!,label:'Refeição',status:'OPEN',userId:'a',userName:'Um',startedAt:c.occurredAt});
    else if(c.kind==='END_OCCURRENCE'){const row=state.occurrences.find(x=>x.id===c.occurrenceId);if(!row)throw new ApiError('MISSING_START','Aguarde início',undefined,409);row.status='CLOSED';row.endedAt??=c.occurredAt;}
    else if(c.kind==='RECORD_STEP'){
      if(state.occurrences.some(x=>x.status==='OPEN'))throw new ApiError('OCCURRENCE_OPEN','Encerre refeição',state,409);
      const stage=state.steps.find(step=>!state.events.some(event=>event.stageKey===step.key));if(!stage||stage.key!==c.stageKey)throw new ApiError('STAGE_CONFLICT','Outra etapa',state,409);
      state.events.push({id:crypto.randomUUID(),stageKey:stage.key,label:stage.label,order:stage.order,userId:stage.executor===1?'a':'b',userName:'Motorista',occurredAt:c.occurredAt,receivedAt:new Date().toISOString(),location:c.location,locationStatus:c.locationStatus});
      const next=state.steps.find(step=>!state.events.some(event=>event.stageKey===step.key));state.nextStep=next?{...next,responsibleUserId:next.executor===1?'a':'b',responsibleName:'Motorista'}:null;
      if(!next)state.status='ARRIVED';
    }
    state.revision++;this.states.set(id,state);const receipt={commandId:c.commandId,tripId:id,revision:state.revision,duplicate:false,state:copy(state)};this.receipts.set(c.commandId,receipt);
    if(this.lost){this.lost=false;throw new ApiError('NETWORK','Resposta perdida após commit');}return copy(receipt);
  }};
}
describe('fila operacional durável',()=>{
  it('hand-off entre dois aparelhos só aparece no segundo depois da confirmação no servidor',async()=>{
    const server=new Server();let onlineA=true;const a=new TripStore(new MemoryPersistence(),server.transport,()=>onlineA),b=new TripStore(new MemoryPersistence(),server.transport,()=>true);
    await a.configure('a');await b.configure('b');await a.load('trip');await b.load('trip');onlineA=false;
    const entry=await a.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT',location:null,locationStatus:'TimedOut'});
    expect(a.getSnapshot('trip')!.nextStep!.responsibleUserId).toBe('b');expect(a.pending('trip')).toHaveLength(1);
    await b.load('trip');expect(b.getSnapshot('trip')!.nextStep!.key).toBe('ARRIVE_SUPPORT_OUT');
    await expect(b.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'})).rejects.toMatchObject({code:'WRONG_DRIVER'});
    onlineA=true;await a.sync();await b.load('trip');expect(b.getSnapshot('trip')!.nextStep!.key).toBe('DRIVER_SWAP_OUT');
    expect(server.calls[0].commandId).toBe(entry.commandId);expect(server.calls[0].location).toBeNull();expect(a.pending('trip')).toHaveLength(0);
    await b.enqueue('trip',{kind:'RECORD_STEP',stageKey:'DRIVER_SWAP_OUT'});await b.sync();expect(server.states.get('trip')!.nextStep!.key).toBe('ARRIVE_FACTORY');
  });
  it('IndexedDB preserva fila e projeção ao recarregar; outro usuário tem namespace separado',async()=>{
    const server=new Server(),name='test-'+crypto.randomUUID(),store=new TripStore(new IndexedDbPersistence(name),server.transport,()=>true);
    await store.configure('a');await store.load('trip');const entry=await store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'});
    const restored=new TripStore(new IndexedDbPersistence(name),server.transport,()=>false);await restored.configure('a');
    expect(restored.pending('trip')[0].commandId).toBe(entry.commandId);expect(restored.getSnapshot('trip')!.nextStep!.key).toBe('DRIVER_SWAP_OUT');
    await restored.configure('b');expect(restored.listPending()).toEqual([]);expect(restored.getSnapshot('trip')).toBeNull();
    await restored.configure('a');expect(restored.pending('trip')).toHaveLength(1);
  });
  it('migração IndexedDB v1→v2 conserva bytes do comando, identidade e pendências de envio',async()=>{
    const server=new Server(),memory=new MemoryPersistence(),previous=new TripStore(memory,server.transport,()=>true);await previous.configure('a');await previous.load('trip');const entry=await previous.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'});
    const data=(await memory.read('a'))!;delete data.schemaVersion;data.queue[entry.commandId].status='SENDING';data.queue[entry.commandId].attempts=1;const frozen=JSON.stringify(data.queue[entry.commandId].command),name='upgrade-'+crypto.randomUUID();
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('users');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('users','readwrite');tx.objectStore('users').put(data,'a');tx.oncomplete=()=>{db.close();resolve();};};});
    const restored=new TripStore(new IndexedDbPersistence(name),server.transport,()=>false);await restored.configure('a');const row=restored.pending('trip')[0];expect(JSON.stringify(row.command)).toBe(frozen);expect(row.status).toBe('PENDING');expect(row.attempts).toBe(1);expect(row.command.deviceId).toBe(data.deviceId);expect(restored.getSnapshot('trip')!.nextStep!.key).toBe('DRIVER_SWAP_OUT');
  });
  it('falha de persistência não avança, não limpa o registro e não chama servidor',async()=>{
    const memory=new MemoryPersistence(),server=new Server();let fail=false;
    const persistence={read:memory.read.bind(memory),update:async(...args:Parameters<MemoryPersistence['update']>)=>{if(fail)throw new Error('QuotaExceededError');return memory.update(...args);}};
    const store=new TripStore(persistence,server.transport,()=>true);await store.configure('a');await store.load('trip');fail=true;
    await expect(store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'})).rejects.toThrow('QuotaExceededError');
    expect(store.getSnapshot('trip')!.events).toHaveLength(1);expect(store.pending('trip')).toHaveLength(0);expect(server.calls).toHaveLength(0);
  });
  it('resposta perdida após commit consulta recibo e não repete o evento ou muda envelope',async()=>{
    const server=new Server(),store=new TripStore(new MemoryPersistence(),server.transport,()=>true);await store.configure('a');await store.load('trip');
    const row=await store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'});server.lost=true;await store.sync();
    expect(store.pending('trip')).toHaveLength(1);expect(server.states.get('trip')!.events).toHaveLength(2);
    await store.retry(row.commandId);expect(server.calls).toHaveLength(1);expect(store.pending('trip')).toHaveLength(0);expect(store.getSnapshot('trip')!.events).toHaveLength(2);
  });
  it('refeição start/end e etapa offline respeitam dependências e o fechamento não reabre em snapshot antigo',async()=>{
    const server=new Server();let online=true;const store=new TripStore(new MemoryPersistence(),server.transport,()=>online);await store.configure('a');await store.load('trip');online=false;
    const start=await store.enqueue('trip',{kind:'START_OCCURRENCE',occurrenceType:'MEAL'});const id=start.command.occurrenceId!;
    await expect(store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'})).rejects.toMatchObject({code:'OCCURRENCE_OPEN'});
    const end=await store.enqueue('trip',{kind:'END_OCCURRENCE',occurrenceId:id});const step=await store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'});
    expect(end.command.dependsOnCommandIds).toContain(start.commandId);expect(step.command.dependsOnCommandIds).toEqual([start.commandId,end.commandId]);
    expect(store.getSnapshot('trip')!.occurrences[0].status).toBe('CLOSED');online=true;await store.load('trip');expect(store.getSnapshot('trip')!.occurrences[0].status).toBe('CLOSED');
    await store.sync();expect(server.calls.map(c=>c.kind)).toEqual(['START_OCCURRENCE','END_OCCURRENCE','RECORD_STEP']);expect(server.states.get('trip')!.occurrences[0].id).toBe(id);expect(store.pending('trip')).toHaveLength(0);
  });
  it('um erro em uma viagem não bloqueia outra; fila mantém a primeira para diagnóstico',async()=>{
    const server=new Server();server.states.set('other',trip('other'));const store=new TripStore(new MemoryPersistence(),server.transport,()=>true);await store.configure('a');await store.load('trip');await store.load('other');
    await store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'});await store.enqueue('other',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'});server.failTrip='trip';await store.sync();
    expect(store.pending('trip')).toHaveLength(1);expect(store.pending('other')).toHaveLength(0);expect(server.states.get('other')!.events).toHaveLength(2);
  });
  it('nenhuma leitura de revisão menor faz a etapa confirmada regredir',async()=>{
    const server=new Server(),original=trip(),store=new TripStore(new MemoryPersistence(),server.transport,()=>true);await store.configure('a');await store.load('trip');await store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'});await store.sync();
    server.states.set('trip',original);await store.load('trip');expect(store.getSnapshot('trip')!.revision).toBe(2);expect(store.getSnapshot('trip')!.events).toHaveLength(2);
  });
  it('duplo clique reaproveita a operação semântica; consumidor não consegue mutar seu envelope',async()=>{
    const server=new Server(),store=new TripStore(new MemoryPersistence(),server.transport,()=>true);await store.configure('a');await store.load('trip');
    const [one,two]=await Promise.all([store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'}),store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'})]);expect(one.commandId).toBe(two.commandId);
    store.pending('trip')[0].command.stageKey='EVIL';expect(store.pending('trip')[0].command.stageKey).toBe('ARRIVE_SUPPORT_OUT');await store.sync();expect(server.calls).toHaveLength(1);
  });
  it('conflito permanece visível, e descarte exige resolver antes os registros dependentes',async()=>{
    const server=new Server(),store=new TripStore(new MemoryPersistence(),server.transport,()=>true);await store.configure('a');await store.load('trip');
    const start=await store.enqueue('trip',{kind:'START_OCCURRENCE',occurrenceType:'MEAL'}),end=await store.enqueue('trip',{kind:'END_OCCURRENCE',occurrenceId:start.command.occurrenceId});
    await expect(store.discard(start.commandId)).rejects.toMatchObject({code:'COMMAND_HAS_DEPENDENTS'});await store.discard(end.commandId);await store.discard(start.commandId);expect(store.pending('trip')).toHaveLength(0);
    const row=await store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'});server.transport.send=async()=>{throw new ApiError('WRONG_DRIVER','Atribuição alterada',undefined,403);};await store.sync();
    expect(store.pending('trip')[0].status).toBe('CONFLICT');expect(store.pending('trip')[0].commandId).toBe(row.commandId);expect(store.getSnapshot('trip')!.events).toHaveLength(1);
  });
  it('snapshot de outra conta que chegou atrasado não entra no namespace novo',async()=>{
    const server=new Server(),wait=deferred<TripSnapshot>(),store=new TripStore(new MemoryPersistence(),{...server.transport,load:()=>wait.promise},()=>true);await store.configure('a');const load=store.load('trip');await Promise.resolve();await store.configure('b');wait.resolve(trip());await load;expect(store.getSnapshot('trip')).toBeNull();
  });
  it('confirmação de envio atrasada após logout não apaga nem publica dados na conta seguinte',async()=>{
    const server=new Server(),memory=new MemoryPersistence(),wait=deferred<CommandReceipt>(),real=server.transport.send;
    const store=new TripStore(memory,{...server.transport,send:async(id,c)=>{const receipt=await real(id,c);await wait.promise;return receipt;}},()=>true);await store.configure('a');await store.load('trip');await store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'});
    const sync=store.sync();await until(()=>server.calls.length===1);await store.configure('b');wait.resolve({} as CommandReceipt);await sync;expect(store.listPending()).toHaveLength(0);expect(store.getSnapshot('trip')).toBeNull();
    await store.configure('a');expect(store.pending('trip')).toHaveLength(1);await store.retry(store.pending('trip')[0].commandId);expect(store.pending('trip')).toHaveLength(0);expect(server.calls).toHaveLength(1);
  });
  it('checklist desligado não cria gates nem exige semana; habilitado usa requisitos congelados',async()=>{
    const server=new Server(),store=new TripStore(new MemoryPersistence(),server.transport,()=>true);await store.configure('a');await store.load('trip');await expect(store.enqueue('trip',{kind:'SUBMIT_CHECKLIST',checkpoint:'D1_START'})).rejects.toMatchObject({code:'CHECKLIST_DISABLED'});
    const state=trip();state.checklistApplies=true;state.checklistRequired=true;state.checklistQuestions=[{id:'q',active:true}];state.checklistRequirements=[{checkpoint:'D1_SUPPORT_OUT',label:'Retorno',driverNo:1,gateStage:'DRIVER_SWAP_OUT',afterAction:'ARRIVE_SUPPORT_OUT'},{checkpoint:'D2_SUPPORT_OUT',label:'Saída',driverNo:2,gateStage:'DRIVER_SWAP_OUT',afterAction:'ARRIVE_SUPPORT_OUT'}];state.revision=2;server.states.set('trip',state);await store.load('trip');
    await store.enqueue('trip',{kind:'RECORD_STEP',stageKey:'ARRIVE_SUPPORT_OUT'});expect(store.getSnapshot('trip')!.pendingChecklist?.checkpoint).toBe('D1_SUPPORT_OUT');
    await expect(store.enqueue('trip',{kind:'SUBMIT_CHECKLIST',checkpoint:'D1_SUPPORT_OUT',odometerKm:100,answers:[{questionId:'q',answer:'NOK'}]})).rejects.toMatchObject({code:'CHECKLIST_INCOMPLETE'});
    await store.enqueue('trip',{kind:'SUBMIT_CHECKLIST',checkpoint:'D1_SUPPORT_OUT',odometerKm:100,answers:[{questionId:'q',answer:'NOK',observation:'Problema observado'}]});expect(store.getSnapshot('trip')!.pendingChecklist?.checkpoint).toBe('D2_SUPPORT_OUT');
  });
});
