import type {EscalaState,MonthPlan} from './model';
import type {RestDrop} from './use-rest-board';
import {weekday} from './engine';
import {personAt,personAvailable} from './person-policy';
import {holidayRest} from './rest-status';

// A board drop edits just the destination day. Weekly constraints remain
// reviewable issues in the draft rather than forcing a swap with a colleague.
export function assignIndividualDay(data:EscalaState,plan:MonthPlan,drop:RestDrop):MonthPlan{
 if(plan.planning_mode!=='INDIVIDUAL'||plan.status!=='DRAFT')throw Error('A escala está protegida.');
 if(drop.mode!=='REST'&&drop.mode!=='ROUTE')throw Error('Solte em Disponíveis ou De folga no dia desejado.');
 const origin=plan.days.find(d=>d.date===drop.from),destination=plan.days.find(d=>d.date===drop.to),source=personAt(origin,drop.person),current=personAt(destination,drop.person);
 if(!origin||!destination||!source||!current)throw Error('Escolha um dia deste mês com a escala da pessoa.');
 for(const [day,assignment]of [[origin,source],[destination,current]] as const){
  if(day.locked||assignment.completed)throw Error('Este dia ou a situação realizada está protegido.');
  if(assignment.fixed_team_id)throw Error('Esta pessoa pertence a uma equipe fixa, com folgas de sábado e domingo.');
  if(weekday(day.date)===0||holidayRest(data,day,'REST'))throw Error('O descanso de domingo e feriado está protegido.');
  if(!['REST','ROUTE','RESERVE'].includes(assignment.mode))throw Error('A pessoa está indisponível nesta data.');
 }
 const person=data.staff.find(p=>p.id===drop.person);
 if(!person||!personAvailable(data,person,drop.to))throw Error('A pessoa está indisponível no dia de destino.');
 if(current.mode===drop.mode||drop.mode==='ROUTE'&&current.mode==='RESERVE')throw Error('A pessoa já está nessa situação no dia escolhido.');
 const next=structuredClone(plan),day=next.days.find(d=>d.date===drop.to)!,assignment=personAt(day,drop.person)!;
 assignment.mode=drop.mode==='ROUTE'&&source.mode==='RESERVE'?'RESERVE':drop.mode;
 assignment.weekly_rest=drop.mode==='REST';day.manual=true;
 return next;
}
