/* Bases autorizadas do Google Planilhas; uma origem fixa por unidade e relatório. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./returns.js'):root.DISB_RETURNS);if(typeof module==='object'&&module.exports)module.exports=api;else root.DISB_RETURNS_GOOGLE=api;})(typeof globalThis!=='undefined'?globalThis:this,R=>{
 'use strict';
 const SPREADSHEET='1hYle_7TyEitARZOYgYPoO5hUcxHsj0xxhTP7YCccGTM',INTERVAL=120000;
 const LABELS={REPORT:'Devoluções',ORDERS:'Pedidos',JOURNEYS:'Equipe',ROUTES:'Totais em rota',PRIORITIES:'Prioridades'};
 const SHEETS={
  'Matriz Caicó':[['REPORT','03.02.24 - MATRIZ',17030001],['ORDERS','PEDIDOS - MATRIZ',17030002],['JOURNEYS','BASE JORNADA LIQ - MATRIZ',17030003],['ROUTES','17.03 - MATRIZ',1816877762],['PRIORITIES','prioridades - matriz',641675492]],
  'Filial Pau dos Ferros':[['REPORT','03.02.24 - FILIAL',17030005],['ORDERS','PEDIDOS - FILIAL',17030006],['JOURNEYS','BASE JORNADA LIQ - FILIAL',17030007],['ROUTES','17.03 - FILIAL',17030008]]
 };
 const sources=unit=>(SHEETS[unit]||[]).map(([kind,title,gid])=>({kind,title,gid,label:LABELS[kind],url:`https://docs.google.com/spreadsheets/d/${SPREADSHEET}/edit#gid=${gid}`,filename:`Google Planilhas / ${kind} / ${gid}`}));
 function readResponse(raw){
  const first=raw.indexOf('{'),last=raw.lastIndexOf('}');if(first<0||last<first)throw Error('A resposta do Google Planilhas não contém dados legíveis.');
  const response=JSON.parse(raw.slice(first,last+1));if(response.status==='error'||!Array.isArray(response.table?.cols)||!Array.isArray(response.table?.rows))throw Error('O Google Planilhas não disponibilizou esta aba para leitura.');
  if(response.table.rows.length>100000)throw Error('A base ultrapassa 100 mil linhas.');
  const cell=value=>{const v=value?.v;if(v==null)return typeof value?.f==='string'?value.f:null;if(typeof v==='string'){const date=/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+)(?:,(\d+))?)?\)$/.exec(v);if(date){const [,y,m,d,h=0,min=0,s=0,ms=0]=date;return (Date.UTC(+y,+m,+d,+h,+min,+s,+ms)-Date.UTC(1899,11,30))/86400000;}}if(Array.isArray(v))return v.slice(0,3).map(n=>String(n).padStart(2,'0')).join(':');return v;};
  return [response.table.cols.map(c=>c.label||''),...response.table.rows.map(r=>response.table.cols.map((_,i)=>cell(r.c?.[i])))];
 }
 function referenceMonth(rows){
  for(let at=0;at<Math.min(rows.length,30);at++){const row=rows[at];for(let i=0;i<row.length;i++)if(['mes referencia','mes de referencia','competencia'].includes(R.norm(row[i]))){for(const value of [row[i+1],rows[at+1]?.[i]]){const date=R.day(value)||R.day(R.text(value)+'-01');if(date)return date.slice(0,7);}throw Error('Mês de referência inválido na aba 17.03. Use 01/mm/aaaa.');}}
  const at=rows.findIndex(row=>row.some(v=>R.norm(v)==='data'));if(at>=0){const col=rows[at].findIndex(v=>R.norm(v)==='data'),months=new Set(rows.slice(at+1).map(r=>R.day(r[col])).filter(Boolean).map(v=>v.slice(0,7)));if(months.size===1)return [...months][0];}
  throw Error('No 17.03 original, informe MES_REFERENCIA em AZ1 e 01/mm/aaaa em AZ2. O formato diário com DATA não precisa desse campo.');
 }
 function directory(orders,unit){
  const groups=new Map();for(const r of [...orders].sort((a,b)=>b.operation_date.localeCompare(a.operation_date))){if(!r.customer_name)continue;const old=groups.get(r.customer_code);if(old&&old.date>r.operation_date)continue;
   if(!old)groups.set(r.customer_code,{row_key:r.customer_code,customer_code:r.customer_code,customer_name:r.customer_name,branch:unit,city:r.city||'',seller:r.seller||'',date:r.operation_date});
   else{if(old.city&&r.city&&R.norm(old.city)!==R.norm(r.city))throw Error(`O PDV ${r.customer_code} tem cidades diferentes na mesma data em PEDIDOS.`);if(!old.city)old.city=r.city||'';old.seller=[...new Set([...old.seller.split(' / '),r.seller].filter(Boolean))].join(' / ');}
  }return [...groups.values()].map(({date,...r})=>r);
 }
 function parse(kind,rows,unit){
  if(kind==='REPORT')return R.report(rows);
  if(kind==='ORDERS')return R.orders(rows,unit);
  if(kind==='JOURNEYS')return R.journeys(rows);
  if(kind==='PRIORITIES')return R.priorities(rows);
  // As três colunas de saída podem coexistir com o 17.03 original a partir de D.
  if(rows.slice(0,30).some(row=>R.norm(row[0])==='data'&&['pdvs em rota','pdvs','pdv'].includes(R.norm(row[1]))&&['hl em rota','hl','volume'].includes(R.norm(row[2]))))return R.routeTotals(rows.map(row=>row.slice(0,3)),unit);
  const names=rows.slice(0,30).flat().map(R.norm);return names.includes('cod id')||names.includes('codigo id')?R.routeReport(rows,referenceMonth(rows),unit):R.routeTotals(rows,unit);
 }
 const hash=async(value,crypto)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');
 function create(adapter){
  let task=null,generation=0,abort=null,lastAttempt=0,lastKey='',activeLease=null;
  const context=()=>adapter.context(),key=()=>`${context().user?.id}|${context().unit}`;
  const now=adapter.now||Date.now,crypto=adapter.crypto||globalThis.crypto;
  function release(lease){if(lease)void lease.client.rpc('returns_google_sync',{p_unit:lease.unit,p_id:lease.id,p_action:'FAIL',p_result:{error:'Atualização interrompida ao sair da sessão ou trocar de unidade.'}}).catch(()=>{});}
  function stop(){const lease=activeLease;generation++;abort?.abort();abort=null;task=null;activeLease=null;lastAttempt=0;lastKey='';release(lease);}
  function pending(){return !!task;}
  async function sync({force=false}={}){
   if(task)return task;if(!adapter.canSync()||!context().user||!context().client)return {skipped:true};
   const current=key();if(lastKey!==current){stop();lastKey=current;}
   if(!force&&lastAttempt&&now()-lastAttempt<INTERVAL)return {skipped:true};
   const unit=context().unit,client=context().client,defs=sources(unit);if(!defs.length)return {skipped:true};
   lastAttempt=now();const token=generation,id=crypto.randomUUID(),identity=key(),statuses={};
   const valid=()=>token===generation&&identity===key();
   const rpc=async(name,args)=>{if(!valid())throw Error('Contexto de sincronização alterado.');const {data,error}=await client.rpc(name,args);if(error)throw error;return data;};
   const lock=(action,extra={})=>rpc('returns_google_sync',{p_unit:unit,p_id:id,p_action:action,...extra});
   task=(async()=>{
    let acquired=false;try{
     const lease=await lock('START');if(!valid()){if(lease.acquired)release({client,unit,id});return {skipped:true};}if(!lease.acquired){adapter.onStatus?.(lease);return {skipped:true,busy:true};}acquired=true;activeLease={client,unit,id};adapter.onStatus?.({running:true,sources:{}});
     abort=new AbortController();const controller=abort;
     const timeout=setTimeout(()=>controller.abort(),20000);
     const fetched=await Promise.allSettled(defs.map(async source=>{try{
      const response=await (adapter.fetch||globalThis.fetch)(`https://docs.google.com/spreadsheets/d/${SPREADSHEET}/gviz/tq?tqx=out:json&gid=${source.gid}&headers=1`,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw Error(`${source.title}: não foi possível ler a aba (${response.status}).`);
      const raw=await response.text();if(raw.length>40*1024*1024)throw Error(`${source.title}: base maior que 40 MB.`);
      const data=parse(source.kind,readResponse(raw),unit);if(data.errors.length)throw Error(`${source.title}: linha ${data.errors[0].row} — ${data.errors[0].message}`);
      if(!valid())throw Error('Contexto de sincronização alterado.');
      return {...source,...data,extra:source.kind==='ORDERS'?directory(data.rows,unit):[]};
     }catch(e){throw Error(`${source.title}: ${e?.name==='AbortError'?'a leitura ultrapassou 20 segundos. Tente novamente.':String(e?.message||e).replace(source.title+': ','')}`);}}));clearTimeout(timeout);
     const failed=[];for(let i=0;i<fetched.length;i++){const f=fetched[i];if(f.status==='rejected'){statuses[defs[i].kind]={state:'ERROR',message:String(f.reason?.message||f.reason)};failed.push(statuses[defs[i].kind].message);}else statuses[defs[i].kind]={state:f.value.rows.length?'OK':'EMPTY',count:f.value.rows.length,...(f.value.warnings?.length?{warning:f.value.warnings.join(' ')}:{})};}
     if(failed.length)throw Error(failed.join('\n'));
     const imports=adapter.imports?.()||[],jobs=[];
     for(const result of fetched){const source=result.value;if(!source.rows.length)continue;
      const rows=[{...source,kind:source.kind,rows:source.rows},...(source.extra.length?[{...source,kind:'CUSTOMERS',filename:`Google Planilhas / CUSTOMERS / ${source.gid}`,rows:source.extra}]:[])];
      for(const item of rows){const digest=await hash({unit,kind:item.kind,rows:item.rows},crypto);const latest=imports.find(r=>r.kind===item.kind&&r.filename===item.filename);if(latest?.file_hash===digest)continue;jobs.push({...item,hash:digest,id:crypto.randomUUID()});}
     }
     for(const job of jobs){await lock('HEARTBEAT');await rpc('returns_begin_import',{p_id:job.id,p_unit:unit,p_kind:job.kind,p_filename:job.filename,p_hash:job.hash,p_count:job.rows.length});
      for(let i=0;i<job.rows.length;i+=250){await lock('HEARTBEAT');await rpc('returns_stage_import',{p_id:job.id,p_rows:job.rows.slice(i,i+250)});}
     }
     const checkpoint=await lock('COMMIT',{p_import_ids:jobs.map(j=>j.id),p_result:{sources:statuses}});adapter.onStatus?.(checkpoint);return {changed:jobs.length>0,checkpoint};
    }catch(error){if(acquired&&valid()){try{const state=await lock('FAIL',{p_result:{error:String(error?.message||error).slice(0,2000),sources:statuses}});adapter.onStatus?.(state);}catch(_e){adapter.onStatus?.({last_error:String(error?.message||error),sources:statuses});}}if(valid())throw error;return {skipped:true};
    }finally{if(valid()){task=null;abort=null;activeLease=null;}}
   })();return task;
  }
  return {sync,stop,pending};
 }
 return {SPREADSHEET,INTERVAL,LABELS,SHEETS,sources,readResponse,referenceMonth,directory,parse,hash,create};
});
