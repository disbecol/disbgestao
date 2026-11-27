import {useState} from 'react';
import type {EscalaState,PersonDuty,PlanDay} from './model';
import {personRole} from './person-policy';
import {availabilityKind,availabilityKinds,availabilityLabels} from './rest-status';
import type {RestBoard} from './use-rest-board';

export function DailyRole({role,assignments,data,day,board}:{role:'DRIVER'|'HELPER';assignments:PersonDuty[];data:EscalaState;day:PlanDay;board?:RestBoard}){
 const [expanded,setExpanded]=useState(false),title=role==='DRIVER'?'Motoristas':'Ajudantes',people=assignments.filter(p=>personRole(p.person.job)===role),available=people.filter(p=>availabilityKind(data,day,p.mode)==='available').length;
 return <details className="escala-role-details" data-role={role} open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}>
  <summary aria-label={(expanded?'Ocultar':'Abrir')+' '+title.toLowerCase()+' de '+day.date+' · '+available+' disponíveis'}><span className="escala-day-chevron" aria-hidden="true">›</span><strong>{title}</strong><span className="escala-role-count" title={available+' '+title.toLowerCase()+' disponíveis'}>{available}</span></summary>
  {expanded?<div className="escala-role-content">{availabilityKinds.map(kind=>{
   const group=people.filter(p=>availabilityKind(data,day,p.mode)===kind),mode=kind==='available'?'ROUTE':kind==='rest'?'REST':null,droppable=!!mode&&!!board?.isEditableDay(day.date),active=board?.zone===day.date+'|'+role+'|'+mode;
   if(!group.length&&!droppable)return null;
   return <section className={'escala-person-group '+kind+(droppable?' escala-assignment-zone':'')+(active?' assignment-drop-target':'')} key={kind} {...(droppable?board!.groupProps(day.date,mode!,role):{})}>
    <h3>{kind==='available'?'Disponíveis':kind==='rest'?'De folga':availabilityLabels[kind]} <span>{group.length}</span></h3>
    {group.length?<ul>{group.map(p=>{const movable=board?.canDrag(day.date,p)||false;return <li key={p.person.id} data-role={role} data-assignment-person={p.person.id}>{movable?<button className="escala-rest-person" aria-label={'Mover '+(p.mode==='REST'?'folga':'dia escalado')+' de '+p.person.name} {...board!.personProps(day.date,p)}><span className="escala-person-grip" aria-hidden="true">⠿</span><strong>{p.person.name}</strong></button>:<strong>{p.person.name}</strong>}</li>;})}</ul>:<p className="escala-drop-empty">{mode==='REST'?'Solte aqui para dar folga':'Solte aqui para deixar disponível'}</p>}
   </section>;
  })}{!people.length?<p className="escala-day-empty">Nenhum {role==='DRIVER'?'motorista':'ajudante'} com os filtros escolhidos.</p>:null}</div>:null}
 </details>;
}
