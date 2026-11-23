/* FDR: helpers puros para filtros e normalização dos registros. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISB_FDR=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 const VIEWS={'fdr-reports':['Apontamento Fora do Raio','Registre e consulte entregas apontadas fora do raio do cliente.'],'fdr-dashboard':['Dashboard fora do raio','Analise os apontamentos, motoristas e justificativas da unidade.']};
 const text=value=>String(value??'').trim();
 const norm=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
 function filterRows(rows,filter={}){
  return rows.filter(row=>
   (!filter.from||row.report_date>=filter.from)&&
   (!filter.to||row.report_date<=filter.to)&&
   (!filter.city||norm(row.city)===norm(filter.city))&&
   (!filter.driver||norm(row.driver)===norm(filter.driver))&&
   (!filter.branch||row.branch===filter.branch)&&
   (filter.justified===''||filter.justified===undefined||String(row.justified)===filter.justified)
  );
 }
 function analytics(rows,filter={}){
  const selected=filterRows([...new Map(rows.map((row,i)=>[row.id||i,row])).values()],filter),total=selected.length,justified=selected.filter(row=>row.justified===true).length;
  const groups=field=>{const map=new Map();for(const row of selected){const label=text(row[field])||'Não informado',key=norm(label);if(!map.has(key))map.set(key,{label,total:0,justified:0});const g=map.get(key);g.total++;if(row.justified===true)g.justified++;}return [...map.values()].map(g=>({...g,unjustified:g.total-g.justified,share:total?g.total/total:null})).sort((a,b)=>b.total-a.total||a.label.localeCompare(b.label,'pt-BR'));};
  return {rows:selected,total,justified,unjustified:total-justified,justified_share:total?justified/total:null,customers:new Set(selected.map(r=>r.customer_code)).size,missing_maps:selected.filter(r=>!text(r.map_number)).length,drivers:groups('driver'),cities:groups('city'),daily:groups('report_date').sort((a,b)=>a.label.localeCompare(b.label))};
 }
 return {VIEWS,text,norm,filterRows,analytics};
});
