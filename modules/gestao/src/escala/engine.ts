import {defaultRules,modeNames,type Duty,type EscalaState,type Holiday,type Issue,type MonthPlan,type PersonSnapshot,type PlanDay,type Rules,type Team} from './model.ts';
import {manualCrew} from './crew-policy.ts';
import {restLedger} from './fairness.ts';
import {holidayRest} from './rest-status.ts';
export const ALGORITHM='escala-weekly-5-person-rest';
const DAY=86400000;
export const dateKey=(d:Date)=>d.toISOString().slice(0,10);
export const parseDay=(s:string)=>new Date(s+'T12:00:00Z');
export const plusDays=(s:string,n:number)=>dateKey(new Date(parseDay(s).getTime()+n*DAY));
export const weekday=(s:string)=>parseDay(s).getUTCDay();
export function monthDates(month:string):string[]{if(!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month))throw Error('Mês inválido.');const d=parseDay(month),result:string[]=[];while(dateKey(d).slice(0,7)===month.slice(0,7)){result.push(dateKey(d));d.setUTCDate(d.getUTCDate()+1);}return result;}
export const within=(date:string,from:string,to:string|null)=>date>=from&&(!to||date<=to);
export function teamMembers(state:EscalaState,teamId:string,date:string):PersonSnapshot[]{return state.memberships.filter(m=>m.team_id===teamId&&within(date,m.starts_on,m.ends_on)).flatMap(m=>{const p=state.staff.find(p=>p.id===m.staff_id);return p?[{id:p.id,name:p.name,job:p.job,profile_id:p.profile_id}]:[];});}
export function available(state:EscalaState,team:Team,date:string):boolean{
 if(!team.active||team.deleted_at||!team.draw_enabled&&!manualCrew(state,team.id,date.slice(0,7)+'-01'))return false;
 if(state.unavailable.some(u=>!u.cancelled_at&&(u.team_id===team.id||teamMembers(state,team.id,date).some(p=>p.id===u.staff_id))&&within(date,u.starts_on,u.ends_on)))return false;
 return teamMembers(state,team.id,date).every(member=>{const p=state.staff.find(p=>p.id===member.id)!;return !p.deleted_at&&p.status!=='INACTIVE'&&p.status!=='LEAVE'&&!(p.status==='VACATION'&&(!p.vacation_start||within(date,p.vacation_start,p.vacation_end)));});
}
export function easter(year:number):string{const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;return `${year}-${String(Math.floor(n/31)).padStart(2,'0')}-${String(n%31+1).padStart(2,'0')}`;}
export function officialHolidays(year:number):Omit<Holiday,'id'|'revision'>[]{
 const fixed=[['01-01','Confraternização Universal'],['04-21','Tiradentes'],['05-01','Dia do Trabalho'],['09-07','Independência do Brasil'],['10-12','Nossa Senhora Aparecida'],['11-02','Finados'],['11-15','Proclamação da República'],['11-20','Consciência Negra'],['12-25','Natal']];
 const result:Omit<Holiday,'id'|'revision'>[]=fixed.filter(([date])=>date!=='11-20'||year>=2024).map(([date,name])=>({date:`${year}-${date}`,name,kind:'NATIONAL',source_url:date==='11-20'?'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm':date==='10-12'?'https://www.planalto.gov.br/ccivil_03/leis/l6802.htm':'https://www.planalto.gov.br/ccivil_03/leis/l0662.htm',automatic:true,enabled:true,operates:false,previous_saturday:true,confirmed:false}));
 // The religious holiday depends on municipal law (Law 9.093/1995, art. 2).
 result.push({date:plusDays(easter(year),-2),name:'Sexta-feira Santa — confirmar lei municipal',kind:'MUNICIPAL',source_url:'https://www.planalto.gov.br/ccivil_03/leis/l9093.htm',automatic:true,enabled:false,operates:false,previous_saturday:false,confirmed:false});return result;
}
export function previousSaturday(date:string):string {const n=weekday(date);return plusDays(date,-(n===6?7:n+1));}
export function specialSaturday(state:EscalaState,date:string){return state.holidays.filter(h=>h.enabled&&h.kind!=='OPTIONAL'&&h.previous_saturday&&weekday(h.date)>=1&&weekday(h.date)<=5&&previousSaturday(h.date)===date);}
function random(seed:string){let s=2166136261;for(const c of seed)s=Math.imul(s^c.charCodeAt(0),16777619);return()=>{s+=0x6D2B79F5;let t=Math.imul(s^(s>>>15),1|s);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}
const work=(d:Duty|undefined)=>d?.mode==='ROUTE'||d?.mode==='RESERVE';
function monday(date:string){return plusDays(date,-((weekday(date)+6)%7));}
export function requiredOpeningDates(month:string){const dow=weekday(month);return dow<2?[]:Array.from({length:dow-1},(_,i)=>plusDays(month,-dow+1+i));}
export function legalWeeklyMinutes(date:string){return date>='2027-12-16'?2400:date>='2026-12-16'?2520:2640;}
function attachTrucks(_state:EscalaState,day:PlanDay,_keepExisting=false){for(const duty of day.duties)if(!duty.completed)duty.truck_id=null;}
export function preservedMode(state:EscalaState,team:Team,date:string):Duty['mode']{
 if(weekday(date)===0||weekday(date)===6)return 'REST';
 if(!available(state,team,date))return 'UNAVAILABLE';
 if(state.holidays.some(h=>h.enabled&&h.kind!=='OPTIONAL'&&h.date===date&&!h.operates))return 'REST';
 return 'ROUTE';
}
export function generateMonth(state:EscalaState,month:string,seed:string):{plan:MonthPlan;issues:Issue[]}{
 if(state.plan?.status&&state.plan.status!=='DRAFT')throw Error('Desbloqueie a escala aprovada antes de realizar outro sorteio.');
 const rules=state.rules||defaultRules,teams=state.teams.filter(t=>t.active&&!t.deleted_at),rng=random(seed),fixed=new Set(teams.filter(t=>manualCrew(state,t.id,month)).map(t=>t.id));
 const prior=new Map([...(state.rotation_history||[]),...state.history].filter(d=>d.date<month).map(d=>[d.date,d]));const allPast=[...prior.values()].sort((a,b)=>a.date.localeCompare(b.date)),days:PlanDay[]=[],ledger=restLedger(state,allPast);
 const remember=(day:PlanDay)=>{days.push(day);ledger.remember(day);};
 for(const date of monthDates(month)){
  const stored=state.plan?.days.find(d=>d.date===date),protectedDay=stored&&(stored.locked||stored.manual)?stored:null;
  if(protectedDay){const copy=structuredClone(protectedDay);let changed=false;if(!copy.locked)for(const duty of copy.duties){if(duty.completed)continue;if(weekday(date)===0&&rules.sunday_rest&&work(duty)){duty.mode='REST';changed=true;}if(fixed.has(duty.team_id)){const team=teams.find(t=>t.id===duty.team_id);if(team){const mode=preservedMode(state,team,date);if(mode!==duty.mode){duty.mode=mode;changed=true;}}}}if(changed)attachTrucks(state,copy,true);remember(copy);continue;}
  const dow=weekday(date),holiday=state.holidays.find(h=>h.enabled&&h.kind!=='OPTIONAL'&&h.date===date),sunday=dow===0&&rules.sunday_rest;
  const day:PlanDay={date,kind:holiday?'HOLIDAY':dow===0?'SUNDAY':dow===6?'SATURDAY':'NORMAL',required:sunday||holiday&&!holiday.operates?0:dow===6?0:rules.weekday_routes,notes:'',confirmed:!holiday?.operates&&!specialSaturday(state,date).length,locked:false,manual:false,duties:[]};
  const completed=new Map((stored?.duties||[]).filter(a=>a.completed).map(a=>[a.team_id,a])),completedRoutes=[...completed.values()].filter(a=>a.mode==='ROUTE').length;
  const eligible=teams.filter(t=>available(state,t,date)),mutable=eligible.filter(t=>!completed.has(t.id)),availableIds=new Set(eligible.map(t=>t.id)),rests=new Set<string>(),reserves=new Set<string>();
  const week=[...allPast,...days].filter(d=>d.date>=monday(date)&&d.date<date),score=(id:string)=>ledger.score(teamMembers(state,id,date).map(p=>p.id),dow);
  if(sunday||holiday&&!holiday.operates)eligible.forEach(t=>rests.add(t.id));
  else if(dow===6){
   const canWork=mutable.filter(t=>!fixed.has(t.id)&&teamMembers(state,t.id,date).every(p=>week.filter(d=>d.duties.some(a=>work(a)&&a.members.some(m=>m.id===p.id))).length<rules.max_week_days));
   const maximum=Math.max(completedRoutes,Math.min(completedRoutes+canWork.length,rules.saturday_routes??Infinity));
   const ordered=canWork.map(t=>({t,...score(t.id),j:rng()})).sort((a,b)=>b.privileged-a.privileged||b.saturdays-a.saturdays||a.j-b.j);
   const route=new Set(ordered.slice(0,Math.max(0,maximum-completedRoutes)).map(x=>x.t.id));eligible.filter(t=>!route.has(t.id)).forEach(t=>rests.add(t.id));day.required=maximum;
  }else{
   const slots=Math.max(0,mutable.length+completedRoutes-day.required),holidayWeek=state.holidays.some(h=>h.enabled&&h.kind!=='OPTIONAL'&&!h.operates&&h.date>=monday(date)&&h.date<=plusDays(monday(date),5));
   const candidates=mutable.filter(t=>!fixed.has(t.id)).map(t=>({t,...score(t.id),used:week.filter(d=>weekday(d.date)>0&&weekday(d.date)<6&&d.duties.some(a=>a.team_id===t.id&&a.mode==='REST'&&!holidayRest(state,d,a.mode))).length,j:rng()}));
   if(holidayWeek)candidates.sort((a,b)=>a.reserves-b.reserves||a.j-b.j).slice(0,slots).forEach(x=>reserves.add(x.t.id));
   else candidates.sort((a,b)=>a.used-b.used||(dow===1?a.privileged-b.privileged||a.mondays-b.mondays||a.recent-b.recent:b.privileged-a.privileged||b.recent-a.recent)||a.same-b.same||a.j-b.j).slice(0,slots).forEach(x=>rests.add(x.t.id));
  }
  for(const team of teams){const recorded=completed.get(team.id);if(recorded){day.duties.push(structuredClone(recorded));continue;}const mode=fixed.has(team.id)?preservedMode(state,team,date):!availableIds.has(team.id)?'UNAVAILABLE':rests.has(team.id)?'REST':reserves.has(team.id)?'RESERVE':'ROUTE';day.duties.push({team_id:team.id,mode,truck_id:null,members:teamMembers(state,team.id,date)});}
  attachTrucks(state,day,completed.size>0);remember(day);
 }
 const plan:MonthPlan={id:state.plan?.id||'',month,status:'DRAFT',revision:state.plan?.revision||0,days,seed,algorithm_version:ALGORITHM,notes:state.plan?.notes||'',approved_at:null,approved_by:null};return {plan,issues:validatePlan(state,plan)};
}
export function validatePlan(state:EscalaState,plan:MonthPlan):Issue[]{
 const errors:Issue[]=[],rules=state.rules;const add=(code:string,message:string,date?:string,team_id?:string,severity:Issue['severity']='ERROR')=>errors.push({code,message,date,team_id,severity});
 const known=new Map([...(state.rotation_history||[]),...state.history,...plan.days].map(d=>[d.date,d]));
 const opening=requiredOpeningDates(plan.month);if(opening.some(date=>state.teams.some(t=>t.active&&!t.deleted_at&&!known.get(date)?.duties.some(x=>x.team_id===t.id))))add('MISSING_HISTORY','Informe o saldo inicial dos dias anteriores ao mês para concluir a validação da primeira semana.');
 if(!rules.collective_reference||!rules.reviewed_on)add('RULES_REVIEW','Revise o regime e informe a referência do acordo ou convenção antes de aprovar.');
 if(rules.work_minutes>rules.daily_limit+rules.overtime_minutes)add('DAILY_HOURS','A jornada supera o limite diário configurado.');
 if(rules.break_minutes<60)add('BREAK','O intervalo informado é inferior a 1h; configure a regra aplicável antes da aprovação.');
 if(rules.start_minute+rules.work_minutes+rules.break_minutes>1440)add('SHIFT','A jornada não pode terminar após a meia-noite neste regime.');
 if(1440-rules.work_minutes-rules.break_minutes<rules.min_rest_minutes)add('REST_HOURS','O intervalo entre jornadas é insuficiente.');
 if(rules.min_rest_minutes<660||rules.weekly_rest_minutes<1440)add('REST_BASELINE','Os descansos não podem ser inferiores a 11h entre jornadas e 24h semanais.');
 for(const day of plan.days){
  if(rules.weekly_minutes>legalWeeklyMinutes(day.date))add('LEGAL_TRANSITION','O limite semanal configurado supera a etapa vigente da transição de jornada.',day.date);
  if(!within(day.date,rules.effective_from,rules.effective_until))add('RULES_DATE','As regras de jornada não abrangem esta data.',day.date);
  const routes=day.duties.filter(d=>d.mode==='ROUTE'),staffUsed=new Set<string>();
  if(routes.length<day.required)add('STAFF_SHORTAGE',`Necessárias ${day.required} equipes em rota; há ${routes.length}.`,day.date);
  const holiday=state.holidays.find(h=>h.enabled&&h.kind!=='OPTIONAL'&&h.date===day.date);
  if((holiday?.operates||specialSaturday(state,day.date).length)&&!day.confirmed)add('CONFIRM_OPERATION','Confirme a operação do feriado ou sábado especial.',day.date);
  if(holiday&&routes.length&&!rules.holiday_treatment)add('HOLIDAY_TREATMENT','Informe como será tratado o trabalho em feriados.',day.date);
  if(holiday&&routes.length&&(!holiday.operates||!holiday.confirmed))add('HOLIDAY_OPERATION','A operação no feriado precisa ser autorizada em Feriados.',day.date);
  if(rules.sunday_rest&&weekday(day.date)===0&&day.duties.some(work))add('SUNDAY','Domingo está configurado como descanso de todas as equipes.',day.date);
  for(const duty of day.duties){const team=state.teams.find(t=>t.id===duty.team_id);if(!team){add('TEAM','Equipe não encontrada.',day.date,duty.team_id);continue;}
   if(manualCrew(state,team.id,plan.month)&&!day.locked&&!duty.completed&&duty.mode!==preservedMode(state,team,day.date))add('FIXED_TEAM_SCHEDULE','Equipe preservada: trabalho de segunda a sexta e folga aos sábados e domingos.',day.date,team.id);
   if(!work(duty))continue;
   if(!available(state,team,day.date))add('UNAVAILABLE','Equipe ou integrante indisponível nesta data.',day.date,team.id);
   const members=teamMembers(state,team.id,day.date);if(!members.some(p=>/MOTORISTA/i.test(p.job)))add('DRIVER','Equipe sem motorista cadastrado.',day.date,team.id);
   if(!members.length)add('EMPTY_TEAM','Equipe sem integrantes.',day.date,team.id);
   for(const member of members){if(staffUsed.has(member.id))add('DUPLICATE_STAFF','Funcionário escalado em duas equipes no mesmo horário.',day.date,team.id);staffUsed.add(member.id);}
  }
 }
 const timeline=[...known.values()].sort((a,b)=>a.date.localeCompare(b.date));
 for(const team of state.teams.filter(t=>t.active&&!t.deleted_at)){
  let consecutive=0,previous='';const weeks=new Map<string,{days:number;minutes:number;last:string}>();
  for(const day of timeline){if(previous&&plusDays(previous,1)!==day.date)consecutive=0;previous=day.date;const duty=day.duties.find(x=>x.team_id===team.id);consecutive=work(duty)?consecutive+1:0;if(consecutive>rules.max_consecutive&&day.date>=plan.month&&day.date<=plan.days.at(-1)!.date)add('CONSECUTIVE',`Mais de ${rules.max_consecutive} dias consecutivos trabalhados.`,day.date,team.id);
   if(work(duty)){const key=monday(day.date),entry=weeks.get(key)||{days:0,minutes:0,last:day.date};entry.days++;entry.minutes+=day.date<plan.month?duty?.work_minutes??rules.work_minutes:rules.work_minutes;entry.last=day.date;weeks.set(key,entry);}
  }
  for(const [week,value]of weeks)if(value.last>=plan.month&&week<=plan.days.at(-1)!.date&&plusDays(week,6)>=plan.month&&(value.days>rules.max_week_days||value.minutes>rules.weekly_minutes+rules.overtime_minutes*value.days))add('WEEKLY_HOURS',`Semana de ${week.split('-').reverse().join('/')}: ${value.days} dias e ${Math.floor(value.minutes/60)}h${String(value.minutes%60).padStart(2,'0')}.`,value.last,team.id);
 }
 for(const person of state.staff){let consecutive=0,previous='';const weeks=new Map<string,{days:number;minutes:number;last:string}>();for(const day of timeline){if(previous&&plusDays(previous,1)!==day.date)consecutive=0;previous=day.date;const duty=day.duties.find(d=>work(d)&&d.members.some(p=>p.id===person.id));consecutive=duty?consecutive+1:0;if(consecutive>rules.max_consecutive&&day.date>=plan.month&&day.date<=plan.days.at(-1)!.date)add('PERSON_CONSECUTIVE',person.name+': dias consecutivos acima do limite.',day.date);if(duty){const key=monday(day.date),entry=weeks.get(key)||{days:0,minutes:0,last:day.date};entry.days++;entry.minutes+=day.date<plan.month?duty.work_minutes??rules.work_minutes:rules.work_minutes;entry.last=day.date;weeks.set(key,entry);}}for(const [week,value]of weeks)if(value.last>=plan.month&&week<=plan.days.at(-1)!.date&&plusDays(week,6)>=plan.month&&(value.days>rules.max_week_days||value.minutes>rules.weekly_minutes+rules.overtime_minutes*value.days))add('PERSON_WEEKLY',person.name+': dias ou horas da semana acima do limite.',value.last);
  if(rules.regime.toUpperCase()==='5X2')for(let start=monday(plan.month);start<=plan.days.at(-1)!.date;start=plusDays(start,7)){
   const duties=Array.from({length:7},(_,i)=>known.get(plusDays(start,i))?.duties.find(d=>d.members.some(p=>p.id===person.id)));
   if(duties.every(d=>d&&d.mode!=='UNAVAILABLE')&&duties.filter(d=>d?.mode==='REST').length<2)add('PERSON_WEEKLY_REST',person.name+': a semana de '+start.split('-').reverse().join('/')+' precisa de pelo menos duas folgas, incluindo o domingo.',plusDays(start,6));
  }
 }
 return errors;
}
export function moveRest(state:EscalaState,plan:MonthPlan,teamId:string,from:string|null,to:string,swapTeam?:string):MonthPlan{
 if(plan.status!=='DRAFT')throw Error('A escala está bloqueada.');
 if(manualCrew(state,teamId,plan.month)||swapTeam&&manualCrew(state,swapTeam,plan.month))throw Error('Equipes preservadas têm folgas fixas aos sábados e domingos e não participam da troca.');
 const next=structuredClone(plan),target=next.days.find(d=>d.date===to),origin=next.days.find(d=>d.date===from);
 if(!target||target.locked||origin?.locked)throw Error('O dia está bloqueado para alterações.');
 if(weekday(to)===0||from&&weekday(from)===0)throw Error('O descanso de domingo deve ser preservado.');
 const duty=target.duties.find(d=>d.team_id===teamId);if(!duty||duty.mode==='UNAVAILABLE')throw Error('A equipe está indisponível nessa data.');
 if(duty.completed||origin?.duties.find(d=>d.team_id===teamId)?.completed||swapTeam&&origin?.duties.find(d=>d.team_id===swapTeam)?.completed)throw Error('Essa equipe já tem rota realizada em uma das datas. Escolha outra data para a folga.');
 const other=target.duties.find(d=>d.team_id===swapTeam&&d.mode==='REST');
 if(duty.mode!=='REST'){duty.mode='REST';if(other)other.mode='ROUTE';target.manual=true;}
 if(origin&&origin!==target){const old=origin.duties.find(d=>d.team_id===teamId);if(old)old.mode='ROUTE';const replace=origin.duties.find(d=>d.team_id===swapTeam);if(replace)replace.mode='REST';origin.manual=true;attachTrucks(state,origin);}
 attachTrucks(state,target);return next;
}
export function restMoveIssues(state:EscalaState,original:MonthPlan,candidate:MonthPlan):Issue[]{
 const existing=new Set(validatePlan(state,original).map(i=>[i.code,i.date,i.team_id].join('|')));
 const introduced=validatePlan(state,candidate).filter(i=>i.severity==='ERROR'&&!existing.has([i.code,i.date,i.team_id].join('|')));
 for(const day of candidate.days){const before=original.days.find(d=>d.date===day.date);if(!before)continue;const previous=before.duties.filter(a=>a.mode==='ROUTE').length,next=day.duties.filter(a=>a.mode==='ROUTE').length;
  if(next<Math.min(previous,day.required)&&!introduced.some(i=>i.code==='CAPACITY'&&i.date===day.date))introduced.push({severity:'ERROR',code:'CAPACITY',date:day.date,message:'A troca reduziria a cobertura de '+previous+' para '+next+' equipes em rota. A necessidade é de '+day.required+'.'});
 }
 return introduced;
}
export function statistics(state:EscalaState,days:PlanDay[]){return state.teams.filter(t=>!t.deleted_at).map(team=>{const rows=days.map(d=>({day:d,duty:d.duties.find(x=>x.team_id===team.id)}));return {team,total:rows.filter(r=>r.duty?.mode==='REST').length,worked:rows.filter(r=>work(r.duty)).length,routes:rows.filter(r=>r.duty?.mode==='ROUTE').length,unavailable:rows.filter(r=>r.duty?.mode==='UNAVAILABLE').length,weekdays:Array.from({length:7},(_,i)=>rows.filter(r=>weekday(r.day.date)===i&&r.duty?.mode==='REST').length),holidays:rows.filter(r=>r.day.kind==='HOLIDAY'&&r.duty?.mode==='REST').length};});}
export function exportMatrix(state:EscalaState,plan:MonthPlan){return [['Data','Colaborador','Função','Grupo de folga','Situação','Observação'],...plan.days.flatMap(day=>day.duties.flatMap(d=>d.members.map(p=>[day.date,p.name,p.job,state.teams.find(t=>t.id===d.team_id)?.name||d.team_id,modeNames[d.mode],day.notes])))];}
