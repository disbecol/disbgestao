import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {cascade,contrast} from './helpers/css-cascade.mjs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('app.js').replace(/\}\)\(\);\s*$/,`window.damageTest={show:showAvariaDetail,close:closeModal,
 prepare(row,permissions,hooks){adminAvarias=[row];hasPerm=code=>permissions.includes(code);
 sb={storage:{from:()=>({createSignedUrl:async path=>({data:{signedUrl:'https://example.test/'+path}})})}};
 customerGeoForDamage=async()=>null;setupDamageGeoMap=()=>{};hydrateSalesDamageProductImages=()=>{};
 markDeliveryDamageDelivered=id=>hooks.push(['deliver',id]);markDeliveryDamageLaunched=id=>hooks.push(['launch',id]);
 reviewAvaria=(status,all,id)=>hooks.push(['review',status,id]);showDamageReceiptHistory=()=>hooks.push(['receipts']);
 }};})();`);
async function workspace(statuses=['LANCADO'],permissions=['DELIVERY_DAMAGE_REVIEW','DELIVERY_DAMAGE_POST']){
 const parsed=parseHTML(read('index.html')),document=parsed.document,hooks=[],window={addEventListener(){},Event:parsed.Event};
 Object.defineProperty(document,'readyState',{value:'loading'});document.addEventListener=()=>{};
 Object.defineProperty(parsed.HTMLInputElement.prototype,'checked',{get(){return this.hasAttribute('checked');},set(value){this.toggleAttribute('checked',!!value);},configurable:true});
 parsed.HTMLElement.prototype.scrollIntoView=function(){};
 const context=vm.createContext({window,document,navigator:{onLine:true},console:{log(){},info(){},warn(){},error(){}},setTimeout,clearTimeout,setInterval(){},clearInterval(){},URL});
 vm.runInContext(read('src/avarias/damage-workspace.js'),context);vm.runInContext(source,context);
 const row={id:'request',customer_code:'40',customer_name:'Mercado de exemplo',city:'Caicó',map_number:'123',delivery_name:'Motorista',occurrence_date:'2026-11-23',signature_path:'signature.png',damage_items:statuses.map((status,index)=>({id:'item-'+index,status,product_code:'988',product_text:'988 - BRAHMA 600ML',lot:'L123',quantity:2,quantity_unit:'UNIDADE',reason:'Quebrado',reviewed_at:status==='PENDENTE'?null:'2026-11-23T10:00:00Z',review_note:'Conferido',damage_item_photos:[{photo_path:'photo.jpg',latitude:-6.46,longitude:-37.1}]}))};
 window.damageTest.prepare(row,permissions,hooks);await window.damageTest.show(row.id);
 return {window,document,hooks,body:document.getElementById('modalBody'),actions:document.getElementById('modalActions')};
}
test('delivery opens with product, status and working primary action visible, without stage tabs or eye',async()=>{
 const c=await workspace();
 assert.equal(c.body.querySelectorAll('[role=tab]').length,2);
 assert.equal(c.body.querySelector('[data-damage-details-toggle]'),null);
 assert.equal(c.body.querySelector('.damage-counts'),null);
 assert.equal(c.body.querySelector('.damage-stage-nav'),null);
 assert.equal(c.body.querySelector('.damage-product-details').hidden,false);
 assert.equal(c.body.querySelector('.damage-product-head .status').textContent,'Aguardando entrega');
 const button=c.body.querySelector('.damage-v2-products [data-delivery-delivered]');
 assert.equal(button.textContent,'Confirmar entrega');button.click();assert.deepEqual(JSON.parse(JSON.stringify(c.hooks)),[['deliver','item-0']]);
 assert.equal(c.actions.hidden,true);
});
test('data tab contains signature, map, audit, receipts and cancellation with visible confirmation',async()=>{
 const c=await workspace();c.body.querySelector('[data-damage-view=information]').click();
 const info=c.body.querySelector('.damage-v2-information');
 assert.equal(info.hidden,false);assert.equal(c.body.querySelector('.damage-v2-products').hidden,true);
 assert.ok(info.querySelector('.damage-geo-details'));assert.ok(info.querySelector('img[alt="Assinatura do cliente registrada na avaria"]'));
 assert.ok(info.querySelector('.damage-v2-history .sales-decision'));
 info.querySelector('.damage-receipts-action').click();assert.deepEqual(JSON.parse(JSON.stringify(c.hooks)),[['receipts']]);
 info.querySelector('[data-delivery-cancel]').click();
 assert.ok(info.querySelector('.damage-decision-panel textarea'));assert.equal(info.closest('[hidden]'),null);
 c.window.damageTest.close();assert.equal(c.body.classList.contains('damage-detail-v2'),false);
});
test('read-only users see supporting information without mutation buttons',async()=>{
 const c=await workspace(['PENDENTE','ENTREGUE'],[]);
 assert.equal(c.body.querySelector('[data-delivery-review],[data-delivery-delivered],[data-delivery-cancel]'),null);
 assert.equal(c.actions.hidden,true);assert.ok(c.body.querySelector('.damage-receipts-action'));
});
test('bulk selection cannot mix stages and shows only actions valid for selected products',async()=>{
 const c=await workspace(['PENDENTE','LANCADO','PENDENTE']);
 const checks=[...c.body.querySelectorAll('.delivery-review-check')];
 function choose(check){check.checked=true;check.dispatchEvent(new c.window.Event('change',{bubbles:true}));}
 choose(checks[0]);choose(checks[1]);assert.equal(checks[0].checked,false);assert.equal(checks[1].checked,true);
 assert.equal(c.actions.querySelector('.damage-action-review').hidden,true);assert.equal(c.actions.querySelector('.damage-action-deliver').hidden,false);
 const all=c.body.querySelector('#deliveryDamageSelectAll');all.checked=true;all.dispatchEvent(new c.window.Event('change',{bubbles:true}));
 assert.deepEqual(checks.map(check=>!!check.checked),[true,false,true]);assert.equal(all.indeterminate,true);
 assert.equal(c.actions.querySelector('.damage-action-review').hidden,false);assert.equal(c.actions.querySelector('.damage-action-deliver').hidden,true);
});
for(const theme of ['light','dark'])test(`new product and supporting text have readable contrast (${theme})`,async()=>{
 const c=await workspace();const colors=cascade({theme,markup:c.document.toString()});
 for(const el of colors.document.querySelectorAll('.damage-detail-v2 strong,.damage-detail-v2 small,.damage-detail-v2 button,.damage-detail-v2 h3,.damage-v2-lot-note,.damage-v2-status')){
  const ratio=contrast(colors.value(el,'color'),colors.background(el));assert.ok(ratio>=4.5,`${el.tagName} ${el.textContent.trim()}: ${ratio.toFixed(2)}`);
 }
});
