import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {parseHTML} from 'linkedom';
function bridge({response={},permissions=['PULL_TRIP'],error,wait,markup}={}){
 const calls=[],window={},context={user:{id:'user-one'},profile:{id:'user-one',active:true,name:'Motorista',role:'MOTORISTA_PUXADOR'},units:['Matriz'],unit:'Matriz',hasPerm:c=>permissions.includes(c)};
 context.sb={rpc(name,args){calls.push({name,args});return {abortSignal(){return this;},then:async resolve=>{if(wait)await wait;return resolve({data:structuredClone(response),error});}}},storage:{from:bucket=>({createSignedUrl:async path=>({data:{signedUrl:'https://private.test/'+bucket+'/'+path}})})}};
 const document=markup?parseHTML(markup).document:{getElementById:()=>({classList:{contains:()=>false}}),documentElement:{dataset:{theme:'dark'}}};
 const sandbox={window,document,MutationObserver:class{observe(){}},URL,Blob,crypto:webcrypto,setTimeout,clearTimeout,location:{origin:'https://disbecol.test'},Date};
 vm.runInNewContext(fs.readFileSync(new URL('../src/puxada/app-bridge.js',import.meta.url),'utf8'),sandbox);
 window.DISB_PULL_INTEGRATION.configure({context:()=>context,openView(){},captureLocation:async()=>({location:null,locationStatus:'Denied'})});return {api:window.DISB_PULL_APP,integration:window.DISB_PULL_INTEGRATION,calls,context,document};
}
test('offline identity comes from the current shared session and never from a standalone login',async()=>{
 const c=bridge();const session=await c.api.request('/auth/session');assert.equal(session.user.id,'user-one');assert.deepEqual(Array.from(session.user.allowedPages),['operations','history']);assert.equal(c.calls.length,0);
 await assert.rejects(c.api.request('/auth/login',{method:'POST',body:{username:'other',password:'unused'}}),e=>e.code==='SHARED_SESSION_REQUIRED');assert.equal(c.calls.length,0);
});
test('commands retain the durable ID, original body and dependency chain in the SQL gateway',async()=>{
 const c=bridge({response:{saved:true}}),body={commandId:'stable',dependsOnCommandIds:['previous'],location:null,locationStatus:'TimedOut'};
 await c.api.request('/trips/trip/commands',{method:'POST',body});assert.equal(c.calls[0].name,'pull_app_request');assert.equal(c.calls[0].args.p_body,body);assert.equal(c.calls[0].args.p_path,'/trips/trip/commands');
});
test('delayed responses are rejected after changing shared user or unit',async()=>{
 let release;const wait=new Promise(resolve=>release=resolve),c=bridge({wait});const request=c.api.request('/catalog');c.context.unit='Filial';release();await assert.rejects(request,e=>e.code==='CANCELLED');
});
test('server errors preserve actionable status and only private signed paths become file URLs',async()=>{
 const denied=bridge({error:{message:'PULL_APP_ERROR',details:JSON.stringify({code:'WRONG_DRIVER',detail:'Aguarde o outro motorista.',status:403})}});
 await assert.rejects(denied.api.request('/trips/one'),e=>e.code==='WRONG_DRIVER'&&e.status===403);
 const c=bridge({response:{id:'one',attachments:[{id:'file',path:'trip/user/file.jpg'}],invoices:[{id:'pdf',path:'trip/user/file.pdf'}]}});const state=await c.api.request('/trips/one');assert.match(state.attachments[0].url,/puxada-anexos/);assert.match(state.invoices[0].url,/puxada-notas/);
});
test('shared GPS denial is metadata, not a blocked operational command',async()=>{
 const c=bridge();const result=await c.api.captureLocation({timeoutMs:10});assert.equal(result.location,null);assert.equal(result.locationStatus,'Denied');
});
test('navigation opens the requested page with one frame and never moves an existing browsing context',()=>{
 const c=bridge({permissions:['PULL_TRIP','PULL_PLAN'],markup:'<html><body><div id="appShell"><section id="view-puxada-app-operations"></section><section id="view-puxada-app-plans"></section></div></body></html>'});
 c.integration.enter('puxada-app-operations');const first=c.document.querySelector('iframe');assert.match(first.src,/#operations$/);
 c.integration.enter('puxada-app-operations');assert.equal(c.document.querySelector('iframe'),first);
 c.integration.enter('puxada-app-plans');assert.notEqual(c.document.querySelector('iframe'),first);assert.match(c.document.querySelector('iframe').src,/#plans$/);assert.equal(c.document.querySelectorAll('iframe').length,1);
 c.integration.suspend();assert.equal(c.document.querySelectorAll('iframe').length,0);
});
