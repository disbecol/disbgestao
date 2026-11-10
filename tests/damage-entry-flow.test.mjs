import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

// Exercise the production handlers, including the final offline-first reassignment.
// Only device/network/storage boundaries and unrelated product-image rendering are stubbed.
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=app.replace(/\}\)\(\);\s*$/,`window.damageEntryTest={
  setup(hooks){
    authUser={id:'driver-a'};profile={name:'Motorista A'};activeUnit='Matriz Caicó';
    refs.products=[{code:'988',name:'BRAHMA CHOPP 600ML'}];
    productsByCode=new Map(refs.products.map(p=>[p.code,p]));
    selectedCustomer=()=>hooks.customer;currentCustomerMatches=()=>hooks.customer?[hooks.customer]:[];
    renderDeliveryDamageProductSelection=()=>{};hideDeliveryDamageProductOptions=()=>{};
    refreshCustomerGeoForCapture=async()=>{};damageCaptureSummary=()=>({outside:0,text:'GPS capturado'});
    toast=(message,type)=>hooks.toasts.push({message,type});
    clearSignature=()=>{signatureDirty=false;hooks.signatureClears++;};
    captureGps=(...args)=>hooks.captureGps(...args);compressImage=(...args)=>hooks.compressImage(...args);
    canvasBlob=async()=>hooks.signatureBlob;
    offlineQueueAdd=(...args)=>hooks.queueAdd(...args);
    syncOfflineQueue=async()=>{hooks.syncCalls++;};offlineGet=async()=>null;
    offlineOpenNextDamageReceipt=async()=>{hooks.receiptCalls++;};
  },
  state(){return {items:avariaItems,photos:avPhotos,editing:avariaEditingId,step:avariaStep,
    signature:signatureDirty,photoPending:avariaPhotoPending,version:avariaEditorVersion,
    lookupSeq:deliveryCustomerLookupSeq,unit:activeUnit,pending:!!submitAvaria._pending};},
  seed(s){
    if('items'in s)avariaItems=s.items;if('photos'in s)avPhotos=s.photos;
    if('selected'in s)deliveryDamageSelectedProduct=s.selected;if('signature'in s)signatureDirty=s.signature;
    if('step'in s)avariaStep=s.step;if('editing'in s)avariaEditingId=s.editing;
    if('unit'in s)activeUnit=s.unit;if('owner'in s)authUser={id:s.owner};
  },
  validDate:validAvariaDate,lotRequirement:renderAvariaLotRequirement,add:addAvariaItem,nextProducts:advanceAvariaProducts,
  edit:editAvariaItem,clearEditor:clearAvariaItemEditor,clearRequest:clearAvariaRequest,
  step:setAvariaStep,photo:onAvariaPhoto,itemClick:onAvariaItemListClick,submit:e=>submitAvaria(e)
};})();`);
assert.notEqual(source,app,'test seam must be inserted into the app closure');

class Element {
  constructor(){this._value='';this.textContent='';this.innerHTML='';this.disabled=false;this.dataset={};this.style={};this.attributes={};this.focused=false;const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>{const add=on??!classes.has(x);if(add)classes.add(x);else classes.delete(x);return add;}};}
  get value(){return this._value;}
  set value(value){this._value=String(value??'');}
  setAttribute(name,value){this.attributes[name]=String(value);}
  focus(){this.focused=true;}
  scrollIntoView(){}
  querySelectorAll(){return [];}
  addEventListener(){}
}
const GPS={latitude:-6.46,longitude:-37.1,accuracy:12,capturedAt:'2026-11-10T12:00:00.000Z'};
const PRODUCT={code:'988',name:'BRAHMA CHOPP 600ML'};
function photo(url='blob:existing'){return {id:randomUUID(),blob:new Blob(['photo']),previewUrl:url,gps:{...GPS}};}
function item(overrides={}){return {id:randomUUID(),product:'988 - BRAHMA CHOPP 600ML',product_code:'988',product_name:PRODUCT.name,lot:'L2408',quantity:2,unit:'UNIDADE',reason:'Quebrado',photos:[photo()],...overrides};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function until(predicate){for(let n=0;n<30;n++){if(predicate())return;await Promise.resolve();}assert.ok(predicate(),'asynchronous boundary was not reached');}
function harness(){
  const elements=new Map(),revoked=[],created=[];
  const el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const steps=[1,2,3].map(n=>Object.assign(new Element(),{dataset:{avStep:String(n)}}));
  const units=['UNIDADE','CAIXA'].map(unit=>Object.assign(new Element(),{dataset:{avUnit:unit}}));
  const hooks={customer:{id:'customer-a',code:'371',name:'Cliente A',city:'Caicó'},toasts:[],signatureClears:0,
    signatureBlob:new Blob(['signature']),captureGps:async()=>({...GPS}),compressImage:async()=>new Blob(['compressed']),
    queueCalls:[],syncCalls:0,receiptCalls:0};
  hooks.queueAdd=async(...args)=>{hooks.queueCalls.push(args);return {id:args[2]};};
  const window={addEventListener(){}};
  vm.runInNewContext(source,{window,document:{addEventListener(){},getElementById:el,
    querySelectorAll:selector=>selector==='[data-av-step]'?steps:selector==='[data-av-unit]'?units:[]},
    navigator:{onLine:false},console:{warn(){},log(){},info(){},error(){}},crypto:{randomUUID},Blob,
    URL:{createObjectURL(){const url='blob:generated-'+created.length;created.push(url);return url;},revokeObjectURL:url=>revoked.push(url)},
    setInterval(){},setTimeout,clearTimeout,clearInterval(){}},{timeout:3000});
  const api=window.damageEntryTest;api.setup(hooks);
  el('avData').value='2026-11-10';el('avPdv').value='371';el('avMapa').value='131313';el('avEntregador').value='Motorista A';el('avUnidade').value='UNIDADE';
  el('formAvaria').querySelectorAll=()=>['avData','avPdv','avMapa','avProduto','avLote','avQuantidade','avUnidade','avMotivo','btnSalvarAvaria'].map(el);
  const fill=(values={})=>{
    const {selected=PRODUCT,photos=[photo()],...fields}=values;
    api.seed({selected,photos});
    for(const [id,value] of Object.entries({avProduto:'988 - BRAHMA CHOPP 600ML',avLote:'L2408',avQuantidade:'2',avUnidade:'UNIDADE',avMotivo:'Quebrado',...fields}))el(id).value=value;
  };
  const click=(act,id)=>{
    const button={dataset:{act},closest:selector=>selector==='[data-id]'?{dataset:{id}}:null};
    api.itemClick({preventDefault(){},target:{closest:selector=>selector==='button[data-act]'?button:null}});
  };
  return {api,el,hooks,revoked,created,fill,click,event:()=>({preventDefault(){}})};
}

test('validates complete real dates, including leap years and century boundaries',()=>{
  const {api}=harness();
  for(const date of ['2024-02-29','2000-02-29','2026-11-10','1900-01-01','9999-12-31'])assert.equal(api.validDate(date),true,date);
  for(const date of ['',null,'10/11/2026','2026-2-09','2026-02-29','1900-02-29','2026-04-31','2026-00-01','2026-13-01','2026-01-00','2026-01-32','2026-11-10x'])assert.equal(api.validDate(date),false,String(date));
});

test('requires a catalog selection, a positive safe integer, and supported unit/reason',()=>{
  for(const invalid of [{selected:null},{avQuantidade:'0'},{avQuantidade:'-1'},{avQuantidade:'1.5'},{avQuantidade:'NaN'},{avQuantidade:'9007199254740992'},{avUnidade:'PALLET'},{avMotivo:'Outro motivo'}]){
    const h=harness();h.fill(invalid);
    assert.equal(h.api.add(),false,JSON.stringify(invalid));assert.equal(h.api.state().items.length,0);
    assert.equal(h.hooks.toasts.at(-1).type,'error');
  }
  const h=harness();h.fill({avQuantidade:'13',avUnidade:'CAIXA'});assert.equal(h.api.add(),true);assert.equal(h.api.state().items[0].quantity,13);assert.equal(h.api.state().items[0].unit,'CAIXA');
});

test('requires photo and GPS except that “Não foi no caminhão” permits no photos',()=>{
  const h=harness();h.fill({photos:[]});assert.equal(h.api.add(),false);assert.match(h.hooks.toasts.at(-1).message,/foto/i);
  h.fill({photos:[{...photo(),gps:null}]});assert.equal(h.api.add(),false);assert.match(h.hooks.toasts.at(-1).message,/GPS/);
  h.fill({photos:[],avMotivo:'Não foi no caminhão'});assert.equal(h.api.add(),true);assert.equal(h.api.state().items[0].photos.length,0);
  const valid=harness();valid.fill();assert.equal(valid.api.add(),true);assert.equal(valid.api.state().items[0].photos[0].gps.accuracy,12);
});

test('Next automatically commits the completed editor exactly once before review',()=>{
  const h=harness();h.api.seed({step:2});h.fill();
  assert.equal(h.api.nextProducts(),true);assert.equal(h.api.state().step,3);assert.equal(h.api.state().items.length,1);
  assert.equal(h.el('avProduto').value,'');assert.equal(h.api.state().photos.length,0);
  assert.equal(h.api.nextProducts(),true);assert.equal(h.api.state().items.length,1);
});

test('a partial editor blocks review even when another product was already added',()=>{
  const h=harness();h.api.seed({items:[item()],step:2});h.el('avLote').value='L-DRAFT';
  assert.equal(h.api.nextProducts(),false);assert.equal(h.api.state().step,2);assert.equal(h.api.state().items.length,1);
  assert.equal(h.el('avLote').value,'L-DRAFT');assert.equal(h.api.state().items[0].lot,'L2408');
});

test('editing replaces the same item; cancelling releases only uncommitted photo URLs',()=>{
  const h=harness(),saved=item();h.api.seed({items:[saved],step:2});
  assert.equal(h.api.edit(saved),true);h.el('avQuantidade').value='7';assert.equal(h.api.add(),true);
  assert.equal(h.api.state().items.length,1);assert.equal(h.api.state().items[0].id,saved.id);assert.equal(h.api.state().items[0].quantity,7);
  h.api.edit(h.api.state().items[0]);h.api.seed({photos:[...h.api.state().photos,photo('blob:draft-only')]});h.api.clearEditor();
  assert.equal(h.api.state().items[0].photos.length,1);assert.equal(h.api.state().editing,null);
  assert.ok(h.revoked.includes('blob:draft-only'));assert.ok(!h.revoked.includes('blob:existing'));
});

test('deleting the item currently being edited cannot resurrect it on Next',()=>{
  const h=harness(),saved=item();h.api.seed({items:[saved],step:2});h.api.edit(saved);h.click('del',saved.id);
  assert.equal(h.api.state().items.length,0);assert.equal(h.api.state().editing,null);assert.equal(h.el('avProduto').value,'');
  assert.equal(h.api.nextProducts(),false);assert.equal(h.api.state().items.length,0);assert.equal(h.api.state().step,2);
  assert.equal(h.revoked.filter(url=>url==='blob:existing').length,1);
});

test('Back and Next preserve the signature if the reviewed content has not changed',()=>{
  const h=harness();h.api.seed({items:[item()],step:3,signature:true});
  h.api.step(2);assert.equal(h.api.state().signature,true);assert.equal(h.api.nextProducts(),true);
  assert.equal(h.api.state().step,3);assert.equal(h.api.state().items.length,1);assert.equal(h.api.state().signature,true);
  assert.equal(h.hooks.signatureClears,0);
  h.api.step(2);h.el('avQuantidade').value='3';assert.equal(h.api.nextProducts(),true);
  assert.equal(h.api.state().signature,false,'a changed product requires a fresh signature');assert.equal(h.hooks.signatureClears,1);
});

test('a late GPS/photo result after resetting the request is discarded and its URL released',async()=>{
  const h=harness(),gps=deferred();let gpsCalls=0;
  h.hooks.captureGps=()=>{gpsCalls++;return gps.promise;};h.api.seed({step:2,signature:true});
  const input={value:'camera-photo',files:[{name:'camera.jpg',size:20,lastModified:1}]};
  const task=h.api.photo({target:input});await until(()=>gpsCalls===1);assert.equal(h.api.state().photoPending,true);
  assert.equal(h.api.nextProducts(),false);assert.equal(h.api.step(1),false);assert.equal(h.api.state().step,2);
  const version=h.api.state().version,lookup=h.api.state().lookupSeq;h.api.clearRequest();
  assert.ok(h.api.state().version>version);assert.ok(h.api.state().lookupSeq>lookup);assert.equal(h.api.state().photoPending,false);
  gps.resolve({...GPS});await task;
  assert.equal(h.api.state().photos.length,0);assert.equal(h.api.state().items.length,0);assert.equal(h.api.state().step,1);
  assert.equal(h.api.state().signature,false);assert.deepEqual(h.revoked,h.created);assert.equal(input.value,'');
});

test('Enter in steps 1 and 2 advances locally and never writes to the offline queue',async()=>{
  const h=harness();
  await h.api.submit(h.event());assert.equal(h.api.state().step,2);assert.equal(h.hooks.queueCalls.length,0);
  h.fill({photos:[],avMotivo:'Não foi no caminhão'});await h.api.submit(h.event());
  assert.equal(h.api.state().step,3);assert.equal(h.api.state().items.length,1);assert.equal(h.hooks.queueCalls.length,0);
  h.el('avData').value='2026-02-30';h.api.seed({signature:true});await h.api.submit(h.event());
  assert.equal(h.api.state().step,1);assert.equal(h.hooks.queueCalls.length,0);assert.equal(h.api.state().items.length,1);
});

test('double submit persists once and clears only after durable local storage succeeds',async()=>{
  const h=harness(),persist=deferred(),saved=item();h.api.seed({items:[saved],step:3,signature:true});
  h.hooks.queueAdd=async(...args)=>{h.hooks.queueCalls.push(args);await persist.promise;return {id:args[2]};};
  const first=h.api.submit(h.event());await until(()=>h.hooks.queueCalls.length===1);
  await h.api.submit(h.event());assert.equal(h.hooks.queueCalls.length,1);assert.equal(h.api.state().items.length,1);assert.equal(h.api.state().signature,true);
  assert.equal(h.api.state().pending,true);assert.equal(h.el('btnSalvarAvaria').disabled,true);
  assert.equal(h.el('avQuantidade').disabled,true);assert.equal(h.el('signatureCanvas').style.pointerEvents,'none');
  const [type,payload,operationId]=h.hooks.queueCalls[0];assert.equal(type,'DAMAGE_CREATE');assert.ok(operationId);
  assert.equal(payload.unit,'Matriz Caicó');assert.equal(payload.items[0].photos[0].blob,saved.photos[0].blob);assert.equal(payload.signature_blob,h.hooks.signatureBlob);
  persist.resolve();await first;
  assert.equal(h.api.state().items.length,0);assert.equal(h.api.state().signature,false);assert.equal(h.api.state().step,1);
  assert.equal(h.api.state().pending,false);assert.equal(h.el('btnSalvarAvaria').disabled,false);assert.equal(h.hooks.syncCalls,0);
  assert.match(h.hooks.toasts.at(-1).message,/salva no aparelho/i);
  // A context changing during a device await must never attach the old draft to it.
  for(const changedContext of [{unit:'Filial Pau dos Ferros'},{owner:'driver-b'}]){
    const scoped=harness(),gps=deferred();let gpsCalls=0;
    scoped.api.seed({items:[item({photos:[],reason:'Não foi no caminhão'})],step:3,signature:true});
    scoped.hooks.captureGps=()=>{gpsCalls++;return gps.promise;};
    const save=scoped.api.submit(scoped.event());await until(()=>gpsCalls===1);scoped.api.seed(changedContext);gps.resolve({...GPS});await save;
    assert.equal(scoped.hooks.queueCalls.length,0,'a changed unit or owner cannot receive the queued request');
    assert.equal(scoped.api.state().items.length,1);assert.equal(scoped.api.state().signature,true);assert.equal(scoped.api.state().pending,false);
  }
});

test('local storage failure preserves products, photos, signature, and retry availability',async()=>{
  const h=harness(),saved=item();h.api.seed({items:[saved],step:3,signature:true});
  h.hooks.queueAdd=async(...args)=>{h.hooks.queueCalls.push(args);throw new Error('QuotaExceededError');};
  await h.api.submit(h.event());
  assert.equal(h.hooks.queueCalls.length,1);assert.equal(h.api.state().items.length,1);assert.equal(h.api.state().items[0].id,saved.id);
  assert.equal(h.api.state().items[0].photos[0].blob,saved.photos[0].blob);assert.equal(h.api.state().signature,true);assert.equal(h.api.state().step,3);
  assert.equal(h.api.state().pending,false);assert.equal(h.el('btnSalvarAvaria').disabled,false);assert.deepEqual(h.revoked,[]);
  assert.match(h.hooks.toasts.at(-1).message,/Não foi possível salvar/);assert.equal(h.hooks.toasts.at(-1).type,'error');
});


test('lot is optional only for missing-on-rack and not-on-truck, without relaxing photo/GPS rules',async()=>{
  for(const reason of ['Faltando na Grade','Não foi no caminhão']){
    const h=harness();h.fill({avLote:'',avMotivo:reason,photos:reason==='Não foi no caminhão'?[]:[photo()]});h.api.lotRequirement();
    assert.equal(h.el('avLote').required,false);assert.equal(h.el('avLote').attributes['aria-required'],'false');assert.equal(h.el('avLotLabel').textContent,'Lote (opcional)');
    assert.equal(h.api.nextProducts(),true);assert.equal(h.api.state().items[0].lot,'');assert.match(h.el('avReviewItems').innerHTML,/Não informado/);
    h.api.seed({signature:true});await h.api.submit(h.event());assert.equal(h.hooks.queueCalls.length,1);assert.equal(h.hooks.queueCalls[0][1].items[0].lot,'');
  }
  for(const reason of ['Quebrado','Embalagem amassada/rasgada','Furada','Sem Tampa','Mal cheia','']){
    const h=harness();h.fill({avLote:'',avMotivo:reason});h.api.lotRequirement();assert.equal(h.el('avLote').required,true);assert.equal(h.el('avLotLabel').textContent,'Lote *');assert.equal(h.api.add(),false);assert.equal(h.api.state().items.length,0);
  }
  const missing=harness();missing.fill({avLote:'',avMotivo:'Faltando na Grade',photos:[]});assert.equal(missing.api.add(),false);assert.match(missing.hooks.toasts.at(-1).message,/foto/i);
  const retained=harness();retained.fill({avLote:'L123',avMotivo:'Não foi no caminhão'});retained.api.lotRequirement();retained.el('avMotivo').value='Quebrado';retained.api.lotRequirement();assert.equal(retained.el('avLote').required,true);assert.equal(retained.el('avLote').value,'L123');assert.equal(retained.api.add(),true);
});
