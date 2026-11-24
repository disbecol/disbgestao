import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('embedded Puxada navigation never replaces the offline main application',async()=>{
 const scope='https://disbecol.test/disbgestao/',entries=new Map([[scope,new Response('main app')]]),listeners={},pending=[];
 const cache={put:async(key,value)=>entries.set(typeof key==='string'?key:key.url,value),addAll:async()=>{},keys:async()=>[]};
 let online=true;
 const sandbox={self:{registration:{scope},location:{origin:'https://disbecol.test'},addEventListener:(name,handler)=>listeners[name]=handler},URL,Request,Response,Set,console,caches:{open:async()=>cache,match:async req=>entries.get(typeof req==='string'?new URL(req,scope).href:req.url)},fetch:async()=>{if(!online)throw Error('offline');return new Response('puxada app');}};
 const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');vm.runInNewContext(source,sandbox);
 let response;const request={url:scope+'src/puxada-app/index.html',method:'GET',mode:'navigate',destination:'document'};
 listeners.fetch({request,respondWith:value=>response=value,waitUntil:value=>pending.push(value)});assert.equal(await (await response).text(),'puxada app');await Promise.all(pending);
 assert.equal(await entries.get(scope).clone().text(),'main app');online=false;
 listeners.fetch({request,respondWith:value=>response=value,waitUntil:value=>pending.push(value)});assert.equal(await (await response).text(),'puxada app');
 assert.equal(await entries.get(scope).clone().text(),'main app');
});
