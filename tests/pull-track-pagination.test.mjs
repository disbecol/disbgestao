import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const loaderStart=source.indexOf('async function loadPullTripTrackRowsV171(');
const loaderEnd=source.indexOf('\nasync function openPullTripDetail(',loaderStart);
const refreshStart=source.indexOf('const pullLiveMapRefreshBusyV171=new Set();');
const refreshEnd=source.indexOf('\n};',refreshStart)+3;
assert.ok(loaderStart>0&&loaderEnd>loaderStart&&refreshStart>0&&refreshEnd>refreshStart);
const implementation=source.slice(loaderStart,loaderEnd)+'\n'+source.slice(refreshStart,refreshEnd);

function setup(rows){
  const contexts=new Map();
  const calls=[];
  const sb={from(table){
    const query={table,after:0,requested:0,
      select(){return this;},eq(){return this;},
      gt(_column,id){this.after=Number(id);return this;},
      order(){return this;},limit(n){this.requested=n;return this;},
      then(resolve){
        if(table!=='pull_track_points')return resolve({data:[],error:null});
        calls.push({after:this.after,requested:this.requested});
        // Simula o limite de 1.000 linhas da API, mesmo se o cliente pedir mais.
        return resolve({data:rows.filter(row=>row.id>this.after).slice(0,Math.min(this.requested,1000)),error:null});
      }
    };
    return query;
  }};
  const context={sb,pullMapContexts:contexts,$:()=>({}),console,
    renderPullMap(mapId,_trip,trackRows){
      const map={getCenter:()=>({lat:1,lng:2}),getZoom:()=>7,setView(center,zoom){this.center=center;this.zoom=zoom;}};
      const result={map,trackRows};
      contexts.set(mapId,result);
      return result;
    }
  };
  vm.runInNewContext(`var refreshPullLiveMapV170;\n${implementation}`,context);
  return {context,contexts,calls};
}

test('carrega todas as posições de um ciclo com mais de 2.000 pontos',async()=>{
  const rows=Array.from({length:2082},(_,i)=>({id:i+1,latitude:-6,longitude:-36}));
  const {context,calls}=setup(rows);
  const loaded=await context.loadPullTripTrackRowsV171('trip-1');
  assert.equal(loaded.length,2082);
  assert.deepEqual([loaded[0].id,loaded.at(-1).id],[1,2082]);
  assert.deepEqual(calls.map(x=>x.after),[0,500,1000,1500,2000]);
  assert.ok(calls.every(x=>x.requested<=1000));
});

test('atualização ao vivo preserva o trajeto anterior e acrescenta somente os novos pontos',async()=>{
  const rows=Array.from({length:2107},(_,i)=>({id:i+1,latitude:-6,longitude:-36}));
  const {context,contexts,calls}=setup(rows);
  contexts.set('map-1',{trackRows:rows.slice(0,2082),map:{getCenter:()=>({lat:3,lng:4}),getZoom:()=>9}});
  assert.equal(await context.refreshPullLiveMapV170('map-1','trip-1',{}),true);
  const refreshed=contexts.get('map-1');
  assert.equal(refreshed.trackRows.length,2107);
  assert.deepEqual([refreshed.trackRows[0].id,refreshed.trackRows.at(-1).id],[1,2107]);
  assert.deepEqual(calls.map(x=>x.after),[2082]);
  assert.equal(refreshed.map.zoom,9);
  assert.deepEqual(refreshed.map.center,{lat:3,lng:4});
});
