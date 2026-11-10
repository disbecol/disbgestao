import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=app.replace(/\}\)\(\);\s*$/,`window.receiptUiTest={
  setup(hooks,client){
    sb=client;authUser={id:'driver-a'};profile={name:'Motorista A'};activeUnit='Matriz Caicó';
    hasPerm=()=>hooks.allowed;
    toast=(message,type)=>hooks.toasts.push({message,type});
    openModal=(...args)=>hooks.openModal(...args);closeModal=()=>{};
    fetchCustomersByCode=(...args)=>hooks.fetchCustomers(...args);
    getCustomerContacts=(...args)=>hooks.getContacts(...args);
    hydrateSalesDamageProductImages=()=>{};humanCustomerContactError=e=>String(e?.message||e);
  },
  seed(s){if('requests'in s)deliveryDamageMyRequests=s.requests;if('unit'in s)activeUnit=s.unit;if('owner'in s)authUser={id:s.owner};},
  context:()=>deliveryDamageReceiptContext,
  cards:renderDeliveryDamageMy,myReceipt:onDeliveryDamageMyReceipt,
  open:openDeliveryDamageReceipt,optin:openDeliveryDamageReceiptOptin,
  capture:captureDeliveryReceiptOptinAndSend,send:sendDeliveryDamageReceipt
};})();`);
assert.notEqual(source,app);

const CONTACT={id:'contact-a',label:'Recebedor',phone_normalized:'5584999394080',whatsapp_receipt_eligible:true,whatsapp_receipt_verified_at:'2026-11-10T10:00:00Z',whatsapp_receipt_verified_by:'driver-a'};
const CUSTOMER={id:'customer-a',code:'371',name:'Mercado A',city:'Caicó'};
function request(overrides={}){return {id:'request-a',unit:'Matriz Caicó',created_by:'driver-a',customer_code:'371',customer_name:'Mercado A',city:'Caicó',occurrence_date:'2026-11-10',created_at:'2026-11-10T12:00:00Z',map_number:'131313',damage_items:[{product_text:'988 - BRAHMA 600ML',quantity:2,quantity_unit:'UNIDADE',status:'PENDENTE'}],...overrides};}
function context(overrides={}){return {request_id:'request-a',unit:'Matriz Caicó',customer:{...CUSTOMER},date:'2026-11-10',map_number:'131313',allow_resend:true,...overrides};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function until(predicate){for(let n=0;n<40;n++){if(predicate())return;await Promise.resolve();}assert.ok(predicate(),'expected asynchronous boundary was not reached');}
class Element {
  constructor(){this.value='';this.checked=false;this.disabled=false;this.textContent='';this.innerHTML='';this.dataset={};this.style={};this.listeners={};this.children=[];this.classList={add(){},remove(){},toggle(){},contains(){return false;}};}
  addEventListener(event,fn){this.listeners[event]=fn;}
  setAttribute(){}
  focus(){}
  querySelectorAll(selector){const match=/^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);if(!match)return [];const key=match[1].replace(/-([a-z])/g,(_,x)=>x.toUpperCase());return this.children.filter(el=>key in el.dataset&&(match[2]===undefined||el.dataset[key]===match[2]));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
function harness(){
  const elements=new Map(),calls=[],invokes=[],rpcs=[],modals=[],confirmations=[];
  const el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const hooks={allowed:true,toasts:[],contacts:[{...CONTACT}],customers:[{...CUSTOMER}],confirm:true,
    rpc:async()=>({data:true,error:null}),invoke:async()=>({data:{accepted:true,already_sent:false},error:null}),
    fetchCustomers:async code=>{calls.push(['customers',code]);return hooks.customers;},
    getContacts:async(...args)=>{calls.push(['contacts',...args]);return hooks.contacts;},
    openModal(title,subtitle,body,actions){calls.push(['modal',title]);modals.push({title,subtitle,body,actions});el('modalBody').innerHTML=body;el('modalBody').children=[];
      for(const match of body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
        const button=new Element();button.textContent=match[2].replace(/<[^>]+>/g,'');
        for(const attr of match[1].matchAll(/data-([\w-]+)="([^"]*)"/g))button.dataset[attr[1].replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=attr[2];
        el('modalBody').children.push(button);
      }
    }};
  const client={
    auth:{getSession:async()=>{calls.push(['session']);return {data:{session:{access_token:'session-test'}},error:null};}},
    rpc:async(name,args)=>{calls.push(['rpc',name]);rpcs.push({name,args});return hooks.rpc(name,args);},
    functions:{invoke:async(name,args)=>{calls.push(['invoke',name]);invokes.push({name,args});return hooks.invoke(name,args);}},
    from(table){const query={select(){return query;},eq(){return query;},order(){calls.push(['query',table]);return Promise.resolve({data:[{product_text:'988 - BRAHMA 600ML',quantity:2,quantity_unit:'UNIDADE',status:'PENDENTE'}],error:null});}};return query;}
  };
  const navigator={onLine:true},window={addEventListener(){}};
  vm.runInNewContext(source,{window,document:{getElementById:el,addEventListener(){},querySelectorAll(){return [];}},navigator,
    crypto:{randomUUID},console:{log(){},info(){},warn(){},error(){}},setInterval(){},setTimeout,clearTimeout,clearInterval(){},
    confirm:message=>{confirmations.push(message);return hooks.confirm;}},{timeout:3000});
  const api=window.receiptUiTest;api.setup(hooks,client);api.seed({requests:[request()]});
  const cardButton=new Element();cardButton.dataset.myDamageReceipt='request-a';
  const event=()=>({preventDefault(){},target:{closest:selector=>selector==='[data-my-damage-receipt]'?cardButton:null}});
  const fillConsent=()=>{el('receiptOptinRecipient').value='Recebedor A';el('receiptOptinAgeEvidence').value='RG';for(const id of ['receiptOptinConsent','receiptOptinAdult','receiptOptinBrazil'])el(id).checked=true;};
  return {api,el,hooks,navigator,calls,invokes,rpcs,modals,confirmations,cardButton,event,fillConsent};
}

test('own-avaria cards render a receipt action; foreign owner/unit and missing permission cannot open it',async()=>{
  const h=harness();h.api.cards();assert.match(h.el('avMyCards').innerHTML,/data-my-damage-receipt="request-a"/);assert.match(h.el('avMyCards').innerHTML,/Reenviar comprovante de avaria/);
  for(const record of [request({created_by:'driver-b'}),request({unit:'Filial Pau dos Ferros'})]){
    const x=harness();x.api.seed({requests:[record]});await x.api.myReceipt(x.event());assert.equal(x.modals.length,0);assert.equal(x.invokes.length,0);assert.equal(x.calls.length,0);
  }
  const denied=harness();denied.hooks.allowed=false;await denied.api.myReceipt(denied.event());assert.equal(denied.modals.length,0);assert.equal(denied.invokes.length,0);assert.equal(denied.calls.length,0);
});

test('opens only the exact customer, disambiguating matching names by city',async()=>{
  const h=harness();h.hooks.customers=[{...CUSTOMER,id:'other-city',city:'Natal'},{...CUSTOMER},{...CUSTOMER,id:'other-name',name:'Outro Mercado'}];
  await h.api.myReceipt(h.event());assert.equal(h.api.context().customer.id,'customer-a');assert.equal(h.api.context().allow_resend,true);assert.equal(h.api.context().request_id,'request-a');assert.equal(h.invokes.length,0);assert.equal(h.cardButton.disabled,false);
  for(const customers of [[{...CUSTOMER,id:'one'},{...CUSTOMER,id:'two'}],[{...CUSTOMER,name:'Nome divergente'}],[]]){
    const x=harness();x.hooks.customers=customers;await x.api.myReceipt(x.event());assert.equal(x.modals.length,0);assert.equal(x.invokes.length,0);assert.match(x.hooks.toasts.at(-1).message,/cadastro exato/);
  }
});

test('a late customer lookup cannot open a receipt after the active unit or account changes',async()=>{
  for(const scope of [{unit:'Filial Pau dos Ferros'},{owner:'driver-b'}]){
    const h=harness(),lookup=deferred();h.hooks.fetchCustomers=()=>lookup.promise;
    const open=h.api.myReceipt(h.event());h.api.seed(scope);lookup.resolve([{...CUSTOMER}]);await open;
    assert.equal(h.modals.length,0);assert.equal(h.invokes.length,0);assert.equal(h.cardButton.disabled,false);
  }
});

test('without internet neither the card, consent action, nor sender invokes the service',async()=>{
  const h=harness();h.navigator.onLine=false;h.fillConsent();
  await h.api.myReceipt(h.event());await h.api.capture(CONTACT,context(),new Element());
  await assert.rejects(()=>h.api.send(CONTACT,context(),new Element()),/internet/);
  assert.equal(h.invokes.length,0);assert.equal(h.rpcs.length,0);assert.equal(h.modals.length,0);
});

test('opening the receipt and consent dialogs never sends automatically',async()=>{
  const h=harness();await h.api.open(context());assert.equal(h.invokes.length,0);assert.equal(h.rpcs.length,0);
  assert.match(h.modals.at(-1).body,/data-send-receipt-contact="contact-a"/);
  h.api.optin(CONTACT,context());assert.equal(h.invokes.length,0);assert.equal(h.rpcs.length,0);
  assert.ok(h.modals.at(-1).actions.some(action=>action.label==='Aceitar termos e enviar comprovante'));
});

test('a late receipt preload cannot display the old account or unit in the new context',async()=>{
  for(const scope of [{unit:'Filial Pau dos Ferros'},{owner:'driver-b'}]){
    const h=harness(),contacts=deferred();let refreshing=false;
    h.hooks.getContacts=()=>{refreshing=true;return contacts.promise;};
    const open=h.api.open(context());await until(()=>refreshing);h.api.seed(scope);contacts.resolve([{...CONTACT}]);await open;
    assert.equal(h.modals.length,0,'stale receipt modal must not open after a context switch');assert.equal(h.invokes.length,0);
  }
});

test('invalid or incomplete consent never saves consent or sends a message',async()=>{
  for(const invalid of ['name','evidence','receiptOptinConsent','receiptOptinAdult','receiptOptinBrazil']){
    const h=harness();h.fillConsent();
    if(invalid==='name')h.el('receiptOptinRecipient').value='A';else if(invalid==='evidence')h.el('receiptOptinAgeEvidence').value=' ';else h.el(invalid).checked=false;
    await h.api.capture(CONTACT,context(),new Element());assert.equal(h.rpcs.length,0);assert.equal(h.invokes.length,0);assert.equal(h.hooks.toasts.at(-1).type,'error');
  }
});

test('saves consent, refreshes eligibility, then sends using the authenticated service',async()=>{
  const h=harness();h.fillConsent();const stale={...CONTACT,whatsapp_receipt_eligible:false,whatsapp_receipt_verified_at:null};h.hooks.contacts=[stale];
  h.hooks.rpc=async()=>{h.hooks.contacts=[{...CONTACT}];return {data:true,error:null};};
  const button=new Element();await h.api.capture(stale,context(),button);
  assert.equal(h.rpcs.length,1);assert.equal(h.rpcs[0].name,'capture_customer_contact_receipt_optin');assert.equal(h.rpcs[0].args.p_age_evidence,'RG');
  assert.equal(h.invokes.length,1);assert.equal(h.invokes[0].args.headers.Authorization,'Bearer session-test');assert.equal(h.invokes[0].args.body.contact_id,'contact-a');
  const order=h.calls.map(call=>call[0]);assert.ok(order.indexOf('rpc')<order.indexOf('contacts'));assert.ok(order.indexOf('contacts')<order.indexOf('invoke'));
  assert.equal(button.disabled,false);assert.match(h.hooks.toasts.at(-1).message,/Aceite registrado e comprovante aceito/);
});

test('a failed consent save never invokes the sender; unconfirmed refreshed eligibility also blocks it',async()=>{
  const failed=harness();failed.fillConsent();failed.hooks.rpc=async()=>({error:{message:'CONSENT_SAVE_DENIED'}});const button=new Element();
  await failed.api.capture(CONTACT,context(),button);assert.equal(failed.invokes.length,0);assert.equal(failed.calls.filter(x=>x[0]==='contacts').length,0);assert.match(failed.hooks.toasts.at(-1).message,/CONSENT_SAVE_DENIED/);assert.equal(button.disabled,false);
  const stale=harness();stale.fillConsent();stale.hooks.contacts=[{...CONTACT,whatsapp_receipt_eligible:false}];
  await stale.api.capture(CONTACT,context(),new Element());assert.equal(stale.rpcs.length,1);assert.equal(stale.invokes.length,0);assert.match(stale.hooks.toasts.at(-1).message,/Aceite registrado, mas o comprovante não foi enviado/);
});

test('a saved consent survives a send failure and the user sees the two outcomes separately',async()=>{
  const h=harness();h.fillConsent();h.hooks.invoke=async()=>({data:{error:'META_SEND_FAILED'},error:null});
  await h.api.capture(CONTACT,context(),new Element());assert.equal(h.rpcs.length,1);assert.equal(h.invokes.length,1);assert.equal(h.hooks.contacts[0].whatsapp_receipt_eligible,true);
  assert.match(h.modals.at(-1).body,/data-send-receipt-contact="contact-a"/);assert.match(h.hooks.toasts.at(-1).message,/Aceite registrado, mas o comprovante não foi enviado/);assert.equal(h.hooks.toasts.at(-1).type,'error');
});

test('changing account/unit during the eligibility refresh prevents the subsequent send',async()=>{
  for(const scope of [{unit:'Filial Pau dos Ferros'},{owner:'driver-b'}]){
    const h=harness(),contacts=deferred();h.fillConsent();let refreshing=false;h.hooks.getContacts=()=>{refreshing=true;return contacts.promise;};
    const save=h.api.capture(CONTACT,context(),new Element());await until(()=>refreshing);h.api.seed(scope);contacts.resolve([{...CONTACT}]);await save;
    assert.equal(h.rpcs.length,1);assert.equal(h.invokes.length,0);assert.equal(h.modals.length,0);
  }
});

test('cancelling an accepted-contact resend performs no second invocation or new operation',async()=>{
  const h=harness();h.hooks.confirm=false;h.hooks.invoke=async()=>({data:{accepted:true,already_sent:true},error:null});const ctx=context(),button=new Element();
  const result=await h.api.send(CONTACT,ctx,button);assert.equal(result.resend_cancelled,true);assert.equal(h.invokes.length,1);assert.equal(h.confirmations.length,1);assert.match(h.confirmations[0],/nova cobrança/);
  assert.equal(h.invokes[0].args.body.resend,undefined);assert.equal(Object.keys(ctx.receiptResendOperations).length,0);assert.equal(button.disabled,false);assert.equal(ctx.receiptSendingContacts.size,0);
});

test('a confirmed resend uses one new UUID bound to that same request and contact',async()=>{
  const h=harness();h.hooks.invoke=async()=>({data:{accepted:true,already_sent:h.invokes.length===1},error:null});const ctx=context();
  const result=await h.api.send(CONTACT,ctx,new Element());assert.equal(result.already_sent,false);assert.equal(h.invokes.length,2);assert.equal(h.confirmations.length,1);
  const first=h.invokes[0].args.body,resend=h.invokes[1].args.body;assert.equal(first.operation_id,undefined);assert.equal(resend.resend,true);assert.match(resend.operation_id,/^[0-9a-f-]{36}$/i);
  assert.equal(resend.contact_id,first.contact_id);assert.equal(resend.request_id,first.request_id);assert.equal(Object.keys(ctx.receiptResendOperations).length,0);
});

test('retrying a lost resend response reuses the UUID and does not ask for another charge confirmation',async()=>{
  const h=harness();h.hooks.invoke=async()=>{if(h.invokes.length===1)return {data:{accepted:true,already_sent:true},error:null};if(h.invokes.length===2)return {data:null,error:{message:'FunctionsFetchError'}};return {data:{accepted:true,already_sent:true},error:null};};
  const ctx=context();await assert.rejects(()=>h.api.send(CONTACT,ctx,new Element()),/FunctionsFetchError/);
  const operation=h.invokes[1].args.body.operation_id;assert.equal(ctx.receiptResendOperations[CONTACT.id],operation);
  await h.api.send(CONTACT,ctx,new Element());assert.equal(h.invokes.length,3);assert.equal(h.invokes[2].args.body.operation_id,operation);assert.equal(h.confirmations.length,1);assert.equal(Object.keys(ctx.receiptResendOperations).length,0);
});

test('a double click while the first send is pending cannot invoke the provider twice',async()=>{
  const h=harness(),reply=deferred();h.hooks.invoke=()=>reply.promise;const ctx=context(),button=new Element();
  const first=h.api.send(CONTACT,ctx,button);await until(()=>h.invokes.length===1);
  await assert.rejects(()=>h.api.send(CONTACT,ctx,new Element()),/SEND_IN_PROGRESS/);assert.equal(h.invokes.length,1);assert.equal(button.disabled,true);
  reply.resolve({data:{accepted:true,already_sent:false},error:null});await first;assert.equal(ctx.receiptSendingContacts.size,0);
});
