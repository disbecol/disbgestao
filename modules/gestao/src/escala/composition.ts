import type {EscalaState,Membership,MonthPlan,Staff,Team} from './model';
import {monthDates,teamMembers} from './engine.ts';

export type CrewAssignment={team_id:string;members:string[]};
export type CrewPreview={assignments:CrewAssignment[];fixed:Team[];targets:Team[];drivers:number;helpers:number;neededDrivers:number;neededHelpers:number;remaining:Staff[];errors:string[]};
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export const crewRole=(job:string)=>/^motorista(?:[ _(-]|$)/i.test(job)?'DRIVER':/^ajudante(?:[ _(-]|$)/i.test(job)?'HELPER':null;
export const overlapsMonth=(membership:Membership,month:string)=>membership.starts_on<=monthDates(month).at(-1)!&&(!membership.ends_on||membership.ends_on>=month);
export function manualCrew(state:EscalaState,team:string,month:string){return state.memberships.some(m=>m.team_id===team&&m.origin!=='AUTO'&&overlapsMonth(m,month));}
export function randomCrewTeams(state:EscalaState,month:string){return state.teams.filter(t=>t.active&&t.draw_enabled&&!t.deleted_at&&!manualCrew(state,t.id,month));}
export function refreshPlanMembers(state:EscalaState,plan:MonthPlan):MonthPlan{
 if(plan.status!=='DRAFT')return plan;
 return {...plan,days:plan.days.map(day=>({...day,duties:day.duties.map(duty=>day.locked||duty.completed?duty:{...duty,members:teamMembers(state,duty.team_id,day.date)})}))};
}
function shuffle<T>(values:T[],seed:string):T[]{let x=2166136261;for(const c of seed)x=Math.imul(x^c.charCodeAt(0),16777619);const result=[...values];for(let i=result.length-1;i>0;i--){x^=x<<13;x^=x>>>17;x^=x<<5;const j=(x>>>0)%(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;}
export function drawCrew(state:EscalaState,month:string,seed:string,helpersPerTeam=2,area='Entrega'):CrewPreview{
 const last=monthDates(month).at(-1)!,targets=randomCrewTeams(state,month),targetIds=new Set(targets.map(t=>t.id)),fixed=state.teams.filter(t=>t.active&&!t.deleted_at&&manualCrew(state,t.id,month));
 const reserved=new Set(state.memberships.filter(m=>overlapsMonth(m,month)&&!(m.origin==='AUTO'&&m.draw_month===month&&targetIds.has(m.team_id))).map(m=>m.staff_id));
 const free=state.staff.filter(p=>!p.deleted_at&&!['INACTIVE','LEAVE'].includes(p.status)&&(!area||normalized(p.area||'')===normalized(area))&&!reserved.has(p.id)
 &&!(p.status==='VACATION'&&(!p.vacation_start||p.vacation_start<=last&&(!p.vacation_end||p.vacation_end>=month)))
 &&!state.unavailable.some(u=>!u.cancelled_at&&u.staff_id===p.id&&u.starts_on<=last&&u.ends_on>=month)).sort((a,b)=>a.id.localeCompare(b.id));
 const drivers=shuffle(free.filter(p=>crewRole(p.job)==='DRIVER'),seed+'|drivers'),helpers=shuffle(free.filter(p=>crewRole(p.job)==='HELPER'),seed+'|helpers');
 const errors:string[]=[];if(!Number.isInteger(helpersPerTeam)||helpersPerTeam<1||helpersPerTeam>5)errors.push('Escolha entre 1 e 5 ajudantes por equipe.');
 if(!targets.length)errors.push('Todas as equipes aptas já têm composição definida manualmente.');
 if(state.plan&&state.plan.status!=='DRAFT')errors.push('A composição está protegida por uma escala aprovada ou bloqueada.');
 if(drivers.length<targets.length)errors.push(`Faltam ${targets.length-drivers.length} motorista(s) disponível(is) para o mês.`);
 if(helpers.length<targets.length*helpersPerTeam)errors.push(`Faltam ${targets.length*helpersPerTeam-helpers.length} ajudante(s) disponível(is) para o mês.`);
 const assignments:CrewAssignment[]=errors.length?[]:targets.map((team,i)=>({team_id:team.id,members:[drivers[i].id,...helpers.slice(i*helpersPerTeam,(i+1)*helpersPerTeam).map(p=>p.id)]}));
 const assigned=new Set(assignments.flatMap(a=>a.members));return {assignments,fixed,targets,drivers:drivers.length,helpers:helpers.length,neededDrivers:targets.length,neededHelpers:targets.length*helpersPerTeam,remaining:free.filter(p=>crewRole(p.job)&&!assigned.has(p.id)),errors};
}
