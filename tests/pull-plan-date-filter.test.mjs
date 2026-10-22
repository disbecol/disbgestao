import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=app.split('let pullPlansRequestId=0;')[1]?.split('async function loadPullPlans(')[0];
assert.ok(source);
const context={
  localIsoDate:date=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(date),
  activeUnit:'Matriz Caicó',sb:null
};
vm.createContext(context);
vm.runInContext(source,context);

test('filtra puxadas por agendamento e transferências por cadastro no dia local',()=>{
  const pull={cycle_type:'PULL',scheduled_at:'2026-10-22T02:30:00Z',created_at:'2026-10-20T12:00:00Z'};
  const transfer={cycle_type:'TRANSFER',scheduled_at:null,created_at:'2026-10-22T02:30:00Z'};
  assert.equal(context.pullPlanFilterDate(pull),'2026-10-21');
  assert.equal(context.pullPlanFilterDate(transfer),'2026-10-21');
  const bounds=context.pullPlanQueryBounds('2026-10-21','2026-10-22');
  assert.equal(new Date(bounds.start).toISOString(),'2026-10-20T00:00:00.000Z');
  assert.equal(new Date(bounds.end).toISOString(),'2026-10-24T00:00:00.000Z');
});

test('consulta todas as páginas do intervalo sem cortar em 200 viagens',async()=>{
  const calls=[];
  const rows=Array.from({length:1002},(_,i)=>({id:i}));
  const query={
    select(){return this;},eq(){return this;},gte(){return this;},lt(){return this;},order(){return this;},
    range(start,end){calls.push([start,end]);return Promise.resolve({data:rows.slice(start,end+1),error:null});}
  };
  context.sb={from:()=>query};
  const result=await context.queryPullPlansInRange('TRANSFER','created_at',context.pullPlanQueryBounds('2026-10-21','2026-10-22'));
  assert.equal(result.length,1002);
  assert.deepEqual(calls,[[0,999],[1000,1999]]);
});
