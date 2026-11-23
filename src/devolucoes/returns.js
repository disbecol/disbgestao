/* Devoluções: importação e indicadores, sem acesso à rede ou à sessão. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISB_RETURNS=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const STATUS={AGUARDANDO_REPASSE:'Aguardando repasse',DEVOLVIDO:'Devolvido',PARCIAL:'Devolução parcial',REVERTIDO:'Revertido'};
  const PENALTY_STATUS={BLOQUEAR:'Bloquear',BLOQUEADO:'Bloqueado',LIBERAR:'Liberar',LIBERADO:'Liberado pós bloqueio'};
  const FOLLOWUP_VIEWS=['returns-summary','returns-panel','returns-city','returns-clients','returns-new-clients','returns-sellers','returns-team','returns-reasons','returns-radius'];
  const VIEWS={
    'returns-followup':['Acompanhamentos','Indicadores e análises das devoluções por período.'],
    'returns-summary':['Resumo','Totais, metas e evolução das devoluções.'],
    'returns-panel':['Painel de devoluções','Notas devolvidas, motivos e tratativas por período.'],
    'returns-city':['Análise por cidade','Participação e detalhes das cidades.'],
    'returns-clients':['Análise por clientes','Clientes com devoluções, valores e volume no período.'],
    'returns-new-clients':['Clientes novos','Devoluções até 60 dias do cadastro, considerando a data da devolução.'],
    'returns-sellers':['Análise por Vendedor','Participação, valor e volume das devoluções por vendedor.'],
    'returns-team':['Análise por QLP','Participação dos motoristas e ajudantes nas devoluções.'],
    'returns-penalties':['Bloqueios por recorrência','Monitore ocorrências nos últimos 60 dias e confirme os bloqueios e liberações.'],
    'returns-reasons':['Análise de motivos','Motivos, valores, volume e comparação da auditoria.'],
    'returns-radius':['Análise por raio','Devoluções dentro e fora do raio, por motorista e justificativa.'],
    'returns-monitoring':['Monitoramento','Registre os apontamentos de devolução feitos pelos motoristas e acompanhe se foram encontrados na base.'],
    'returns-audited':['Devoluções auditadas','Audite as devoluções reais importadas da aba 03.02.24, mesmo que não tenham sido monitoradas.'],
    'returns-priorities':['Prioridades do dia','Cadastre as prioridades informadas pelo gerente e identifique-as no Monitoramento.'],
    'returns-priority-sheet':['Prioridades por motorista','Veja as prioridades da data agrupadas pelas rotas e imprima a tabela para encaminhar aos motoristas.'],
    'returns-goals':['Metas','Configure as metas de devolução por unidade e mês.'],
    'returns-import':['Bases do Google','Preencha as abas da unidade no Google Planilhas e acompanhe a atualização.']
  };
  const text=v=>String(v??'').trim().replace(/\s+/g,' ');
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const REASON_ALIASES={'c pedidos duplicados':'pedido duplicado','pedidos duplicados':'pedido duplicado','pdv fechado':'pdv fechado horario com','sem dinheiro':'sem dinheiro cheque','forma de pagamento':'forma pagamento errada','forma pagamento':'forma pagamento errada','cliente canelou':'cliente cancelou','pdv fechado horario comercial':'pdv fechado horario com','produto quantidade errada':'produto qtde errada','forma de pagamento errada':'forma pagamento errada'};
  const REASON_LABELS={'horario de entrega':'Horário de entrega','nao fez pedido':'Não fez pedido','cliente cancelou':'Cliente cancelou','pdv fechado horario com':'PDV fechado (horário comercial)','produto qtde errada':'Produto / quantidade errada','sem dinheiro cheque':'Sem dinheiro / cheque','nf errada':'NF errada','endereco nao encontrado':'Endereço não encontrado','forma pagamento errada':'Forma de pagamento errada','tempo insuficiente':'Tempo insuficiente','sem vasilhame':'Sem vasilhame','pedido duplicado':'Pedido duplicado','dificil acesso':'Difícil acesso'};
  const reasonKey=v=>REASON_ALIASES[norm(v)]||norm(v);
  const reasonLabel=v=>REASON_LABELS[reasonKey(v)]||text(v);
  const cityLabel=v=>/^(?:[a-z]{2}[- ]?\d{4,}|\d+)$/i.test(text(v))?'':text(v).toLocaleUpperCase('pt-BR');
  function preferredLabel(a,b){const score=s=>(s.match(/[^\u0000-\u007f]/g)||[]).length;return score(b)>score(a)||score(b)===score(a)&&b.localeCompare(a,'pt-BR')<0?b:a;}
  function labels(rows,field){const map=new Map();for(const r of rows){const value=field==='reason'?reasonKey(r[field]):norm(field==='city'?cityLabel(r[field]):r[field]),label=field==='reason'?reasonLabel(r[field]):field==='city'?cityLabel(r[field]):text(r[field]);if(!value)continue;map.set(value,map.has(value)?preferredLabel(map.get(value),label):label);}return [...map].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'));}
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const identifier=v=>{if(typeof v==='number'){if(!Number.isSafeInteger(v)||v<0)return '';return String(v);}return text(v).replace(/\.0$/,'');};
  function day(value){
    if(value instanceof Date)return Number.isNaN(+value)?null:value.toISOString().slice(0,10);
    if(typeof value==='number'){if(!Number.isFinite(value)||value<20000||value>80000)return null;return new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);}
    const raw=text(value);let y,m,d,match;
    if((match=/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(raw)))[,y,m,d]=match;
    else if((match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw)))[,d,m,y]=match;else return null;
    const date=new Date(Date.UTC(+y,+m-1,+d));return date.getUTCFullYear()===+y&&date.getUTCMonth()===+m-1&&date.getUTCDate()===+d?`${y}-${m}-${d}`:null;
  }
  function number(value){
    if(value===null||value===undefined||text(value)==='')return null;
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    let s=text(value).replace(/R\$|\s/g,'');if(!/^-?[\d.,]+$/.test(s))return null;
    if(s.includes(','))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
    else if((s.match(/\./g)||[]).length>1)s=s.replace(/\./g,'');
    const n=Number(s);return Number.isFinite(n)?n:null;
  }
  const cents=v=>{const n=number(v);return n===null||n<0||n>1e11?null:Math.round((n+Number.EPSILON)*100);};
  const volume=v=>{const n=number(v);return n===null||n<0||n>1e9?null:Math.round(n*10000)/10000;};
  const dateShift=(d,n)=>{const v=new Date(d+'T12:00:00Z');v.setUTCDate(v.getUTCDate()+n);return v.toISOString().slice(0,10);};
  const ratio=(n,d)=>d>0?n/d:null;
  const customerDay=r=>[r.operation_date,r.customer_code,r.map_number||''].join('~');
  const unique=rows=>new Set(rows.map(customerDay)).size;
  function csv(source){
    source=String(source||'').replace(/^\uFEFF/,'');const first=source.split(/\r?\n/,1)[0],sep=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<source.length;i++){const c=source[i];if(quoted){if(c==='"'&&source[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"')quoted=true;else if(c===sep){row.push(cell);cell='';}else if(c==='\n'){row.push(cell.replace(/\r$/,''));if(row.some(x=>text(x)))rows.push(row);row=[];cell='';}else cell+=c;}
    if(quoted)throw Error('O CSV contém aspas sem fechamento.');if(cell||row.length){row.push(cell.replace(/\r$/,''));if(row.some(x=>text(x)))rows.push(row);}return rows;
  }
  const key=(...parts)=>parts.map(v=>text(v).replace(/~/g,' ')).join('~');
  function header(rows,required){for(let i=0;i<Math.min(rows.length,30);i++){const names=(rows[i]||[]).map(norm);if(required.every(aliases=>aliases.some(a=>names.includes(a))))return {index:i,names};}throw Error('Cabeçalho do relatório não encontrado. Confira o tipo de importação.');}
  const column=(names,...aliases)=>names.findIndex(h=>aliases.includes(h));
  function issue(errors,row,message){errors.push({row,message});}
  function report(rows){
    const h=header(rows,[['mapa'],['cod cliente','codigo cliente'],['valor'],['volume']]),start=column(h.names,'mapa');
    const sliced=h.names.slice(start,start+20);
    if(sliced.length<20||!['cod cliente','codigo cliente'].includes(sliced[6])||sliced[12]!=='valor'||sliced[13]!=='volume')throw Error('Use o relatório 03.02.24, com os campos de Mapa até Hora (F:Y no arquivo de referência).');
    const errors=[],groups=new Map(),seen=new Set();let duplicates=0,sourceRows=0;
    for(let index=h.index+1;index<rows.length;index++){
      const v=(rows[index]||[]).slice(start,start+20);if(!v.some(x=>text(x)))continue;if(norm(v[0]).startsWith('total'))continue;sourceRows++;
      const r={operation_date:day(v[1]),return_date:day(v[14]),map_number:identifier(v[0]),invoice_number:identifier(v[3]),invoice_series:identifier(v[4]),customer_code:identifier(v[6]),customer_name:text(v[7]),amount_cents:cents(v[12]),volume_hl:volume(v[13]),reason_code:identifier(v[15]),reason:text(v[16]),plate:text(v[11]).toUpperCase(),return_time:text(v[19]),report_user:text(v[18]),source:{unb_note:text(v[2]),unb_customer:text(v[5]),phone:text(v[8]),area:text(v[9]),sector:text(v[10]),order_origin:text(v[17])}};
      if(!r.operation_date||!r.map_number||!r.invoice_number||!r.customer_code||r.amount_cents===null||r.volume_hl===null||!r.return_date){issue(errors,index+1,'Confira data, mapa, nota, cliente, valor e volume.');continue;}
      const fingerprint=JSON.stringify(r);if(seen.has(fingerprint)){duplicates++;continue;}seen.add(fingerprint);
      r.row_key=key(r.operation_date,r.map_number,r.invoice_number,r.invoice_series,r.customer_code,r.return_date,r.return_time);
      const previous=groups.get(r.row_key);
      if(previous){previous.amount_cents+=r.amount_cents;previous.volume_hl=Math.round((previous.volume_hl+r.volume_hl)*10000)/10000;previous.reasons.push({reason:r.reason,reason_code:r.reason_code,amount_cents:r.amount_cents,volume_hl:r.volume_hl});previous.reason=[...new Set(previous.reasons.map(x=>x.reason))].join(' / ');}
      else{r.reasons=[{reason:r.reason,reason_code:r.reason_code,amount_cents:r.amount_cents,volume_hl:r.volume_hl}];groups.set(r.row_key,r);}
    }
    return {kind:'REPORT',rows:[...groups.values()],errors,duplicates,sourceRows};
  }
  function orders(rows,unit=''){
    const h=header(rows,[['mapa'],['cliente'],['emissao'],['nota'],['total']]);
    // O relatório original repete Mapa/Cliente com pontuação e zeros à esquerda.
    const at=name=>{const exact=rows[h.index].findIndex(value=>text(value).toLocaleLowerCase('pt-BR')===name);return exact>=0?exact:column(h.names,name);};
    const id=value=>{const raw=identifier(value);return /^\d[\d.]*$/.test(raw)?raw.replace(/\.(?=\d{3}(?:\.|$))/g,'').replace(/^0+(?=\d)/,''):raw;};
    const c={map:at('mapa'),code:at('cliente'),date:at('emissao'),invoice:at('nota'),series:at('serie'),name:at('nome'),amount:at('total'),status:at('status'),product:at('produto'),quantity:at('qtde'),driver:at('motorista'),city:at('cidade'),seller:at('vendedor')};
    const errors=[],groups=new Map(),seen=new Set();let duplicates=0,sourceRows=0;
    const branch=column(h.names,'filial'),expected=norm(unit).includes('caico')?'1':norm(unit).includes('pau dos ferros')?'6':'';
    for(let i=h.index+1;i<rows.length;i++){
      const v=rows[i]||[];if(![c.map,c.code,c.date,c.invoice,c.amount].some(k=>text(v[k])))continue;if(unit&&branch>=0&&id(v[branch])!==expected)continue;if(['c','cancelado','cancelada'].includes(norm(v[c.status])))continue;sourceRows++;
      const r={operation_date:day(v[c.date]),map_number:id(v[c.map]),customer_code:id(v[c.code]),customer_name:text(v[c.name]),invoice_number:id(v[c.invoice]),invoice_series:id(v[c.series]),order_amount_cents:cents(v[c.amount]),driver_code:id(v[c.driver]),city:text(v[c.city]),seller:text(v[c.seller])};
      if(!r.operation_date||!r.map_number||!r.customer_code||!r.invoice_number||r.order_amount_cents===null){issue(errors,i+1,'Pedido sem data, mapa, cliente, nota ou total válido.');continue;}
      r.row_key=key(r.operation_date,r.map_number,r.customer_code,r.invoice_number,r.invoice_series);
      const fingerprint=key(r.row_key,text(v[c.product]),text(v[c.quantity]),r.order_amount_cents);if(seen.has(fingerprint)){duplicates++;continue;}seen.add(fingerprint);
      const previous=groups.get(r.row_key);if(previous)previous.order_amount_cents+=r.order_amount_cents;else groups.set(r.row_key,r);
    }return {kind:'ORDERS',rows:[...groups.values()],errors,duplicates,sourceRows};
  }
  function journeys(rows){
    const h=header(rows,[['mapa','mapas'],['data'],['motorista']]),at=(...a)=>column(h.names,...a),c={date:at('data'),map:at('mapa','mapas'),driver:at('motorista'),h1:at('ajudante 1','ajudante'),h2:at('ajudante 2'),route:at('rota','cidade')};
    if(c.h2<0&&c.h1>=0&&h.names[c.h1+1]==='ajudante')c.h2=c.h1+1;
    const errors=[],groups=new Map();
    for(let i=h.index+1;i<rows.length;i++){const v=rows[i]||[];if(!v.some(x=>text(x))||!identifier(v[c.map])&&(!text(v[c.driver])||text(v[c.driver]).startsWith('#')))continue;const r={operation_date:day(v[c.date]),map_number:identifier(v[c.map]),driver:text(v[c.driver]),helper1:text(v[c.h1]),helper2:text(v[c.h2]),route:text(v[c.route]),is_drop:/\bdrop\b/i.test(text(v[c.route]))?true:null};
      if(!r.operation_date||!r.map_number){issue(errors,i+1,'Jornada sem data ou mapa válido.');continue;}r.row_key=key(r.operation_date,r.map_number);const old=groups.get(r.row_key);if(old&&JSON.stringify(old)!==JSON.stringify(r)){issue(errors,i+1,'O mesmo mapa/data tem equipes diferentes.');continue;}groups.set(r.row_key,r);
    }return {kind:'JOURNEYS',rows:[...groups.values()],errors,duplicates:0,sourceRows:groups.size};
  }
  function routeTotals(rows,unit=''){
    const h=header(rows,[['data','dia','data de entrega'],['pdvs','pdv','pdvs em rota','pdv em rota','clientes'],['hl','hl em rota','volume']]),c={date:column(h.names,'data','dia','data de entrega'),pdv:column(h.names,'pdvs','pdv','pdvs em rota','pdv em rota','clientes'),hl:column(h.names,'hl','hl em rota','volume'),unit:column(h.names,'unidade','revenda')};
    const errors=[],groups=new Map();
    for(let i=h.index+1;i<rows.length;i++){const v=rows[i]||[];if(!v.some(x=>text(x))||norm(v[c.date]).startsWith('total'))continue;if(c.unit>=0&&unit&&text(v[c.unit])&&norm(v[c.unit])!==norm(unit))continue;
      const r={operation_date:day(v[c.date]),planned_outlets:number(v[c.pdv]),planned_hl:volume(v[c.hl])};
      if(r.planned_outlets===null&&r.planned_hl===null)continue;
      if(!r.operation_date||r.planned_outlets===null||!Number.isSafeInteger(r.planned_outlets)||r.planned_outlets<0||r.planned_hl===null){issue(errors,i+1,'Preencha uma data válida e os dois totais (PDVs e HL). Zero é permitido.');continue;}
      r.row_key=r.operation_date;const old=groups.get(r.row_key);if(old){issue(errors,i+1,'Data repetida na mesma unidade. Consolide o total diário antes de importar.');continue;}groups.set(r.row_key,r);
    }return {kind:'ROUTES',rows:[...groups.values()],errors,duplicates:0,sourceRows:groups.size};
  }
  function routeReport(rows,month,unit){
    if(!/^\d{4}-\d{2}$/.test(month))throw Error('Informe o mês de referência do relatório 17.03.');
    const h=header(rows,[['cod id','codigo id'],['filial'],['dia 01','dia 1']]),code=column(h.names,'cod id','codigo id'),branch=column(h.names,'filial');
    const branchCode=norm(unit).includes('caico')?'1':norm(unit).includes('pau dos ferros')?'6':null;
    if(!branchCode)throw Error('A filial do relatório precisa ser identificada para esta unidade.');
    const selected=rows.slice(h.index+1).filter(r=>identifier(r[branch])===branchCode),pdv=selected.filter(r=>identifier(r[code])==='697'),hl=selected.filter(r=>identifier(r[code])==='563');
    if(pdv.length!==1||hl.length!==1)throw Error('O relatório deve conter uma única linha dos indicadores 697 (PDVs com entrega) e 563 (HL de saída) da filial, sem subtotais por vendedor.');
    const daily=[['DATA','PDVS EM ROTA','HL EM ROTA']];
    for(let d=1;d<=31;d++){const date=`${month}-${String(d).padStart(2,'0')}`;if(!day(date))continue;const at=column(h.names,`dia ${String(d).padStart(2,'0')}`,`dia ${d}`);if(at<0)continue;const a=pdv[0][at],b=hl[0][at];if(text(a)===''&&text(b)==='')continue;daily.push([date,a,b]);}
    return routeTotals(daily);
  }
  function customers(rows,unit=''){
    const errors=[],groups=new Map();
    for(let i=1;i<rows.length;i++){const v=rows[i]||[],code=identifier(v[6]);if(!code||!/^\d+$/.test(code))continue;const r={row_key:code,customer_code:code,customer_name:text(v[7]),seller:text(v[9]),branch:text(v[10]),city:text(v[11])};if(unit&&!([norm(unit),norm(unit).replace(/^(matriz|filial) /,'')].includes(norm(r.branch))))continue;if(r.customer_name&&!r.customer_name.startsWith('#'))groups.set(code,r);}
    return {kind:'CUSTOMERS',rows:[...groups.values()],errors,duplicates:0,sourceRows:groups.size};
  }
  function filterRows(rows,f={}){const q=norm(f.search);return rows.filter(r=>(!f.from||r.operation_date>=f.from)&&(!f.to||r.operation_date<=f.to)&&(!f.city||norm(cityLabel(r.city))===norm(f.city))&&(!f.driver||norm(r.driver)===norm(f.driver))&&(!f.reason||reasonKey(r.reason||r.driver_reason)===reasonKey(f.reason))&&(!f.status||r.status===f.status)&&(!q||norm([r.customer_code,r.customer_name,r.map_number,r.city,r.driver,r.helper1,r.helper2,r.reason,r.driver_reason,r.client_reason,r.invoice_number].join(' ')).includes(q)));}
  function totals(rows){return {outlets:unique(rows),amount_cents:rows.reduce((s,r)=>s+Number(r.amount_cents||0),0),volume_hl:rows.reduce((s,r)=>s+Math.round(Number(r.volume_hl||0)*10000),0)/10000,notes:rows.length};}
  function occurrences(rows){const groups=new Map(),join=values=>{const map=new Map();for(const value of values){const label=text(value);if(label)map.set(norm(label),map.has(norm(label))?preferredLabel(map.get(norm(label)),label):label);}return [...map.values()].join(' / ');};for(const row of rows){const key=customerDay(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}return [...groups].map(([row_key,items])=>{const total=totals(items),invoices=new Map();for(const r of items){if(text(r.invoice_number))invoices.set(key(r.invoice_number,r.invoice_series),{number:text(r.invoice_number),series:text(r.invoice_series)});}const notes=[...invoices.values()].sort((a,b)=>a.number.localeCompare(b.number,'pt-BR',{numeric:true})||a.series.localeCompare(b.series));const display=notes.map(n=>n.number+(notes.some(other=>other!==n&&other.number===n.number)?' (série '+(n.series||'não informada')+')':''));return {...items[0],row_key,amount_cents:total.amount_cents,volume_hl:total.volume_hl,note_count:invoices.size,source_count:items.length,invoice_number:join(notes.map(n=>n.number)),notes_display:display.join(' / '),reason:join(items.flatMap(r=>(Array.isArray(r.reasons)&&r.reasons.length?r.reasons:[r]).map(v=>reasonLabel(v.reason)))),seller:join(items.map(r=>r.seller)),driver:join(items.map(r=>r.driver)),helper1:join(items.map(r=>r.helper1)),helper2:join(items.map(r=>r.helper2)),driver_treatment:join(items.map(r=>r.driver_treatment)),responsibles:[...new Set(items.flatMap(r=>r.responsibles||[]))],penalty_eligible:items.some(r=>r.penalty_eligible===true),exclusion:items.find(r=>r.exclusion)?.exclusion||null};});}
  function grouped(rows,field){const map=new Map();for(const r of rows){const raw=typeof field==='function'?field(r):r[field],label=(field==='reason'?reasonLabel(raw):field==='city'?cityLabel(raw):text(raw))||'Não informado',k=field==='reason'?reasonKey(label):norm(label);if(!map.has(k))map.set(k,{label,rows:[]});const group=map.get(k);group.label=preferredLabel(group.label,label);group.rows.push(r);}const denominator=unique(rows);return [...map.values()].map(g=>({label:g.label,...totals(g.rows),share:ratio(unique(g.rows),denominator)})).sort((a,b)=>b.amount_cents-a.amount_cents||b.outlets-a.outlets||a.label.localeCompare(b.label,'pt-BR'));}
  function clientGroups(rows){const groups=new Map();for(const r of rows){const code=identifier(r.customer_code);if(!groups.has(code))groups.set(code,[]);groups.get(code).push(r);}const total=unique(rows);return [...groups].map(([customer_code,items])=>{const recent=[...items].sort((a,b)=>b.operation_date.localeCompare(a.operation_date)),customer_name=recent.find(r=>text(r.customer_name))?.customer_name||'Não informado',city=cityLabel(recent.find(r=>cityLabel(r.city))?.city);return {customer_code,customer_name,city,label:customer_code+' · '+customer_name,days:new Set(items.map(r=>r.operation_date)).size,...totals(items),share:ratio(unique(items),total)};}).sort((a,b)=>b.amount_cents-a.amount_cents||b.outlets-a.outlets||a.customer_code.localeCompare(b.customer_code,'pt-BR',{numeric:true}));}
  function registrationAge(row){const registered=day(row.registration_date),operation=day(row.operation_date);if(!registered||!operation)return null;const age=Math.round((Date.parse(operation+'T00:00:00Z')-Date.parse(registered+'T00:00:00Z'))/86400000);return age>=0?age:null;}
  function analytics(snapshot,filter={}){
    const raw=snapshot.reports||[],rows=filterRows(raw,filter),audits=filterRows(snapshot.cases||[],filter),t=totals(rows),routes=(snapshot.routes||[]).filter(r=>(!filter.from||r.operation_date>=filter.from)&&(!filter.to||r.operation_date<=filter.to)),routeDates=new Set(routes.map(r=>r.operation_date));
    const missingDates=[...new Set(rows.map(r=>r.operation_date))].filter(d=>!routeDates.has(d));
    const plannedOutlets=routes.length?routes.reduce((s,r)=>s+Number(r.planned_outlets),0):null,plannedHl=routes.length?routes.reduce((s,r)=>s+Math.round(Number(r.planned_hl)*10000),0)/10000:null;
    const counts=Object.fromEntries(Object.keys(STATUS).map(s=>[s,audits.filter(r=>r.status===s).length]));
    const recent=rows;
    const recurring=new Map();for(const r of recent){const code=r.customer_code;if(!recurring.has(code))recurring.set(code,[]);recurring.get(code).push(r);}
    const recurrence=[...recurring].filter(([,v])=>new Set(v.map(r=>r.operation_date)).size>1).map(([customer_code,v])=>({customer_code,customer_name:v[0].customer_name,city:v[0].city,days:new Set(v.map(r=>r.operation_date)).size,...totals(v),rows:v})).sort((a,b)=>b.days-a.days||b.amount_cents-a.amount_cents);
    const helperRows=rows.flatMap(r=>[...new Set([text(r.helper1),text(r.helper2)].filter(Boolean))].map(helper=>({...r,helper})));
    const scoped=!!(filter.city||filter.driver||filter.reason||filter.search);
    const daily=[...new Set([...rows.map(r=>r.operation_date),...routes.map(r=>r.operation_date)])].sort().map(date=>{const g=totals(rows.filter(r=>r.operation_date===date)),p=routes.find(r=>r.operation_date===date);return {date,...g,planned_outlets:p?.planned_outlets??null,planned_hl:p?.planned_hl??null,outlet_rate:scoped?null:ratio(g.outlets,p?.planned_outlets),hl_rate:scoped?null:ratio(g.volume_hl,p?.planned_hl)};}).filter(d=>d.outlets>0||d.planned_outlets>0||d.planned_hl>0);
    const matrix=new Map();for(const a of audits){const driver=reasonLabel(a.driver_reason)||'Não informado',client=reasonLabel(a.client_reason)||'Sem auditoria do cliente',k=key(reasonKey(driver),reasonKey(client));if(!matrix.has(k))matrix.set(k,{driver,client,count:0});matrix.get(k).count++;}
    const reasons=rows.flatMap(r=>(Array.isArray(r.reasons)&&r.reasons.length?r.reasons:[r]).map(reason=>({...r,...reason})));
    const fresh=rows.filter(r=>{const age=registrationAge(r);return age!==null&&age<=60;});
    return {rows,audits,totals:t,newCustomers:{rows:occurrences(fresh),clients:clientGroups(fresh),totals:totals(fresh),unknown:unique(rows.filter(r=>registrationAge(r)===null))},clients:clientGroups(rows),cities:grouped(rows,'city'),drivers:grouped(rows,'driver'),helpers:grouped(helperRows,'helper'),drop:grouped(rows.filter(r=>r.is_drop===true),'driver'),dropUnknown:rows.filter(r=>r.is_drop==null).length,sellers:grouped(rows,'seller'),reasons:grouped(reasons,'reason'),weekdays:grouped(rows,r=>['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][new Date(r.operation_date+'T12:00:00Z').getUTCDay()]),daily,recurrence,largest:occurrences(rows).sort((a,b)=>b.amount_cents-a.amount_cents).slice(0,10),counts,reversal_rate:ratio(counts.REVERTIDO,counts.REVERTIDO+counts.DEVOLVIDO+counts.PARCIAL),reversal_all:ratio(counts.REVERTIDO,audits.length),driverReasons:grouped(audits.map(r=>({...r,reason:r.driver_reason,amount_cents:r.order_amount_cents})),'reason'),clientReasons:grouped(audits.map(r=>({...r,reason:r.client_reason||'Sem auditoria do cliente',amount_cents:r.order_amount_cents})),'reason'),reasonMatrix:[...matrix.values()].sort((a,b)=>b.count-a.count),route:{days:routes.length,missingDates,scoped,planned_outlets:plannedOutlets,planned_hl:plannedHl,outlet_rate:scoped||missingDates.length||!routes.length?null:ratio(t.outlets,plannedOutlets),hl_rate:scoped||missingDates.length||!routes.length?null:ratio(t.volume_hl,plannedHl)}};
  }
  const toCSV=(headers,rows)=>'\uFEFF'+[headers,...rows].map(row=>row.map(v=>{let s=String(v??'');if(/^[=+@\-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');
  const RADIUS_STATUS={INSIDE:'Dentro do raio',OUTSIDE:'Fora do raio',PENDING:'Vínculo pendente'};
  function radiusAnalysis(rows,source,selection=''){
    if(source?.available!==true||!Array.isArray(source.matches))return {available:false,reason:source?.reason||'UNAVAILABLE'};
    const matches=new Map(source.matches.map(r=>[customerDay(r),r]));
    const selected=occurrences(rows).map(r=>{const m=matches.get(customerDay(r));return {...r,radius_state:Object.hasOwn(RADIUS_STATUS,m?.state)?m.state:'PENDING',radius_justified:m?.state==='OUTSIDE'?m.justified===true:null,radius_matches:Number(m?.match_count||0)};}).filter(r=>!selection||selection==='JUSTIFIED'&&r.radius_state==='OUTSIDE'&&r.radius_justified||selection==='UNJUSTIFIED'&&r.radius_state==='OUTSIDE'&&!r.radius_justified||r.radius_state===selection);
    const counts=items=>{const total=items.length,inside=items.filter(r=>r.radius_state==='INSIDE').length,outside=items.filter(r=>r.radius_state==='OUTSIDE').length,pending=total-inside-outside,justified=items.filter(r=>r.radius_state==='OUTSIDE'&&r.radius_justified).length;return {total,inside,outside,pending,justified,unjustified:outside-justified,inside_share:ratio(inside,total),outside_share:ratio(outside,total),pending_share:ratio(pending,total),justified_share:ratio(justified,outside),unjustified_share:ratio(outside-justified,outside),...totals(items)};};
    const groups=field=>{const map=new Map();for(const r of selected){const label=(field==='city'?cityLabel(r[field]):text(r[field]))||'Não informado',key=norm(label);if(!map.has(key))map.set(key,{label,rows:[]});const g=map.get(key);g.label=preferredLabel(g.label,label);g.rows.push(r);}return [...map.values()].map(g=>({label:g.label,...counts(g.rows)})).sort((a,b)=>b.outside-a.outside||b.total-a.total||a.label.localeCompare(b.label,'pt-BR'));};
    return {available:true,rows:selected,totals:counts(selected),drivers:groups('driver'),cities:groups('city')};
  }
  return {STATUS,PENALTY_STATUS,RADIUS_STATUS,VIEWS,FOLLOWUP_VIEWS,text,norm,reasonKey,reasonLabel,cityLabel,labels,esc,identifier,day,number,cents,volume,dateShift,ratio,csv,report,orders,journeys,routeTotals,routeReport,customers,filterRows,totals,occurrences,registrationAge,grouped,analytics,radiusAnalysis,toCSV,customerDay};
});
