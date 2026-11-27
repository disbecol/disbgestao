import {useState,type ReactNode} from 'react';

type Props={month:string;busy:boolean;onPrevious():void;onNext():void;onCurrent():void;onMonth(month:string):void;onRefresh():void;children:ReactNode};
export function CalendarFilters({month,busy,onPrevious,onNext,onCurrent,onMonth,onRefresh,children}:Props){
 const [open,setOpen]=useState(()=>!window.matchMedia?.('(max-width: 900px)')?.matches);
 return <section className="escala-filter-toolbar" aria-label="Filtros da Escala"><details className="escala-filter-panel" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary><strong>Filtros</strong><span className="escala-filter-month-badge">{month.slice(5,7)}/{month.slice(0,4)}</span><span className="escala-filter-chevron" aria-hidden="true">›</span></summary>
  <div className="escala-filter-body">
   <div className="escala-month-nav" role="group" aria-label="Navegação do mês">
    <label htmlFor="escalaFilterMonth">Mês e ano</label>
    <div className="escala-month-picker"><button type="button" aria-label="Mês anterior" title="Mês anterior" disabled={busy||month<='2020-01-01'} onClick={onPrevious}>‹</button><input id="escalaFilterMonth" type="month" min="2020-01" max="2100-12" value={month.slice(0,7)} disabled={busy} onChange={e=>onMonth(e.target.value+'-01')}/><button type="button" aria-label="Próximo mês" title="Próximo mês" disabled={busy||month>='2100-12-01'} onClick={onNext}>›</button></div>
    <div className="escala-month-shortcuts"><button type="button" disabled={busy} onClick={onCurrent}>Mês atual</button><button type="button" disabled={busy} onClick={onRefresh}>Atualizar</button></div>
   </div>
   {children}
  </div>
 </details></section>;
}
