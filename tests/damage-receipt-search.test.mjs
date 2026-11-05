import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import validation from '../receipt-validation.js';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const code='DGB-11111111-22224444-88889999-AAAAAAAA';
const searchSource=source.slice(source.indexOf('let damageReceiptSearch=null'),source.indexOf('let damageGeoMapInstance=null'));
const filterSource=source.slice(source.indexOf('function filteredAdminAvarias()'),source.indexOf('\nfunction renderAdminAvarias()',source.indexOf('function filteredAdminAvarias()')));
function harness(lookup=async()=>({data:[{receipt_code:code,request_id:'old'}],error:null})){
 const fields={avAdminBusca:{value:code},avAdminStatus:{value:''},avReceiptSearchHint:{textContent:''}};
 let pending,fromCalls=0;
 const context={window:{DisbReceiptValidation:validation},navigator:{onLine:true},activeUnit:'Matriz Caicó',
  adminAvarias:[{id:'recent',customer_name:'Cliente recente',status:'PENDENTE'}],$:id=>fields[id],norm:s=>String(s||'').toLowerCase(),
  humanError:e=>e.message,clearTimeout:()=>{},setTimeout:fn=>{pending=fn;},renderAdminAvarias:()=>{},
  sb:{rpc:lookup,from:()=>{fromCalls++;const b={select:()=>b,eq:()=>b,maybeSingle:async()=>({data:{id:'old',customer_name:'Cliente antigo',status:'APROVADO'},error:null})};return b;}}};
 vm.runInNewContext(searchSource+'\n'+filterSource,context);
 return {context,fields,search:async()=>{context.searchAdminDamageReceipt();if(pending)await pending();},get fromCalls(){return fromCalls;}};
}
test('busca por código encontra avaria fora dos 1000 registros recentes e preserva filtros normais',async()=>{
 const h=harness();await h.search();assert.equal(h.fromCalls,1);assert.equal(h.context.filteredAdminAvarias()[0].id,'old');
 h.fields.avAdminBusca.value='recente';await h.search();assert.equal(h.context.filteredAdminAvarias()[0].id,'recent');
 h.fields.avAdminStatus.value='ENTREGUE';assert.equal(h.context.filteredAdminAvarias().length,0);
});
test('resposta atrasada após trocar unidade não insere a avaria na unidade atual',async()=>{
 let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));
 const search=h.search();h.context.activeUnit='Filial Pau dos Ferros';finish({data:[{request_id:'old'}]});await search;
 assert.equal(h.fromCalls,0);assert.equal(h.context.filteredAdminAvarias().length,0);
});
test('código incompleto não consulta o banco e não exibe avarias sem correspondência',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return {data:[]};});h.fields.avAdminBusca.value='DGB-111';await h.search();
 assert.equal(calls,0);assert.equal(h.context.filteredAdminAvarias().length,0);assert.match(h.fields.avReceiptSearchHint.textContent,/código completo/);
});
