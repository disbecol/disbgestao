import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function comparePendingProduct('),app.indexOf('async function removeNri('));
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function harness(){
 const {document}=parseHTML('<html><body><input id="pendFiltro"><input id="pendUnidade"><div id="tbodyPendentes"></div><button id="btnExcluirSelecionados"></button><span id="pendSelectionStatus"></span></body></html>');
 const calls=[],rows=[['one','req-one','9','NRI-999'],['two','req-one','100','NRI-001'],['three','req-one','20','NRI-555'],['four','req-two','90','NRI-900']].map(([id,request_id,codigoProduto,nri])=>({id,request_id,codigoProduto,nri,nomeProduto:'Produto '+codigoProduto,placa:'ABC1D23',unidade:'Matriz',recebimento:request_id==='req-one'?'2026-11-24':'2026-11-23',fabrica:'Fábrica',motorista:'Motorista',lote:'L1',quantidade:1}));
 const c={document,$:id=>document.getElementById(id),pendingNris:rows,selectedNris:new Set(),norm:s=>String(s??'').toLowerCase(),esc,fmtDate:s=>s,fmtNum:s=>s,nriDamageForRecord:()=>[],nriDamageSummaryHtml:()=>'',showNriPreview:r=>calls.push(['preview',r.id]),showNriDamageDetail:()=>{},startPrint:r=>calls.push(['print',Array.from(r,x=>x.id)]),removeNri:()=>{}};
 vm.runInNewContext(source,c);return {c,document,calls,rows};
}
test('pending NRI groups represent receipts and show products in descending numeric code order',()=>{
 const {c,document,rows}=harness();c.renderPending();const groups=[...document.querySelectorAll('details')];assert.equal(groups.length,2);assert.equal(groups[0].hasAttribute('open'),false);assert.match(groups[0].querySelector('summary').textContent,/Carreta ABC1D23/);
 assert.deepEqual([...groups[0].querySelectorAll('input[data-check]')].map(x=>x.dataset.check),['two','three','one']);assert.equal(rows[0].id,'one');
});
test('opening a receipt and selecting NRI survive refresh; filtered search opens the matching receipt',()=>{
 const {c,document}=harness();c.renderPending();document.querySelector('details').setAttribute('open','');const checkbox=document.querySelector('[data-check="two"]');checkbox.checked=true;c.onPendingCheck({target:checkbox});c.renderPending();assert.equal(document.querySelector('details').hasAttribute('open'),true);assert.equal(document.querySelector('[data-check="two"]').hasAttribute('checked'),true);
 c.$('pendFiltro').value='90';c.renderPending();assert.equal(document.querySelectorAll('details').length,1);assert.equal(document.querySelector('details').hasAttribute('open'),true);assert.match(c.$('pendSelectionStatus').textContent,/1 fora do filtro/);assert.equal(c.$('btnExcluirSelecionados').disabled,false);
});
test('nested row actions keep the original record and select-filtered applies to collapsed groups',()=>{
 const {c,document,calls}=harness();c.renderPending();c.onPendingClick({target:document.querySelector('[data-act="print"][data-id="two"]')});assert.deepEqual(calls,[['print',['two']]]);c.$('pendFiltro').value='90';c.toggleVisiblePendingSelection();assert.deepEqual([...c.selectedNris],['four']);
});
