import type {EscalaState,MonthPlan,PersonSnapshot} from './model';
import {holidayRest} from './rest-status.ts';
import {manualCrew} from './crew-policy.ts';

export type RestCount={person:PersonSnapshot;days:number[];holidays:number;total:number;privileged:number;preserved:boolean};
export function monthlyRestCounts(state:EscalaState,plan:MonthPlan):RestCount[]{
 const rows=new Map<string,RestCount>();
 for(const day of plan.days){const seen=new Set<string>(),dow=new Date(day.date+'T12:00:00Z').getUTCDay();for(const duty of day.duties)for(const person of duty.members){if(seen.has(person.id))continue;seen.add(person.id);let row=rows.get(person.id);if(!row){row={person,days:Array(7).fill(0),holidays:0,total:0,privileged:0,preserved:false};rows.set(person.id,row);}row.person=person;row.preserved ||= manualCrew(state,duty.team_id,plan.month);if(duty.mode!=='REST')continue;row.total++;if(holidayRest(state,day,duty.mode))row.holidays++;else{row.days[dow]++;if(dow===1||dow===6)row.privileged++;}}}
 return [...rows.values()].sort((a,b)=>a.person.name.localeCompare(b.person.name,'pt-BR'));
}
