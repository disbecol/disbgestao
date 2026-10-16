import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const keySource=app.slice(app.indexOf('function nriPrintJobKey('),app.indexOf('async function manageNriAndroidPrintQueue('));
const printSource=app.slice(app.indexOf('async function startPrint('),app.indexOf('async function finishPrint('));

function harness(pending){
  const calls=[];
  const plugin={
    async getPendingJobs(args){calls.push(['pending',args]);return pending;},
    async printHtml(args){calls.push(['print',args]);},
    async cancelPendingJobs(args){calls.push(['cancel',args]);return {count:1};}
  };
  const context={
    window:{Capacitor:{isPluginAvailable:()=>true}},
    printOperation:null,printStarting:false,
    isNativeCapacitor:()=>true,nriNativePrintPlugin:()=>plugin,
    printDocument:()=>'<html>etiqueta</html>',
    openModal:(title,subtitle,body,actions)=>calls.push(['modal',{title,actions}]),
    closeModal:()=>{},toast:()=>{},humanError:error=>String(error)
  };
  vm.runInNewContext(`${keySource}\n${printSource}`,context,{timeout:1000});
  return {context,calls};
}

test('identificação da fila é estável para o mesmo conjunto de NRIs',()=>{
  const {context}=harness({count:0,scoped:true});
  const first=context.nriPrintJobKey([{id:'a'},{id:'b'}]);
  assert.equal(first,context.nriPrintJobKey([{id:'b'},{id:'a'}]));
  assert.notEqual(first,context.nriPrintJobKey([{id:'a'}]));
  assert.match(first,/^2-[0-9a-f]{16}$/);
});

test('fila antiga ou de outra NRI não impede a impressão nova',async()=>{
  const {context,calls}=harness({count:3});
  await context.startPrint([{id:'new',nri:'NRI-0001'}]);
  assert.equal(calls.filter(([name])=>name==='print').length,1);
  assert.equal(calls.filter(([name])=>name==='modal')[0][1].title,'Confirmar impressão');
  assert.match(calls.find(([name])=>name==='print')[1].jobKey,/^1-[0-9a-f]{16}$/);
});

test('fila da mesma NRI pede confirmação e só cancela a impressão correspondente',async()=>{
  const {context,calls}=harness({count:1,scoped:true});
  await context.startPrint([{id:'same',nri:'NRI-0002'}]);
  assert.equal(calls.filter(([name])=>name==='print').length,0);
  const modal=calls.find(([name])=>name==='modal')[1];
  assert.equal(modal.title,'Esta NRI já está na fila');
  const key=calls.find(([name])=>name==='pending')[1].jobKey;
  await modal.actions.find(action=>action.label==='Cancelar impressão anterior').onClick();
  assert.equal(calls.find(([name])=>name==='cancel')[1].jobKey,key);
  assert.equal(calls.filter(([name])=>name==='print').length,1);
});
