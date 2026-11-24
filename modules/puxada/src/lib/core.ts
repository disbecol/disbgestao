export type LocationStatus = 'Captured' | 'TimedOut' | 'Denied' | 'Unavailable';
export interface Location { latitude:number; longitude:number; accuracy?:number|null; capturedAt:string; source:'GPS'|'Manual' }
export interface Step { key:string; label:string; order:number; executor:1|2; responsibleUserId?:string; responsibleName?:string }
export interface TripEvent { id:string; stageKey:string; label:string; order:number; userId:string; userName:string; occurredAt:string; receivedAt?:string|null; location:Location|null; locationStatus:LocationStatus; locationCorrections?:unknown[]; local?:boolean }
export interface Occurrence { id:string; type:string; label:string; note?:string; status:string; userId:string; userName:string; startedAt:string; endedAt?:string|null; startLocation?:Location|null; endLocation?:Location|null; local?:boolean; [key:string]:unknown }
export interface TripSnapshot {
  id:string; code:string; unitId:string; unitName:string; type:string; status:string; plate:string; carrier:string; destination:string;
  driver1Id:string; driver1Name:string; driver2Id?:string|null; driver2Name?:string|null; solo:boolean; revision:number; workflowVersion:number|string;
  steps:Step[]; events:TripEvent[]; occurrences:Occurrence[]; checklists:any[]; attachments:any[]; invoices:any[]; routePoints:any[];
  nextStep?:Step|null; pendingChecklist?:any|null; imported?:boolean; weekPosition?:string|null; startedAt?:string; endedAt?:string|null;
  localPending?:boolean; pendingCompletion?:boolean; [key:string]:any;
}
export type CommandKind = 'RECORD_STEP'|'START_OCCURRENCE'|'END_OCCURRENCE'|'SUBMIT_CHECKLIST';
export interface CommandPayload {
  kind:CommandKind; stageKey?:string; occurrenceId?:string; occurrenceType?:string; note?:string; checkpoint?:string; odometerKm?:number; answers?:unknown[];
  location?:Location|null; locationStatus?:LocationStatus; occurredAt?:string; commandId?:string; dependsOnCommandIds?:string[];
}
export interface TripCommand extends CommandPayload { commandId:string; deviceId:string; deviceSequence:number; occurredAt:string; dependsOnCommandIds:string[]; location:Location|null; locationStatus:LocationStatus }
export interface CommandReceipt { commandId:string; tripId:string; revision:number; eventId?:string; duplicate:boolean; state:TripSnapshot }
export interface QueueEntry {
  commandId:string; tripId:string; userId:string; kind:CommandKind; lane:'operational'; command:TripCommand;
  status:'PENDING'|'SENDING'|'CONFLICT'; attempts:number; createdAt:string; nextAttemptAt:number; error?:string; errorCode?:string;
}
