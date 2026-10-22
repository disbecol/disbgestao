import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('excluir ciclo exige administrador e o código exato antes da RPC',async()=>{
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const source=app.split('// PULL_CYCLE_DELETE_BEGIN')[1]?.split('// PULL_CYCLE_DELETE_END')[0];
  assert.ok(source);
  const calls=[];
  let admin=false,actions;
  const input={value:''};
  const button={disabled:false,textContent:''};
  const farolButtons=[];
  const farolDetail={dataset:{pullDetail:'transfer-id'},parentElement:{appendChild(button){farolButtons.push(button);}}};
  const context={
    document:{addEventListener(){},createElement(){return {dataset:{}};}},navigator:{onLine:true},
    renderPullHistory(){},renderPullFarol(){},pullPlanCardHtml(){return '<article><div class="pull-plan-actions"></div></article>';},
    onPullHistoryClick(){},onPullPlansClick(){},onPullFarolClick(){},
    loadPullHistory(){},loadPullPlans(){},loadPullFarol(){},pullHistory:[],pullPlans:[],
    isAdmin:()=>admin,$:id=>id==='pullDeleteConfirmCode'?input:id==='pullFarolCards'?{querySelectorAll:()=>[farolDetail]}:null,
    esc:value=>String(value),toast(){},closeModal(){},
    openModal(_title,_subtitle,_body,items){actions=items;},
    sb:{rpc:async(name)=>{calls.push(name);return {data:name==='preview_pull_cycle_deletion'
      ?{trip_code:'PUX-0000041',plate:'ABC1234',events:3,checklists:2,files:0,nris_preserved:1}
      :{files:[]}};}},
  };
  vm.createContext(context);vm.runInContext(source,context);
  await vm.runInContext("openPullDeleteCycle('trip-id')",context);
  assert.deepEqual(calls,[]);
  admin=true;
  context.renderPullFarol();
  assert.equal(farolButtons[0].dataset.pullDeleteCycle,'transfer-id');
  assert.match(context.pullPlanCardHtml({id:'planned-id',plate:'ABC1234',cycle_type:'TRANSFER'},true),/data-pull-delete-plan="planned-id"/);
  assert.match(context.pullPlanCardHtml({id:'started-id',trip_id:'transfer-id',cycle_type:'TRANSFER'},true),/data-pull-delete-cycle="transfer-id"/);
  await vm.runInContext("openPullDeleteCycle('trip-id')",context);
  assert.deepEqual(calls,['preview_pull_cycle_deletion']);
  input.value='PUX-ERRADO';
  await actions[1].onClick({currentTarget:button});
  assert.deepEqual(calls,['preview_pull_cycle_deletion']);
  input.value='PUX-0000041';
  context.removePullDeletedFiles=async()=>0;
  await actions[1].onClick({currentTarget:button});
  assert.deepEqual(calls,['preview_pull_cycle_deletion','delete_pull_cycle']);
});
