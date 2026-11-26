import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {parseHTML} from 'linkedom';
import rating from '../src/ratings/rating.js';

test('formata datas da planilha sem converter o dia por fuso horário',()=>{
  assert.equal(rating.formatDate('2026-11-25T00:00:00.000Z'),'25/11/2026');
  assert.equal(rating.formatDate('3/4/2026'),'03/04/2026');
  assert.equal(rating.formatDate('Data pendente'),'Data pendente');
  assert.equal(rating.formatDate(''),'—');
});

test('pesquisa avaliacoes pelos campos apresentados ignorando acentos e caixa',()=>{
  const rows=[
    {date:'20/11/2026',code:'101',name:'Mercado São João',city:'Caicó',driver:'Ana',motive:'Atraso',comment:'Entregue no dia seguinte'},
    {date:'21/11/2026',code:'202',name:'Bar Central',city:'Natal',driver:'João',motive:'Produto',comment:''}
  ];
  assert.deepEqual(rating.filterRows(rows,'sao joao'),[rows[0]]);
  assert.deepEqual(rating.filterRows(rows,'JOÃO'),rows);
  assert.deepEqual(rating.filterRows(rows,'produto natal'),[rows[1]]);
  assert.deepEqual(rating.filterRows(rows,''),rows);
});

test('consulta a unidade e salva o comentário pela função autenticada',async()=>{
  const {document,window}=parseHTML(`<html><body>
    <div id="ratingUnitTabs"></div><strong id="ratingUnitLabel"></strong><a id="ratingSheetLink"></a>
    <div id="ratingAlert"></div><button id="btnRatingRefresh"></button>
    <input id="ratingSearch"><span id="ratingStatus"></span>
    <table><tbody id="ratingRows"></tbody></table>
  </body></html>`);
  const calls=[];
  const row={rowNumber:7,date:'20/11/2026',code:'101',name:'Mercado São João',city:'Caicó',driver:'Ana',motive:'Atraso',comment:'',fingerprint:'a'.repeat(64)};
  const client={functions:{invoke:async(name,{body})=>{
    calls.push({name,body});
    return {data:body.action==='list'?{ok:true,rows:[row]}:{ok:true,comment:body.comment,fingerprint:'b'.repeat(64)},error:null};
  }}};
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const api=rating.create({
    document,
    getElement:id=>document.getElementById(id),
    context:()=>({client,units:['Matriz Caicó'],activeUnit:'Matriz Caicó',hasPermission:code=>code==='RATING_EDIT'}),
    escapeHtml,
    toast:()=>{}
  });
  api.bind();
  await api.load('Matriz Caicó');
  assert.match(document.getElementById('ratingRows').textContent,/Mercado São João/);
  assert.match(document.getElementById('ratingSheetLink').href,/#gid=1949652663$/);

  document.querySelector('[data-rating-edit]').dispatchEvent(new window.Event('click',{bubbles:true}));
  const textarea=document.querySelector('[data-rating-editor] textarea');
  textarea.value='Retorno realizado';
  textarea.dispatchEvent(new window.Event('input',{bubbles:true}));
  document.querySelector('[data-rating-save]').dispatchEvent(new window.Event('click',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,0));

  assert.equal(calls[1].name,'rating-google');
  assert.equal(calls[1].body.action,'save');
  assert.equal(calls[1].body.unit,'Matriz Caicó');
  assert.equal(calls[1].body.rowNumber,7);
  assert.equal(calls[1].body.expected.fingerprint,'a'.repeat(64));
  assert.equal(calls[1].body.comment,'Retorno realizado');
  assert.match(document.getElementById('ratingRows').textContent,/Retorno realizado/);

  document.querySelector('[data-rating-edit]').dispatchEvent(new window.Event('click',{bubbles:true}));
  document.querySelector('[data-rating-editor] textarea').value='Tratativa revisada';
  document.querySelector('[data-rating-save]').dispatchEvent(new window.Event('click',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls[2].body.expected.fingerprint,'b'.repeat(64));
  assert.equal(calls[2].body.comment,'Tratativa revisada');
});

test('registra a tela Rating no menu e carrega o módulo antes do app principal',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const {document}=parseHTML(html);
  assert.ok(document.querySelector('.nav-item[data-view="rating-clients"]'));
  assert.ok(document.querySelector('#view-rating-clients[data-permission-any*="RATING_VIEW"]'));
  const scripts=[...document.querySelectorAll('script[src]')].map(script=>script.getAttribute('src'));
  assert.ok(scripts.indexOf('src/ratings/rating.js?v=1.7.114-rating-fix')<scripts.indexOf('app.js?v=1.7.114-rating'));
});

test('exibe orientação quando a função não pode ser alcançada',async()=>{
  const {document}=parseHTML(`<html><body><div id="ratingUnitTabs"></div><strong id="ratingUnitLabel"></strong>
    <a id="ratingSheetLink"></a><div id="ratingAlert"></div><button id="btnRatingRefresh"></button>
    <input id="ratingSearch"><span id="ratingStatus"></span><table><tbody id="ratingRows"></tbody></table></body></html>`);
  const api=rating.create({
    document,getElement:id=>document.getElementById(id),
    context:()=>({client:{functions:{invoke:async()=>({data:null,error:{name:'FunctionsFetchError',message:'Failed to send a request to the Edge Function'}})}},units:['Filial Pau dos Ferros'],hasPermission:()=>false}),
    escapeHtml:value=>String(value??''),toast:()=>{}
  });
  await api.load('Filial Pau dos Ferros');
  assert.match(document.getElementById('ratingAlert').textContent,/administrador para implantar/);
  assert.match(document.getElementById('ratingSheetLink').href,/#gid=1042578215$/);
  api.reset();
  assert.equal(document.getElementById('ratingSheetLink').hasAttribute('href'),false);
});

test('script lê e atualiza os cabeçalhos reais das duas abas sem aceitar colunas ambíguas',()=>{
  const code=readFileSync(new URL('../src/ratings/rating-google.gs',import.meta.url),'utf8');
  for(const headers of [
    ['DATA DA AVALIAÇÃO','AVALIAÇÃO','CLASSIFICAÇÃO','CÓDIGO DO PDV','NOME PDV','MOTIVO','COMENTÁRIO','CATEGORIA','ÚLTIMA COMPRA','SETOR','BAIRRO','CIDADE','UF','TELEFONE(S)','MOTORISTA','AJUDANTE 1','AJUDANTE 2'],
    ['DATA DA AVALIAÇÃO','AVALIAÇÃO','CLASSIFICAÇÃO','CÓDIGO DO PDV','NOME PDV','MOTIVO','COMENTÁRIO','CATEGORIA','ÚLTIMA COMPRA','BAIRRO','CIDADE','UF','TELEFONE(S)','MOTORISTA','AJUDANTE 1','AJUDANTE 2']
  ]) {
    const cells=headers.map(()=>''),commentIndex=headers.indexOf('COMENTÁRIO');
    cells[0]='25/11/2026';cells[3]='123';cells[4]='Cliente';cells[commentIndex]='Antes';
    const sheet={
      getDataRange:()=>({getDisplayValues:()=>[headers,cells]}),
      getLastColumn:()=>headers.length,getLastRow:()=>2,
      getRange:(row,column)=>({getDisplayValues:()=>[row===1?headers:cells],setValue:value=>{cells[column-1]=value;}})
    };
    const context=vm.createContext({
      SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush:()=>{}},
      Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_algorithm,value)=>[...createHash('sha256').update(value).digest()].map(x=>x>127?x-256:x)}
    });
    vm.runInContext(code,context);
    const [row]=context.listRows('RATING - MATRIZ');
    assert.equal(row.code,'123');
    const saved=context.saveComment('RATING - MATRIZ',{rowNumber:2,comment:'Depois',expected:{fingerprint:row.fingerprint}});
    assert.equal(saved.ok,true);
    assert.equal(cells[commentIndex],'Depois');
    assert.equal(context.saveComment('RATING - MATRIZ',{rowNumber:2,comment:'Conflito',expected:{fingerprint:row.fingerprint}}).error,'ROW_CHANGED');
    assert.throws(()=>context.columnIndexes([...headers,'Cod PDV']),/INVALID_HEADERS/);
  }
});
