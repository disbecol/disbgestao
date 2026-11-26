import {useEffect,useRef,useState} from 'react';
import type {EscalaState,MonthPlan,PersonSnapshot} from './model';
import {monthDates,weekday} from './engine';
import {createEscalaService,escalaError,type EscalaAdapter} from './service';
import {readEscalaDraft} from './drafts';
import {prepareEscalaDraft} from './draft-policy';
import {availabilityKind,availabilityKinds,availabilityLabels,type AvailabilityKind} from './rest-status';
import {comparisonPreview,monthShift} from './comparison-model';
import {comparisonWeeks} from './comparison-weeks';
import {monthlyRestCounts} from './rest-counts';
import {dailyPeople,personAt} from './person-policy';

type Loaded={state:EscalaState;plan:MonthPlan|null;origin:'saved'|'local'|'updated'|'preview'|'empty'};
const week=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const shortDate=(date:string)=>date.slice(8)+'/'+date.slice(5,7);
const monthName=(month:string)=>new Date(month+'T12:00:00Z').toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
function personStatus(view:Loaded,person:string,date:string):AvailabilityKind|null{const day=view.plan?.days.find(d=>d.date===date),duty=personAt(day,person);return day&&duty?availabilityKind(view.state,day,duty.mode):null;}
function weekdayRest(view:Loaded|null,person:string){if(!view?.plan)return 'Sem escala';if(!view.plan.days.some(d=>!!personAt(d,person)))return 'Sem vínculo';const count=(dow:number)=>view.plan!.days.filter(d=>weekday(d.date)===dow&&personStatus(view,person,d.date)==='rest').length;return 'Seg: '+count(1)+' · Sáb: '+count(6);}

export function CompareMonths({adapter,month,current,currentPlan,currentDirty,initialPerson,onOpenMonth}:{adapter:EscalaAdapter;month:string;current:EscalaState;currentPlan:MonthPlan|null;currentDirty:boolean;initialPerson:string;onOpenMonth(month:string):void}){
 const service=useRef(createEscalaService(adapter)).current;
 const [months,setMonths]=useState<[string,string]>([month,monthShift(month,1)]),[loaded,setLoaded]=useState<[Loaded,Loaded]|null>(null),[person,setPerson]=useState(initialPerson),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;setLoading(true);setError('');setLoaded(null);
  async function load(selected:string):Promise<Loaded>{
   if(selected===month)return {state:current,plan:currentPlan,origin:currentDirty?'local':currentPlan?'saved':'empty'};
   const state=await service.load(selected);let plan=state.plan,origin:Loaded['origin']=plan?'saved':'empty';
   try{const local=readEscalaDraft(JSON.parse(localStorage.getItem('disb_escala_draft_v1_'+service.key()+'_'+selected)||'null'),selected,plan?.revision||0);if(local&&(!plan||plan.status==='DRAFT')){plan=local;origin='local';}}catch{/* An invalid local draft must not replace a saved calendar. */}
   const prepared=prepareEscalaDraft(state,plan);return {state,plan:prepared.plan,origin:prepared.updated?'updated':origin};
  }
  void Promise.all(months.map(load)).then(results=>{if(active)setLoaded(results as [Loaded,Loaded]);}).catch(e=>{if(active)setError(escalaError(e));}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[months[0],months[1]]);
 const people=new Map<string,PersonSnapshot>();
 for(const plan of [currentPlan,...(loaded?.map(v=>v.plan)||[])])for(const day of plan?.days||[])for(const duty of dailyPeople(day))people.set(duty.person.id,duty.person);
 const options=[...people.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')),selected=options.find(p=>p.id===person)||options[0];
 function setMonth(index:number,value:string){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||value<'2020-01'||value>'2100-12')return;setMonths(old=>index===0?[value+'-01',old[1]]:[old[0],value+'-01']);}
 function preview(index:number){
  if(!loaded)return;setError('');
  try{const reference=[currentPlan,...loaded.map(v=>v.plan)].filter((p):p is MonthPlan=>!!p&&p.month<months[index]).sort((a,b)=>b.month.localeCompare(a.month))[0];if(!reference)throw Error('Abra esse mês no calendário e organize os grupos para iniciar a comparação.');const next=comparisonPreview(loaded[index].state,reference,months[index]);setLoaded(old=>old?old.map((v,i)=>i===index?{state:next,plan:next.plan,origin:'preview'}:v) as [Loaded,Loaded]:old);}catch(e){setError(escalaError(e));}
 }
 return <div className="escala-dialog-body escala-comparison" aria-busy={loading}>
  <p>Semanas de segunda a domingo. Cada colaborador deve ter duas folgas na semana, incluindo o domingo. Feriados ficam em azul. A coincidência com uma folga semanal já definida não gera outro dia de descanso.</p>
  <div className="escala-compare-controls"><label>Colaborador<select aria-label="Colaborador" value={selected?.id||''} onChange={e=>setPerson(e.target.value)}>{options.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{months.map((m,i)=><label key={i}>{i===0?'Primeiro mês':'Segundo mês'}<input type="month" min="2020-01" max="2100-12" value={m.slice(0,7)} onChange={e=>setMonth(i,e.target.value)}/></label>)}</div>
  <div className="escala-compare-presets"><button onClick={()=>setMonths([monthShift(month,-1),month])}>Anterior × atual</button><button onClick={()=>setMonths([month,monthShift(month,1)])}>Atual × seguinte</button></div>
  <div className="escala-availability-legend"><span className="available">Disponível</span><span className="rest">Folga</span><span className="holiday-rest">Feriado</span><span className="unavailable">Indisponível</span></div>
  {error?<p role="alert" className="escala-error">{error}</p>:null}
  {loading?<p role="status">Carregando os meses…</p>:loaded&&selected?<>
   <h3>{selected.name}</h3><p className="escala-compare-change">Folgas junto do domingo: <strong>{weekdayRest(loaded[0],selected.id)}</strong> → <strong>{weekdayRest(loaded[1],selected.id)}</strong></p>
   <div className="escala-comparison-grid">{loaded.map((view,index)=>{
    const dates=monthDates(months[index]),counts=Object.fromEntries(availabilityKinds.map(k=>[k,dates.filter(d=>personStatus(view,selected.id,d)===k).length])),restCounts=view.plan?monthlyRestCounts(view.state,view.plan).find(r=>r.person.id===selected.id):null,weeks=comparisonWeeks(view,selected.id,loaded.filter((_,i)=>i!==index));
    return <section className="escala-compare-month" key={index} aria-label={monthName(months[index])}>
     <header><h4>{monthName(months[index])}</h4><span className="escala-pill">{view.origin==='preview'?'Prévia · não salva':view.origin==='updated'?'Rascunho atualizado · não salvo':view.origin==='local'?'Rascunho neste aparelho':view.origin==='saved'?'Escala salva':'Sem escala'}</span></header>
     {view.plan?<>
      <div className="escala-compare-counts"><span>{counts.available} disponíveis</span><span>{counts.rest+counts['holiday-rest']} dias de folga no mês</span><span>{counts['holiday-rest']} por feriado</span></div>
      <div className="escala-compare-weekday-counts" aria-label="Folgas comuns por dia da semana; feriados separados">{[[1,'Seg'],[2,'Ter'],[3,'Qua'],[4,'Qui'],[5,'Sex'],[6,'Sáb'],[0,'Dom']].map(([dow,name])=><span key={dow}><small>{name}</small><strong>{restCounts?.days[Number(dow)]||0}</strong></span>)}</div>
      <div className="escala-compare-weeks">{weeks.map(row=><article className={'escala-compare-week'+(row.invalid?' invalid':'')} key={row.start} data-week-start={row.start}>
       <div className="escala-compare-week-summary"><strong>{shortDate(row.start)} a {shortDate(row.dates[6].date)}</strong><span className={row.invalid?'invalid':row.missing||row.unavailable?'partial':'valid'}>{row.sundayWork?'Revisar: domingo disponível':row.missing?'Semana incompleta · '+row.missing+' dia(s) sem escala':row.unavailable?row.off+' folga(s) · '+row.unavailable+' indisponível(is)':row.regularOff+' folgas'+(row.extraHolidays?' + '+row.extraHolidays+' feriado(s)':'')+(row.invalid?' · revisar':'')}</span></div>
       <div className="escala-compare-calendar">{week.map((w,i)=><strong className="weekday" key={'week'+i}>{w}</strong>)}{row.dates.map(d=><div className={'escala-compare-date '+(d.kind||'unassigned')+(d.outside?' outside-month':'')} key={d.date} data-date={d.date} data-weekday={weekday(d.date)} title={d.date.split('-').reverse().join('/')+' · '+(d.kind?availabilityLabels[d.kind]:'Sem escala ou vínculo nesta data')} aria-label={d.date.split('-').reverse().join('/')+': '+(d.kind?availabilityLabels[d.kind]:'Sem escala')}><strong>{d.outside?shortDate(d.date):Number(d.date.slice(8))}</strong>{d.kind==='available'?<><span className="escala-compare-status-long">Disponível</span><span className="escala-compare-status-short">Disp.</span></>:<span>{d.kind?d.kind==='holiday-rest'?'Feriado':d.kind==='unavailable'?'Indisp.':availabilityLabels[d.kind]:'Sem escala'}</span>}</div>)}</div>
      </article>)}</div>
      <small>Dias de outro mês aparecem com borda tracejada. Sem escala significa que a semana ainda não pode ser conferida por inteiro.</small>
     </>:<div className="escala-compare-empty"><p>Este mês ainda não tem escala para comparar.</p>{months[index]>month&&currentPlan?<button onClick={()=>preview(index)}>Gerar prévia</button>:null}<button onClick={()=>onOpenMonth(months[index])}>Abrir mês no calendário</button></div>}
     {view.origin==='preview'||view.origin==='updated'?<small>Prévia para conferência. Para compartilhar, abra o mês no calendário, revise e salve.</small>:null}
    </section>;
   })}</div>
  </>:!loading?<p>Nenhum colaborador encontrado nas escalas selecionadas.</p>:null}
 </div>;
}
