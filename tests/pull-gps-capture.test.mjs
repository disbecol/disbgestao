import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const timeoutSource=app.slice(app.indexOf('function withDeadline('),app.indexOf('function browserHighAccuracyPosition('));
const captureSource=app.slice(app.indexOf('async function captureGps('),app.indexOf('function compressImage('));

test('captura GPS libera a etapa mesmo se clearWatch do Android nunca responder',async()=>{
  let clearCalled=false;
  const sample={coords:{latitude:-6.4,longitude:-35.4,accuracy:25},timestamp:Date.now()};
  const geo={
    checkPermissions:async()=>({location:'granted'}),
    watchPosition:async(_options,callback)=>{
      setTimeout(()=>callback(sample,null),0);
      return 'watch-1';
    },
    clearWatch:()=>{clearCalled=true;return new Promise(()=>{});}
  };
  const context={
    getCapacitorGeolocation:()=>geo,isNativeCapacitor:()=>true,
    locationGranted:()=>true,preciseLocationGranted:()=>true,
    recentGpsSample:()=>null,rememberPullGpsSample:()=>{},
    gpsSample:p=>({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,capturedAt:new Date(p.timestamp).toISOString()}),
    gpsAccuracyError:()=>new Error('GPS_PRECISAO_INSUFICIENTE'),
    Promise,Date,setTimeout,clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(timeoutSource+captureSource,context);
  const gps=await Promise.race([
    context.captureGps({maxAccuracy:200,maxWaitMs:100}),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('A captura permaneceu travada')),250))
  ]);
  assert.equal(gps.accuracy,25);
  assert.equal(clearCalled,true);
});

test('captura GPS encerra a espera quando o monitor nativo não responde',async()=>{
  const geo={checkPermissions:async()=>({location:'granted'}),watchPosition:()=>new Promise(()=>{}),clearWatch:async()=>{}};
  const context={
    getCapacitorGeolocation:()=>geo,isNativeCapacitor:()=>true,
    locationGranted:()=>true,preciseLocationGranted:()=>true,
    recentGpsSample:()=>null,rememberPullGpsSample:()=>{},
    gpsSample:()=>null,gpsAccuracyError:()=>new Error('GPS_PRECISAO_INSUFICIENTE'),
    Promise,Date,setTimeout,clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(timeoutSource+captureSource,context);
  await assert.rejects(context.captureGps({maxAccuracy:200,maxWaitMs:20}),/GPS_PRECISAO_INSUFICIENTE/);
});

test('captura GPS usa posição única quando o monitor nativo não entrega pontos',async()=>{
  const point={coords:{latitude:-6.4,longitude:-35.4,accuracy:30},timestamp:Date.now()};
  const geo={
    checkPermissions:async()=>({location:'granted'}),
    watchPosition:()=>new Promise(()=>{}),
    getCurrentPosition:async()=>point,
    clearWatch:async()=>{}
  };
  const context={
    getCapacitorGeolocation:()=>geo,isNativeCapacitor:()=>true,
    locationGranted:()=>true,preciseLocationGranted:()=>true,
    recentGpsSample:()=>null,rememberPullGpsSample:()=>{},
    gpsSample:p=>({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,capturedAt:new Date(p.timestamp).toISOString()}),
    gpsAccuracyError:()=>new Error('GPS_PRECISAO_INSUFICIENTE'),
    Promise,Date,setTimeout,clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(timeoutSource+captureSource,context);
  const gps=await context.captureGps({maxAccuracy:200,maxWaitMs:200});
  assert.equal(gps.accuracy,30);
});
