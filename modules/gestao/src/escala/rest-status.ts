import type {Duty,EscalaState,PlanDay} from './model';

export type AvailabilityKind='available'|'rest'|'holiday-rest'|'unavailable';
export const availabilityLabels:Record<AvailabilityKind,string>={available:'Disponível',rest:'Folga','holiday-rest':'Folga por feriado',unavailable:'Indisponível'};
export const availabilityKinds:AvailabilityKind[]=['available','rest','holiday-rest','unavailable'];
export function holidayRest(state:Pick<EscalaState,'holidays'>,day:Pick<PlanDay,'date'|'kind'>,mode:Duty['mode']):boolean{
 if(mode!=='REST')return false;
 const holidays=state.holidays.filter(h=>h.date===day.date);
 return holidays.length?holidays.some(h=>h.enabled&&h.kind!=='OPTIONAL'&&!h.operates):day.kind==='HOLIDAY';
}
export function availabilityKind(state:Pick<EscalaState,'holidays'>,day:Pick<PlanDay,'date'|'kind'>,mode:Duty['mode']):AvailabilityKind{
 return mode==='REST'?(holidayRest(state,day,mode)?'holiday-rest':'rest'):mode==='UNAVAILABLE'?'unavailable':'available';
}
export const availabilityMark=(kind:AvailabilityKind)=>kind==='available'?'D':kind==='rest'?'F':kind==='holiday-rest'?'FER':'I';
