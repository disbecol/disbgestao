import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=app.replace(/\}\)\(\);\s*$/,`window.reviewTest={
  setup(record,permissions,matches,hooks){
    adminAvarias=[record];hasPerm=code=>permissions.includes(code);
    lotNriMap=new Map(matches.map(row=>[deliveryDamageLotKey(row),[row]]));
    sb={storage:{from:()=>({createSignedUrl:async path=>({data:{signedUrl:'https://example.test/'+path}})})}};
    openModal=(...args)=>hooks.modals.push(args);setupDamageGeoMap=()=>{};setupDamageReviewWorkspace=()=>{};
    customerGeoForDamage=async()=>null;
  },show:showAvariaDetail
};})();`);
const item=(id,status,overrides={})=>({id,status,product_code:'988',product_text:'988 - BRAHMA 600ML',lot:'L123',quantity:2,quantity_unit:'UNIDADE',reason:'Quebrado',...overrides});
const record=(items,overrides={})=>({id:'request',customer_code:'40',customer_name:'Mercado de exemplo',city:'Caicó',map_number:'123',delivery_name:'Motorista',occurrence_date:'2026-11-12',damage_items:items,...overrides});
async function render(row,permissions=[],matches=[]){
  const modals=[],el={querySelectorAll:()=>[],addEventListener(){}};
  const window={addEventListener(){}};
  vm.runInNewContext(source,{window,document:{getElementById:()=>el,addEventListener(){},querySelectorAll:()=>[]},navigator:{onLine:true},console,setInterval(){},setTimeout,clearTimeout,clearInterval(){}},{timeout:3000});
  window.reviewTest.setup(row,permissions,matches,{modals});await window.reviewTest.show(row.id);
  const [title,subtitle,html,actions]=modals[0];return {title,subtitle,html,actions};
}
test('delivery detail keeps status-specific permissions and never exposes actions to read-only users',async()=>{
  const row=record([item('pending','PENDENTE'),item('approved','APROVADO'),item('launched','LANCADO'),item('done','ENTREGUE')]);
  const read=await render(row);
  assert.doesNotMatch(read.html,/data-delivery-(review|launch|delivered|cancel)=/);
  assert.equal(read.actions.length,1);
  const reviewer=await render(row,['DELIVERY_DAMAGE_REVIEW']);
  assert.match(reviewer.html,/data-delivery-review="APROVADO" data-item-id="pending"/);
  assert.doesNotMatch(reviewer.html,/data-delivery-(launch|delivered)=/);
  const post=await render(row,['DELIVERY_DAMAGE_POST']);
  assert.match(post.html,/data-delivery-launch="approved"/);
  assert.match(post.html,/data-delivery-delivered="launched"/);
  assert.doesNotMatch(post.html,/data-delivery-review=|data-delivery-cancel="done"/);
});
test('receipt history is a global utility, including occurrences without actionable products',async()=>{
  for(const status of ['PENDENTE','APROVADO','LANCADO','ENTREGUE','REPROVADO','CANCELADO']){
    const result=await render(record([item('a',status)]));
    const history=result.actions.find(action=>action.label==='Comprovantes emitidos');
    assert.ok(history?.class.includes('damage-action-global'),status);
  }
});
test('NRI lot compatibility remains keyed by both product and lot',async()=>{
  const row=record([item('a','PENDENTE')]);
  const wrong=await render(row,[],[{product_code:'982',lot:'L123',nri:'NRI-WRONG'}]);
  assert.doesNotMatch(wrong.html,/Lote compatível|NRI-WRONG/);
  const matched=await render(row,[],[{product_code:'988',lot:'L123',nri:'NRI-EXAMPLE'}]);
  assert.match(matched.html,/Lote compatível/);assert.match(matched.html,/NRI-EXAMPLE/);
});
test('evidence, audit, and signature remain available without broken missing-signature images',async()=>{
  const result=await render(record([item('a','LANCADO',{reviewed_at:'2026-11-12T10:00:00Z',review_note:'Conferido',damage_item_photos:[{photo_path:'photo.jpg',latitude:-6.46,longitude:-37.1}]})],{signature_path:'signature.png'}),['DELIVERY_DAMAGE_POST']);
  assert.match(result.html,/data-damage-photo/);assert.match(result.html,/signature.png/);assert.match(result.html,/sales-decision/);assert.match(result.html,/damageGeoDetails/);
  const missing=await render(record([item('a','PENDENTE',{lot:'',reason:'Não foi no caminhão'})]));
  assert.match(missing.html,/Esta ocorrência não possui assinatura disponível/);assert.doesNotMatch(missing.html,/<img src=""|Lote não encontrado/);
});
test('customer and product text is escaped in the redesigned detail',async()=>{
  const result=await render(record([item('a','PENDENTE',{product_text:'988 - <script>alert(1)</script>',reason:'<img onerror=alert(1)>'})],{customer_name:'<svg onload=alert(1)>'}));
  assert.doesNotMatch(result.html,/<script>|<svg onload|<img onerror/);assert.match(result.html,/&lt;script&gt;/);assert.match(result.html,/&lt;svg/);
});
