import type {EscalaState,MonthPlan} from './model';
import {ALGORITHM,generateMonth,teamMembers} from './engine.ts';
import {refreshPlanMembers} from './composition.ts';

export function prepareEscalaDraft(state:EscalaState,plan:MonthPlan|null){
 if(!plan||plan.status!=='DRAFT')return {plan,updated:false};
 const refreshed=refreshPlanMembers(state,plan);
 if(plan.algorithm_version===ALGORITHM||state.teams.some(t=>t.active&&!t.deleted_at&&!teamMembers(state,t.id,plan.month).length))return {plan:refreshed,updated:false};
 return {plan:generateMonth({...state,plan:refreshed},plan.month,plan.seed+'|'+ALGORITHM).plan,updated:true};
}
