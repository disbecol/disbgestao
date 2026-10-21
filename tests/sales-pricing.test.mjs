import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function pricing(){
  const window={};
  vm.runInNewContext(fs.readFileSync(new URL('../sales-pricing.js',import.meta.url),'utf8'),
    {window,Date},{timeout:3000});
  return window.DISB_SALES_PRICING;
}

test('remove cabecalhos e linhas vazias reais da planilha, preservando formulas',()=>{
  const api=pricing();
  const rows=api.normalizeProducts([
    {codigo:'COD.',nome:'0',ttc:{AD_ROTA:'AD_ROTA'}},
    {codigo:'0',nome:'0',ttc:{AD_ROTA:'#N/D'}},
    {codigo:'988',nome:'BRAHMA 600',ttc:{AD_ROTA:'8,99',ASR:'6,99'},ttv:{AD_ROTA:'131,9'}},
    {codigo:'33857',nome:'STELLA PURE GOLD 600',ttc:{AD_ROTA:'HEIN + 1,00'},ttv:{NAD:'-'}}
  ]);
  assert.equal(rows.length,2);
  assert.equal(rows.find(row=>row.code==='33857').ttc.AD_ROTA,'HEIN + 1,00');
  assert.equal(api.formatPrice('8,99'),'R$ 8,99');
  assert.equal(api.formatPrice('HEIN + 1,00'),'HEIN + 1,00');
  assert.equal(api.formatPrice('-'),'—');
  assert.equal(api.searchProducts(rows,'brahma 600').total,1);
  assert.equal(api.searchProducts(rows,'33857').rows[0].code,'33857');
});

test('recebe os precos atualizados da mesma API do projeto original',async()=>{
  const api=pricing();
  let called='';
  const result=await api.loadPrices(async url=>{
    called=url;
    return {ok:true,json:async()=>({status:'success',atualizadoEm:'21/10/2026 08:52:33',produtos:[
      {codigo:'988',nome:'BRAHMA 600',ttc:{AD_ROTA:'8,99'},ttv:{AD_ROTA:'131,9'}}
    ]})};
  });
  assert.match(called,/script\.google\.com\/macros\/s\/.*\/exec\?acao=produtos&_=/);
  assert.equal(result.updatedAt,'21/10/2026 08:52:33');
  assert.equal(result.products.length,1);
});
