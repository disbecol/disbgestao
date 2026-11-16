import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {cascade,contrast,luminance} from './helpers/css-cascade.mjs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

// O HTML é o da aplicação, e os componentes dinâmicos saem das funções de
// produção. Os dados são fictícios; nenhuma sessão ou requisição é aberta.
function renderedApplication(productQuery='',decision=null,home=null){
  const {document}=parseHTML(read('index.html'));
  document.defaultView.HTMLElement.prototype.scrollIntoView=()=>{};
  document.defaultView.HTMLElement.prototype.focus=()=>{};
  const window={addEventListener(){},DISB_CONFERENCE:{bottlesFromCrates:()=>({estimated:69,gross:69})},DISB_SALES_PRICING:{SEGMENTS:['AD_ROTA','ASR'],formatPrice:value=>value==null?'—':`R$ ${value.toFixed(2)}`,searchProducts:products=>({total:products.length,rows:products})}};
  const context=vm.createContext({window,document,navigator:{onLine:true},console:{log(){},info(){},warn(){},error(){}},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}});
  const source=read('app.js').replace(/\}\)\(\);\s*$/,`window.appearanceRenderTest={types:VALUE_TYPES,
    setup(){hydrateSalesDamageProductImages=()=>{};setProductImage=()=>{};updateConferenceBottleSummary=()=>{};openModal=(title,subtitle,body)=>{$('modalBody').innerHTML=body;};},
    conference:renderConferenceQuantityCards,detail:showDashboardDetail,
    own(requests){deliveryDamageMyRequests=requests;renderDeliveryDamageMy();},
    prices(){salesPricingLoaded=true;salesPricingProducts=[{code:'982',name:'SKOL 600ML',ttv:{AD_ROTA:89.4},ttc:{AD_ROTA:9.99}}];renderSalesPricing();},
    pickers(query){refs.products=[{code:'25178',name:'51 ICE LIMÃO GARRAFA VD 275ML CX C/24'},{code:'9148',name:'ÁGUA M STER BOM S/GÁS PET 1,5L CAIXA C/6'}];const product=refs.products[0];for(const kind of ['nri','fefo']){selectOperationalProduct(kind,product);renderOperationalProductOptions(kind,query);}selectDeliveryDamageProduct(product);renderDeliveryDamageProductOptions(query);selectSalesDamageProduct(product);renderSalesDamageProductOptions(query);},
    decision(status,domain){const body=$('modalBody');body.className='damage-review-workspace'+(domain==='entrega'?' damage-review-delivery':'');body.innerHTML='<div class="damage-selection-bar"></div>';showDamageDecisionPanel({status,count:2,label:'Avaria de '+domain,onConfirm:()=>{throw new Error('This fixture cannot apply a decision.');}});},
    home(views,query){homeShortcutCatalog=()=>[{view:'nri-cadastro',title:'Cadastro por carreta',area:'Armazém',detail:'Produtos, lotes e NRIs',icon:'▣'}];saveHomeShortcutCache=()=>{};homeShortcutIds=views;$('homeShortcutSearch').value=query;renderHome();}
  };})();`);
  vm.runInContext(source,context,{timeout:3000});
  const api=window.appearanceRenderTest;api.setup();api.conference();
  const diffs=Object.fromEntries(api.types.map(t=>[t.key,{plan:3,planBottles:69,sold:{containers:0,bottles:0},expected:3,expectedBottles:69,actual:3,actualBottles:69,diff:-1,diffUnits:0,containerValue:-2,bottleValue:0,value:-2,checkedValue:6}]));
  api.detail({status:'SEM_BASE',missing_maps:['123281'],map_number:'123281',source_map_date:'2026-11-16',conference:{checker_name:'Conferente de exemplo'},diffs,pos:0,neg:2});
  api.own([{id:'example',occurrence_date:'2026-11-16',created_at:'2026-11-16T12:00:00Z',customer_code:'371',customer_name:'CLIENTE DE EXEMPLO',map_number:'123456',damage_items:[{product_text:'982 - SKOL 600ML',quantity:1,quantity_unit:'UNIDADE',lot:'123',reason:'Quebrado',status:'CANCELADO'}]}]);
  document.getElementById('salesPricingSearch').value='skol';api.prices();
  api.pickers(productQuery);
  if(decision)api.decision(decision.status,decision.domain);
  if(home)api.home(home.views||[],home.query||'');
  return document.toString();
}
const markup=renderedApplication();
function readable(c,element){assert.ok(element,'element must exist');const color=c.value(element,'color'),bg=c.background(element);assert.ok(contrast(color,bg)>=4.5,`${element.tagName}.${element.className} ${element.textContent.trim().slice(0,30)}: ${color} on ${bg}`);}
function darkSurface(c,element){assert.ok(element,'surface must exist');const bg=c.background(element);assert.ok(luminance(bg)<.12,`${element.tagName}#${element.id}.${element.className} must use a dark surface, got ${bg}`);}

for(const width of [390,1280])test(`real form controls use dark colors across every module (${width}px)`,()=>{
  const c=cascade({theme:'dark',width,markup});
  const controls=c.document.querySelectorAll('#appShell input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]),#appShell select,#appShell textarea');
  assert.ok(controls.length>200);
  for(const control of controls){darkSurface(c,control);readable(c,control);}
});
test('section titles, live info, customer panels and indicators are readable in dark mode',()=>{
  const c=cascade({theme:'dark',markup});
  for(const el of c.document.querySelectorAll('.block-head strong,.block-head small,.live-info strong,.live-info small,.customer-card strong,.customer-card small,.kpi strong,.kpi span,.kpi small,.conf-outcome-donut strong,.conf-outcome-donut span'))readable(c,el);
  for(const el of c.document.querySelectorAll('.live-info>div,.customer-card,.kpi,.multi-lot-list,.conf-outcome-donut>div,.evidence-card'))darkSurface(c,el);
});
test('all six phases of the generated conference detail stay dark and readable',()=>{
  const c=cascade({theme:'dark',markup});
  assert.ok(c.document.querySelectorAll('.conference-phase').length>=24);
  for(const el of c.document.querySelectorAll('.conference-product-head,.conference-phase,.conference-simple-row'))darkSurface(c,el);
  for(const el of c.document.querySelectorAll('.conference-results h3,.conference-product-head h4,.conference-product-head small,.conference-product-status,.conference-phase-label,.conference-phase-line small,.conference-phase-line strong,.conference-simple-name,.conference-simple-metric small,.conference-simple-metric strong'))readable(c,el);
});
test('generated own damage cards have no light body and retain readable metadata and status',()=>{
  const c=cascade({theme:'dark',markup});
  assert.equal(c.document.querySelectorAll('.delivery-my-card').length,1);
  for(const el of c.document.querySelectorAll('.delivery-my-card,.delivery-my-card-head,.delivery-my-card-body,.delivery-my-product'))darkSurface(c,el);
  for(const el of c.document.querySelectorAll('.delivery-my-card small,.delivery-my-card strong,.delivery-my-card h2,.delivery-my-card-label,.delivery-my-card .status,.delivery-my-card-actions button'))readable(c,el);
});
test('generated TTV and TTC headers, prices and missing-price values are readable',()=>{
  const c=cascade({theme:'dark',markup});
  assert.equal(c.document.querySelectorAll('.sales-pricing-metric').length,2);
  for(const el of c.document.querySelectorAll('.sales-pricing-metric h4,.sales-pricing-row span,.sales-pricing-row strong'))readable(c,el);
});
test('dark overrides retain light controls for print and white signing surfaces',()=>{
  const light=cascade({theme:'light',markup}),darkPrint=cascade({theme:'dark',media:'print',markup}),dark=cascade({theme:'dark',markup});
  for(const id of ['nriUnidade','confMapa','salesDamageObservation','salesPricingSearch']){assert.ok(luminance(light.background(light.document.getElementById(id)))>.9);assert.ok(luminance(darkPrint.background(darkPrint.document.getElementById(id)))>.9);}
  assert.equal(dark.background(dark.document.querySelector('.av-signature canvas')),'#fff');
});
test('static text across all application screens retains readable dark-mode contrast',()=>{
  const c=cascade({theme:'dark'});let checked=0;
  for(const el of c.document.querySelectorAll('#appShell p,#appShell span,#appShell button,#appShell h1,#appShell h2,#appShell h3,#appShell h4,#appShell small,#appShell strong,#appShell label')){
    if(![...el.childNodes].some(node=>node.nodeType===3&&node.textContent.trim())||el.closest('svg,.signature-sheet'))continue;
    readable(c,el);checked++;
  }
  assert.ok(checked>1000);
});
for(const theme of ['light','dark'])for(const state of ['normal','hover','active'])test(`generated product suggestions and selected products are readable (${theme}, ${state})`,()=>{
  const {document}=parseHTML(markup);
  if(state!=='normal')document.querySelectorAll('.sales-product-option').forEach(el=>el.classList.add(state==='hover'?'test-hover':'active'));
  const c=cascade({theme,markup:document.toString()});
  for(const id of ['nriProductOptions','fefoProductOptions','avProductOptions','salesDamageProductOptions']){
    const list=c.document.getElementById(id);assert.equal(list.querySelectorAll('.sales-product-option').length,2);
    for(const el of list.querySelectorAll('.sales-product-option-text strong,.sales-product-option-text small,.sales-product-footer'))readable(c,el);
  }
  for(const el of c.document.querySelectorAll('.sales-product-selected.chosen strong,.sales-product-selected.chosen small'))readable(c,el);
});
test('product empty-result messages remain readable in dark mode',()=>{
  const c=cascade({theme:'dark',markup:renderedApplication('produto-inexistente')});
  assert.equal(c.document.querySelectorAll('.sales-product-empty').length,4);
  for(const el of c.document.querySelectorAll('.sales-product-empty')){darkSurface(c,el);readable(c,el);}
});
for(const domain of ['entrega','vendas'])for(const status of ['APROVADO','REPROVADO','CANCELADO'])test(`generated bulk decision panel follows dark mode (${domain}, ${status})`,()=>{
  const scene=renderedApplication('',{status,domain}),c=cascade({theme:'dark',markup:scene}),panel=c.document.querySelector('.damage-decision-panel');
  assert.ok(panel.getAttribute('aria-label').includes('2 produtos'));
  darkSurface(c,panel);
  for(const el of panel.querySelectorAll('strong,small,label,textarea,button'))readable(c,el);
  for(const media of ['screen','print']){
    const light=cascade({theme:'light',media,markup:scene}),lightPanel=light.document.querySelector('.damage-decision-panel');
    assert.ok(luminance(light.background(lightPanel))>.9);
  }
  const darkPrint=cascade({theme:'dark',media:'print',markup:scene});assert.ok(luminance(darkPrint.background(darkPrint.document.querySelector('.damage-decision-panel')))>.9);
});
test('generated home empty state, shortcuts and picker messages remain readable in dark mode',()=>{
  for(const home of [{},{views:['nri-cadastro']},{query:'busca-sem-resultados'}]){
    const c=cascade({theme:'dark',markup:renderedApplication('',null,home)});
    const elements=c.document.querySelectorAll('.home-empty strong,.home-empty p,.home-empty button,.home-shortcut-card strong,.home-shortcut-card small,.home-shortcut-area,.home-shortcut-open>span,.home-shortcut-remove,.home-option strong,.home-option small,.home-options-empty');
    assert.ok(elements.length>2);
    for(const el of elements)readable(c,el);
    for(const el of c.document.querySelectorAll('.home-empty,.home-shortcut-card,.home-option'))darkSurface(c,el);
    if(home.query)assert.ok(c.document.querySelector('.home-options-empty'));
    else if(home.views)assert.ok(c.document.querySelector('.home-shortcut-card'));
    else assert.match(c.document.querySelector('.home-empty').textContent,/Sua Home está pronta para você/);
  }
});
