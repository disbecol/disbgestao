import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {cascade,contrast} from './helpers/css-cascade.mjs';
const D=createRequire(import.meta.url)('../src/avarias/damage-dashboard.js'),source=readFileSync(new URL('../src/avarias/damage-dashboard-ui.js',import.meta.url),'utf8');
const sample={id:'r1',occurrence_date:'2026-11-12',created_at:'2026-11-12T12:00:00Z',delivery_user_id:'d1',delivery_name:'Motorista',customer_code:'10',customer_name:'<img src=x onerror=alert(1)>',city:'Caicó',map_number:'123',items:[{id:'i1',product_text:'982 - Produto',reason:'Quebrado',quantity:2,quantity_unit:'UNIDADE',status:'PENDENTE'}]};
function harness(){const {document}=parseHTML('<html><body><section id="view-avaria-dashboard"></section></body></html>'),calls=[],opened=[];let allowed=true,unit='Matriz Caicó',fail=false,data=[sample];
 class FormData{constructor(form){this.entries=[...form.querySelectorAll('input,select')].map(e=>[e.name,e.value]);}get(k){return this.entries.find(e=>e[0]===k)?.[1]??'';}}
 const client={rpc:async(name,args)=>{calls.push({name,args});if(fail)return {error:{message:'Failed to fetch'}};return {data:{requests:data,previous:[],previous_from:'2025-11-01',previous_to:'2025-11-30',server_now:'2026-11-19T15:00:00Z'}};}};
 const c={window:{DISB_DAMAGE_DASHBOARD:D},document,console,Intl,Date,Map,Set,FormData,crypto:{randomUUID},setInterval:()=>1,clearInterval(){}};vm.runInNewContext(source,c);
 const module=c.window.DISB_DAMAGE_DASHBOARD_UI.create({context:()=>({client,user:{id:'u1'},unit}),canView:()=>allowed,toast(){},openRequest:async id=>opened.push(id)}),root=()=>document.getElementById('view-avaria-dashboard');
 return {module,document,calls,opened,root,setAllowed:v=>allowed=v,setUnit:v=>unit=v,setRows:v=>data=v,fail:()=>fail=true,click:el=>root().onclick({target:el}),submit:form=>root().onsubmit({target:form,preventDefault(){}})};
}
test('oito análises usam os registros atuais, sem upload e sem executar texto de dados',async()=>{
 const h=harness();await h.module.enter();assert.equal(h.root().querySelectorAll('[role=tab]').length,8);for(const name of ['overview','swaps','replacements','drivers','clients','products','cities','comparison']){await h.click(h.root().querySelector(`[data-ad-tab="${name}"]`));assert.equal(h.root().querySelectorAll('input[type=file],img,script').length,0);assert.ok(!h.root().textContent.includes('[object Object]'));}assert.ok(h.calls.every(c=>c.name==='delivery_damage_dashboard'));h.module.stop();
});
test('drilldown por cliente abre a ocorrência existente e filtros são enviados à unidade atual',async()=>{
 const h=harness();await h.module.enter();await h.click(h.root().querySelector('[data-ad-client="10"]'));assert.ok(h.root().textContent.includes('Cliente 10'));await h.click(h.root().querySelector('[data-ad-request]'));assert.deepEqual(h.opened,['r1']);const from=h.root().querySelector('[name=from]');from.value='2026-09-01';await h.submit(h.root().querySelector('form'));assert.equal(h.calls.at(-1).args.p_from,'2026-09-01');assert.equal(h.calls.at(-1).args.p_unit,'Matriz Caicó');h.module.stop();
});
test('falha inicial não aparece como indicador saudável zerado, e acesso revogado limpa o painel',async()=>{
 const h=harness();h.fail();await h.module.enter();assert.equal(h.root().querySelector('.ad-kpi'),null);assert.ok(h.root().querySelector('[role=alert]'));h.setAllowed(false);await h.module.enter();assert.ok(h.root().textContent.includes('Sem acesso'));assert.equal(h.root().querySelector('.ad-kpi'),null);h.module.stop();
});
test('link do dashboard, arquivos e permissão ficam na área de Avarias de Entrega',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),{document}=parseHTML(html),link=document.querySelector('[data-view=avaria-dashboard]');assert.equal(link.closest('.nav-area').dataset.area,'entrega');assert.ok(link.dataset.permissionAny.includes('DELIVERY_DAMAGE_VIEW_ALL'));for(const file of ['damage-dashboard.js','damage-dashboard-ui.js','damage-dashboard.css'])assert.ok(readFileSync(new URL('../sw.js',import.meta.url),'utf8').includes('src/avarias/'+file));
});
for(const theme of ['light','dark'])for(const width of [390,1280])test(`dashboard e novo estilo mantêm contraste (${theme}, ${width}px)`,()=>{
 const c=cascade({theme,width,markup:`<html><body><div id="appShell"><section class="ad-dashboard"><div class="ad-panel"><h2>Prazos e indicadores</h2><p class="ad-note">Data da ocorrência</p><div class="ad-kpi"><span>Ocorrências</span><strong>85</strong><small>Registros com itens</small></div><form class="ad-filters"><label><span>Cidade</span><input value="Caicó"></label><button class="btn primary">Aplicar filtros</button></form><div class="ad-tabs"><button role="tab" aria-selected="true">Resumo</button></div><div class="ad-table-wrap"><table><thead><tr><th>Status</th></tr></thead><tbody><tr><td><span class="ad-status ad-ENTREGUE">Entregue</span></td></tr></tbody></table></div></div></section></div></body></html>`});for(const el of c.document.querySelectorAll('h2,p,.ad-kpi>span,.ad-kpi>strong,.ad-kpi>small,.ad-filters label>span,input,button,th,td,.ad-status')){const ratio=contrast(c.value(el,'color'),c.background(el));assert.ok(ratio>=4.5,`${el.tagName} ${el.className}: ${ratio.toFixed(2)}`);}
});
