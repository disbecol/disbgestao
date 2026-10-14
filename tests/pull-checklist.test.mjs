import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function checklistContext(){
  const source=fs.readFileSync(new URL('../pull-checklist.js',import.meta.url),'utf8');
  const stubs=['clearPullPlanForm','pullPlanCardHtml','onPullPlansClick','savePullPlan',
    'loadPullActiveTrip','renderPullDriver','recordPullNextStep','processOfflineRecord',
    'syncOfflineQueue','humanPullError','humanPullPlanError','loadPullConfig',
    'renderPullTripDetailExtras'];
  const context={document:{addEventListener(){},querySelector(){return null;}},navigator:{onLine:false},
    pullActiveTrip:{id:'trip-1',week_trip_type:'LAST'},pullDriverEvents:[],pullNextStep:()=>({action_code:'ARRIVE_UNIT'}),
    ...Object.fromEntries(stubs.map(name=>[name,()=>{}]))};
  vm.createContext(context);vm.runInContext(source,context);
  return context;
}

test('bloqueia a etapa até todos os checklists do mesmo ponto estarem preenchidos',()=>{
  const ctx=checklistContext();
  vm.runInContext(`pullDriverEvents=[{action_code:'DRIVER_SWAP_RETURN'}];
    pullChecklistRequirements=[
      {checkpoint_code:'D1_SUPPORT_RETURN',after_action:'DRIVER_SWAP_RETURN',gate_action:'ARRIVE_UNIT'},
      {checkpoint_code:'D1_UNIT_LAST',after_action:'DRIVER_SWAP_RETURN',gate_action:'ARRIVE_UNIT'}
    ];`,ctx);
  assert.equal(vm.runInContext('pullChecklistGatePending().checkpoint_code',ctx),'D1_SUPPORT_RETURN');
  vm.runInContext(`pullChecklistRuns=[{checkpoint_code:'D1_SUPPORT_RETURN'}]`,ctx);
  assert.equal(vm.runInContext('pullChecklistGatePending().checkpoint_code',ctx),'D1_UNIT_LAST');
  vm.runInContext(`pullChecklistRuns.push({checkpoint_code:'D1_UNIT_LAST'})`,ctx);
  assert.equal(vm.runInContext('pullChecklistGatePending()',ctx),undefined);
});

test('resposta NOK exige observação antes de salvar',()=>{
  const ctx=checklistContext();
  ctx.document.querySelector=()=>({querySelector(selector){
    if(selector==='input[type="radio"]:checked')return {value:'NOK'};
    return {value:'  '};
  }});
  vm.runInContext(`pullChecklistQuestions=[{id:'q1',question:'Freios estão ok?'}]`,ctx);
  assert.throws(()=>vm.runInContext('pullCollectAnswers()',ctx),/Descreva o problema/);
  ctx.document.querySelector=()=>({querySelector(selector){
    if(selector==='input[type="radio"]:checked')return {value:'NOK'};
    return {value:'Freio com ruído'};
  }});
  assert.equal(vm.runInContext('pullCollectAnswers()[0].observation',ctx),'Freio com ruído');
});
