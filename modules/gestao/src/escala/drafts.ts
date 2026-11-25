import type {MonthPlan} from './model';
import {monthDates} from './engine';
export function readEscalaDraft(value:unknown,month:string,revision:number):MonthPlan|null{
 if(value===null)return null;if(!value||typeof value!=='object')throw Error('Rascunho inválido.');const p=value as Partial<MonthPlan>;
 if(p.month!==month||p.revision!==revision)return null;
 if(p.status!=='DRAFT'||typeof p.id!=='string'||typeof p.seed!=='string'||!Array.isArray(p.days)||p.days.length!==monthDates(month).length)throw Error('Rascunho inválido.');
 const dates=new Set(monthDates(month));for(const day of p.days){if(!day||!dates.delete(day.date)||!Array.isArray(day.duties)||day.duties.length>100||!Number.isInteger(day.required)||typeof day.locked!=='boolean'||typeof day.manual!=='boolean'||typeof day.notes!=='string')throw Error('Rascunho inválido.');const teams=new Set<string>();for(const duty of day.duties){if(!duty||typeof duty.team_id!=='string'||teams.has(duty.team_id)||!['ROUTE','REST','UNAVAILABLE','RESERVE'].includes(duty.mode)||!Array.isArray(duty.members)||duty.members.some(p=>!p||typeof p.id!=='string'||typeof p.name!=='string'||typeof p.job!=='string'))throw Error('Rascunho inválido.');teams.add(duty.team_id);}}
 return p as MonthPlan;
}
