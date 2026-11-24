import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRefugoHarness} from './helpers/refugo-module-harness.mjs';

test('aferição limita tipos ao saldo do mapa e bloqueia quantidade acima do saldo',async()=>{
  const harness=createRefugoHarness({
    catalog:[
      {id:'type-g300',kind:'TYPE',name:'300ml',active:true,map_field:'g300'},
      {id:'type-g600',kind:'TYPE',name:'600ml',active:true,map_field:'g600_green'}
    ],
    openSessions:[{
      id:'session-1',unit:'Matriz Caicó',map_number:'122117',status:'OPEN',
      created_by_name:'Pessoa',started_at:'2026-10-05T10:00:00Z',
      map_limits:{g300:920,g600_green:240}
    }],
    items:[
      {id:'item-1',session_id:'session-1',status:'COMPLETED',map_field:'g300',quantity_checked:300},
      {id:'item-2',session_id:'session-1',status:'COMPLETED',map_field:'g300',quantity_checked:120},
      {id:'item-3',session_id:'session-1',status:'COMPLETED',map_field:'g600_green',quantity_checked:240}
    ]
  });
  harness.refugo.bind();
  await harness.enter('refugo-afericao');
  await harness.click(harness.document.querySelector('[data-refugo-resume]'));

  const type=harness.document.querySelector('#refugoType');
  assert.deepEqual([...type.querySelectorAll('option')].map(option=>option.value),['','type-g300']);
  for(const option of type.querySelectorAll('option'))option.selected=option.value==='type-g300';
  harness.document.querySelector('#refugoStartQuantity').value='501';
  await harness.click(harness.document.querySelector('[data-refugo-action="start-item"]'));
  assert.match(harness.toasts.at(-1)[0],/supera o permitido/);
  assert.equal(harness.calls.filter(call=>call.name==='start_refugo_item_v2').length,0);

  harness.document.querySelector('#refugoStartQuantity').value='500';
  await harness.click(harness.document.querySelector('[data-refugo-action="start-item"]'));
  const start=harness.calls.find(call=>call.name==='start_refugo_item_v2');
  assert.equal(start.args.p_quantity_planned,500);
});
