/* Cadastro de clientes: reconhece PY050094 e CSVs de referência, sem dados privados. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISB_CUSTOMER_IMPORT=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 const text=v=>String(v??'').replace(/[\r\n\t]+/g,' ').trim().replace(/\s+/g,' ');
 const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const invalid=v=>/[\u0000-\u001f\u007f-\u009f\ufffd]/.test(v);
 function date(value){const v=text(value);if(!v)return null;const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v)||/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);if(!m)return undefined;const iso=v.includes('/')?`${m[3]}-${m[2]}-${m[1]}`:v,[y,mo,d]=iso.split('-').map(Number),dt=new Date(Date.UTC(y,mo-1,d));return y>=1900&&y<=2200&&dt.getUTCFullYear()===y&&dt.getUTCMonth()===mo-1&&dt.getUTCDate()===d?iso:undefined;}
 const branch=value=>{let n=norm(value);if(/^\d+(?:\.0+)?$/.test(text(value)))n=String(Number(text(value)));if(['1','caico','matrizcaico','matriz'].includes(n))return 'Caicó';if(['6','paudosferros','filialpaudosferros'].includes(n))return 'Pau dos Ferros';return '';};
 function plan(input){
  const rows=[],errors=[],stats={sourceRows:input.length,byBranch:{'Caicó':0,'Pau dos Ferros':0},skippedBranches:{},duplicates:0,nameFallbacks:0};
  if(input.length>20000)return {rows,errors:[{row:1,message:'O arquivo ultrapassa o limite de 20 mil linhas.'}],stats};
  if(!input.length)return {rows,errors:[{row:1,message:'O arquivo não possui registros.'}],stats};
  const aliases={code:['codpdv','codigopdv','codcliente','codigocliente','codigo','code'],name:['nomefantasia','fantasia','nome','cliente','name'],legal:['razaosocial','nomelegal'],city:['nomecidade','nomemunicipio','cidade','municipio','city'],branch:['filial','revenda','unidade','branch'],registration:['datadecadastro','datacadastro','registrationdate']};
  const headers=new Map(Object.keys(input[0]).map(h=>[norm(h),h])),keys=Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,names.filter(n=>headers.has(n)).map(n=>headers.get(n))]));
  for(const key of ['code','city','branch'])if(!keys[key].length)errors.push({row:1,message:'Coluna obrigatória não encontrada: '+{code:'Cód PDV',city:'Cidade',branch:'Filial'}[key]+'.'});
  if(!keys.name.length&&!keys.legal.length)errors.push({row:1,message:'Informe Nome Fantasia, Nome ou Razão Social no cabeçalho.'});
  if(errors.length)return {rows,errors,stats};
  const first=(row,list)=>list.map(k=>text(row[k])).find(Boolean)||'',seen=new Map();
  for(let at=0;at<input.length;at++){
   const source=input[at],line=at+2,rawBranch=first(source,keys.branch),mapped=branch(rawBranch);
   if(!mapped){const key=/^\d+$/.test(rawBranch)?String(Number(rawBranch)):rawBranch||'sem filial';stats.skippedBranches[key]=(stats.skippedBranches[key]||0)+1;continue;}
   const rawCode=first(source,keys.code);if(!/^\d+(?:\.0+)?$/.test(rawCode)){errors.push({row:line,message:'Cód PDV inválido.'});continue;}
   const code=rawCode.replace(/\.0+$/,'').replace(/^0+(?=\d)/,'');
   const regular=keys.name.map(k=>text(source[k])).find(v=>v&&!invalid(v)),legal=keys.legal.map(k=>text(source[k])).find(v=>v&&!invalid(v)),name=regular||legal||'',city=first(source,keys.city);
   if(!name||name.length>300||code.length>40||city.length>200||invalid(city)){errors.push({row:line,message:'Confira nome e cidade: campos ausentes, extensos ou com caracteres inválidos.'});continue;}
   if(/^(?:[a-z]{2}[- ]?\d{4,}|\d+)$/i.test(city)){errors.push({row:line,message:'Cidade precisa conter o nome, em vez do código da cidade.'});continue;}
   const registration=keys.registration.length?date(first(source,keys.registration)):null;if(registration===undefined){errors.push({row:line,message:'Data de Cadastro inválida. Use dia/mês/ano.'});continue;}
   const row={code,name,city,branch:mapped,...(keys.registration.length?{registration_date:registration}:{})},key=code+'|'+mapped,previous=seen.get(key);
   if(previous){if(JSON.stringify(previous)!==JSON.stringify(row))errors.push({row:line,message:'O mesmo Cód PDV/Filial possui dados divergentes no arquivo.'});else stats.duplicates++;continue;}
   if(!regular&&legal)stats.nameFallbacks++;seen.set(key,row);rows.push(row);stats.byBranch[mapped]++;
  }
  return {rows,errors,stats};
 }
 function summary(p){const s=p.stats,parts=[p.rows.length.toLocaleString('pt-BR')+' clientes reconhecidos.',`Matriz Caicó: ${s.byBranch['Caicó']}. Filial Pau dos Ferros: ${s.byBranch['Pau dos Ferros']}.`];for(const [key,n] of Object.entries(s.skippedBranches))parts.push(`Filial ${key}: ${n} linha(s) fora da importação; somente filiais 1 e 6 são aceitas.`);if(s.nameFallbacks)parts.push(`${s.nameFallbacks} cadastro(s) usarão a Razão Social por falta de um Nome Fantasia válido.`);if(s.duplicates)parts.push(`${s.duplicates} linha(s) repetida(s) desconsiderada(s).`);if(p.errors.length)parts.push('Corrija o arquivo antes de importar: '+p.errors.slice(0,5).map(e=>'linha '+e.row+': '+e.message).join(' '));return parts.join('\n');}
 return {plan,summary,branch,date};
});
