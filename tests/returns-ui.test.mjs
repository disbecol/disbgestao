import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {cascade,contrast} from './helpers/css-cascade.mjs';
const require=createRequire(import.meta.url),R=require('../returns.js'),G=require('../returns-google.js'),code=readFileSync(new URL('../returns-ui.js',import.meta.url),'utf8');
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Fortaleza'}).format(new Date());
const sample={reports:[{operation_date:today,customer_code:'42',customer_name:'Loja <script>',map_number:'1',city:'Caicó',driver:'Pessoa',helper1:'A',amount_cents:123400,volume_hl:3.5,reason:'Recusa',seller:'Vendedor'}],cases:[],routes:[{operation_date:today,planned_outlets:100,planned_hl:300}],goals:[],imports:[],at:new Date().toISOString()};
function harness({rpc,permissions=['RETURNS_VIEW','RETURNS_EDIT','RETURNS_IMPORT']}={}){
 const {document}=parseHTML(`<html><body><main id="appShell">${Object.keys(R.VIEWS).map(v=>`<section id="view-${v}" class="view active"></section>`).join('')}</main></body></html>`),window={},events={},wevents={},calls=[],timers=[],toasts=[];
 let unit='Matriz Caicó',data=structuredClone(sample);
 const client={rpc:async(name,args)=>{calls.push({name,args});return rpc?rpc(name,args):{data:structuredClone(data),error:null};},channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:()=>{}};
 document.addEventListener=(name,fn)=>{(events[name]||=[]).push(fn);};window.addEventListener=(name,fn)=>{wevents[name]=fn;};window.DISB_RETURNS=R;window.DISB_RETURNS_GOOGLE={...G,create:()=>({sync:async()=>({skipped:true}),stop(){},pending:()=>false})};
 class FormData {constructor(form){this.items=[...form.querySelectorAll('input,select,textarea')].filter(e=>e.name&&!e.disabled).map(e=>[e.name,e.value||'']);} [Symbol.iterator](){return this.items[Symbol.iterator]();}}
 const ctx=vm.createContext({window,document,console,Intl,Date,Blob,TextEncoder,TextDecoder,crypto:webcrypto,FormData,structuredClone,confirm:()=>true,setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval:()=>{},fetch:async()=>({ok:true,text:async()=>''})});
 vm.runInContext(code,ctx);
 const module=window.DISB_RETURNS_UI.create({context:()=>({client,user:{id:'u1'},unit}),hasPermission:p=>permissions.includes(p),toast:(...x)=>toasts.push(x),modal:()=>{},closeModal:()=>{},loadScript:()=>{},download:()=>{}});
 const click=async(el)=>{for(const fn of events.click||[])await fn({target:el});};
 return {module,document,window,events,wevents,calls,timers,toasts,click,setUnit:u=>unit=u,setData:d=>data=d};
}
test('as seis visões, auditoria e importação renderizam sem HTML de dados ou objetos acidentais',async()=>{
 const h=harness();for(const v of Object.keys(R.VIEWS)){await h.module.enter(v);const root=h.document.getElementById('view-'+v);assert.ok(root.querySelector('h1'));assert.ok(!root.innerHTML.includes('[object Object]'),v);assert.equal(root.querySelectorAll('script').length,0);}
 assert.equal(h.document.querySelectorAll('#view-returns-import .rt-source').length,4);assert.equal(h.document.querySelectorAll('#view-returns-import input[type=file]').length,0);
});
test('Acompanhamentos mantém cinco abas lado a lado e reaproveita o período selecionado',async()=>{
 const h=harness();await h.module.enter('returns-followup');assert.equal(h.document.querySelectorAll('#view-returns-followup [role=tab]').length,5);const before=h.document.querySelector('#view-returns-followup [name=from]').value;
 await h.click(h.document.querySelector('#view-returns-followup [data-tab="returns-city"]'));assert.equal(h.document.querySelector('#view-returns-followup [role=tab][aria-selected=true]').textContent,'Análise por cidade');assert.equal(h.document.querySelector('#view-returns-followup [name=from]').value,before);assert.match(h.document.querySelector('#rt-followup-panel').textContent,/Participação por cidade/);
 const target=h.document.querySelector('#view-returns-followup [data-tab="returns-city"]');for(const fn of h.events.keydown)fn({target,key:'ArrowRight',preventDefault(){}});assert.equal(h.document.querySelector('#view-returns-followup [role=tab][aria-selected=true]').textContent,'Análise por QLP');
});
for(const theme of ['light','dark'])test(`abas de Acompanhamentos têm contraste e rolagem horizontal no celular (${theme})`,()=>{
 const c=cascade({theme,width:390,markup:'<html><body><main id="appShell"><section class="rt-workspace"><div class="fm-tabs rt-tabs"><button role="tab" class="active">Resumo</button><button role="tab">Análise por cidade</button></div></section></main></body></html>'});const tabs=c.document.querySelector('.rt-tabs');assert.equal(c.value(tabs,'flex-wrap'),'nowrap');assert.equal(c.value(tabs,'overflow-x'),'auto');for(const b of tabs.querySelectorAll('button'))assert.ok(contrast(c.value(b,'color'),c.background(b))>=4.5);
});
test('resposta atrasada de outra unidade não aparece na nova unidade',async()=>{
 const pending=[];const h=harness({rpc:()=>new Promise(resolve=>pending.push(resolve))});
 const a=h.module.enter('returns-summary');h.module.stop();h.setUnit('Filial Pau dos Ferros');const b=h.module.enter('returns-summary');
 pending[1]({data:{...sample,reports:[{...sample.reports[0],customer_name:'Filial exemplo'}]},error:null});await b;
 pending[0]({data:{...sample,reports:[{...sample.reports[0],customer_name:'Unidade anterior'}]},error:null});await a;
 assert.ok(h.document.querySelector('#view-returns-summary').textContent.includes('Filial exemplo'));assert.ok(!h.document.querySelector('#view-returns-summary').textContent.includes('Unidade anterior'));
});
test('atualização automática preserva filtros digitados antes de aplicar e ao trocar de aba',async()=>{
 const h=harness();await h.module.enter('returns-followup');const root=h.document.querySelector('#view-returns-followup');root.querySelector('[name=search]').value='Pedido em análise';root.querySelector('[name=from]').value='2026-11-01';
 await h.timers[0]();await new Promise(resolve=>setImmediate(resolve));assert.equal(root.querySelector('[name=search]').value,'Pedido em análise');
 await h.click(root.querySelector('[data-tab="returns-panel"]'));assert.equal(root.querySelector('[name=search]').value,'Pedido em análise');assert.equal(root.querySelector('[name=from]').value,'2026-11-01');
 await h.click(root.querySelector('[data-rt-action="clear-filter"]'));assert.equal(root.querySelector('[name=search]').value,'');
});
test('atualização periódica preserva formulário aberto; criação exige buscar cliente/data',async()=>{
 const h=harness();await h.module.enter('returns-audited');await h.click(h.document.querySelector('#view-returns-audited [data-rt-action="new"]'));
 const form=h.document.querySelector('[data-rt-case-form]');assert.ok(form);form.querySelector('[name="customer_code"]').value='42';form.querySelector('[name="driver_reason"]').value='Recusa';
 for(const fn of h.events.input)await fn({target:form.querySelector('[name="driver_reason"]')});
 h.setData({...sample,at:new Date().toISOString()});await h.timers[0]();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.document.querySelector('[name="driver_reason"]').value,'Recusa');assert.match(h.document.querySelector('[data-rt-live]').textContent,/formulário aberto foi preservado/);
 for(const fn of h.events.submit)await fn({target:form,preventDefault(){}});
 assert.ok(h.toasts.some(([message])=>message.includes('Buscar informações')));assert.ok(!h.calls.some(c=>c.name==='returns_save_case'));
});
test('falha de servidor informa erro, sem exibir indicadores saudáveis zerados',async()=>{
 const h=harness({rpc:async()=>({error:{message:'FORBIDDEN'},data:null})});await h.module.enter('returns-summary');assert.equal(h.document.querySelectorAll('.rt-kpi').length,0);assert.match(h.document.querySelector('[data-rt-live]').textContent,/não tem acesso/);
});
for(const theme of ['light','dark'])test(`cores das devoluções, permissões, módulos e GPS são legíveis (${theme})`,()=>{
 const markup=`<html><body><main id="appShell"><div class="rt-workspace"><div class="rt-panel"><h2>Devoluções</h2><p class="rt-note">Informações do período</p><div class="rt-kpi"><span>Valor</span><strong>R$ 1.234,00</strong></div><span class="rt-status rt-DEVOLVIDO">Devolvido</span><label class="rt-field"><span>Cliente</span><input value="42"></label></div></div><div class="module-setting-copy"><strong>NRI</strong><p>Descrição do módulo</p></div></main><div id="modal"><section class="permission-group"><div class="permission-group-title">Administração <small>0/2</small></div></section><div class="damage-geo-legend">Ponto de venda e círculo de 100 m</div><div class="damage-geo-point"><span>Registro sem foto · 28 m do PDV</span><b class="damage-geo-pill inside">Dentro</b></div></div></body></html>`;
 const c=cascade({theme,markup});for(const el of c.document.querySelectorAll('h2,p,span,strong,small,input,.permission-group-title,.damage-geo-legend,.damage-geo-point b')){const ratio=contrast(c.value(el,'color').replace(/^white$/,'#fff'),c.background(el).replace(/^white$/,'#fff'));assert.ok(ratio>=4.5,`${el.className||el.tagName} ${ratio.toFixed(2)}`);}
});
