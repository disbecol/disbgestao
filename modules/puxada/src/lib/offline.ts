import {api,ApiError} from './api';
import type {CommandPayload,CommandReceipt,QueueEntry,TripCommand,TripSnapshot,Step} from './core';
export type {CommandPayload,CommandReceipt,QueueEntry,TripCommand,TripSnapshot} from './core';
export interface UserData {schemaVersion?:number;deviceId:string;sequence:number;snapshots:Record<string,TripSnapshot>;queue:Record<string,QueueEntry>}
export interface Persistence {read(userId:string):Promise<UserData|null>;update(userId:string,mutate:(data:UserData)=>void):Promise<UserData>}
const clone=<T>(value:T):T=>structuredClone(value);
const empty=():UserData=>({schemaVersion:2,deviceId:crypto.randomUUID(),sequence:0,snapshots:{},queue:{}});
function migrateUser(value:UserData|undefined):UserData{
  const data=value||empty();data.schemaVersion=2;data.snapshots??={};data.queue??={};data.deviceId||=crypto.randomUUID();
  data.sequence=Math.max(Number(data.sequence)||0,...Object.values(data.queue).map(entry=>Number(entry.command?.deviceSequence)||0));
  // Never rewrite an already durable command: its exact body is its idempotency key contract.
  for(const entry of Object.values(data.queue)){entry.attempts??=0;entry.nextAttemptAt??=0;entry.lane='operational';entry.kind=entry.command.kind;}
  return data;
}

export class IndexedDbPersistence implements Persistence {
  private connection?:Promise<IDBDatabase>;
  constructor(private name='disbgestao-puxada-offline-v1'){}
  private db(){return this.connection??=new Promise<IDBDatabase>((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new ApiError('STORAGE_UNAVAILABLE','O armazenamento local não está disponível.'));return;}
    const request=indexedDB.open(this.name,2);request.onupgradeneeded=()=>{
      const database=request.result;if(!database.objectStoreNames.contains('users'))database.createObjectStore('users');
      if(!database.objectStoreNames.contains('meta'))database.createObjectStore('meta');
      request.transaction!.objectStore('meta').put({schemaVersion:2},'schema');
    };
    request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Feche as outras abas para atualizar o armazenamento.'));request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
  });}
  async read(userId:string){const db=await this.db();return new Promise<UserData|null>((resolve,reject)=>{
    const transaction=db.transaction('users','readonly'),request=transaction.objectStore('users').get(userId);let result:UserData|null=null;
    request.onsuccess=()=>{result=request.result||null;};transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });}
  async update(userId:string,mutate:(data:UserData)=>void){const db=await this.db();return new Promise<UserData>((resolve,reject)=>{
    const transaction=db.transaction('users','readwrite'),store=transaction.objectStore('users'),request=store.get(userId);let result:UserData;let thrown:unknown;
    request.onsuccess=()=>{try{result=migrateUser(request.result);mutate(result);store.put(result,userId);}catch(error){thrown=error;transaction.abort();}};
    transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(thrown||transaction.error);transaction.onabort=()=>reject(thrown||transaction.error);
  });}
}
/** Testable transactional adapter; never selected by the production singleton. */
export class MemoryPersistence implements Persistence {
  private rows=new Map<string,UserData>();private writes=Promise.resolve();
  async read(owner:string){await this.writes;return clone(this.rows.get(owner)||null);}
  async update(owner:string,mutate:(data:UserData)=>void){let result!:UserData;const write=this.writes.catch(()=>{}).then(()=>{const row=clone(this.rows.get(owner)||empty());mutate(row);this.rows.set(owner,row);result=clone(row);});this.writes=write;await write;return result;}
}
export interface Transport {load(tripId:string):Promise<TripSnapshot>;send(tripId:string,command:TripCommand):Promise<CommandReceipt>;receipt?(commandId:string):Promise<CommandReceipt>}
const defaultTransport:Transport={load:id=>api.get('/trips/'+id),send:(id,command)=>api.post('/trips/'+id+'/commands',command),receipt:id=>api.get('/commands/'+id)};
const ordered=(entries:QueueEntry[])=>entries.sort((a,b)=>a.command.deviceSequence-b.command.deviceSequence||a.commandId.localeCompare(b.commandId));
const semantic=(command:CommandPayload)=>command.kind==='RECORD_STEP'?'STEP:'+command.stageKey:command.kind==='SUBMIT_CHECKLIST'?'CHECK:'+command.checkpoint:command.kind+':'+command.occurrenceId;
const userName=(state:TripSnapshot,owner:string)=>owner===state.driver1Id?state.driver1Name:state.driver2Name||'Motorista';
function nextStep(state:TripSnapshot):Step|null {
  const done=new Set(state.events.map(event=>event.stageKey)),step=[...state.steps].sort((a,b)=>a.order-b.order).find(stage=>!done.has(stage.key));
  if(!step)return null;const one=state.solo||step.executor===1;
  return {...step,responsibleUserId:one?state.driver1Id:state.driver2Id||undefined,responsibleName:one?state.driver1Name:state.driver2Name||undefined};
}
function refreshChecklist(state:TripSnapshot){
  if(state.checklistApplies===false||state.checklistRequired===false){state.pendingChecklist=null;return;}
  if(!Array.isArray(state.checklistRequirements))return;
  const last=[...state.events].sort((a,b)=>a.order-b.order).at(-1)?.stageKey;
  state.pendingChecklist=state.checklistRequirements.find((gate:any)=>gate.gateStage===state.nextStep?.key&&(!gate.afterAction||gate.afterAction===last)&&!state.checklists.some(run=>run.checkpoint===gate.checkpoint))||null;
}
/** Server snapshot plus durable commands; stale reads cannot reopen a local close. */
export function projectTrip(server:TripSnapshot,entries:QueueEntry[],owner:string):TripSnapshot {
  const state=clone(server);let projected=false;const blocked=new Set<string>();refreshChecklist(state);
  for(const entry of ordered([...entries])){
    if(entry.status==='CONFLICT'||entry.command.dependsOnCommandIds.some(id=>blocked.has(id))){blocked.add(entry.commandId);continue;}const c=entry.command;
    if(c.kind==='RECORD_STEP'){
      if(state.events.some(event=>event.stageKey===c.stageKey))continue;
      const next=nextStep(state);if(!next||next.key!==c.stageKey||next.responsibleUserId!==owner||state.occurrences.some(row=>row.status==='OPEN'))continue;
      state.events.push({id:'local:'+c.commandId,stageKey:next.key,label:next.label,order:next.order,userId:owner,userName:userName(state,owner),occurredAt:c.occurredAt,receivedAt:null,location:c.location,locationStatus:c.locationStatus,local:true});
      state.nextStep=nextStep(state);if(!state.nextStep){state.pendingCompletion=true;state.endedAt=c.occurredAt;}projected=true;refreshChecklist(state);
    }else if(c.kind==='START_OCCURRENCE'){
      if(state.occurrences.some(row=>row.id===c.occurrenceId))continue;
      if(state.occurrences.some(row=>row.status==='OPEN'))continue;
      state.occurrences.push({id:c.occurrenceId!,type:c.occurrenceType||'',label:c.occurrenceType||'Ocorrência',note:c.note,status:'OPEN',userId:owner,userName:userName(state,owner),startedAt:c.occurredAt,startLocation:c.location,local:true});projected=true;
    }else if(c.kind==='END_OCCURRENCE'){
      const row=state.occurrences.find(occurrence=>occurrence.id===c.occurrenceId);if(!row||row.status==='CLOSED')continue;
      Object.assign(row,{status:'CLOSED',endedAt:c.occurredAt,endLocation:c.location,local:true});projected=true;
    }else if(c.kind==='SUBMIT_CHECKLIST'&&state.pendingChecklist){
      state.checklists.push({id:'local:'+c.commandId,checkpoint:c.checkpoint,odometerKm:c.odometerKm,answers:c.answers,local:true});state.pendingChecklist=null;projected=true;refreshChecklist(state);
    }
  }
  state.localPending=entries.length>0;if(!projected&&!state.nextStep&&state.status==='IN_PROGRESS')state.nextStep=nextStep(state);
  return state;
}

export class TripStore {
  private owner='';private epoch=0;private data:UserData|null=null;private snapshots=new Map<string,TripSnapshot>();private listeners=new Set<()=>void>();
  private ready:Promise<void>=Promise.resolve();private syncing=new Map<string,Promise<void>>();private loadVersion=new Map<string,number>();
  constructor(private persistence:Persistence=new IndexedDbPersistence(),private transport:Transport=defaultTransport,private online=()=>typeof navigator==='undefined'||navigator.onLine,private now=()=>Date.now()){}
  configure(userId:string|null){const owner=userId||'';if(owner===this.owner)return this.ready;this.owner=owner;const epoch=++this.epoch;this.data=null;this.snapshots.clear();this.emit();
    this.ready=(async()=>{if(!owner)return;const row=await this.persistence.update(owner,data=>{for(const entry of Object.values(data.queue))if(entry.status==='SENDING')entry.status='PENDING';});if(epoch!==this.epoch)return;this.accept(row);})();return this.ready;
  }
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  getSnapshot=(tripId:string)=>this.snapshots.get(tripId)||null;
  pending(tripId:string){return clone(ordered(Object.values(this.data?.queue||{}).filter(entry=>entry.tripId===tripId)));}
  listPending(){return clone(ordered(Object.values(this.data?.queue||{})));}
  private emit(){for(const listener of this.listeners)listener();}
  private accept(data:UserData){this.data=clone(data);this.snapshots.clear();for(const [id,state] of Object.entries(data.snapshots))this.snapshots.set(id,projectTrip(state,this.pending(id),this.owner));this.emit();}
  private async mutate(mutate:(data:UserData)=>void){const owner=this.owner,epoch=this.epoch;if(!owner)throw new ApiError('UNAUTHORIZED','Entre para acessar suas viagens.');await this.ready;const data=await this.persistence.update(owner,mutate);if(epoch===this.epoch)this.accept(data);return data;}
  async load(tripId:string){await this.ready;if(!this.owner)throw new ApiError('UNAUTHORIZED','Entre para acessar suas viagens.');if(!this.online())return this.getSnapshot(tripId);
    const owner=this.owner,epoch=this.epoch,generation=(this.loadVersion.get(tripId)||0)+1;this.loadVersion.set(tripId,generation);
    const incoming=await this.transport.load(tripId);if(owner!==this.owner||epoch!==this.epoch||generation!==this.loadVersion.get(tripId))return this.getSnapshot(tripId);
    if(incoming.id!==tripId||!Number.isSafeInteger(incoming.revision))throw new ApiError('INVALID_STATE','O estado da viagem não pôde ser confirmado.');
    await this.mutate(data=>{const current=data.snapshots[tripId];if(!current||incoming.revision>=current.revision)data.snapshots[tripId]=clone(incoming);});return this.getSnapshot(tripId);
  }
  async enqueue(tripId:string,payload:CommandPayload):Promise<QueueEntry>{await this.ready;const owner=this.owner;if(!owner)throw new ApiError('UNAUTHORIZED','Entre para registrar etapas.');let queued!:QueueEntry;
    payload=clone(payload);if(payload.kind==='START_OCCURRENCE'&&!payload.occurrenceId)payload.occurrenceId=crypto.randomUUID();
    await this.mutate(data=>{
      const existing=Object.values(data.queue).find(entry=>entry.tripId===tripId&&semantic(entry.command)===semantic(payload));if(existing){queued=clone(existing);return;}
      const server=data.snapshots[tripId];if(!server)throw new ApiError('TRIP_NOT_LOADED','Carregue a viagem com internet antes de continuar.');
      const prior=ordered(Object.values(data.queue).filter(entry=>entry.tripId===tripId));const state=projectTrip(server,prior,owner);
      if(state.status!=='IN_PROGRESS'||state.imported)throw new ApiError('TRIP_NOT_ACTIVE','Esta viagem não está disponível para novos registros.');
      if(prior.some(entry=>entry.status==='CONFLICT'))throw new ApiError('PENDING_CONFLICT','Resolva a pendência desta viagem antes de continuar.');
      if(payload.kind==='RECORD_STEP'){
        if(state.nextStep?.key!==payload.stageKey)throw new ApiError('STAGE_CONFLICT','Atualize a viagem: esta não é a próxima etapa.',state,409);
        if(state.nextStep?.responsibleUserId!==owner)throw new ApiError('WRONG_DRIVER','Esta etapa pertence ao outro motorista.',state,403);
        if(state.occurrences.some(row=>row.status==='OPEN'))throw new ApiError('OCCURRENCE_OPEN','Encerre a ocorrência antes de continuar.',state,409);
        if(state.pendingChecklist)throw new ApiError('CHECKLIST_PENDING','Preencha o checklist antes de continuar.',state,409);
      }
      if(payload.kind==='SUBMIT_CHECKLIST'&&!state.pendingChecklist)throw new ApiError('CHECKLIST_DISABLED','Não há checklist exigido nesta etapa.');
      if(payload.kind==='SUBMIT_CHECKLIST'){
        const gate=state.pendingChecklist,driverId=gate.driverNo===2?state.driver2Id:state.driver1Id;
        if(driverId!==owner)throw new ApiError('WRONG_DRIVER','Este checklist pertence ao outro motorista.');
        if(gate.checkpoint!==payload.checkpoint)throw new ApiError('CHECKLIST_CONFLICT','Atualize o checklist desta etapa.');
        if(!Number.isSafeInteger(payload.odometerKm)||payload.odometerKm!<0)throw new ApiError('INVALID_ODOMETER','Informe uma quilometragem inteira válida.');
        const questions=state.checklistQuestions||state.questions||[];
        for(const question of questions.filter((q:any)=>q.active!==false)){
          const answer=(payload.answers||[]).find((a:any)=>a.questionId===question.id) as any;
          if(!answer||!['OK','NOK'].includes(answer.answer)||answer.answer==='NOK'&&!String(answer.observation||'').trim())throw new ApiError('CHECKLIST_INCOMPLETE','Responda todas as perguntas; descreva cada NOK.');
        }
      }
      if(['START_OCCURRENCE','END_OCCURRENCE'].includes(payload.kind)&&(state.pendingChecklist ? (state.pendingChecklist.driverNo===2?state.driver2Id:state.driver1Id) : state.nextStep?.responsibleUserId)!==owner)throw new ApiError('WRONG_DRIVER','A ocorrência pertence ao motorista responsável por este trecho.');
      if(payload.kind==='START_OCCURRENCE'&&state.occurrences.some(row=>row.status==='OPEN'))throw new ApiError('OCCURRENCE_OPEN','Encerre a ocorrência em andamento.');
      if(payload.kind==='END_OCCURRENCE'&&!state.occurrences.some(row=>row.id===payload.occurrenceId&&row.status==='OPEN'))throw new ApiError('OCCURRENCE_NOT_OPEN','Esta ocorrência já foi encerrada ou não está disponível.');
      const commandId=payload.commandId||crypto.randomUUID();if(data.queue[commandId])throw new ApiError('COMMAND_ID_CONFLICT','Identificador já utilizado por outro registro.');
      const command:TripCommand={...clone(payload),commandId,deviceId:data.deviceId,deviceSequence:++data.sequence,occurredAt:payload.occurredAt||new Date(this.now()).toISOString(),
        occurrenceId:payload.kind==='START_OCCURRENCE'?(payload.occurrenceId||crypto.randomUUID()):payload.occurrenceId,
        dependsOnCommandIds:[...new Set([...(payload.dependsOnCommandIds||[]),...prior.map(entry=>entry.commandId)])],location:payload.location||null,locationStatus:payload.location?payload.locationStatus||'Captured':payload.locationStatus||'Unavailable'};
      queued={commandId,tripId,userId:owner,kind:command.kind,lane:'operational',command,status:'PENDING',attempts:0,createdAt:new Date(this.now()).toISOString(),nextAttemptAt:0};data.queue[commandId]=queued;
    });
    return clone(queued);
  }
  async sync(){await this.ready;if(!this.owner||!this.online())return;const trips=[...new Set(this.listPending().map(entry=>entry.tripId))];await Promise.all(trips.map(id=>this.syncTrip(id)));}
  private syncTrip(tripId:string){const running=this.syncing.get(tripId);if(running)return running;const epoch=this.epoch,owner=this.owner;
    const work=this.drain(tripId,owner,epoch).finally(()=>{if(this.syncing.get(tripId)===work)this.syncing.delete(tripId);});this.syncing.set(tripId,work);return work;
  }
  private async drain(tripId:string,owner:string,epoch:number){
    while(owner===this.owner&&epoch===this.epoch&&this.online()){
      const entry=this.pending(tripId)[0];if(!entry||entry.status==='CONFLICT'||entry.nextAttemptAt>this.now())return;
      await this.mutate(data=>{const row=data.queue[entry.commandId];if(row){row.status='SENDING';row.attempts++;}});
      try{
        let receipt:CommandReceipt|undefined;
        if(entry.attempts>0&&this.transport.receipt){try{receipt=await this.transport.receipt(entry.commandId);}catch(error){if(!(error instanceof ApiError&&error.status===404))throw error;}}
        if(owner!==this.owner||epoch!==this.epoch)return;
        receipt??=await this.transport.send(tripId,clone(entry.command));
        if(receipt.commandId!==entry.commandId||receipt.tripId!==tripId||receipt.state?.id!==tripId||!Number.isSafeInteger(receipt.revision))throw new ApiError('INVALID_RECEIPT','O servidor não confirmou este registro.');
        if(owner!==this.owner||epoch!==this.epoch)return;
        await this.mutate(data=>{const current=data.snapshots[tripId];if(!current||receipt!.state.revision>=current.revision)data.snapshots[tripId]=clone(receipt!.state);delete data.queue[entry.commandId];});
      }catch(error){
        if(owner!==this.owner||epoch!==this.epoch)return;
        const apiError=error instanceof ApiError?error:new ApiError('NETWORK',error instanceof Error?error.message:'Falha de conexão.');
        const conflict=apiError.status>=400&&apiError.status<500&&![401,408,429].includes(apiError.status);
        await this.mutate(data=>{const row=data.queue[entry.commandId];if(!row)return;row.status=conflict?'CONFLICT':'PENDING';row.error=apiError.detail;row.errorCode=apiError.code;row.nextAttemptAt=conflict?0:this.now()+Math.min(30000,1000*2**Math.min(row.attempts,5));
          const state=apiError.state as TripSnapshot|undefined;if(state?.id===tripId&&state.revision>=(data.snapshots[tripId]?.revision||0))data.snapshots[tripId]=clone(state);
        });return;
      }
    }
  }
  async retry(commandId:string){await this.mutate(data=>{const entry=data.queue[commandId];if(entry){entry.status='PENDING';entry.nextAttemptAt=0;entry.error=undefined;entry.errorCode=undefined;}});return this.sync();}
  async discard(commandId:string){await this.mutate(data=>{const entry=data.queue[commandId];if(!entry)return;if(entry.status==='SENDING')throw new ApiError('SEND_IN_PROGRESS','Aguarde a confirmação antes de descartar.');
    const dependent=Object.values(data.queue).some(row=>row.command.dependsOnCommandIds.includes(commandId));if(dependent)throw new ApiError('COMMAND_HAS_DEPENDENTS','Descarte primeiro os registros posteriores que dependem desta ação.');delete data.queue[commandId];});}
}
export const tripStore=new TripStore();
