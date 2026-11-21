/* FDR: helpers puros para filtros e normalização dos registros. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISB_FDR=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 const VIEWS={'fdr-reports':['Apontamento Fora do Raio','Registre e consulte entregas apontadas fora do raio do cliente.']};
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
 return {VIEWS,text,norm,filterRows};
});
