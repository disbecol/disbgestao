import type {EscalaState,MonthPlan,PlanDay} from './model';
import {monthWeeks,weekDates} from './weeks.ts';
import {availabilityKind,type AvailabilityKind} from './rest-status.ts';
import {personAt} from './person-policy.ts';

export type CalendarSource={state:EscalaState;plan:MonthPlan|null};
export function comparisonWeeks(view:CalendarSource,person:string,adjacent:CalendarSource[]=[]){
 if(!view.plan)return [];
 const known=new Map<string,{state:EscalaState;day:PlanDay}>();
 for(const source of [view,...adjacent])for(const day of [...(source.state.rotation_history||[]),...source.state.history])known.set(day.date,{state:source.state,day});
 for(const source of [...adjacent,view])for(const day of source.plan?.days||[])known.set(day.date,{state:source.state,day});
 return monthWeeks(view.plan.month).map(start=>{
  const dates=weekDates(start).map(date=>{
   const record=known.get(date),duty=personAt(record?.day,person);
   const kind:AvailabilityKind|null=record&&duty?availabilityKind(record.state,record.day,duty.mode):null;
   return {date,kind,outside:!date.startsWith(view.plan!.month.slice(0,7))};
  });
  const missing=dates.filter(d=>!d.kind).length,off=dates.filter(d=>d.kind==='rest'||d.kind==='holiday-rest').length,unavailable=dates.filter(d=>d.kind==='unavailable').length;
  const sundayWork=dates[6].kind==='available',insufficient=!missing&&!unavailable&&off<2;
  return {start,dates,missing,off,unavailable,invalid:sundayWork||insufficient,sundayWork};
 });
}
