// Vendas > Escalonada Digital. A planilha continua sendo lida pelo Apps Script
// do projeto original; nenhuma tabela de precos e copiada para o Supabase.
(() => {
  'use strict';

  const ENDPOINT='https://script.google.com/macros/s/AKfycbw6ncAKWC50QgTyujHKh9UkZMSdkK69_Zb7NbXK2eoZpH0-rxwBlBqd57AohA21kBrhwQ/exec';
  const SEGMENTS=['AD_ROTA','ASR','SUB_TRAD','NAD'];
  const clean=value=>String(value??'').trim();
  const searchKey=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
  const hasPrice=value=>!!clean(value)&&!/^(-|#N\/D|#N\/A|#VALUE!|#REF!)$/i.test(clean(value));

  function normalizeProducts(rows){
    if(!Array.isArray(rows))throw new Error('A planilha retornou produtos em formato inválido.');
    return rows.map(row=>{
      const code=clean(row?.codigo),name=clean(row?.nome);
      const ttc={},ttv={};
      for(const segment of SEGMENTS){
        ttc[segment]=clean(row?.ttc?.[segment]);
        ttv[segment]=clean(row?.ttv?.[segment]);
      }
      return {code,name,ttc,ttv};
    }).filter(row=>/^\d+$/.test(row.code)&&Number(row.code)>0&&row.name&&row.name!=='0'
      &&SEGMENTS.some(segment=>hasPrice(row.ttc[segment])||hasPrice(row.ttv[segment])))
      .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{sensitivity:'base'}));
  }

  function formatPrice(value){
    const raw=clean(value);
    if(!hasPrice(raw))return '—';
    const amount=raw.replace(/^R\$\s*/i,'').trim();
    if(/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(amount)){
      const parsed=Number(amount.replace(/\./g,'').replace(',','.'));
      if(Number.isFinite(parsed))return parsed.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    }
    if(/^\d+\.\d{1,2}$/.test(amount)){
      const parsed=Number(amount);
      if(Number.isFinite(parsed))return parsed.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    }
    return raw;
  }

  function searchProducts(products,query,limit=100){
    const term=searchKey(query);
    if(!term)return {total:0,rows:[]};
    const words=term.split(' '),matched=products.filter(row=>searchKey(row.code).includes(term)
      ||words.every(word=>searchKey(row.name).includes(word)));
    return {total:matched.length,rows:matched.slice(0,limit)};
  }

  async function loadPrices(fetcher=fetch){
    const url=`${ENDPOINT}?acao=produtos&_=${Date.now()}`;
    const response=await fetcher(url,{method:'GET',cache:'no-store'});
    if(!response.ok)throw new Error(`A planilha não respondeu (HTTP ${response.status}).`);
    const data=await response.json();
    if(data?.status!=='success')throw new Error(clean(data?.message)||'Não foi possível carregar os preços da planilha.');
    return {products:normalizeProducts(data.produtos),updatedAt:clean(data.atualizadoEm)};
  }

  const api={SEGMENTS,normalizeProducts,formatPrice,searchProducts,loadPrices};
  if(typeof window!=='undefined')window.DISB_SALES_PRICING=api;
})();
