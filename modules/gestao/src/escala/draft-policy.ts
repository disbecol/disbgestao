import type {EscalaState,MonthPlan} from './model';
import {ALGORITHM,generateMonth,teamMembers} from './engine.ts';
import {refreshPlanMembers} from './composition.ts';
import {INDIVIDUAL_ALGORITHM} from './individual-engine.ts';
import {deliveryPeople,fixedTeam} from './person-policy.ts';

export function prepareEscalaDraft(state:EscalaState,plan:MonthPlan|null){
 if(!plan||plan.status!=='DRAFT')return {plan,updated:false};
 const refreshed=refreshPlanMembers(state,plan);
 const algorithm=state.individual_enabled?INDIVIDUAL_ALGORITHM:ALGORITHM;
 const roster=deliveryPeople(state),changedRoster=state.individual_enabled&&plan.planning_mode==='INDIVIDUAL'&&plan.days.some(day=>!day.locked&&(roster.some(p=>!day.people?.some(a=>a.person.id===p.id))||day.people?.some(a=>!a.completed&&(!roster.some(p=>p.id===a.person.id)||a.fixed_team_id!==fixedTeam(state,a.person.id,day.date)))));
 if((plan.algorithm_version===algorithm&&!changedRoster)||(state.individual_enabled?!roster.length:state.teams.some(t=>t.active&&!t.deleted_at&&!teamMembers(state,t.id,plan.month).length)))return {plan:refreshed,updated:false};
 return {plan:generateMonth({...state,plan:refreshed},plan.month,plan.seed+'|'+algorithm).plan,updated:true};
}
