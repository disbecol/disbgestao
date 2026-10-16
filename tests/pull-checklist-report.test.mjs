import test from 'node:test';
import assert from 'node:assert/strict';
import PDFLib from '../vendor/pdf-lib.min.js';
import report from '../pull-report.js';

test('gera relatório de checklist em PDF com todos os itens em várias páginas',async()=>{
  const checklistRuns=Array.from({length:6},(_,index)=>({
    id:`run-${index}`,checkpoint_code:`POINT_${index}`,checkpoint_label:`Etapa ${index+1}`,
    checklist_type:index%2?'RETURN':'DEPARTURE',driver_name:'Motorista',
    recorded_at:'2026-10-16T12:00:00Z',odometer_km:120000+index*100,
    odometer_previous_km:119900+index*100,odometer_delta_km:100,
    latitude:-6.4589,longitude:-37.0991,gps_accuracy:8
  }));
  const checklistAnswers=checklistRuns.flatMap(run=>Array.from({length:14},(_,index)=>({
    run_id:run.id,sort_order:index+1,question_snapshot:`Pergunta ${index+1} sobre o veículo`,
    critical_snapshot:index%2===0,answer:index===2?'NOK':'OK',
    observation:index===2?'Descrição do problema encontrado na carreta.':''
  })));
  const bytes=await report.buildPdf({
    checklistOnly:true,trip:{trip_code:'PUX-0000099',plate:'ABC1234',origin_unit:'Matriz Caicó'},
    checklistRuns,checklistAnswers
  },PDFLib);
  const pdf=await PDFLib.PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount()>1);
  assert.match(pdf.getTitle(),/Checklists do ciclo PUX-0000099/);
  for(const page of pdf.getPages()){
    assert.ok(Math.abs(page.getWidth()-595.28)<.1);
    assert.ok(Math.abs(page.getHeight()-841.89)<.1);
  }
});

test('gera PDF mesmo quando não há checklist registrado',async()=>{
  const bytes=await report.buildPdf({checklistOnly:true,trip:{trip_code:'PUX-SEM-CHECKLIST'}},PDFLib);
  const pdf=await PDFLib.PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),1);
});

test('o resumo completo do ciclo também aceita as respostas do checklist',async()=>{
  const bytes=await report.buildPdf({
    trip:{trip_code:'PUX-0000100',plate:'ABC1234',origin_unit:'Matriz Caicó'},
    checklistRuns:[{id:'run-1',checkpoint_label:'Saída da revenda',driver_name:'Motorista 1',recorded_at:'2026-10-16T12:00:00Z'}],
    checklistAnswers:[{run_id:'run-1',sort_order:1,question_snapshot:'Freios estão ok?',critical_snapshot:true,answer:'NOK',observation:'Necessita manutenção.'}]
  },PDFLib);
  const pdf=await PDFLib.PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount()>=1);
  assert.match(pdf.getTitle(),/Resumo do ciclo PUX-0000100/);
});
