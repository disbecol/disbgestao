import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../fefo-corrections.js',import.meta.url),'utf8');

test('botão de correção aparece somente para administrador em contagem finalizada',()=>{
  let admin=false,added=0,opened=0;
  const context={
    openFefoReport:()=>{opened++;},
    fefoReports:[{id:'finished',status:'COMPLETED'},{id:'active',status:'IN_PROGRESS'}],
    isAdmin:()=>admin,hasPerm:()=>true,
    document:{createElement:()=>({addEventListener(){}})},
    $:()=>({prepend(){added++;}})
  };
  vm.createContext(context);vm.runInContext(source,context);
  vm.runInContext("openFefoReport('finished')",context);
  assert.equal(added,0);
  admin=true;
  vm.runInContext("openFefoReport('active')",context);
  assert.equal(added,0);
  vm.runInContext("openFefoReport('finished')",context);
  assert.equal(added,1);
  assert.equal(opened,3);
});

test('cabeçalho exige justificativa e envia horário local corretamente ao backend',async()=>{
  const calls=[],notices=[];
  const fields={
    fefoCorrectionReason:{value:'',focus(){}},
    fefoCorrectionStart:{value:'2026-10-14T14:04'},
    fefoCorrectionEnd:{value:'2026-10-14T16:32'},
    fefoCorrectionUnit:{value:'Matriz Caicó'},
    fefoCorrectionCounter:{value:'person-id'},
    fefoCorrectionSaveHeader:{disabled:false}
  };
  const context={
    openFefoReport(){},fefoReports:[{id:'count-id',status:'COMPLETED'}],
    isAdmin:()=>true,hasPerm:()=>true,
    document:{createElement:()=>({addEventListener(){}})},
    $:id=>fields[id],toast:message=>notices.push(message),
    sb:{rpc:async(name,args)=>{calls.push({name,args});return {data:{}};}},
    TZ:'America/Fortaleza',humanFefoError:error=>error.message,
  };
  vm.createContext(context);vm.runInContext(source,context);
  vm.runInContext("fefoCorrectionContext={countId:'count-id'}",context);
  context.reloadFefoCorrection=async()=>{};
  await vm.runInContext('saveFefoCorrectionHeader()',context);
  assert.equal(calls.length,0);
  fields.fefoCorrectionReason.value='Correção do relatório';
  await vm.runInContext('saveFefoCorrectionHeader()',context);
  assert.equal(calls[0].name,'edit_completed_fefo_header_v2');
  assert.equal(calls[0].args.p_started_at,'2026-10-14T17:04:00.000Z');
  assert.equal(calls[0].args.p_completed_at,'2026-10-14T19:32:00.000Z');
  assert.equal(calls[0].args.p_reason,'Correção do relatório');
  assert.ok(notices.some(message=>message.includes('Cabeçalho corrigido')));
});
