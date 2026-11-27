import type {EscalaState,Issue,MonthPlan,PersonDuty,PlanDay,Staff} from './model';
import {monthDates,plusDays,weekday,teamMembers,preservedMode,legalWeeklyMinutes} from './engine.ts';
import {dailyPeople,deliveryPeople,fixedTeam,personAt,personAvailable,personRole} from './person-policy.ts';
import {restLedger} from './fairness.ts';
import {weeklyRest,legalRuleIssues} from './legal-policy.ts';
import {assignRest,type RestChoice} from './rest-assignment.ts';
import {staffingGoal} from './staffing-policy.ts';
export const INDIVIDUAL_ALGORITHM='escala-individual-5-staffing';
const startWeek=(date:string)=>plusDays(date,-((weekday(date)+6)%7));
const works=(d:PersonDuty|undefined)=>d?.mode==='ROUTE'||d?.mode==='RESERVE';
const closed=(s:EscalaState,date:string)=>s.holidays.some(h=>h.date===date&&h.enabled&&h.kind!=='OPTIONAL'&&!h.operates);
function tie(seed:string,value:string){let n=2166136261;for(const c of seed+'|'+value)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0)%17;}
export function generateIndividualMonth(state:EscalaState,month:string,seed:string){
 if(state.plan&&state.plan.status!=='DRAFT')throw Error('Desbloqueie a escala aprovada antes de realizar outro sorteio.');
 const roster=deliveryPeople(state),dates=monthDates(month),end=dates.at(-1)!,known=new Map([...(state.rotation_history||[]),...state.history].filter(d=>d.date<month).map(d=>[d.date,d])),stored=new Map((state.plan?.days||[]).map(d=>[d.date,d])),days:PlanDay[]=[],ledger=restLedger(state,[...known.values()].sort((a,b)=>a.date.localeCompare(b.date)));
 const teamIds=state.teams.filter(t=>t.active&&!t.deleted_at&&(t.fixed_group||state.memberships.some(m=>m.team_id===t.id&&m.origin==='MANUAL'))).map(t=>t.id);
 for(let start=startWeek(month);start<=end;start=plusDays(start,7)){
  const week=Array.from({length:7},(_,n)=>plusDays(start,n)),peopleByDay=new Map<string,PersonDuty[]>(),protectedPeople=new Set<string>();
  for(const date of week){const prior=known.get(date),original=stored.get(date);
   if(original?.locked){const people=structuredClone(dailyPeople(original));for(const p of people)protectedPeople.add(date+'|'+p.person.id);peopleByDay.set(date,people);continue;}
   const people=roster.map(p=>{const old=personAt(original,p.id),historical=personAt(prior,p.id);if(date<month&&historical)return structuredClone(historical);const fixed=fixedTeam(state,p.id,date),dow=weekday(date),mode=dow===0?'REST':!personAvailable(state,p,date)?'UNAVAILABLE':closed(state,date)||fixed&&dow===6?'REST':'ROUTE';
    if(original&&(original.locked||original.manual||old?.completed)&&old){protectedPeople.add(date+'|'+p.id);const copy=structuredClone(old);if(!old.completed&&!original.locked){copy.fixed_team_id=fixed;if(dow===0)copy.mode='REST';}return copy;}
    return {person:{id:p.id,name:p.name,job:p.job,profile_id:p.profile_id},fixed_team_id:fixed,mode,completed:false,weekly_rest:mode==='REST'&&(dow===0||!!fixed&&dow===6)} as PersonDuty;
   });for(const old of original?dailyPeople(original):[])if(old.completed&&!people.some(p=>p.person.id===old.person.id))people.push(structuredClone(old));peopleByDay.set(date,people);
  }
  for(const role of ['DRIVER','HELPER'] as const){
   const capacity=role==='DRIVER'?1:2,pool=roster.filter(p=>personRole(p.job)===role&&!week.some(d=>fixedTeam(state,p.id,d))),limits=Array.from({length:5},(_,i)=>{const people=peopleByDay.get(week[i])||[],goal=staffingGoal(state.rules,week[i],role);return Math.max(0,goal==null?capacity-people.filter(a=>pool.some(p=>p.id===a.person.id)&&weeklyRest(state,week[i],a)).length:people.filter(a=>personRole(a.person.job)===role&&works(a)).length-goal);});
   const choices:RestChoice[]=pool.flatMap(p=>{
    if(week.slice(0,6).some(d=>weeklyRest(state,d,d<month?personAt(known.get(d),p.id):peopleByDay.get(d)?.find(a=>a.person.id===p.id))))return [];
    const allowed=week.slice(0,6).flatMap((date,index)=>{const assignment=peopleByDay.get(date)!.find(a=>a.person.id===p.id)!;if(date<month||closed(state,date)&&weekday(date)!==6||protectedPeople.has(date+'|'+p.id)||assignment.mode==='UNAVAILABLE'||!personAvailable(state,p,date))return [];const dow=index+1,score=ledger.score([p.id],dow),privileged=dow===1||dow===6;return [{day:dow,cost:(privileged?(2*score.privileged+1)*10000:0)+(privileged?(dow===1?score.mondays:score.saturdays)*100:score.same*20)+tie(seed,start+'|'+p.id+'|'+dow)}];});return [{id:p.id,days:allowed}];
   });
   const maxWeekday=assignRest(choices.map(p=>({...p,days:p.days.filter(d=>d.day<6).map(d=>({...d,cost:0}))})),[...limits,0]).flow;
   const saturdayGoal=staffingGoal(state.rules,week[5],role),saturdayLimit=saturdayGoal==null?choices.length:Math.max(0,(peopleByDay.get(week[5])||[]).filter(a=>personRole(a.person.job)===role&&works(a)).length-saturdayGoal);
   let result=assignRest(choices,[...limits,Math.min(choices.length-maxWeekday,saturdayLimit)]);
   // A protected Saturday or absence may make maximum weekday coverage
   // infeasible. Keep daily limits and report anyone without a possible rest.
   if(result.flow<choices.length)result=assignRest(choices,[...limits,saturdayLimit]);
   // If staffing and weekly rest are incompatible, keep the weekly rest and
   // flag the staffing shortfall for review rather than silently overworking.
   if(result.flow<choices.length)result=assignRest(choices,[...limits,choices.length]);
   for(const [id,dow]of result.assignments){const date=week[dow-1],assignment=peopleByDay.get(date)!.find(p=>p.person.id===id)!;assignment.mode='REST';assignment.weekly_rest=true;}
  }
  for(const date of week.filter(d=>d>=month&&d<=end)){
   const original=stored.get(date),holiday=state.holidays.find(h=>h.date===date&&h.enabled&&h.kind!=='OPTIONAL'),people=peopleByDay.get(date)!;
   const day:PlanDay={date,kind:holiday?'HOLIDAY':weekday(date)===0?'SUNDAY':weekday(date)===6?'SATURDAY':'NORMAL',required:weekday(date)>0&&weekday(date)<6&&!closed(state,date)?state.rules.weekday_routes:0,notes:original?.notes||'',confirmed:original?.confirmed??true,locked:original?.locked||false,manual:original?.manual||false,people,duties:teamIds.map(id=>({team_id:id,mode:preservedMode(state,state.teams.find(t=>t.id===id)!,date),truck_id:null,members:teamMembers(state,id,date)}))};
   days.push(day);known.set(date,day);ledger.remember(day);
  }
 }
 const plan:MonthPlan={id:state.plan?.id||'',month,status:'DRAFT',planning_mode:'INDIVIDUAL',revision:state.plan?.revision||0,seed,algorithm_version:INDIVIDUAL_ALGORITHM,notes:state.plan?.notes||'',approved_at:null,approved_by:null,days};
 return {plan,issues:validateIndividualPlan(state,plan)};
}
export function validateIndividualPlan(state:EscalaState,plan:MonthPlan):Issue[]{
 const issues:Issue[]=legalRuleIssues(state.rules),add=(code:string,message:string,date?:string)=>issues.push({code,message,date,severity:'ERROR'}),roster=deliveryPeople(state),known=new Map([...(state.rotation_history||[]),...state.history,...plan.days].map(d=>[d.date,d])),rules=state.rules;
 if(!rules.collective_reference||!rules.reviewed_on)add('RULES_REVIEW','Revise as regras de jornada antes de aprovar.');
 if(rules.work_minutes>rules.daily_limit+rules.overtime_minutes||rules.break_minutes<60||rules.start_minute+rules.work_minutes+rules.break_minutes>1440||1440-rules.work_minutes-rules.break_minutes<rules.min_rest_minutes)add('WORK_RULES','Revise a jornada, o almoço e o intervalo entre jornadas.');
 if(rules.max_week_days>5||!rules.sunday_rest)add('REST_RULES','Use no máximo cinco dias de trabalho e descanso aos domingos.');
 for(const day of plan.days){
  const rows=dailyPeople(day),ids=new Set<string>();for(const row of rows){if(ids.has(row.person.id))add('DUPLICATE_STAFF','Colaborador repetido no mesmo dia.',day.date);ids.add(row.person.id);const person=roster.find(p=>p.id===row.person.id);if(weekday(day.date)===0&&works(row))add('SUNDAY','Todos devem folgar no domingo.',day.date);if(person&&works(row)&&!personAvailable(state,person,day.date))add('UNAVAILABLE',person.name+': indisponível nesta data.',day.date);if(row.fixed_team_id&&!row.completed){const expected=weekday(day.date)===0||weekday(day.date)===6?'REST':person&&!personAvailable(state,person,day.date)?'UNAVAILABLE':closed(state,day.date)?'REST':'ROUTE';if(row.mode!==expected)add('FIXED_TEAM_SCHEDULE',row.person.name+': equipe fixa trabalha de segunda a sexta e folga sábado e domingo.',day.date);}}
  if(roster.some(p=>!ids.has(p.id)))add('MISSING_PERSON','Há colaboradores sem situação definida nesta data.',day.date);
  if(weekday(day.date)>0&&!closed(state,day.date))for(const role of ['DRIVER','HELPER'] as const){const group=rows.filter(p=>personRole(p.person.job)===role),count=group.filter(p=>!p.fixed_team_id&&p.mode==='REST').length,available=group.filter(works).length,goal=staffingGoal(rules,day.date,role),label=role==='DRIVER'?'motoristas':'ajudantes';if(goal==null){if(weekday(day.date)<6&&count>(role==='DRIVER'?1:2))add('REST_CAPACITY','Há '+count+' '+label+' de folga neste dia; o limite diário é '+(role==='DRIVER'?1:2)+'. Revise a distribuição.',day.date);}else if(available<goal)add('QLP_SHORTAGE','QLP de '+label+': '+available+' disponíveis; configurado '+goal+'. Faltam '+(goal-available)+'.',day.date);else if(available>goal)issues.push({code:'QLP_SURPLUS',message:'QLP de '+label+': '+available+' disponíveis; configurado '+goal+'. Revise a distribuição das folgas.',date:day.date,severity:'WARN'});}
  if(rules.weekly_minutes>legalWeeklyMinutes(day.date))add('LEGAL_TRANSITION','Revise o limite semanal vigente nas configurações.',day.date);
 }
 for(const p of roster)for(let start=startWeek(plan.month);start<=plan.days.at(-1)!.date;start=plusDays(start,7)){
  const week=Array.from({length:7},(_,i)=>({date:plusDays(start,i),duty:personAt(known.get(plusDays(start,i)),p.id)})),present=week.filter(d=>d.duty),off=present.filter(d=>d.duty?.mode==='REST'),worked=present.filter(d=>works(d.duty)),ordinary=off.filter(d=>weekday(d.date)>0&&weeklyRest(state,d.date,d.duty)),weeklyOff=off.filter(d=>weeklyRest(state,d.date,d.duty));
  if(present.length===7&&!present.some(d=>d.duty?.mode==='UNAVAILABLE')&&weeklyOff.length<2)add('PERSON_WEEKLY_REST',p.name+': tem apenas '+weeklyOff.length+' folga'+(weeklyOff.length===1?'':'s')+' na semana de '+start.split('-').reverse().join('/')+' a '+week[6].date.split('-').reverse().join('/')+'. Ajuste para garantir duas folgas.',week[6].date);
  if(!week.some(d=>d.duty?.fixed_team_id)&&ordinary.some(d=>weekday(d.date)<6)&&ordinary.some(d=>weekday(d.date)===6))add('DOUBLE_REST',p.name+': quem folga na semana deve estar disponível no sábado.',week[5].date);
  if(!week.some(d=>d.duty?.fixed_team_id)&&ordinary.length>1)add('DOUBLE_REST',p.name+': tem '+ordinary.length+' folgas entre segunda e sábado na semana de '+start.split('-').reverse().join('/')+'. Revise as folgas extras.',week[5].date);
  if(worked.length>5||worked.reduce((sum,d)=>sum+(d.duty?.work_minutes??rules.work_minutes),0)>rules.weekly_minutes+rules.overtime_minutes*worked.length)add('PERSON_WEEKLY',p.name+': dias ou horas de trabalho acima do limite semanal.',week[6].date);
 }
 return issues;
}
