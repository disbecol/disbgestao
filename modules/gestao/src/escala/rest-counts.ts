import type {EscalaState,MonthPlan,PersonSnapshot} from './model';
import {holidayRest} from './rest-status.ts';
import {manualCrew} from './crew-policy.ts';
import {dailyPeople} from './person-policy.ts';

export type RestCount={person:PersonSnapshot;days:number[];holidays:number;total:number;privileged:number;preserved:boolean};
export function monthlyRestCounts(state:EscalaState,plan:MonthPlan):RestCount[]{
 const rows=new Map<string,RestCount>();
 for(const day of plan.days){const dow=new Date(day.date+'T12:00:00Z').getUTCDay();for(const duty of dailyPeople(day)){const person=duty.person;let row=rows.get(person.id);if(!row){row={person,days:Array(7).fill(0),holidays:0,total:0,privileged:0,preserved:false};rows.set(person.id,row);}row.person=person;row.preserved ||= !!duty.fixed_team_id&&manualCrew(state,duty.fixed_team_id,plan.month);if(duty.mode!=='REST')continue;row.total++;if(holidayRest(state,day,duty.mode))row.holidays++;else{row.days[dow]++;if(dow===1||dow===6)row.privileged++;}}}
 return [...rows.values()].sort((a,b)=>a.person.name.localeCompare(b.person.name,'pt-BR'));
}
