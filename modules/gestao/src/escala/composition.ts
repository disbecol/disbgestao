import type {EscalaState,MonthPlan,Staff,Team} from './model';
import {monthDates,teamMembers} from './engine.ts';
import {manualCrew,overlapsMonth} from './crew-policy.ts';
export {manualCrew,overlapsMonth} from './crew-policy.ts';

export type CrewAssignment={team_id:string;members:string[]};
export type CrewPreview={assignments:CrewAssignment[];fixed:Team[];targets:Team[];drivers:number;helpers:number;neededDrivers:number;neededHelpers:number;usedHelpers:number;automatic:boolean;remaining:Staff[];errors:string[]};
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export const crewRole=(job:string)=>/^motorista(?:[ _(-]|$)/i.test(job)?'DRIVER':/^ajudante(?:[ _(-]|$)/i.test(job)?'HELPER':null;
export function randomCrewTeams(state:EscalaState,month:string){return state.teams.filter(t=>t.active&&t.draw_enabled&&!t.deleted_at&&!manualCrew(state,t.id,month));}
export function refreshPlanMembers(state:EscalaState,plan:MonthPlan):MonthPlan{
 if(plan.status!=='DRAFT')return plan;
 return {...plan,days:plan.days.map(day=>({...day,duties:day.duties.map(duty=>day.locked||duty.completed?duty:{...duty,members:teamMembers(state,duty.team_id,day.date)})}))};
}
export function moveCrewHelper(state:EscalaState,assignments:CrewAssignment[],helperId:string,targetTeam:string,swapId?:string):CrewAssignment[]{
 const source=assignments.find(a=>a.members.includes(helperId)),target=assignments.find(a=>a.team_id===targetTeam);
 if(!source||!target||crewRole(state.staff.find(p=>p.id===helperId)?.job||'')!=='HELPER')throw Error('Escolha um ajudante desta prévia e uma equipe disponível.');
 if(source.team_id===target.team_id)return assignments;
 if(swapId&&(!target.members.includes(swapId)||crewRole(state.staff.find(p=>p.id===swapId)?.job||'')!=='HELPER'))throw Error('A troca deve ser feita entre dois ajudantes.');
 return assignments.map(a=>a.team_id===source.team_id?{...a,members:swapId?a.members.map(id=>id===helperId?swapId:id):a.members.filter(id=>id!==helperId)}:a.team_id===targetTeam?{...a,members:swapId?a.members.map(id=>id===swapId?helperId:id):[...a.members,helperId]}:{...a,members:[...a.members]});
}
export function crewAdjustmentErrors(state:EscalaState,assignments:CrewAssignment[],helpersPerTeam:number):string[]{
 const errors:string[]=[],seen=new Set<string>();
 for(const crew of assignments){const name=state.teams.find(t=>t.id===crew.team_id)?.name||'Equipe',people=crew.members.map(id=>state.staff.find(p=>p.id===id)),drivers=people.filter(p=>p&&crewRole(p.job)==='DRIVER').length,helpers=people.filter(p=>p&&crewRole(p.job)==='HELPER').length;
  if(drivers!==1)errors.push(name+': mantenha 1 motorista.');
  if(helpersPerTeam===0?(helpers<1||helpers>2):helpers!==helpersPerTeam)errors.push(name+(helpersPerTeam===0?': mantenha 1 ou 2 ajudantes.':`: mantenha ${helpersPerTeam} ajudante(s).`));
  for(const id of crew.members){if(seen.has(id))errors.push('Um colaborador aparece em mais de uma equipe.');seen.add(id);}
 }
 return [...new Set(errors)];
}
function shuffle<T>(values:T[],seed:string):T[]{let x=2166136261;for(const c of seed)x=Math.imul(x^c.charCodeAt(0),16777619);const result=[...values];for(let i=result.length-1;i>0;i--){x^=x<<13;x^=x>>>17;x^=x<<5;const j=(x>>>0)%(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;}
export function drawCrew(state:EscalaState,month:string,seed:string,helpersPerTeam=0,area='Entrega'):CrewPreview{
 const last=monthDates(month).at(-1)!,targets=randomCrewTeams(state,month),targetIds=new Set(targets.map(t=>t.id)),fixed=state.teams.filter(t=>t.active&&!t.deleted_at&&manualCrew(state,t.id,month));
 const reserved=new Set(state.memberships.filter(m=>overlapsMonth(m,month)&&!(m.origin==='AUTO'&&m.draw_month===month&&targetIds.has(m.team_id))).map(m=>m.staff_id));
 const free=state.staff.filter(p=>!p.deleted_at&&!['INACTIVE','LEAVE'].includes(p.status)&&(!area||normalized(p.area||'')===normalized(area))&&!reserved.has(p.id)
 &&!(p.status==='VACATION'&&(!p.vacation_start||p.vacation_start<=last&&(!p.vacation_end||p.vacation_end>=month)))
 &&!state.unavailable.some(u=>!u.cancelled_at&&u.staff_id===p.id&&u.starts_on<=last&&u.ends_on>=month)).sort((a,b)=>a.id.localeCompare(b.id));
 const drivers=shuffle(free.filter(p=>crewRole(p.job)==='DRIVER'),seed+'|drivers'),helpers=shuffle(free.filter(p=>crewRole(p.job)==='HELPER'),seed+'|helpers');
 const automatic=helpersPerTeam===0,minimumHelpers=automatic?1:helpersPerTeam;
 const errors:string[]=[];if(!Number.isInteger(helpersPerTeam)||helpersPerTeam<0||helpersPerTeam>5)errors.push('Escolha a distribuição automática ou entre 1 e 5 ajudantes por equipe.');
 if(!targets.length)errors.push('Todas as equipes aptas já têm composição definida manualmente.');
 if(state.plan&&state.plan.status!=='DRAFT')errors.push('A composição está protegida por uma escala aprovada ou bloqueada.');
 if(drivers.length<targets.length)errors.push(`Faltam ${targets.length-drivers.length} motorista(s) disponível(is) para o mês.`);
 if(helpers.length<targets.length*minimumHelpers)errors.push(`Faltam ${targets.length*minimumHelpers-helpers.length} ajudante(s) disponível(is) para o mês.`);
 // Guarantee one helper per team, then fairly draw which teams receive a
 // second helper. A seeded shuffle avoids always favoring the first teams.
 const extraHelpers=Math.min(helpers.length,targets.length*2)-targets.length;
 const counts=shuffle(targets.map((_,i)=>automatic?1+(i<extraHelpers?1:0):helpersPerTeam),seed+'|helper-counts');let offset=0;
 const assignments:CrewAssignment[]=errors.length?[]:targets.map((team,i)=>{const ids=helpers.slice(offset,offset+counts[i]).map(p=>p.id);offset+=counts[i];return {team_id:team.id,members:[drivers[i].id,...ids]};});
 const assigned=new Set(assignments.flatMap(a=>a.members));return {assignments,fixed,targets,drivers:drivers.length,helpers:helpers.length,neededDrivers:targets.length,neededHelpers:targets.length*minimumHelpers,usedHelpers:assignments.reduce((n,a)=>n+a.members.length-1,0),automatic,remaining:free.filter(p=>crewRole(p.job)&&!assigned.has(p.id)),errors};
}
