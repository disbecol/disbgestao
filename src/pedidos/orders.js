/* Regras de apresentação de Pedidos. A autorização e as transições são validadas pelo banco. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISB_ORDERS=api;})(typeof window==='object'?window:globalThis,()=>{
 'use strict';
 const VIEWS={
  'orders-new':['Nova solicitação','Fora de rota, bipasse e cliente novo'],
  'orders-own':['Minhas solicitações','Acompanhe a análise e as respostas'],
  'orders-queue':['Fila de análise','Solicitações ordenadas pela urgência do SLA'],
  'orders-manage':['Gestão de solicitações','Consulta e acompanhamento da unidade'],
  'orders-dashboard':['Dashboard de pedidos','Indicadores e análise por cliente'],
  'orders-productivity':['Minha produtividade','Resultados das suas análises'],
  'orders-audit':['Auditoria de pedidos','Histórico de alterações da unidade'],
  'orders-config':['Configurações de pedidos','Horários e prazos de atendimento']
 };
 const TYPE={FORA_ROTA:'Fora de rota',BIPASSE:'Bipasse',CLIENTE_NOVO:'Cliente novo'};
 const STATUS={PENDENTE:'Pendente',EM_ANALISE:'Em análise',APROVADO:'Aprovado',REPROVADO:'Reprovado'};
 const EVENTS={CREATED:'Solicitação criada',CLAIMED:'Análise assumida',RETURNED:'Devolvida à fila',APPROVED:'Aprovada',REJECTED:'Reprovada',SETTINGS:'Regras atualizadas'};
 const REASONS=['Esqueceu de pedir','Negociação de evento','Limite de crédito','FEFO','Vendeu mais do que o previsto','Falta de capacidade no veículo','Alto volume de buffer','Justificativa operacional ou comercial insuficiente','PDV com alto tempo de atendimento','Outros'];
 const REJECTIONS=['Fora da região de atendimento','PDV reincidente de devolução','Excesso de solicitações fora de rota','Cliente já possui bipasse','Cliente não utiliza as janelas liberadas','Falta de capacidade no veículo','Alto volume de buffer','Justificativa operacional ou comercial insuficiente','PDV com alto tempo de atendimento','Outro'];
 const DEFAULTS={revision:0,restricted_hours:true,morning_start:510,morning_end:690,afternoon_start:840,afternoon_end:960,route_sla:30,bypass_sla:2880};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const localDate=(v=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(v));
 const minutes=v=>Math.max(0,Number(v)||0);
 const duration=v=>v==null?'—':minutes(v)<60?Math.round(minutes(v))+' min':Math.floor(minutes(v)/60)+'h '+Math.round(minutes(v)%60)+'min';
 const time=v=>String(Math.floor(v/60)).padStart(2,'0')+':'+String(v%60).padStart(2,'0');
 const timeValue=v=>/^\d{2}:\d{2}$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3,5)):NaN;
 function windowState(settings=DEFAULTS,now=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  const m=Number(p.hour)*60+Number(p.minute),s={...DEFAULTS,...settings};
  return {open:!s.restricted_hours||(m>=s.morning_start&&m<=s.morning_end)||(m>=s.afternoon_start&&m<=s.afternoon_end),label:time(s.morning_start)+'–'+time(s.morning_end)+' e '+time(s.afternoon_start)+'–'+time(s.afternoon_end)};
 }
 function sla(r,now=Date.now()){
  const elapsed=r.resolved_at&&r.resolution_minutes!=null?Number(r.resolution_minutes):Math.max(0,(Number(now)-Date.parse(r.created_at))/60000);
  const ratio=elapsed/r.sla_minutes,within=r.within_sla??ratio<=1;
  return {elapsed,ratio,within,tone:r.resolved_at?(within?'success':'danger'):ratio>.9?'danger':ratio>.5?'warning':'success',label:r.resolved_at?(within?'No prazo':'Fora do prazo'):ratio>=1?'SLA excedido':ratio>.9?'Crítico':ratio>.5?'Atenção':'No prazo'};
 }
 function filterRows(rows,f={}){
  const search=norm(f.search);
  return rows.filter(r=>(!f.status||r.status===f.status)&&(!f.kind||r.kind===f.kind)&&(!f.customer||r.customer_code===f.customer)&&(!f.analyst||r.analyst_id===f.analyst)&&(!search||norm([r.customer_code,r.customer_name,r.city,r.created_by_name,r.analyst_name,r.reason,r.notes].join(' ')).includes(search)));
 }
 function stats(rows){
  const resolved=rows.filter(r=>['APROVADO','REPROVADO'].includes(r.status));
  const onTime=resolved.filter(r=>r.within_sla===true).length;
  return {total:rows.length,pending:rows.filter(r=>r.status==='PENDENTE').length,analyzing:rows.filter(r=>r.status==='EM_ANALISE').length,
   approved:rows.filter(r=>r.status==='APROVADO').length,rejected:rows.filter(r=>r.status==='REPROVADO').length,
   resolved:resolved.length,onTime,overdue:resolved.length-onTime,rate:resolved.length?onTime/resolved.length:null,
   average:resolved.length?resolved.reduce((a,r)=>a+Number(r.resolution_minutes||0),0)/resolved.length:null};
 }
 function groups(rows,key,label){
  const m=new Map();for(const r of rows){const id=key(r)||'Não informado';if(!m.has(id))m.set(id,{id,label:label?label(r):id,rows:[]});m.get(id).rows.push(r);}
  return [...m.values()].map(g=>({...g,...stats(g.rows)})).sort((a,b)=>b.total-a.total||a.label.localeCompare(b.label,'pt-BR',{numeric:true}));
 }
 const daily=rows=>groups(rows,r=>localDate(r.created_at)).sort((a,b)=>a.id.localeCompare(b.id));
 const monthly=rows=>groups(rows,r=>localDate(r.created_at).slice(0,7)).sort((a,b)=>a.id.localeCompare(b.id));
 function period(key,now=new Date()){
  const t=localDate(now),[year,month,day]=t.split('-').map(Number),format=d=>d.toISOString().slice(0,10);
  const last=(y,m)=>format(new Date(Date.UTC(y,m,0,12))),first=(y,m)=>format(new Date(Date.UTC(y,m-1,1,12)));
  if(key==='today')return {from:t,to:t};if(key==='7d')return {from:format(new Date(Date.UTC(year,month-1,day-6,12))),to:t};
  if(key==='previous')return {from:first(year,month-1),to:last(year,month-1)};
  if(key==='3m'||key==='6m')return {from:first(year,month-(key==='3m'?2:5)),to:t};
  if(key==='year')return {from:first(year,1),to:t};return {from:first(year,month),to:t};
 }
 function weekdays(rows,from,to,now=new Date()){
  const end=[to,localDate(now)].sort()[0],names=['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  const counts=new Map(names.map(name=>[name,{label:name,total:0,days:0,average:0}]));
  for(let d=Date.parse(from+'T12:00:00Z'),limit=0;d<=Date.parse(end+'T12:00:00Z')&&limit<367;d+=86400000,limit++)counts.get(names[new Date(d).getUTCDay()]).days++;
  for(const r of rows){const d=localDate(r.created_at),name=names[new Date(d+'T12:00:00Z').getUTCDay()];if(counts.has(name))counts.get(name).total++;}
  return [...counts.values()].map(r=>({...r,average:r.days?r.total/r.days:0})).sort((a,b)=>b.total-a.total||names.indexOf(a.label)-names.indexOf(b.label));
 }
 const queue=rows=>[...rows].sort((a,b)=>sla(b).ratio-sla(a).ratio||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
 const csvCell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 function csv(rows){
  const head=['ID','Tipo','Status','Código cliente','Cliente','Cidade','Data desejada','Dias','Motivo','Observações','Solicitante','Analista','Criado em','Assumido em','Resolvido em','Minutos de resolução','Dentro do SLA','Resposta'];
  return '\uFEFF'+[head,...rows.map(r=>[r.id,TYPE[r.kind],STATUS[r.status],r.customer_code,r.customer_name,r.city,r.desired_date,(r.weekdays||[]).join(', '),r.reason,r.notes,r.created_by_name,r.analyst_name,r.created_at,r.claimed_at,r.resolved_at,r.resolution_minutes,r.within_sla==null?'':r.within_sla?'Sim':'Não',r.response])].map(row=>row.map(csvCell).join(';')).join('\r\n');
 }
 return {VIEWS,TYPE,STATUS,EVENTS,REASONS,REJECTIONS,DEFAULTS,esc,norm,localDate,duration,time,timeValue,windowState,sla,filterRows,stats,groups,daily,monthly,period,weekdays,queue,csv};
});
