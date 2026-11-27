import type {EscalaState,Rules} from './model';
import {weekday} from './engine.ts';
export type StaffingGoal={drivers?:number;helpers?:number};
export type DailyStaffing={weekdays:Record<string,StaffingGoal>;dates:Record<string,StaffingGoal>};
export const emptyStaffing=():DailyStaffing=>({weekdays:{},dates:{}});
export function staffingGoal(rules:Pick<Rules,'daily_staffing'>,date:string,role:'DRIVER'|'HELPER'):number|null{
 if(weekday(date)===0)return 0;
 const key=role==='DRIVER'?'drivers':'helpers',config=rules.daily_staffing,value=config?.dates?.[date]?.[key]??config?.weekdays?.[String(weekday(date))]?.[key];
 return Number.isInteger(value)&&Number(value)>=0?Number(value):null;
}
export const closedStaffingDay=(state:Pick<EscalaState,'holidays'>,date:string)=>weekday(date)===0||state.holidays.some(h=>h.date===date&&h.enabled&&h.kind!=='OPTIONAL'&&!h.operates);
