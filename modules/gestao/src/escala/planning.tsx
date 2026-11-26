import {useState} from 'react';
import type {EscalaState,MonthPlan} from './model';
import {teamMembers,weekday} from './engine';
import {crewRole,manualCrew} from './composition';

const shortDate=(date:string)=>date.slice(8)+'/'+date.slice(5,7);
const weekdays=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

export function PlanningSteps({data,plan,month,dirty,busy,canEdit,onCrew,onGenerate,onSave}:{data:EscalaState;plan:MonthPlan|null;month:string;dirty:boolean;busy:boolean;canEdit:boolean;onCrew():void;onGenerate():void;onSave():void}){
 const teams=data.teams.filter(t=>t.active&&(t.draw_enabled||manualCrew(data,t.id,month))&&!t.deleted_at),ready=teams.filter(t=>{const people=teamMembers(data,t.id,month);return people.some(p=>crewRole(p.job)==='DRIVER')&&people.some(p=>crewRole(p.job)==='HELPER');}).length;
 const locked=!!plan&&plan.status!=='DRAFT';
 return <section className="escala-planning-steps" aria-label="Etapas do planejamento">
  <article className={ready===teams.length&&teams.length?'complete':''}><span>1</span><div><h2>Montar as equipes</h2><p>{ready} de {teams.length} equipes com motorista e ajudante.</p><button disabled={busy||!canEdit||locked} onClick={onCrew} title={locked?'Desbloqueie a escala para alterar as equipes.':undefined}>Sortear colaboradores</button></div></article>
  <article className={plan?'complete':''}><span>2</span><div><h2>Distribuir as folgas</h2><p>Preservadas: Seg–Sex em rota, Sáb/Dom de folga. Só as demais equipes entram no sorteio.</p><button disabled={busy||!canEdit||locked||!teams.length} onClick={onGenerate} title="Gera outras folgas automáticas para revisão, mantendo os dias bloqueados e as rotas realizadas.">{plan?'Sortear novas folgas':'Sortear folgas'}</button></div></article>
  <article className={plan&&!dirty?'complete':''}><span>3</span><div><h2>Revisar e salvar</h2><p>{dirty?'Você tem alterações neste aparelho para salvar.':plan?'A escala está salva. Confira as folgas abaixo.':'Confira o resultado do sorteio antes de compartilhar.'}</p><button className={dirty?'primary':''} disabled={busy||!dirty||!canEdit} onClick={onSave}>Salvar escala{dirty?' •':''}</button></div></article>
 </section>;
}

export function RestByTeam({data,plan,canEdit,onMove,onDay}:{data:EscalaState;plan:MonthPlan;canEdit:boolean;onMove(team:string,from:string):void;onDay(date:string):void}){
 const [search,setSearch]=useState(''),[sundays,setSundays]=useState(false);
 const key=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
 const teams=data.teams.filter(t=>t.active&&!t.deleted_at&&key(t.name+' '+teamMembers(data,t.id,plan.month).map(p=>p.name).join(' ')).includes(key(search)));
 return <section className="escala-rest-browser" aria-label="Folgas por equipe">
  <div className="escala-rest-filters"><label>Buscar equipe ou colaborador<input type="search" value={search} placeholder="Nome da equipe, motorista ou ajudante" onChange={e=>setSearch(e.target.value)} onInput={e=>setSearch(e.currentTarget.value)}/></label><label className="escala-checkbox-field"><input type="checkbox" checked={sundays} onChange={e=>setSundays(e.target.checked)}/><span>Mostrar domingos</span></label></div>
  <p>Selecione uma folga para mudar a data ou trocar com outra equipe. Equipes preservadas têm descanso fixo aos sábados e domingos.</p>
  <div className="escala-team-grid">{teams.map(team=>{const rest=plan.days.filter(d=>(sundays||weekday(d.date)!==0)&&d.duties.some(a=>a.team_id===team.id&&a.mode==='REST'));const people=teamMembers(data,team.id,plan.month);return <article className="escala-panel escala-rest-team" key={team.id}><header><h2>{team.name}</h2><span className="escala-pill">{rest.length} folga{rest.length===1?'':'s'}{sundays?'':' + domingos'}</span></header>{manualCrew(data,team.id,plan.month)?<small className="escala-preserved-label">Preservada · trabalho Seg–Sex · folga Sáb/Dom</small>:null}<p>{people.map(p=>p.name).join(' · ')||'Composição pendente'}</p><div className="escala-rest-dates">{rest.map(day=>{const movable=canEdit&&plan.status==='DRAFT'&&!manualCrew(data,team.id,plan.month)&&!day.locked&&weekday(day.date)!==0;return <button key={day.date} className={day.manual?'manual':''} aria-label={(movable?'Mover folga de ':'Ver folga de ')+team.name+' em '+shortDate(day.date)} onClick={()=>movable?onMove(team.id,day.date):onDay(day.date)}><small>{weekdays[weekday(day.date)]}</small><strong>{shortDate(day.date)}</strong>{day.locked?<span aria-label="Dia bloqueado">▣</span>:null}</button>;})}</div>{!rest.length?<small>Nenhuma folga fora dos domingos neste mês.</small>:null}</article>;})}</div>
  {!teams.length?<p role="status">Nenhuma equipe encontrada para essa busca.</p>:null}
 </section>;
}

export function MoveImpact({plan,candidate,from,to,error,conflicts}:{plan:MonthPlan;candidate:MonthPlan|null;from:string;to:string;error:string;conflicts:string[]}){
 if(!to)return <p className="escala-inline-help">Escolha a nova data. A cobertura das rotas será conferida antes de salvar.</p>;
 return <section className="escala-move-impact" aria-label="Prévia da troca de folga"><h3>Confira a alteração</h3>{error?<p role="alert">{error}</p>:candidate?<><div>{[...new Set([from,to].filter(Boolean))].map(date=>{const before=plan.days.find(d=>d.date===date),after=candidate.days.find(d=>d.date===date);return <article key={date}><strong>{weekdays[weekday(date)]}, {shortDate(date)}</strong><span>{before?.duties.filter(a=>a.mode==='ROUTE').length||0} → {after?.duties.filter(a=>a.mode==='ROUTE').length||0} equipes em rota</span><small>Necessidade: {after?.required||0} equipes</small></article>;})}</div>{conflicts.length?<div className="escala-conflicts" role="alert"><strong>Revise a troca</strong><ul>{conflicts.map((message,i)=><li key={i}>{message}</li>)}</ul><p>Escolha outra data ou uma equipe para trocar a folga.</p></div>:<p className="escala-move-ok">A troca mantém a cobertura e não cria novas pendências.</p>}</>:null}</section>;
}
