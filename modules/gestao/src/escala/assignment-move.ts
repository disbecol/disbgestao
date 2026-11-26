import type {EscalaState,MonthPlan} from './model';
import type {RestDrop} from './use-rest-board';
import {personAt} from './person-policy';
import {weekStart} from './weeks';
import {weekday} from './engine';
import {holidayRest} from './rest-status';

// The board can start from either a working day or a rest day. The existing
// validator receives the equivalent move of the weekly rest in both cases.
export function restMoveForAssignment(data:EscalaState,plan:MonthPlan,drop:RestDrop):RestDrop{
 const origin=plan.days.find(d=>d.date===drop.from),source=personAt(origin,drop.person);
 if(!origin||!source)throw Error('O colaborador não está nesta escala.');
 if(source.fixed_team_id)throw Error('Esta pessoa pertence a uma equipe fixa, com folgas de sábado e domingo.');
 if(source.mode==='UNAVAILABLE')throw Error('A pessoa está indisponível nesta data.');
 if(!drop.to){
  if(source.mode==='REST')return drop;
  const rest=plan.days.find(d=>weekStart(d.date)===weekStart(drop.from)&&weekday(d.date)!==0&&!d.locked&&!holidayRest(data,d,'REST')&&personAt(d,drop.person)?.mode==='REST'&&!personAt(d,drop.person)?.completed);
  if(!rest)throw Error('Não há uma folga editável desta pessoa na mesma semana e neste mês.');
  return {...drop,from:rest.date,to:drop.from};
 }
 const destination=plan.days.find(d=>d.date===drop.to),target=personAt(destination,drop.person);
 if(!destination||!target)throw Error('Escolha um dia deste mês com a escala da pessoa.');
 const working=source.mode==='ROUTE'||source.mode==='RESERVE',targetWorking=target.mode==='ROUTE'||target.mode==='RESERVE';
 if(source.mode==='REST'&&targetWorking)return drop;
 if(working&&target.mode==='REST')return {...drop,from:drop.to,to:drop.from};
 if(working&&targetWorking)throw Error('Esta pessoa já está escalada nos dois dias. Solte no dia de folga dela para trocar.');
 if(source.mode==='REST'&&target.mode==='REST')throw Error('Esta pessoa já está de folga nos dois dias. Solte em um dia em que ela está escalada.');
 throw Error('A pessoa está indisponível no dia de destino.');
}
