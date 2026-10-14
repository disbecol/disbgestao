import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('mapa arquivado inclui pontos de GPS que chegaram depois do snapshot',async()=>{
  const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const start=source.indexOf('async function loadPullTripRouteV172(');
  const end=source.indexOf('\nasync function openPullTripDetail(',start);
  assert.ok(start>=0&&end>start);
  const late=[{id:100,latitude:-6.1,longitude:-35.2,device_at:'2026-10-14T12:05:00Z'}];
  const context={sb:{from(){return {select(){return {eq(){return {maybeSingle:async()=>({
    data:{route_points:[[-6.2,-35.3,1791979200]],original_points:200},error:null
  })};}};}};}},loadPullTripTrackRowsV171:async()=>late};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const rows=await vm.runInContext("loadPullTripRouteV172('trip-1','ARRIVED')",context);
  assert.equal(rows.length,2);
  assert.equal(rows[0].archived,true);
  assert.equal(rows[1].archived,true);
  assert.equal(rows[1].latitude,late[0].latitude);
});
