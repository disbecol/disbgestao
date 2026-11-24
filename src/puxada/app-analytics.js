/* Cálculos da Puxada isolada, sobre linhas já autorizadas pelo servidor. */
(() => {
 'use strict';
 const keys=['tmvOut','factory','tmvReturn','unit','cycle'];
 const labels={tmvOut:'TMV Ida',factory:'TMA Fábrica',tmvReturn:'TMV Volta',unit:'TMA Revenda',cycle:'Ciclo'};
 const local=value=>new Date(new Date(value).getTime()-3*3600000);
 const day=value=>local(value).toISOString().slice(0,10);
 const clean=value=>String(value??'').trim();
 const compare=(a,b)=>String(a).localeCompare(String(b),'pt-BR');
 const unique=values=>[...new Set(values.filter(Boolean))].sort(compare);
 const drivers=t=>{const map=new Map();for(const n of [1,2]){const name=clean(t[`driver${n}Name`]);if(name)map.set(t[`driver${n}Id`]||'name:'+name,{value:t[`driver${n}Id`]||'name:'+name,label:name});}return [...map.values()];};
 const span=(a,b,discount=0)=>{if(!a||!b)return null;const m=(Date.parse(b)-Date.parse(a))/60000-discount;return Number.isFinite(m)&&m>=0?m:null;};
 function metrics(t){
  if(t.imported&&t.legacyMetrics)return Object.fromEntries(keys.map(k=>[k,Number.isFinite(t.legacyMetrics[k])?t.legacyMetrics[k]:null]));
  if(t.type==='TRANSFER')return {tmvOut:null,factory:null,tmvReturn:null,unit:null,cycle:span(t.startedAt,t.endedAt)};
  const discount=Math.max(0,Number(t.tmaAdjustmentMinutes)||0);
  const discounted=(a,b)=>{const raw=span(a,b);return raw==null?null:Math.max(0,raw-discount);};
  return {tmvOut:span(t.startedAt,t.arrivedFactoryAt),factory:span(t.arrivedFactoryAt,t.leftFactoryAt),tmvReturn:span(t.leftFactoryAt,t.endedAt),unit:discounted(t.endedAt,t.nextStartedAt),cycle:discounted(t.startedAt,t.nextStartedAt)};
 }
 function aggregate(rows,goal){return Object.fromEntries(keys.map(k=>{
  const eligible=rows.filter(t=>k==='cycle'||t.type==='PULL'),valid=eligible.map(t=>({t,m:metrics(t)[k]})).filter(x=>x.m!=null&&Number.isFinite(x.m)&&x.m>=0);
  const target=Number(goal[k+'TargetMinutes'])>0?Number(goal[k+'TargetMinutes']):null,within=target==null?null:valid.filter(x=>x.m<=target).length;
  return [k,{count:valid.length,missingCount:eligible.length-valid.length,notApplicableCount:rows.length-eligible.length,averageMinutes:valid.length?valid.reduce((a,x)=>a+x.m,0)/valid.length:null,targetMinutes:target,adherenceTargetPercent:Number(goal[k+'Adherence'])||0,within,above:target==null?null:valid.length-within,adherencePercent:target!=null&&valid.length?100*within/valid.length:null,destinationCount:new Set(valid.map(x=>x.t.destination)).size,plateCount:new Set(valid.map(x=>x.t.plate)).size}];
 }));}
 function groups(rows,selector,goal){const map=new Map();for(const t of rows)for(const opt of new Map(selector(t).map(x=>[x.value,x])).values()){if(!map.has(opt.value))map.set(opt.value,{key:opt.value,label:opt.label,rows:[]});map.get(opt.value).rows.push(t);}return [...map.values()].map(g=>({key:g.key,label:g.label,total:g.rows.length,tripIds:g.rows.map(t=>t.id),metrics:aggregate(g.rows,goal)})).sort((a,b)=>b.total-a.total||compare(a.label,b.label));}
 function arrivalStats(dates){const values=dates.map(local).map(d=>d.getUTCHours()*60+d.getUTCMinutes()).sort((a,b)=>a-b),bins=Array.from({length:24},(_,hour)=>({hour,count:values.filter(m=>Math.floor(m/60)===hour).length}));
  if(!values.length)return {count:0,medianMinute:null,firstMinute:null,lastMinute:null,peakHours:[],bins};const i=Math.floor(values.length/2),peak=Math.max(...bins.map(b=>b.count));
  return {count:values.length,medianMinute:values.length%2?values[i]:(values[i-1]+values[i])/2,firstMinute:values[0],lastMinute:values.at(-1),peakHours:bins.filter(b=>b.count===peak).map(b=>b.hour),bins};
 }
 function arrivals(rows,factory){const data=rows.map(t=>({t,at:factory?(t.type==='PULL'?t.arrivedFactoryAt:null):t.endedAt})).filter(x=>x.at),map=new Map();for(const x of data){const key=factory?clean(x.t.destination):x.t.unitId+':'+x.t.type;if(!map.has(key))map.set(key,{key,label:factory?x.t.destination:x.t.unitName,type:factory?null:x.t.type,dates:[]});map.get(key).dates.push(x.at);}return {summary:arrivalStats(data.map(x=>x.at)),groups:[...map.values()].map(({dates,...g})=>({...g,summary:arrivalStats(dates)})).sort((a,b)=>b.summary.count-a.summary.count||compare(a.label,b.label))};}
 function build(authorizedRows,goal,query={}){
  const year=Number(query.year||local(new Date()).getUTCFullYear()),month=query.month?Number(query.month):null;
  if(!Number.isInteger(year)||year<1900||year>2100||month!=null&&(!Number.isInteger(month)||month<1||month>12)||query.type&&!['PULL','TRANSFER'].includes(query.type))throw Object.assign(new Error('Selecione ano, mês e tipo de viagem válidos.'),{code:'INVALID_DASHBOARD_FILTER',status:422});
  const candidates=authorizedRows.filter(t=>t.status!=='CANCELLED'),match=t=>t.startedAt&&local(t.startedAt).getUTCFullYear()===year&&(!query.unitId||t.unitId===query.unitId)&&(!query.type||t.type===query.type)&&(!query.carrier||clean(t.carrier)===query.carrier)&&(!query.destination||clean(t.destination)===query.destination)&&(!query.driverId||drivers(t).some(d=>d.value===query.driverId))&&(!query.plate||clean(t.plate)===query.plate);
  const yearRows=candidates.filter(match),rows=yearRows.filter(t=>!month||local(t.startedAt).getUTCMonth()+1===month),computed=aggregate(rows,goal),destinations=groups(rows,t=>[{value:clean(t.destination),label:clean(t.destination)||'Sem destino'}],goal),arrival={factory:arrivals(rows,true),unit:arrivals(rows,false)},completed=rows.filter(t=>t.endedAt).length,inProgress=rows.filter(t=>!t.endedAt&&t.status==='IN_PROGRESS').length;
  const options={years:[...new Set([...candidates.filter(t=>t.startedAt).map(t=>local(t.startedAt).getUTCFullYear()),year])].sort((a,b)=>b-a),units:[...new Map(candidates.map(t=>[t.unitId,{value:t.unitId,label:t.unitName}])).values()].sort((a,b)=>compare(a.label,b.label)),carriers:unique(candidates.map(t=>clean(t.carrier))),destinations:unique(candidates.map(t=>clean(t.destination))),drivers:[...new Map(candidates.flatMap(drivers).map(d=>[d.value,d])).values()].sort((a,b)=>compare(a.label,b.label)),plates:unique(candidates.map(t=>clean(t.plate)))};
  return {generatedAt:new Date().toISOString(),filter:{...query,year,month},options,goal,overview:{total:rows.length,completed,inProgress,historicalOpen:rows.filter(t=>t.imported&&!t.endedAt&&t.status==='IN_PROGRESS').length,other:rows.length-completed-inProgress,averageCycleMinutes:computed.cycle.averageMinutes,factoryArrivals:arrival.factory.summary.count,unitArrivals:arrival.unit.summary.count,topDestinations:destinations.slice(0,6)},metrics:computed,
   monthly:Array.from({length:12},(_,i)=>{const slice=yearRows.filter(t=>local(t.startedAt).getUTCMonth()===i);return {month:i+1,total:slice.length,completed:slice.filter(t=>t.endedAt).length,metrics:aggregate(slice,goal)};}),
   breakdowns:{destination:destinations,plate:groups(rows,t=>[{value:t.plate,label:t.plate}],goal),driver:groups(rows,drivers,goal),day:groups(rows,t=>[{value:day(t.startedAt),label:day(t.startedAt).split('-').reverse().join('/')}],goal).sort((a,b)=>compare(a.key,b.key))},arrivals:arrival,
   trips:rows.sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)).map(t=>({...t,metrics:metrics(t)}))};
 }
 function csv(rows){return '\ufeff'+rows.map(row=>row.map(value=>{let text=value==null?'':String(value);if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}).join(';')).join('\r\n');}
 function dashboardCsv(report){const rows=[['Análise','Grupo','Indicador','Viagens com cálculo','Aguardando cálculo','Não se aplica','Tempo médio (min)','Meta (min)','Dentro da meta','Acima da meta','Aderência (%)','Meta de aderência (%)','Ano','Mês']];const add=(kind,label,metrics,month)=>{for(const k of keys){const m=metrics[k];rows.push([kind,label,labels[k],m.count,m.missingCount,m.notApplicableCount,m.averageMinutes,m.targetMinutes,m.within,m.above,m.adherencePercent,m.adherenceTargetPercent,report.filter.year,month]);}};
  add('Resumo','Período selecionado',report.metrics,report.filter.month);for(const m of report.monthly.filter(m=>!report.filter.month||m.month===report.filter.month))add('Planificador',String(m.month).padStart(2,'0'),m.metrics,m.month);for(const [kind,name]of [['destination','Destino'],['plate','Placa'],['driver','Motorista'],['day','Dia']])for(const g of report.breakdowns[kind])add(name,g.label,g.metrics,report.filter.month);return csv(rows);
 }
 function arrivalsCsv(report,kind){if(!['factory','unit'].includes(kind))throw Error('Selecione o tipo de chegada.');const data=report.arrivals[kind],rows=[['Análise','Grupo','Tipo','Chegadas','Horário mediano UTC−3','Menor horário UTC−3','Maior horário UTC−3','Horas de pico UTC−3','Hora UTC−3','Quantidade','Ano','Mês']],clock=m=>m==null?'':`${String(Math.floor(Math.min(1439,Math.round(m))/60)).padStart(2,'0')}:${String(Math.min(1439,Math.round(m))%60).padStart(2,'0')}`;
  for(const g of [{label:'Total do período',type:'',summary:data.summary},...data.groups])for(const bin of g.summary.bins)rows.push([kind==='factory'?'Chegada à fábrica':'Chegada à revenda',g.label,g.type,g.summary.count,clock(g.summary.medianMinute),clock(g.summary.firstMinute),clock(g.summary.lastMinute),g.summary.peakHours.map(h=>`${String(h).padStart(2,'0')}h`).join(', '),`${String(bin.hour).padStart(2,'0')}:00`,bin.count,report.filter.year,report.filter.month]);return csv(rows);
 }
 window.DISB_PULL_ANALYTICS=Object.freeze({build,metrics,aggregate,arrivalStats,csv,dashboardCsv,arrivalsCsv});
})();
