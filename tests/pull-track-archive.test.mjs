import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {test} from 'node:test';
import vm from 'node:vm';

const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const start=source.indexOf('async function loadPullTripRouteV172(');
const end=source.indexOf('\nasync function openPullTripDetail(',start);
assert.ok(start>0&&end>start);
const implementation=source.slice(start,end);

function setup(snapshot,error=null){
  const raw=[{id:123,latitude:-6.4,longitude:-36.7}];
  const calls=[];
  const context={
    sb:{from(table){
      calls.push(table);
      return {select(){return this;},eq(){return this;},
        async maybeSingle(){return {data:snapshot,error};}};
    }},
    async loadPullTripTrackRowsV171(){calls.push('raw-loader');return raw;}
  };
  vm.runInNewContext(implementation,context);
  return {context,calls,raw};
}

test('trajeto concluído usa o desenho arquivado',async()=>{
  const {context,calls}=setup({
    route_points:[[-6.45,-36.71,1790000000],[-6.46,-36.72,1790000015]],
    original_points:900,
    sampled_points:2
  });
  const rows=await context.loadPullTripRouteV172('trip-1','ARRIVED');
  assert.equal(rows.length,2);
  assert.equal(rows[0].archived,true);
  assert.equal(rows[0].archived_original_points,900);
  assert.equal(rows[1].longitude,-36.72);
  assert.deepEqual(calls,['pull_trip_route_snapshots']);
});

test('trajeto ativo continua lendo pontos GPS detalhados',async()=>{
  const {context,calls,raw}=setup(null);
  const rows=await context.loadPullTripRouteV172('trip-1','IN_PROGRESS');
  assert.equal(rows,raw);
  assert.deepEqual(calls,['raw-loader']);
});

test('durante publicação do SQL, histórico volta aos pontos GPS',async()=>{
  const {context,calls,raw}=setup(null,{code:'PGRST205'});
  const rows=await context.loadPullTripRouteV172('trip-1','ARRIVED');
  assert.equal(rows,raw);
  assert.deepEqual(calls,['pull_trip_route_snapshots','raw-loader']);
});
