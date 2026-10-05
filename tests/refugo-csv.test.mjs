import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
function section(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,`${start} não encontrado`);
  return source.slice(a,b);
}
let exported;
const context={
  Date,
  fmtDateTime:value=>String(value||''),
  localIsoDate:()=> '2026-10-05',
  isNativeCapacitor:()=>false,
  downloadCsv:(name,matrix)=>{exported={name,matrix};}
};
vm.runInNewContext(
  section('function refugoDuration(','function refugoCatalogFor(')+'\n'+
  section('function refugoCsvText(','function renderRefugoCatalog('),
  context
);

test('tempo individual é calculado entre início e fim do item',()=>{
  assert.equal(context.refugoDuration('2026-10-05T10:00:00Z','2026-10-05T11:02:03Z'),'01:02:03');
});

test('CSV de um mapa traz uma linha por vasilhame e colunas de motivos',async()=>{
  const session={unit:'Matriz Caicó',map_number:'122117',created_by_name:'João',started_at:'2026-10-05T10:00:00Z',completed_at:'2026-10-05T11:00:00Z'};
  const items=[
    {type_name:'Garrafeira',started_at:'2026-10-05T10:00:00Z',ended_at:'2026-10-05T10:10:00Z',quantity_checked:10,quantity_rejected:3,note:'=SOMA(1;2)',refugo_item_reasons:[{reason_name:'Quebrado',quantity:2},{reason_name:'Trincado',quantity:1}]},
    {type_name:'Barril',started_at:'2026-10-05T10:15:00Z',ended_at:'2026-10-05T10:20:00Z',quantity_checked:5,quantity_rejected:1,note:'Conferido',refugo_item_reasons:[{reason_name:'Quebrado',quantity:1}]}
  ];
  await context.downloadRefugoCsv(session,items);
  assert.equal(exported.name,'refugo_mapa_122117_2026-10-05.csv');
  assert.equal(exported.matrix.length,3);
  const header=exported.matrix[0],first=exported.matrix[1],second=exported.matrix[2];
  assert.equal(first[header.indexOf('Aferido por')],'João');
  assert.equal(header.includes('Ajudante'),false);
  assert.equal(first[header.indexOf('Duração')],'00:10:00');
  assert.equal(first[header.indexOf('Quantidade aproveitada')],'7');
  assert.equal(first[header.indexOf('Motivo: Quebrado')],'2');
  assert.equal(first[header.indexOf('Motivo: Trincado')],'1');
  assert.equal(second[header.indexOf('Motivo: Trincado')],'0');
  assert.equal(first[header.indexOf('Observação')],"'=SOMA(1;2)");
});

test('APK salva o CSV em cache e abre o compartilhamento nativo',async()=>{
  let written,shared;
  context.isNativeCapacitor=()=>true;
  context.Blob=Blob;
  context.FileReader=class {
    readAsDataURL(blob){
      blob.arrayBuffer().then(bytes=>{
        this.result=`data:text/csv;base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      },error=>{this.error=error;this.onerror();});
    }
  };
  context.window={Capacitor:{Plugins:{
    Filesystem:{writeFile:async options=>{written=options;return {uri:'file:///cache/refugo.csv'};}},
    Share:{share:async options=>{shared=options;}}
  }}};
  try{
    await context.downloadRefugoCsv(
      {unit:'Matriz Caicó',map_number:'122117',status:'COMPLETED',created_by_name:'João',started_at:'2026-10-05T10:00:00Z'},
      [{type_name:'Barril',started_at:'2026-10-05T10:00:00Z',ended_at:'2026-10-05T10:10:00Z',quantity_checked:5,quantity_rejected:0,note:'Conferido',refugo_item_reasons:[]}]
    );
    assert.equal(written.directory,'CACHE');
    assert.equal(written.path,'refugo_mapa_122117_2026-10-05.csv');
    assert.ok(Buffer.from(written.data,'base64').toString('utf8').startsWith('\uFEFF"Unidade";"Mapa"'));
    assert.equal(shared.url,'file:///cache/refugo.csv');
  }finally{
    context.isNativeCapacitor=()=>false;
    delete context.window;
  }
});
