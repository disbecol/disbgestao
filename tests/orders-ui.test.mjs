import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const O=createRequire(import.meta.url)('../src/pedidos/orders.js');
const ui=readFileSync(new URL('../src/pedidos/orders-ui.js',import.meta.url),'utf8');
const sample={id:'r1',unit:'Matriz Caicó',kind:'FORA_ROTA',customer_code:'123',customer_name:'<img src=x onerror=alert(1)>',city:'Caicó',desired_date:O.localDate(),weekdays:[],reason:'FEFO',notes:'Evento',created_by:'u1',created_by_name:'Vendedor',created_at:new Date().toISOString(),status:'PENDENTE',sla_minutes:30,revision:1};
function harness(permissions=null,options={}){
 const {document}=parseHTML('<html><body>'+Object.keys(O.VIEWS).map(v=>`<section class="view" id="view-${v}"></section>`).join('')+'</body></html>');
 const calls=[],toasts=[],downloads=[],intervals=[];let rows=[{...sample}],unit='Matriz Caicó',fail=false,modal='';
 const allowed=permissions?new Set(permissions):null;let elapsed=0;const serverStart=Date.parse(options.serverTime||new Date().toISOString()),testSettings={...O.DEFAULTS,restricted_hours:false,...options.settings};
 class FormData{constructor(form){this.rows=[...form.querySelectorAll('input,select,textarea')].filter(el=>el.name&&!el.disabled&&(el.type!=='checkbox'||(el.checked??el.hasAttribute('checked')))).map(el=>[el.name,el.value]);}get(n){return this.rows.find(r=>r[0]===n)?.[1]??null;}getAll(n){return this.rows.filter(r=>r[0]===n).map(r=>r[1]);}has(n){return this.rows.some(r=>r[0]===n);}}
 const client={rpc:async(name,args)=>{calls.push({name,args});if(fail){fail=false;return {error:{message:'Failed to fetch'}};}if(name==='orders_settings')return {data:{...testSettings,server_now:new Date(serverStart+elapsed).toISOString()}};if(name==='orders_customer')return {data:{code:'123',name:'Cliente correto'}};if(name==='orders_history')return {data:[]};if(name==='orders_create')return {data:{...sample,id:'new12345'}};if(name==='orders_save_settings')return {data:{...args.p_data,revision:1}};if(name==='orders_action'){rows=rows.map(r=>({...r,status:'EM_ANALISE',analyst_id:'u1',analyst_name:'Analista',claimed_at:new Date().toISOString(),revision:2}));return {data:rows[0]};}return {data:{requests:rows,settings:{...O.DEFAULTS,restricted_hours:false},server_now:new Date().toISOString()}};}};
 const context={window:{DISB_ORDERS:O},document,console,Intl,Date,Map,Set,Blob,FormData,performance:{now:()=>elapsed},crypto:{randomUUID},confirm:()=>true,setInterval:fn=>{intervals.push(fn);return 1;},clearInterval(){},setTimeout:()=>1,clearTimeout(){}};
 vm.runInNewContext(ui,context);
 const module=context.window.DISB_ORDERS_UI.create({context:()=>({client,user:{id:'u1'},profile:{role:'ADMIN'},unit}),hasPermission:p=>!allowed||allowed.has(p),toast:(...t)=>toasts.push(t),modal:m=>{modal=m.html;},openView(){},download:async(...d)=>downloads.push(d)});
 const root=v=>document.getElementById('view-'+v);
 return {module,document,calls,toasts,downloads,intervals,root,get modal(){return modal;},advance(ms){elapsed+=ms;},setRows:r=>{rows=r;},setUnit:u=>{unit=u;},fail:()=>{fail=true;},click:async(el)=>root(el.closest('.view').id.slice(5)).onclick({target:el}),submit:async(form)=>root(form.closest('.view').id.slice(5)).onsubmit({target:form,preventDefault(){}}),input(el,value){if(el.tagName==='SELECT'){for(const o of el.querySelectorAll('option')){if(o.value===value)o.setAttribute('selected','');else o.removeAttribute('selected');}}else el.value=value;root(el.closest('.view').id.slice(5)).oninput({target:el});}};
}
test('todas as telas renderizam com rótulos, sem executar HTML vindo do cliente',async()=>{
 const h=harness();for(const view of Object.keys(O.VIEWS)){await h.module.enter(view);assert.ok(h.root(view).querySelector('h1'));assert.equal(h.root(view).querySelectorAll('img').length,0);assert.ok(!h.root(view).innerHTML.includes('[object Object]'));}h.module.stop();
});
test('fila permite assumir e registra resposta de análise sem alterar dados do cliente',async()=>{
 const h=harness();await h.module.enter('orders-queue');let r=h.root('orders-queue');await h.click(r.querySelector('[data-od-action=claim]'));const call=h.calls.find(c=>c.name==='orders_action');assert.equal(call.args.p_action,'CLAIM');assert.equal(call.args.p_revision,1);assert.ok(call.args.p_operation);r=h.root('orders-queue');assert.ok(r.textContent.includes('Confirmar aprovação'));assert.ok(r.querySelector('[data-od-action=return]'));h.module.stop();
});
test('falha de rede preserva formulário e retry usa a mesma chave sem duplicar',async()=>{
 const h=harness();await h.module.enter('orders-new');let r=h.root('orders-new');h.input(r.querySelector('[name=customer_code]'),'123');h.input(r.querySelector('[name=notes]'),'Observação preservada');r.querySelector('[name=reason] option[value=FEFO]').setAttribute('selected','');h.input(r.querySelector('[name=reason]'),'FEFO');h.fail();await h.submit(r.querySelector('form'));
 r=h.root('orders-new');assert.equal(r.querySelector('[name=notes]').value,'Observação preservada');await h.submit(r.querySelector('form'));const calls=h.calls.filter(c=>c.name==='orders_create');assert.equal(calls.length,2);assert.equal(calls[0].args.p_operation,calls[1].args.p_operation);assert.ok(h.toasts.some(t=>t[0].includes('registrada')));h.module.stop();
});
test('troca entre bipasse e cliente novo exibe campos e dias correspondentes',async()=>{
 const h=harness();await h.module.enter('orders-new');let r=h.root('orders-new');await h.click(r.querySelector('[data-od-type=BIPASSE]'));assert.equal(r.querySelectorAll('[name=weekdays]').length,5);assert.equal(r.querySelector('[name=desired_date]'),null);
 await h.click(r.querySelector('[data-od-type=CLIENTE_NOVO]'));assert.ok(r.querySelector('[name=customer_name]'));assert.ok(r.querySelector('[name=desired_date]'));h.module.stop();
});
test('seleção de cliente e exportação respeitam os filtros do dashboard',async()=>{
 const h=harness();h.setRows([{...sample,status:'APROVADO',resolved_at:sample.created_at,within_sla:true,resolution_minutes:10},{...sample,id:'r2',customer_code:'999',customer_name:'Outro'}]);await h.module.enter('orders-dashboard');let r=h.root('orders-dashboard');await h.click(r.querySelector('[data-od-dashboard=clients]'));await h.click(r.querySelector('[data-od-client="123"]'));assert.ok(r.textContent.includes('Solicitações do cliente 123'));await h.click(r.querySelector('[data-od-action=export]'));const text=await h.downloads[0][1].text();assert.ok(text.includes('"123"'));assert.ok(!text.includes('"999"'));h.module.stop();
});
test('consulta própria não tem botões de análise e revogação impede a renderização',async()=>{
 const h=harness(['ORDERS_OWN']);await h.module.enter('orders-own');assert.equal(h.root('orders-own').querySelector('[data-od-action=claim]'),null);await h.module.enter('orders-queue');assert.ok(h.root('orders-queue').textContent.includes('Sem permissão'));h.module.stop();
});
test('menu mantém a hierarquia Pedidos → Pedidos fora de rota e caches incluem os arquivos',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),{document}=parseHTML(html),area=document.querySelector('[data-area=pedidos]');assert.ok(area);const group=area.querySelector('[data-module=pedidos-fora-rota]');assert.ok(group);assert.equal(group.querySelectorAll('[data-view]').length,8);
 for(const file of ['orders.js','orders-ui.js','orders.css']){assert.ok(html.includes('src/pedidos/'+file));assert.ok(readFileSync(new URL('../sw.js',import.meta.url),'utf8').includes('src/pedidos/'+file));}
});
test('Admin também fica bloqueado às 13:20 e nenhuma requisição de criação é enviada',async()=>{
 const h=harness(null,{settings:{restricted_hours:true},serverTime:'2026-11-19T16:20:00Z'});await h.module.enter('orders-new');const r=h.root('orders-new');
 for(const type of ['FORA_ROTA','BIPASSE','CLIENTE_NOVO']){await h.click(r.querySelector(`[data-od-type="${type}"]`));assert.equal(r.querySelector('[data-od-new] button[type=submit]').disabled,true);assert.equal(r.querySelector('[data-od-request-fields]').disabled,true);assert.ok(r.textContent.includes('Fora do horário de envio'));assert.ok(!r.textContent.includes('Administradores podem'));await h.submit(r.querySelector('form'));}
 assert.equal(h.calls.filter(c=>c.name==='orders_create').length,0);h.module.stop();
});
test('abertura e fechamento atualizam sem recarregar nem apagar o preenchimento',async()=>{
 const h=harness(null,{settings:{restricted_hours:true},serverTime:'2026-11-19T16:59:59Z'});await h.module.enter('orders-new');const r=h.root('orders-new');assert.equal(r.querySelector('button[type=submit]').disabled,true);
 h.advance(1000);await h.intervals.at(-1)();assert.equal(r.querySelector('button[type=submit]').disabled,false);h.input(r.querySelector('[name=notes]'),'Não apagar este preenchimento');h.advance(121*60000);await h.intervals.at(-1)();assert.equal(r.querySelector('button[type=submit]').disabled,true);assert.equal(r.querySelector('[name=notes]').value,'Não apagar este preenchimento');h.module.stop();
});
test('dashboard mostra o ranking RN/GV e mantém a quantidade em ordem decrescente',async()=>{
 const h=harness();h.setRows([{...sample,created_by:'a',created_by_name:'Ana',requester_role:'VENDEDOR'},...Array.from({length:3},(_,i)=>({...sample,id:'b'+i,created_by:'b',created_by_name:'Beto',requester_role:'GERENTE_VENDAS'}))]);await h.module.enter('orders-dashboard');const r=h.root('orders-dashboard');assert.ok(r.textContent.includes('Ranking por vendedor (RN/GV)'));assert.deepEqual([...r.querySelectorAll('.od-seller-ranking li strong')].map(x=>x.textContent),['Beto','Ana']);h.module.stop();
});
