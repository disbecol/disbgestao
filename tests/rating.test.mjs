import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
    <div id="ratingUnitTabs"></div><strong id="ratingUnitLabel"></strong>
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
  assert.ok(scripts.indexOf('src/ratings/rating.js?v=1.7.113-rating')<scripts.indexOf('app.js?v=1.7.113-rating'));
});
