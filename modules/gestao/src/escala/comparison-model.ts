import type {EscalaState,MonthPlan} from './model';
import {generateMonth,monthDates,teamMembers} from './engine.ts';
import {manualCrew} from './crew-policy.ts';

export function monthShift(month:string,offset:number){const d=new Date(month+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,7)+'-01';}

export function comparisonPreview(target:EscalaState,reference:MonthPlan,month:string):EscalaState{
 if(month<=reference.month)throw Error('A prévia é destinada aos meses seguintes. O histórico precisa de uma escala registrada.');
 if(target.plan)throw Error('Este mês já possui uma escala. Abra o calendário para alterá-la.');
 const state=structuredClone(target),end=monthDates(month).at(-1)!;
 if(state.individual_enabled){const history=new Map([...(state.rotation_history||[]),...state.history,...reference.days].map(d=>[d.date,d]));state.rotation_history=[...history.values()];state.plan=generateMonth(state,month,reference.seed+'|comparison|'+month).plan;return state;}
 const reserved=new Set(state.memberships.filter(m=>m.starts_on<=end&&(!m.ends_on||m.ends_on>=month)).map(m=>m.staff_id));
 for(const team of state.teams.filter(t=>t.active&&!t.deleted_at)){
  if(manualCrew(state,team.id,month)||teamMembers(state,team.id,month).length)continue;
  const duty=[...reference.days].reverse().flatMap(d=>d.duties).find(d=>d.team_id===team.id&&d.members.length);
  if(!duty)continue;
  for(const person of duty.members){if(reserved.has(person.id)||!state.staff.some(p=>p.id===person.id))continue;state.memberships.push({id:'comparison-'+team.id+'-'+person.id,team_id:team.id,staff_id:person.id,starts_on:month,ends_on:end,origin:'AUTO',draw_month:month,override_reason:'Prévia de comparação, sem gravação',revision:0});reserved.add(person.id);}
 }
 if(state.teams.some(t=>t.active&&!t.deleted_at&&!teamMembers(state,t.id,month).length))throw Error('Faltam integrantes para montar a prévia. Organize os grupos no calendário desse mês.');
 const history=new Map((state.rotation_history||state.history).map(d=>[d.date,d]));for(const day of reference.days)history.set(day.date,day);state.rotation_history=[...history.values()];
 state.plan=generateMonth(state,month,reference.seed+'|comparison|'+month).plan;
 return state;
}
