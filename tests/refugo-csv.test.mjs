import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRefugoHarness} from './helpers/refugo-module-harness.mjs';

const session=(id,map,started='2026-10-05T10:00:00Z',name='João')=>({
  id,unit:'Matriz Caicó',map_number:map,status:'COMPLETED',created_by_name:name,
  started_at:started,completed_at:'2026-10-05T11:00:00Z'
});
const firstItems=[
  {id:'item-1',session_id:'mapa-1',status:'COMPLETED',type_name:'Garrafeira',started_at:'2026-10-05T10:00:00Z',ended_at:'2026-10-05T10:10:00Z',quantity_checked:10,quantity_rejected:3,note:'=SOMA(1;2)',refugo_item_reasons:[{reason_name:'Quebrado',quantity:2},{reason_name:'Trincado',quantity:1}]},
  {id:'item-2',session_id:'mapa-1',status:'COMPLETED',type_name:'Barril',started_at:'2026-10-05T10:15:00Z',ended_at:'2026-10-05T10:20:00Z',quantity_checked:5,quantity_rejected:1,note:'Conferido',refugo_item_reasons:[{reason_name:'Quebrado',quantity:1}]}
];

test('CSV do mapa mantém uma linha por vasilhame e inclui motivos e proteção contra fórmulas',async()=>{
  const harness=createRefugoHarness({history:[session('mapa-1','122117')],items:firstItems});
  harness.refugo.bind();
  await harness.enter('refugo-historico');
  await harness.click(harness.document.querySelector('[data-refugo-csv]'));

  const {name,matrix}=harness.exported;
  assert.equal(name,'refugo_mapa_122117_2026-10-05.csv');
  assert.equal(matrix.length,3);
  const [header,first,second]=matrix;
  assert.equal(first[header.indexOf('Aferido por')],'João');
  assert.equal(header.includes('Ajudante'),false);
  assert.equal(first[header.indexOf('Duração')],'00:10:00');
  assert.equal(first[header.indexOf('Quantidade aproveitada')],'7');
  assert.equal(first[header.indexOf('Motivo: Quebrado')],'2');
  assert.equal(first[header.indexOf('Motivo: Trincado')],'1');
  assert.equal(second[header.indexOf('Motivo: Trincado')],'0');
  assert.equal(first[header.indexOf('Observação')],"'=SOMA(1;2)");
});

test('CSV diário reúne mapas da unidade e conserva os motivos de cada item',async()=>{
  const history=[
    session('mapa-1','100'),
    session('mapa-2','101','2026-10-05T12:00:00Z','Maria'),
    session('mapa-3','102','2026-10-04T10:00:00Z','Pedro')
  ];
  const items=[
    {...firstItems[0],session_id:'mapa-1',refugo_item_reasons:[{reason_name:'Quebrado',quantity:2}]},
    {id:'item-3',session_id:'mapa-2',status:'COMPLETED',type_name:'600ml',started_at:'2026-10-05T12:05:00Z',ended_at:'2026-10-05T12:10:00Z',quantity_checked:20,quantity_rejected:1,refugo_item_reasons:[{reason_name:'Trincado',quantity:1}]},
    {id:'item-4',session_id:'mapa-3',status:'COMPLETED',type_name:'1L',started_at:'2026-10-04T10:05:00Z',ended_at:'2026-10-04T10:10:00Z',quantity_checked:30,quantity_rejected:0,refugo_item_reasons:[]}
  ];
  const harness=createRefugoHarness({history,items});
  harness.refugo.bind();
  await harness.enter('refugo-historico');
  harness.document.querySelector('#refugoHistoryDate').value='2026-10-05';
  await harness.click(harness.document.querySelector('#refugoDailyCsv'));

  assert.deepEqual(Array.from(harness.calls.filter(call=>call.table==='refugo_items').at(-1).filters.session_id),['mapa-1','mapa-2']);
  const {name,matrix}=harness.exported;
  assert.equal(name,'refugo_dia_2026-10-05_matriz_caico.csv');
  assert.equal(matrix.length,3);
  const [header,first,second]=matrix;
  assert.equal(first[header.indexOf('Mapa')],'100');
  assert.equal(second[header.indexOf('Mapa')],'101');
  assert.equal(first[header.indexOf('Motivo: Trincado')],'0');
  assert.equal(second[header.indexOf('Motivo: Quebrado')],'0');
});

test('APK grava o CSV em cache e abre o compartilhamento do aparelho',async()=>{
  const harness=createRefugoHarness({history:[session('mapa-1','122117')],items:[{
    id:'item-1',session_id:'mapa-1',status:'COMPLETED',type_name:'Barril',
    started_at:'2026-10-05T10:00:00Z',ended_at:'2026-10-05T10:10:00Z',
    quantity_checked:5,quantity_rejected:0,note:'Conferido',refugo_item_reasons:[]
  }],native:true});
  harness.refugo.bind();
  await harness.enter('refugo-historico');
  await harness.click(harness.document.querySelector('[data-refugo-csv]'));

  assert.equal(harness.downloads.written.directory,'CACHE');
  assert.equal(harness.downloads.written.path,'refugo_mapa_122117_2026-10-05.csv');
  assert.ok(Buffer.from(harness.downloads.written.data,'base64').toString('utf8').startsWith('\uFEFF"Unidade";"Mapa"'));
  assert.equal(harness.downloads.shared.url,'file:///cache/refugo.csv');
});
