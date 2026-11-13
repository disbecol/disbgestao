import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';

// Run the shipped handlers and IndexedDB transactions. Only device, DOM and
// remote-service boundaries are replaced; no real records/messages are sent.
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=app.replace(/\}\)\(\);\s*$/,`window.offlineDamageTest={
  setup(hooks,client){
    sb=client;authUser={id:'driver-a'};profile={name:'Motorista A'};activeUnit='Matriz Caicó';
    toast=(message,type)=>hooks.toasts.push({message,type});updateOnlineStatus=()=>{};
    populateReferenceInputs=()=>{};renderDeliveryDamageProductSelection=()=>{};hideDeliveryDamageProductOptions=()=>{};
    refreshCustomerGeoForCapture=async()=>{};damageCaptureSummary=()=>({outside:0,text:'GPS capturado'});
    clearSignature=()=>{signatureDirty=false;};canvasBlob=async()=>hooks.signature;
    compressImage=async file=>file;captureGps=async()=>hooks.gps;
    dispatchDamagePushV170=async()=>true;
    openModal=(...args)=>hooks.modals.push(args);closeModal=()=>{};
    getCustomerContacts=async()=>hooks.contacts;
    disbEnsureOnlineSupabaseSessionV172=async()=>{hooks.sessionRefreshes++;};
  },
  selectProduct(code){deliveryDamageSelectedProduct=productsByCode.get(code);},
  state(){return {items:avariaItems,photos:avPhotos,step:avariaStep,signature:signatureDirty};},
  seed(s){if('owner'in s)authUser={id:s.owner};if('unit'in s)activeUnit=s.unit;if('signature'in s)signatureDirty=s.signature;if('step'in s)avariaStep=s.step;},
  cacheKey:REF_CACHE_KEY,loadRefs:()=>loadReferences(true),customer:fetchCustomersByCode,
  photo:onAvariaPhoto,add:addAvariaItem,submit:submitAvaria,
  rows:offlineQueueRows,allRows:()=>offlineGetAll('queue'),get:id=>offlineGet('queue',id),process:processOfflineRecord,
  abortNextSave:async()=>{
    const db=await offlineDb(),transaction=db.transaction.bind(db);
    db.transaction=function(...args){const tx=transaction(...args);if(args[0]==='queue'&&args[1]==='readwrite'){db.transaction=transaction;queueMicrotask(()=>tx.abort());}return tx;};
  },
  sync:()=>syncOfflineQueue({silent:true}),reconnect:()=>disbSyncPendingAfterReconnectV172({notify:false}),
  receipts:offlineDamageReceipts,openReceipt:offlineOpenNextDamageReceipt,
  receiptContext:()=>deliveryDamageReceiptContext,send:sendDeliveryDamageReceipt,
  close:async()=>{if(offlineDbPromise)(await offlineDbPromise).close();}
};})();`);
assert.notEqual(source,app);
const GPS={latitude:-6.46,longitude:-37.1,accuracy:12,capturedAt:'2026-11-13T10:15:00Z'};
const CUSTOMER={id:'customer-a',code:'371',name:'Cliente de teste',city:'Caicó',branch:'Matriz Caicó'};
const CONTACT={id:'contact-a',label:'Recebedor de teste',phone_normalized:'5584000000000',whatsapp_receipt_eligible:true,whatsapp_receipt_verified_at:'2026-11-13T10:00:00Z'};
class Element{
  constructor(){this.value='';this.checked=false;this.disabled=false;this.textContent='';this.innerHTML='';this.dataset={};this.style={};this.attributes={};this.classList={add(){},remove(){},toggle(){},contains(){return false;}};}
  addEventListener(){} setAttribute(k,v){this.attributes[k]=v;} focus(){} scrollIntoView(){} querySelectorAll(){return [];}
}
function storage(){const entries=new Map();return {getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};}
function remote(){
  const r={files:new Map(),requests:new Map(),uploads:[],rpcs:[],messages:[],queryError:null,beforeUpload:null,afterRpc:null,uploadErrorAt:0,lostAck:false,missingId:false,locationError:false};
  r.client={
    storage:{from(bucket){assert.equal(bucket,'avarias');return {async upload(path,blob,options){r.uploads.push({path,blob,options});if(r.beforeUpload)await r.beforeUpload();if(r.uploads.length===r.uploadErrorAt)return {error:new Error('Failed to fetch')};r.files.set(path,blob);return {error:null};}};}},
    async rpc(name,args){
      r.rpcs.push({name,args});
      if(name==='offline_sync_damage_request'){
        if(!r.requests.has(args.p_operation_id))r.requests.set(args.p_operation_id,{id:randomUUID(),payload:structuredClone(args.p_payload)});
        if(r.afterRpc)await r.afterRpc();
        if(r.lostAck){r.lostAck=false;return {error:new Error('Failed to fetch: response lost')};}
        return {data:r.missingId?null:{request_id:r.requests.get(args.p_operation_id).id},error:null};
      }
      if(name==='set_damage_request_location')return {data:true,error:r.locationError?new Error('Failed to fetch location'):null};
      throw new Error('Unexpected RPC: '+name);
    },
    auth:{async getSession(){return {data:{session:{access_token:'isolated-test-token'}},error:null};}},
    functions:{async invoke(name,args){r.messages.push({name,args});return {data:{accepted:true},error:null};}},
    from(table){assert.equal(table,'damage_items');const query={select(){return query;},eq(){return query;},async order(){return {data:[{product_text:'988 - BRAHMA CHOPP 600ML',quantity:2,quantity_unit:'UNIDADE',status:'PENDENTE'}],error:r.queryError};}};return query;}
  };
  return r;
}
async function harness({indexedDB=new IDBFactory(),localStorage=storage(),server=remote()}={}){
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const hooks={toasts:[],modals:[],contacts:[CONTACT],signature:new Blob(['signature-bytes'],{type:'image/jpeg'}),gps:GPS,sessionRefreshes:0};
  const navigator={onLine:false},window={addEventListener(){}};
  const context={window,document:{getElementById:el,addEventListener(){},querySelectorAll(){return [];}},navigator,indexedDB,localStorage,
    crypto:{randomUUID},Blob,URL:{createObjectURL:()=>`blob:${randomUUID()}`,revokeObjectURL(){}},structuredClone,queueMicrotask,
    console:{warn(){},error(){},info(){},log(){}},setTimeout,clearTimeout,setInterval(){},clearInterval(){},confirm:()=>true};
  vm.runInNewContext(source,context,{timeout:3000});
  const api=window.offlineDamageTest;api.setup(hooks,server.client);
  if(!localStorage.getItem(api.cacheKey))localStorage.setItem(api.cacheKey,JSON.stringify({at:Date.now()-7*86400000,data:{products:[{code:'988',name:'BRAHMA CHOPP 600ML'}],customers:[CUSTOMER]}}));
  await api.loadRefs();
  el('avData').value='2026-11-13';el('avPdv').value='371';el('avMapa').value='TEST-131313';el('avUnidade').value='UNIDADE';
  const addProduct=async({reason='Quebrado',photos=2}={})=>{
    api.selectProduct('988');el('avProduto').value='988 - BRAHMA CHOPP 600ML';el('avLote').value='L-TEST';el('avQuantidade').value='2';el('avUnidade').value='UNIDADE';el('avMotivo').value=reason;
    for(let n=0;n<photos;n++)await api.photo({target:{value:'camera',files:[Object.assign(new Blob([`photo-${n}`],{type:'image/jpeg'}),{name:`photo-${n}.jpg`,lastModified:n+1})]}});
    assert.equal(api.add(),true);
  };
  const save=async(options)=>{
    const before=(await api.rows()).length;
    el('avData').value='2026-11-13';el('avPdv').value='371';el('avMapa').value='TEST-131313';
    await addProduct(options);api.seed({step:3,signature:true});await api.submit({preventDefault(){}});
    const rows=await api.rows();assert.equal(rows.length,before+1);return rows.at(-1);
  };
  return {api,el,hooks,navigator,indexedDB,localStorage,server,addProduct,save};
}

test('offline registration stores product, two photos, GPS and signature durably across app restart',async()=>{
  const h=await harness();assert.equal((await h.api.customer('000371'))[0].id,CUSTOMER.id);
  const row=await h.save();assert.equal(row.status,'PENDING');assert.equal(row.user_id,'driver-a');assert.equal(h.server.uploads.length,0);assert.equal(h.server.rpcs.length,0);
  assert.equal(await row.payload.signature_blob.text(),'signature-bytes');assert.equal(row.payload.items[0].photos.length,2);
  assert.equal(await row.payload.items[0].photos[1].blob.text(),'photo-1');assert.equal(row.payload.items[0].photos[0].gps.latitude,GPS.latitude);
  assert.equal(h.api.state().items.length,0);assert.equal(h.api.state().signature,false);assert.match(h.hooks.toasts.at(-1).message,/salva no aparelho/);
  await h.api.close();
  const reopened=await harness(h),restored=(await reopened.api.rows())[0];
  assert.equal(restored.id,row.id);assert.equal(await restored.payload.signature_blob.text(),'signature-bytes');assert.equal(await restored.payload.items[0].photos[0].blob.text(),'photo-0');
  reopened.navigator.onLine=true;assert.equal(await reopened.api.reconnect(),true);
  assert.equal((await reopened.api.rows()).length,0);assert.equal(h.server.requests.size,1);assert.equal(h.server.files.size,3);assert.equal(reopened.hooks.sessionRefreshes,1);
  const saved=h.server.requests.get(row.id);assert.equal(saved.payload.unit,'Matriz Caicó');assert.equal(saved.payload.customer_code,'371');assert.equal(saved.payload.items[0].photos.length,2);
  assert.ok([...h.server.files.keys()].every(path=>path.startsWith(`driver-a/offline_${row.id}/`)));
  assert.equal(h.server.messages.length,0,'synchronizing a registration does not send a paid message');
  assert.equal(reopened.hooks.modals.length,1,'reconnect opens the recipient chooser');
  await reopened.api.close();
});

test('interrupted photo upload retains all local bytes and retries with stable paths',async()=>{
  const h=await harness(),row=await h.save();h.server.uploadErrorAt=2;h.navigator.onLine=true;
  assert.equal(await h.api.sync(),false);const pending=await h.api.get(row.id);assert.equal(pending.status,'ERROR');assert.equal(pending.tries,1);
  assert.equal(await pending.payload.items[0].photos[1].blob.text(),'photo-1');assert.equal(h.server.requests.size,0);assert.equal((await h.api.receipts()).length,0);
  h.server.uploadErrorAt=0;assert.equal(await h.api.sync(),true);assert.equal((await h.api.rows()).length,0);assert.equal(h.server.requests.size,1);assert.equal(h.server.files.size,3);
  assert.ok(h.server.uploads.every(x=>x.options.upsert===true));assert.equal((await h.api.receipts()).length,1);await h.api.close();
});

test('lost server response and concurrent retry create one registration and one receipt prompt',async()=>{
  const h=await harness(),row=await h.save();h.navigator.onLine=true;h.server.lostAck=true;
  assert.equal(await h.api.sync(),false);assert.equal(h.server.requests.size,1);assert.ok(await h.api.get(row.id));
  await Promise.all([h.api.sync(),h.api.sync(),h.api.sync()]);
  assert.equal(h.server.requests.size,1);assert.equal((await h.api.rows()).length,0);assert.equal((await h.api.receipts()).length,1);
  const ids=h.server.rpcs.filter(x=>x.name==='offline_sync_damage_request').map(x=>x.args.p_operation_id);assert.ok(ids.every(id=>id===row.id));await h.api.close();
});

test('optional photo/GPS path retains registration after location RPC failure',async()=>{
  const h=await harness(),row=await h.save({reason:'Não foi no caminhão',photos:0});h.navigator.onLine=true;h.server.locationError=true;
  assert.equal(await h.api.sync(),false);assert.equal(h.server.requests.size,1);assert.ok(await h.api.get(row.id));
  h.server.locationError=false;assert.equal(await h.api.sync(),true);assert.equal(h.server.requests.size,1);assert.equal(h.server.files.size,1);
  assert.equal(h.server.rpcs.filter(x=>x.name==='set_damage_request_location').length,2);await h.api.close();
});

test('another signed-in user cannot synchronize or consume the owner’s local records',async()=>{
  const h=await harness(),row=await h.save();h.api.seed({owner:'driver-b'});h.navigator.onLine=true;await h.api.sync();
  assert.equal((await h.api.rows()).length,0);assert.equal((await h.api.allRows()).length,1);assert.equal(h.server.uploads.length,0);
  h.api.seed({owner:'driver-a',unit:'Filial Pau dos Ferros'});await h.api.sync();
  assert.equal(h.server.requests.get(row.id).payload.unit,'Matriz Caicó','the queued unit is preserved when the current unit changes');await h.api.close();
});

test('offline receipt send is blocked while the registration remains saved; online send uses synced request ID',async()=>{
  const h=await harness(),row=await h.save();
  await assert.rejects(()=>h.api.send(CONTACT,row.payload.receiptCtx,new Element()),/sincronizada/);
  assert.equal(h.server.messages.length,0);assert.ok(await h.api.get(row.id));
  h.navigator.onLine=true;await h.api.sync();const receipt=(await h.api.receipts())[0];
  h.navigator.onLine=false;await assert.rejects(()=>h.api.send(CONTACT,receipt,new Element()),/internet/);await h.api.openReceipt();
  assert.equal((await h.api.receipts()).length,1);assert.equal(h.server.messages.length,0);
  h.navigator.onLine=true;await h.api.openReceipt();await h.api.send(CONTACT,h.api.receiptContext(),new Element());
  assert.equal(h.server.messages.length,1);assert.equal(h.server.messages[0].args.body.request_id,h.server.requests.get(row.id).id);assert.equal(h.server.messages[0].args.body.contact_id,CONTACT.id);
  assert.equal((await h.api.rows()).length,0);await h.api.close();
});

test('missing server confirmation must not delete the local registration',async()=>{
  const h=await harness(),row=await h.save();h.navigator.onLine=true;h.server.missingId=true;
  assert.equal(await h.api.sync(),false);assert.ok(await h.api.get(row.id));assert.equal((await h.api.receipts()).length,0);
  h.server.missingId=false;await h.api.sync();assert.equal((await h.api.rows()).length,0);assert.equal(h.server.requests.size,1);await h.api.close();
});

test('failed receipt preload keeps the prompt available for another attempt',async()=>{
  const h=await harness();await h.save();h.navigator.onLine=true;await h.api.sync();h.server.queryError=new Error('Failed to fetch');
  assert.equal(await h.api.openReceipt(),false);assert.equal((await h.api.receipts()).length,1);
  h.server.queryError=null;assert.equal(await h.api.openReceipt(),true);assert.equal((await h.api.receipts()).length,0);assert.equal(h.server.messages.length,0);await h.api.close();
});

test('changing accounts during an upload cannot continue the request under the new session',async()=>{
  const h=await harness(),row=await h.save();h.navigator.onLine=true;h.server.beforeUpload=async()=>{h.api.seed({owner:'driver-b'});};
  await h.api.sync();assert.equal(h.server.rpcs.length,0);assert.equal(h.server.messages.length,0);assert.ok(await h.api.get(row.id));
  assert.equal((await h.api.receipts()).length,0);h.server.beforeUpload=null;h.api.seed({owner:'driver-a'});await h.api.sync();assert.equal(h.server.requests.size,1);await h.api.close();
});

test('changing accounts while receiving the server acknowledgement preserves the owner’s pending record',async()=>{
  const h=await harness(),row=await h.save();h.navigator.onLine=true;h.server.afterRpc=async()=>{h.api.seed({owner:'driver-b'});};
  await h.api.sync();assert.equal(h.server.requests.size,1);assert.ok(await h.api.get(row.id));assert.equal((await h.api.receipts()).length,0);
  h.api.seed({owner:'driver-a'});assert.equal((await h.api.receipts()).length,0);h.server.afterRpc=null;await h.api.sync();
  assert.equal(h.server.requests.size,1);assert.equal((await h.api.rows()).length,0);assert.equal((await h.api.receipts()).length,1);await h.api.close();
});

test('receipt prompts from two finishing uploads cannot overwrite each other',async()=>{
  const h=await harness(),first=await h.save(),second=await h.save();h.navigator.onLine=true;
  await Promise.all([h.api.process(first),h.api.process(second)]);
  const ids=(await h.api.receipts()).map(row=>row.offline_operation_id);assert.equal(ids.length,2);assert.ok(ids.includes(first.id));assert.ok(ids.includes(second.id));await h.api.close();
});

test('a receipt from another unit stays pending and double clicks open only one dialog',async()=>{
  const h=await harness();await h.save();h.navigator.onLine=true;await h.api.sync();h.api.seed({unit:'Filial Pau dos Ferros'});
  assert.equal(await h.api.openReceipt(),false);assert.equal((await h.api.receipts()).length,1);assert.equal(h.hooks.modals.length,0);
  h.api.seed({unit:'Matriz Caicó'});await Promise.all([h.api.openReceipt(),h.api.openReceipt()]);
  assert.equal(h.hooks.modals.length,1);assert.equal((await h.api.receipts()).length,0);await h.api.close();
});

test('an aborted IndexedDB save preserves the complete draft and unlocks the retry',async()=>{
  const h=await harness();await h.addProduct();h.api.seed({signature:true,step:3});await h.api.abortNextSave();
  const result=await Promise.race([h.api.submit({preventDefault(){}}).then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),100))]);
  assert.equal(result,true,'an aborted transaction must settle instead of leaving Saving forever');assert.equal((await h.api.rows()).length,0);
  assert.equal(h.api.state().items.length,1);assert.equal(h.api.state().signature,true);assert.equal(h.el('btnSalvarAvaria').disabled,false);
  assert.match(h.hooks.toasts.at(-1).message,/Não foi possível salvar/);await h.api.submit({preventDefault(){}});assert.equal((await h.api.rows()).length,1);await h.api.close();
});
