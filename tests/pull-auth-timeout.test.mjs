import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const code=app.slice(app.indexOf('function withDeadline('),app.indexOf('function browserHighAccuracyPosition(')).replace("})(),15000,'AUTH_NETWORK_TIMEOUT'","})(),20,'AUTH_NETWORK_TIMEOUT'");
function setup(fetch){const context={fetch,AbortController,Promise,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(code,context);return context;}
test('renovação de token sem resposta é abortada para não prender o cliente',async()=>{
  let signal;const ctx=setup(async(_input,options)=>{signal=options.signal;return new Promise(()=>{});});
  await assert.rejects(()=>ctx.backendFetch('https://project.supabase.co/auth/v1/token'),/AUTH_NETWORK_TIMEOUT/);
  assert.equal(signal.aborted,true);
});
test('prazo inclui corpo de autenticação que não termina de chegar',async()=>{
  const ctx=setup(async()=>({clone:()=>({arrayBuffer:()=>new Promise(()=>{})})}));
  await assert.rejects(()=>ctx.backendFetch('https://project.supabase.co/auth/v1/token'),/AUTH_NETWORK_TIMEOUT/);
});
test('resposta original de autenticação permanece disponível para o SDK',async()=>{
  const response={clone:()=>({arrayBuffer:async()=>new ArrayBuffer(8)})};
  let signal;const ctx=setup(async(_input,options)=>{signal=options.signal;return response;});
  assert.equal(await ctx.backendFetch('https://project.supabase.co/auth/v1/token'),response);
  assert.equal(signal.aborted,false);
});
