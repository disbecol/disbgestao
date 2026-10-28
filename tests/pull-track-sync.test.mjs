import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const deadlineSource=app.slice(app.indexOf('function withDeadline('),app.indexOf('function browserHighAccuracyPosition('));
const from=app.indexOf('const processOfflineRecordBeforeTrackV170=processOfflineRecord;');
const to=app.indexOf('async function getPullNativeTokenV170(',from);
const trackSource=app.slice(from,to).replace("),12000,'PULL_TRACK_TIMEOUT');","),25,'PULL_TRACK_TIMEOUT');");

test('envio GPS sem resposta libera a fila com erro de tempo limite',async()=>{
  assert.ok(from>0&&to>from);
  const context={
    processOfflineRecord:async()=>null,
    sb:{rpc:()=>new Promise(()=>{})},
    Promise,setTimeout,clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(deadlineSource+trackSource,context);
  await assert.rejects(
    Promise.race([
      context.processOfflineRecord({type:'PULL_TRACK_POINT',payload:{p_trip_id:'trip-1'}}),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('A fila permaneceu travada')),200))
    ]),
    /PULL_TRACK_TIMEOUT/
  );
});
