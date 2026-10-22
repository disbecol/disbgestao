import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const planErrorSource=source.slice(source.indexOf('function humanPullPlanError('),source.indexOf('function pullPlanCardHtml('));
const gpsErrorSource=source.slice(source.indexOf('function humanGpsError('),source.indexOf('function normalizeUsername('));
const planSaveSource=source.slice(source.indexOf('async function savePullPlan('),source.indexOf('async function onPullPlansClick('));

function errorContext(native=false){
  const context={isNativeCapacitor:()=>native,humanPullError:error=>`Banco: ${error.message}`};
  vm.createContext(context);
  vm.runInContext(`${gpsErrorSource}\n${planErrorSource}`,context);
  return context;
}

test('cadastro de viagem não confunde permissão do banco com GPS',()=>{
  const context=errorContext();
  const error={code:'42501',message:'permission denied for function save_pull_trip_plan'};
  assert.equal(context.humanPullPlanError(error),'Banco: permission denied for function save_pull_trip_plan');
});

test('permissão de GPS mostra instruções para o dispositivo correto',()=>{
  const browser=errorContext();
  const denied={code:1,message:'User denied Geolocation'};
  assert.match(browser.humanPullPlanError(denied),/No navegador/);
  assert.doesNotMatch(browser.humanPullPlanError(denied),/No Android/);
  assert.match(errorContext(true).humanGpsError(denied),/No Android/);
});

async function submitPlanWithChecklist(checklistEnabled){
  const fields={pullPlanId:'',pullPlanType:'PULL',pullPlanScheduled:'2026-10-15T04:00',
    pullPlanOrigin:'Matriz Caicó',pullPlanPlate:'QGK4085',pullPlanFactory:'Itapissuma',
    pullPlanDriver1:'motorista-1',pullPlanDriver2:'motorista-2',pullPlanSolo:''};
  const controls=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{value,checked:false}]));
  controls.pullPlanSave={disabled:false,textContent:''};
  let args;
  const messages=[];
  const context={
    document:{querySelector:()=>checklistEnabled?{value:'ROUTINE'}:null},$:(id)=>controls[id],
    pullChecklistEnabled:()=>checklistEnabled,
    hasPerm:()=>true,sb:{rpc:async(_name,params)=>{args=params;return {error:null};}},
    toast:message=>messages.push(message),clearPullPlanForm:()=>{},loadPullPlans:async()=>{},
    humanPullPlanError:error=>error.message
  };
  vm.createContext(context);vm.runInContext(planSaveSource,context);
  await context.savePullPlan({preventDefault(){}});
  return {args,messages};
}

test('cadastro exige posição semanal apenas quando o checklist está ativo',async()=>{
  const {args,messages}=await submitPlanWithChecklist(true);
  assert.equal(args.p_week_trip_type,'ROUTINE');
  assert.match(messages[0],/regra semanal e checklist/);
});

test('cadastro sem checklist envia semana nula e dispensa escolha',async()=>{
  const {args,messages}=await submitPlanWithChecklist(false);
  assert.equal(args.p_week_trip_type,null);
  assert.equal(messages[0],'Viagem cadastrada.');
});
