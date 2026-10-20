import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('código principal carrega o checklist no mesmo escopo',()=>{
  const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const context={window:{addEventListener(){}},document:{addEventListener(){}},navigator:{},setInterval(){},setTimeout(){}};
  assert.doesNotThrow(()=>vm.runInNewContext(source,context,{timeout:3000}));
});

function checklistContext(overrides={}){
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const source=app.split('// PULL_CHECKLIST_BEGIN')[1]?.split('// PULL_CHECKLIST_END')[0];
  assert.ok(source,'O checklist precisa estar incorporado ao código principal.');
  const stubs=['clearPullPlanForm','pullPlanCardHtml','onPullPlansClick','savePullPlan',
    'onPullAssignedPlanClick','loadPullActiveTrip','renderPullDriver','recordPullNextStep','processOfflineRecord',
    'syncOfflineQueue','humanPullError','humanPullPlanError','loadPullConfig',
    'renderPullTripDetailExtras'];
  const context={document:{addEventListener(){},querySelector(){return null;}},navigator:{onLine:false},pullSettings:{checklist_enabled:true},
    pullActiveTrip:{id:'trip-1',week_trip_type:'LAST'},pullDriverEvents:[],pullNextStep:()=>({action_code:'ARRIVE_UNIT'}),
    ...Object.fromEntries(stubs.map(name=>[name,()=>{}])),...overrides};
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

test('desabilitar checklist libera etapas pendentes sem apagar respostas',async()=>{
  let proceeded=false;
  const ctx=checklistContext({recordPullNextStep:()=>{proceeded=true;}});
  vm.runInContext(`pullDriverEvents=[{action_code:'ARRIVE_SUPPORT_OUT'}];
    pullChecklistRequirements=[{checkpoint_code:'D1_SUPPORT_OUT',after_action:'ARRIVE_SUPPORT_OUT',gate_action:'ARRIVE_UNIT'}];
    pullChecklistRuns=[{checkpoint_code:'D1_START'}];
    pullSettings.checklist_enabled=false;`,ctx);
  assert.equal(vm.runInContext('pullChecklistGatePending()',ctx),undefined);
  await vm.runInContext('recordPullNextStep()',ctx);
  assert.equal(proceeded,true);
  assert.equal(vm.runInContext('pullChecklistRuns.length',ctx),1);
  vm.runInContext('pullSettings.checklist_enabled=true',ctx);
  assert.equal(vm.runInContext('pullChecklistGatePending().checkpoint_code',ctx),'D1_SUPPORT_OUT');
});

test('checklists de retorno e saída aparecem em sequência dentro da próxima etapa',()=>{
  const ctx=checklistContext();
  const elements=new Map([
    ['pullNextStepName',{textContent:''}],['pullNextStepHint',{textContent:''}],
    ['btnPullNextStep',{disabled:false,textContent:''}]
  ]);
  ctx.$=id=>elements.get(id)||null;
  ctx.authUser={id:'driver-1'};
  vm.runInContext(`pullActiveTrip={id:'trip-1',week_trip_type:'ROUTINE',driver1_id:'driver-1',driver2_id:'driver-2'};
    pullDriverEvents=[{action_code:'ARRIVE_SUPPORT_OUT'}];
    pullChecklistStateReady=true;
    pullChecklistQuestions=[{id:'q1'}];
    pullChecklistRequirements=[
      {checkpoint_code:'D1_SUPPORT_OUT',after_action:'ARRIVE_SUPPORT_OUT',gate_action:'DRIVER_SWAP_OUT',driver_no:1,checklist_type:'RETURN'},
      {checkpoint_code:'D2_SUPPORT_OUT',after_action:'ARRIVE_SUPPORT_OUT',gate_action:'DRIVER_SWAP_OUT',driver_no:2,checklist_type:'DEPARTURE'},
      {checkpoint_code:'D2_SUPPORT_RETURN',after_action:'ARRIVE_SUPPORT_RETURN',gate_action:'DRIVER_SWAP_RETURN',driver_no:2,checklist_type:'RETURN'},
      {checkpoint_code:'D1_SUPPORT_RETURN',after_action:'ARRIVE_SUPPORT_RETURN',gate_action:'DRIVER_SWAP_RETURN',driver_no:1,checklist_type:'DEPARTURE'}
    ];`,ctx);
  vm.runInContext('renderPullDriver()',ctx);
  assert.match(elements.get('pullNextStepName').textContent,/Retorno do Motorista 1/);
  assert.equal(elements.get('btnPullNextStep').textContent,'Preencher checklist');
  assert.match(elements.get('pullNextStepHint').textContent,/Checklist 1\/4/);
  vm.runInContext(`pullChecklistRuns=[{trip_id:'trip-1',checkpoint_code:'D1_SUPPORT_OUT'}]`,ctx);
  vm.runInContext('renderPullDriver()',ctx);
  assert.match(elements.get('pullNextStepName').textContent,/Saída do Motorista 2/);
  assert.equal(elements.get('btnPullNextStep').disabled,true);
  assert.match(elements.get('pullNextStepHint').textContent,/Checklist 2\/4/);
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/id="pullChecklistCard"/);
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

test('KM é obrigatório e alertas usam o último registro da placa',()=>{
  const ctx=checklistContext();
  ctx.$=()=>({value:''});
  assert.throws(()=>vm.runInContext('pullReadOdometer()',ctx),/quilometragem atual/);
  ctx.$=()=>({value:'125430'});
  assert.equal(vm.runInContext('pullReadOdometer()',ctx),125430);
  assert.equal(vm.runInContext('pullKmComparison(999,1000).alert',ctx),'LOWER');
  assert.equal(vm.runInContext('pullKmComparison(2499,1000).alert',ctx),'');
  assert.equal(vm.runInContext('pullKmComparison(2500,1000).alert',ctx),'JUMP');
  assert.equal(vm.runInContext('pullKmComparison(1052,1000).delta',ctx),52);
});
