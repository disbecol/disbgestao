import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=app.indexOf('function pullChecklistCsvMatrix(');
const end=app.indexOf('async function downloadPullTripSummary(',start);
assert.ok(start>=0&&end>start);

function csvContext(overrides={}){
  const context={
    fmtDateTime:value=>value||'—',hasPerm:()=>true,navigator:{onLine:true},
    activeUnit:'Matriz Caicó',pullReportBusy:new Set(),
    console,toast(){},...overrides
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start,end),context);
  return context;
}

const trip={id:'trip-1',trip_code:'PUX-0000099',cycle_type:'PULL',origin_unit:'Matriz Caicó',plate:'ABC1234',factory:'Itapissuma'};
const run={id:'run-1',checkpoint_code:'D1_START',checkpoint_label:'Saída da revenda',checklist_type:'DEPARTURE',driver_name:'Motorista 1',recorded_at:'2026-10-16T12:00:00Z',device_at:'2026-10-16T11:59:00Z',odometer_km:120100,odometer_previous_km:120000,odometer_delta_km:100,latitude:-6.4589,longitude:-37.0991,gps_accuracy:8};
const answers=[
  {run_id:'run-1',sort_order:2,question_snapshot:'Freios estão ok?',critical_snapshot:true,answer:'NOK',observation:'=SOMA(1;2)'},
  {run_id:'run-1',sort_order:1,question_snapshot:'Documento do veículo está ok?',critical_snapshot:true,answer:'OK',observation:''}
];

test('CSV da Puxada traz uma linha por pergunta, KM, GPS e observação em ordem',()=>{
  const matrix=csvContext().pullChecklistCsvMatrix(trip,{checklistRuns:[run],checklistAnswers:answers});
  const headers=matrix[0];
  assert.equal(matrix.length,3);
  assert.equal(matrix[1][headers.indexOf('Pergunta')],'Documento do veículo está ok?');
  assert.equal(matrix[2][headers.indexOf('Resposta')],'NOK');
  assert.equal(matrix[2][headers.indexOf('Observação')],"'=SOMA(1;2)");
  assert.equal(matrix[2][headers.indexOf('KM atual')],120100);
  assert.equal(matrix[2][headers.indexOf('Diferença de KM')],100);
  assert.equal(matrix[2][headers.indexOf('Latitude')],-6.4589);
  assert.equal(matrix[2][headers.indexOf('Motorista')],'Motorista 1');
  assert.equal(matrix[2][headers.indexOf('Crítico')],'Sim');
});

test('o botão salva CSV sem carregar a biblioteca de PDF',async()=>{
  let exported;
  const context=csvContext({
    sb:{from:()=>({select(){return this;},eq(){return this;},async single(){return {data:trip,error:null};}})},
    fetchPullReportChecklists:async()=>({checklistRuns:[run],checklistAnswers:answers}),
    saveCsvDocument:async(name,matrix,title)=>{exported={name,matrix,title};}
  });
  const button={disabled:false,textContent:'Baixar checklist CSV'};
  await context.downloadPullTripChecklist(trip.id,button);
  assert.equal(exported.name,'checklists-PUX-0000099.csv');
  assert.equal(exported.matrix.length,3);
  assert.equal(exported.title,'Checklists da Puxada');
  assert.equal(button.disabled,false);
  assert.equal(button.textContent,'Baixar checklist CSV');
});

test('não baixa um CSV incompleto quando faltam respostas',()=>{
  assert.throws(()=>csvContext().pullChecklistCsvMatrix(trip,{checklistRuns:[run],checklistAnswers:[]}),/não estão disponíveis/);
});
