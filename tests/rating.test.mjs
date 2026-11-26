import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
import rating from '../src/ratings/rating.js';

const require=createRequire(import.meta.url);
globalThis.DISB_RETURNS_GOOGLE=require('../src/devolucoes/returns-google.js');
const headers=['DATA DA AVALIAÇÃO','CÓDIGO DO PDV','NOME PDV','CIDADE','MOTORISTA','MOTIVO','COMENTÁRIO'];
const sourceRows=[['Date(2026,10,20)',101,'Mercado São João','Caicó','Ana','Atraso','Relato original']];
const googleResponse=rows=>`google.visualization.Query.setResponse(${JSON.stringify({status:'ok',table:{cols:headers.map(label=>({label})),rows:rows.map(row=>({c:row.map(v=>({v}))}))}})});`;
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

test('formata datas e pesquisa campos da avaliação e da tratativa',()=>{
  assert.equal(rating.formatDate('2026-11-25T00:00:00.000Z'),'25/11/2026');
  assert.equal(rating.formatDate('3/4/2026'),'03/04/2026');
  const rows=[{name:'Mercado São João',city:'Caicó',sourceComment:'Relato',comment:'Retorno realizado'}];
  assert.deepEqual(rating.filterRows(rows,'sao joao retorno'),rows);
  assert.deepEqual(rating.filterRows(rows,'relato'),rows);
});

test('identifica avaliação por data e código, recusa duplicadas e valida cabeçalhos',()=>{
  const row=[46346,'101','Loja','Caicó','Ana','Atraso','Original'];
  const [a,b,c]=rating.parseSheet([headers,row,['','','Sem código','','','',''],row]);
  assert.equal(a.date,'2026-11-20');
  assert.equal(a.ambiguous,true);
  assert.equal(b.ambiguous,true);
  assert.equal(c.ambiguous,true);
  assert.throws(()=>rating.parseSheet([[...headers,'Cod PDV'],row]),/cabeçalhos/);
  assert.throws(()=>rating.parseSheet([headers.slice(1),row]),/cabeçalhos/);
});

function harness({rows=sourceRows,comments=[],saveError=null,fetchError=null}={}) {
  const {document,window}=parseHTML(`<html><body>
    <div id="ratingUnitTabs"></div><strong id="ratingUnitLabel"></strong><a id="ratingSheetLink"></a>
    <div id="ratingAlert"></div><button id="btnRatingRefresh"></button><input id="ratingSearch">
    <span id="ratingStatus"></span><table><tbody id="ratingRows"></tbody></table>
  </body></html>`);
  const calls=[],toasts=[];
  const client={
    from:table=>({
      select:()=>({
        eq:(field,unit)=>({
          order:()=>({
            range:async()=>{calls.push({table,field,unit});return {data:comments,error:null};}
          })
        })
      })
    }),
    rpc:async(name,args)=>{calls.push({name,args});return saveError?{data:null,error:saveError}:{data:{comment:args.p_comment,revision:args.p_revision+1},error:null};}
  };
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const api=rating.create({
    document,getElement:id=>document.getElementById(id),
    context:()=>({client,units:['Matriz Caicó','Filial Pau dos Ferros'],activeUnit:'Matriz Caicó',hasPermission:code=>code==='RATING_EDIT'}),
    escapeHtml,toast:(...args)=>toasts.push(args),
    fetch:async(url)=>{calls.push({url});if(fetchError)throw fetchError;return {ok:true,text:async()=>googleResponse(rows)};}
  });
  api.bind();
  return {api,document,window,calls,toasts};
}

test('consulta a planilha, preserva comentário original e salva tratativa no Supabase',async()=>{
  const h=harness();await h.api.load('Matriz Caicó');
  assert.match(h.document.getElementById('ratingRows').textContent,/Relato original/);
  assert.match(h.calls.find(x=>x.url).url,/gid=1949652663/);
  assert.match(h.document.getElementById('ratingSheetLink').href,/#gid=1949652663$/);
  h.document.querySelector('[data-rating-edit]').dispatchEvent(new h.window.Event('click',{bubbles:true}));
  h.document.querySelector('textarea').value='Retorno realizado';
  h.document.querySelector('[data-rating-save]').dispatchEvent(new h.window.Event('click',{bubbles:true}));
  await flush();
  const save=h.calls.find(x=>x.name==='rating_save_comment');
  assert.equal(save.args.p_unit,'Matriz Caicó');
  assert.equal(save.args.p_comment,'Retorno realizado');
  assert.equal(save.args.p_revision,0);
  assert.match(h.document.getElementById('ratingRows').textContent,/Retorno realizado/);
  h.document.querySelector('[data-rating-edit]').dispatchEvent(new h.window.Event('click',{bubbles:true}));
  h.document.querySelector('textarea').value='Revisado';
  h.document.querySelector('[data-rating-save]').dispatchEvent(new h.window.Event('click',{bubbles:true}));
  await flush();
  assert.equal(h.calls.filter(x=>x.name==='rating_save_comment')[1].args.p_revision,1);
});

test('tratativa acompanha avaliação ao mover linhas e duplicadas não recebem tratativa',async()=>{
  const parsed=rating.parseSheet(globalThis.DISB_RETURNS_GOOGLE.readResponse(googleResponse(sourceRows)));
  const another=['Date(2026,10,21)',202,'Outro','Natal','Bia','Produto',''];
  const comments=[{row_key:parsed[0].rowKey,comment:'Já tratada',revision:2}];
  const h=harness({rows:[another,...sourceRows],comments});await h.api.load('Matriz Caicó');
  const row=[...h.document.querySelectorAll('#ratingRows tr')].find(el=>el.textContent.includes('Mercado'));
  assert.match(row.textContent,/Já tratada/);
  const duplicate=harness({rows:[...sourceRows,...sourceRows],comments});await duplicate.api.load('Matriz Caicó');
  assert.equal(duplicate.document.querySelectorAll('[data-rating-edit]').length,0);
  assert.doesNotMatch(duplicate.document.getElementById('ratingRows').textContent,/Já tratada/);
});

test('conflito de edição preserva rascunho e falha de leitura é apresentada',async()=>{
  const h=harness({saveError:{message:'RATING_VERSION_CONFLICT'}});await h.api.load('Filial Pau dos Ferros');
  assert.match(h.document.getElementById('ratingSheetLink').href,/#gid=1042578215$/);
  h.document.querySelector('[data-rating-edit]').dispatchEvent(new h.window.Event('click',{bubbles:true}));
  h.document.querySelector('textarea').value='Rascunho';
  h.document.querySelector('[data-rating-save]').dispatchEvent(new h.window.Event('click',{bubbles:true}));await flush();
  assert.match(h.document.getElementById('ratingAlert').textContent,/Outra pessoa/);
  assert.equal(h.document.querySelector('textarea').value,'Rascunho');
  const failed=harness({fetchError:new Error('Failed to fetch')});await failed.api.load('Matriz Caicó');
  assert.match(failed.document.getElementById('ratingAlert').textContent,/conectar ao Google/);
});

test('registra a tela Rating e carrega os módulos necessários',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  const {document}=parseHTML(html);
  assert.ok(document.querySelector('.nav-item[data-view="rating-clients"]'));
  assert.ok(document.querySelector('#view-rating-clients[data-permission-any*="RATING_VIEW"]'));
  const scripts=[...document.querySelectorAll('script[src]')].map(script=>script.getAttribute('src').split('?')[0]);
  assert.ok(scripts.indexOf('src/ratings/rating.js')>=0);
  assert.ok(scripts.indexOf('src/devolucoes/returns-google.js')>=0);
  assert.ok(scripts.indexOf('src/devolucoes/returns-google.js')<scripts.indexOf('app.js'));
  for(const name of ['src/ratings/rating.js','src/devolucoes/returns-ui.js']){
    const url=[...document.querySelectorAll('script[src]')].map(script=>script.getAttribute('src')).find(src=>src.split('?')[0]===name);
    assert.ok(sw.includes(url),`${url} ausente do cache offline`);
  }
});
