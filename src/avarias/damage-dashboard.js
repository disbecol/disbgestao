/* Indicadores de avarias: dados existentes, sem importação ou alteração de registros. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISB_DAMAGE_DASHBOARD=api;})(typeof window==='object'?window:globalThis,()=>{
 'use strict';
 const STATUS={PENDENTE:'Pendente',APROVADO:'Aprovado',LANCADO:'Lançado no sistema',ENTREGUE:'Entregue',REPROVADO:'Reprovado',CANCELADO:'Cancelado'};
 const TYPES={TROCA:'Trocas',REPOSICAO:'Reposições',NAO_CLASSIFICADA:'Não classificadas'};
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
 const type=reason=>/^(nao foi no caminhao|faltando na grade|falta de produto|falta de produtos|falta)$/.test(norm(reason))?'REPOSICAO':/^(sem tampa|quebrado|mal cheia|furada|embalagem amassada\/rasgada|amassado|rasgada|vencido|validade)$/.test(norm(reason))?'TROCA':'NAO_CLASSIFICADA';
 function flatten(requests){
  const seen=new Set(),rows=[];
  for(const request of requests||[]){
   const all=request.items||[],eligible=all.filter(i=>!['REPROVADO','CANCELADO'].includes(i.status)),complete=eligible.length>0&&eligible.every(i=>i.status==='ENTREGUE');
   for(const item of all){if(seen.has(item.id))continue;seen.add(item.id);
    const created=Date.parse(request.created_at||item.created_at),delivered=Date.parse(item.delivered_at);
    const days=item.status==='ENTREGUE'&&Number.isFinite(created)&&Number.isFinite(delivered)&&delivered>=created?(delivered-created)/86400000:null;
    const product=String(item.product_text||'Produto não informado'),match=product.match(/^\s*(\d+)\s*[-–•]/);
    rows.push({...item,request_id:request.id,date:request.occurrence_date,request_created_at:request.created_at,
     driver:request.delivery_name||'Não informado',driver_key:request.delivery_user_id||norm(request.delivery_name)||'unknown',
     customer_code:request.customer_code,customer_name:request.customer_name,city:request.city||'Não informada',map_number:request.map_number,
     product,product_key:match?'C:'+match[1]:norm(product),type:type(item.reason),quantity:number(item.quantity),unit:String(item.quantity_unit||'').toUpperCase(),
     request_eligible:eligible.length>0,request_complete:complete,lead_days:days});
   }
  }
  return rows;
 }
 function filter(rows,f={}){const query=norm(f.search);return rows.filter(r=>(!f.driver||r.driver_key===f.driver)&&(!f.city||norm(r.city)===f.city)&&(!f.reason||norm(r.reason)===f.reason)&&(!f.status||r.status===f.status)&&(!f.type||r.type===f.type)&&(!query||norm([r.customer_code,r.customer_name,r.map_number,r.product,r.lot,r.city,r.driver].join(' ')).includes(query)));}
 function stats(rows,now=Date.now()){
  const requests=new Map(rows.map(r=>[r.request_id,r])),eligible=[...requests.values()].filter(r=>r.request_eligible),delivered=rows.filter(r=>r.status==='ENTREGUE'),lead=delivered.filter(r=>r.lead_days!=null),open=rows.filter(r=>['PENDENTE','APROVADO','LANCADO'].includes(r.status));
  return {occurrences:requests.size,items:rows.length,customers:new Set(rows.map(r=>r.customer_code)).size,
   delivered:delivered.length,pending:rows.filter(r=>r.status==='PENDENTE').length,approved:rows.filter(r=>r.status==='APROVADO').length,
   launched:rows.filter(r=>r.status==='LANCADO').length,rejected:rows.filter(r=>r.status==='REPROVADO').length,cancelled:rows.filter(r=>r.status==='CANCELADO').length,
   open:open.length,complete:eligible.filter(r=>r.request_complete).length,eligible:eligible.length,infull:eligible.length?eligible.filter(r=>r.request_complete).length/eligible.length:null,
   averageDays:lead.length?lead.reduce((n,r)=>n+r.lead_days,0)/lead.length:null,leadCount:lead.length,missingLead:delivered.length-lead.length,
   units:rows.filter(r=>r.unit==='UNIDADE').reduce((n,r)=>n+(r.quantity||0),0),boxes:rows.filter(r=>r.unit==='CAIXA').reduce((n,r)=>n+(r.quantity||0),0),
   unknownQuantity:rows.filter(r=>r.quantity==null||!['CAIXA','UNIDADE'].includes(r.unit)).length,
   withMap:new Set(rows.filter(r=>r.map_number&&r.map_number!=='-').map(r=>r.request_id)).size,
   oldestDays:open.length?Math.max(0,...open.map(r=>Number.isFinite(Date.parse(r.request_created_at))?(now-Date.parse(r.request_created_at))/86400000:0)):null};
 }
 function group(rows,key,label){const map=new Map();for(const r of rows){const k=key(r)||'unknown';if(!map.has(k))map.set(k,{key:k,label:label?label(r):k,rows:[]});map.get(k).rows.push(r);}return [...map.values()].map(g=>({...g,...stats(g.rows)})).sort((a,b)=>b.occurrences-a.occurrences||b.items-a.items||a.label.localeCompare(b.label,'pt-BR',{numeric:true}));}
 const daily=rows=>group(rows,r=>r.date).sort((a,b)=>a.key.localeCompare(b.key));
 function aging(rows,now){const groups=[{label:'Até 2 dias',total:0},{label:'3 a 7 dias',total:0},{label:'8 a 15 dias',total:0},{label:'Mais de 15 dias',total:0},{label:'Sem data de registro',total:0}];for(const r of rows.filter(r=>['PENDENTE','APROVADO','LANCADO'].includes(r.status))){const created=Date.parse(r.request_created_at),days=(now-created)/86400000,i=!Number.isFinite(created)?4:days<3?0:days<8?1:days<16?2:3;groups[i].total++;}return groups;}
 function comparison(rows,previous){const a=group(rows,r=>r.date.slice(5,7)),b=group(previous,r=>r.date.slice(5,7)),months=[...new Set([...a,...b].map(g=>g.key))].sort();return months.map(month=>{const current=a.find(g=>g.key===month),prior=b.find(g=>g.key===month),value=current?.occurrences||0,old=previous.length?prior?.occurrences||0:null;return {month,current:value,previous:old,delta:old==null||old===0?null:(value-old)/old};});}
 const choices=(rows,key,label)=>[...new Map(rows.map(r=>[key(r),label(r)])).entries()].filter(([k])=>k).map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR',{numeric:true}));
 return {STATUS,TYPES,norm,esc,type,flatten,filter,stats,group,daily,aging,comparison,choices};
});
