import type {MonthPlan} from './model';
export function redrawPlan(plan:MonthPlan|null,preserveManual=false):MonthPlan|null{
 if(!plan||plan.planning_mode!=='INDIVIDUAL'||preserveManual)return plan;
 if(plan.status!=='DRAFT')throw Error('Desbloqueie a escala antes de sortear novamente.');
 return {...structuredClone(plan),days:plan.days.map(day=>day.locked?structuredClone(day):{...structuredClone(day),manual:false})};
}
