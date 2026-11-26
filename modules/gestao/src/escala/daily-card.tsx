import {useState} from 'react';
import type {EscalaState,PlanDay} from './model';
import {weekday} from './engine';
import {dailyPeople,personRole} from './person-policy';
import {availabilityKind,availabilityKinds} from './rest-status';
const names=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
export function DailyCard({date,day,data,search,preview=false,local=false,loading=false,outside=false,onOpen}:{date:string;day?:PlanDay;data:EscalaState;search:string;preview?:boolean;local?:boolean;loading?:boolean;outside?:boolean;onOpen():void}){
 const [open,setOpen]=useState(true),[drivers,setDrivers]=useState(true),[helpers,setHelpers]=useState(true),people=(day?dailyPeople(day):[]).map(d=>d.person).filter(p=>normalize(p.name+' '+p.job).includes(normalize(search))&&(personRole(p.job)==='DRIVER'?drivers:personRole(p.job)==='HELPER'?helpers:true)).sort((a,b)=>(personRole(a.job)==='DRIVER'?0:1)-(personRole(b.job)==='DRIVER'?0:1)||a.name.localeCompare(b.name,'pt-BR'));
 const modes=new Map((day?dailyPeople(day):[]).map(p=>[p.person.id,p.mode])),label=names[weekday(date)]+', '+date.slice(8)+'/'+date.slice(5,7);
 return <article className="escala-daily-card" data-date={date}><details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary aria-label={(open?'Ocultar':'Abrir')+' '+label}><span className="escala-day-chevron" aria-hidden="true">›</span><h2>{label}</h2></summary><div className="escala-daily-content">
  {preview?<small className="escala-day-origin">Prévia · não salva</small>:local?<small className="escala-day-origin">Rascunho neste aparelho</small>:outside&&day?<small className="escala-day-origin">Escala do mês vizinho</small>:null}
  <fieldset className="escala-day-role-filters"><legend>Mostrar</legend><label><input type="checkbox" checked={drivers} onChange={e=>setDrivers(e.target.checked)}/>Motoristas</label><label><input type="checkbox" checked={helpers} onChange={e=>setHelpers(e.target.checked)}/>Ajudantes</label></fieldset>
  {day?<><button className="escala-view-day" onClick={onOpen}>{outside?'Abrir mês':'Ver dia'}</button>{availabilityKinds.map(kind=>{const group=people.filter(p=>availabilityKind(data,day,modes.get(p.id)!)===kind);return group.length?<section className={'escala-person-group '+kind} key={kind}><h3>{kind==='available'?'Disponíveis':kind==='rest'?'De folga':kind==='holiday-rest'?'Folga por feriado':'Indisponíveis'} <span>{group.length}</span></h3><ul>{group.map(p=><li key={p.id} data-role={personRole(p.job)||'OTHER'}><strong>{p.name}</strong></li>)}</ul></section>:null;})}{!people.length?<p className="escala-day-empty">{!drivers&&!helpers?'Motoristas e ajudantes ocultos.':'Nenhum colaborador com os filtros escolhidos.'}</p>:null}</>:<p className="escala-day-empty">{loading?'Carregando este dia…':'Sem escala registrada para esta data.'}</p>}
 </div></details></article>;
}
