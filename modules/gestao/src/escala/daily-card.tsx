import {useState} from 'react';
import type {EscalaState,PlanDay} from './model';
import {weekday} from './engine';
import {dailyPeople} from './person-policy';
import {DailyRole} from './daily-role';
import {availabilityKind,availabilityKinds,availabilityLabels} from './rest-status';
import type {RestBoard} from './use-rest-board';
const names=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
export function DailyCard({date,day,data,search,preview=false,local=false,loading=false,outside=false,compact=false,board,onOpen}:{date:string;day?:PlanDay;data:EscalaState;search:string;preview?:boolean;local?:boolean;loading?:boolean;outside?:boolean;compact?:boolean;board?:RestBoard;onOpen():void}){
 const [open,setOpen]=useState(true);
 const assignments=(day?dailyPeople(day):[]).filter(d=>normalize(d.person.name+' '+d.person.job).includes(normalize(search))).sort((a,b)=>a.person.name.localeCompare(b.person.name,'pt-BR'));
 const label=names[weekday(date)]+', '+date.slice(8)+'/'+date.slice(5,7);
 return <article className={'escala-daily-card'+(weekday(date)===0?' sunday':'')+(board?.target===date?' rest-drop-target':'')} data-date={date} {...board?.dayProps(date)}><details className="escala-day-details" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary aria-label={(open?'Ocultar':'Abrir')+' '+label}><span className="escala-day-chevron" aria-hidden="true">›</span><h2>{label}</h2></summary><div className="escala-daily-content">
  {preview?<small className="escala-day-origin">Prévia · não salva</small>:local?<small className="escala-day-origin">Rascunho neste aparelho</small>:outside&&day?<small className="escala-day-origin">Escala do mês vizinho</small>:null}
  {day?<><button className="escala-view-day" onClick={onOpen}>{outside?'Abrir mês':'Ver dia'}</button>
   {compact?<div className="escala-day-totals">{availabilityKinds.map(kind=>{const count=assignments.filter(p=>availabilityKind(data,day,p.mode)===kind).length;return count?<span className={kind} key={kind}>{count} {kind==='available'?'disponíveis':kind==='rest'?'de folga':kind==='holiday-rest'?'feriado':'indisponíveis'}</span>:null;})}</div>:null}
   {(['DRIVER','HELPER'] as const).map(role=><DailyRole key={role} role={role} assignments={assignments} data={data} day={day} board={board}/>)}
  </>:<p className="escala-day-empty">{loading?'Carregando este dia…':'Sem escala registrada para esta data.'}</p>}
 </div></details></article>;
}
