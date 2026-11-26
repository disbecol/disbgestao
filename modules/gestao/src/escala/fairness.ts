import type {EscalaState,PlanDay} from './model';
import {holidayRest} from './rest-status.ts';

type Score={privileged:number;mondays:number;saturdays:number;recent:number;reserves:number;days:number[]};
const empty=():Score=>({privileged:0,mondays:0,saturdays:0,recent:0,reserves:0,days:Array(7).fill(0)});
export function restLedger(state:Pick<EscalaState,'holidays'>,history:PlanDay[]){
 const people=new Map<string,Score>();
 function remember(day:PlanDay){const dow=new Date(day.date+'T12:00:00Z').getUTCDay(),seen=new Set<string>();for(const duty of day.duties)for(const p of duty.members){if(seen.has(p.id))continue;seen.add(p.id);const score=people.get(p.id)||empty();people.set(p.id,score);if(duty.mode==='RESERVE')score.reserves++;if(duty.mode!=='REST'||dow===0||holidayRest(state,day,duty.mode))continue;score.days[dow]++;if(dow===1||dow===6){score.privileged++;score.mondays+=Number(dow===1);score.saturdays+=Number(dow===6);score.recent=Date.parse(day.date)/86400000;}}}
 for(const day of history)remember(day);
 function score(ids:string[],dow:number){const rows=ids.map(id=>people.get(id)||empty()),n=rows.length||1;return {privileged:rows.reduce((n,s)=>n+s.privileged,0)/n,mondays:rows.reduce((n,s)=>n+s.mondays,0)/n,saturdays:rows.reduce((n,s)=>n+s.saturdays,0)/n,recent:rows.reduce((n,s)=>n+s.recent,0)/n,reserves:rows.reduce((n,s)=>n+s.reserves,0)/n,same:rows.reduce((n,s)=>n+s.days[dow],0)/n};}
 return {remember,score};
}
