import test from 'node:test';
import assert from 'node:assert/strict';
import readXlsx from 'read-excel-file/node';
import F from '../forms.js';

const schema={sections:[{id:'data',title:'Dados',fields:[{id:'name',label:'Nome',type:'TEXT',required:true}]},{id:'checks',title:'Condições',fields:[
 {id:'ok',label:'Veículo em condições?',type:'BOOLEAN',scored:true,expected:'YES',required:true,require_note:true,allow_na:true},
 {id:'leak',label:'Apresenta vazamento?',type:'BOOLEAN',scored:true,expected:'NO',required:true,allow_na:true},
 {id:'state',label:'Estado',type:'SINGLE_CHOICE',options:['Bom','Ruim'],scored:true,expected:'Bom'},
 {id:'km',label:'KM',type:'NUMBER',required:true,min:0,max:1000000},
 {id:'date',label:'Data',type:'DATE'},
 {id:'items',label:'Itens',type:'MULTIPLE_CHOICE',options:['A','B']}
]}]};
const answers={name:{value:'Roberto'},ok:{value:'YES'},leak:{value:'NA'},state:{value:'Ruim',observation:'Trocar peça',plan:'Revisar'},km:{value:100},__sections:{checks:'Inspeção presencial'}};

test('N/A fica fora da conformidade e textos/números não recebem nota',()=>{
 assert.deepEqual(F.score(schema,answers),{ok:1,nok:1,na:1,answered:5,total:7,percent:50});
 assert.equal(F.outcome(schema.sections[1].fields[1],{value:'NO'}),'OK');
 assert.equal(F.outcome(schema.sections[1].fields[1],{value:'YES'}),'NOK');
});
test('formulário sem perguntas avaliadas não inventa resultado zero ou 100%',()=>{
 assert.equal(F.score({sections:[schema.sections[0]]},{name:{value:'Ana'}}).percent,null);
});
test('a finalização exige obrigatórias e observação quando NOK',()=>{
 const a={...answers,ok:{value:'NO'}};
 assert.match(F.validateAnswers(schema,a,true).errors[0].message,/não conformidade/);
 assert.equal(F.validateAnswers(schema,a,false).errors.length,0);
 delete a.km;
 assert.ok(F.validateAnswers(schema,a,true).errors.some(x=>x.id==='km'));
});
test('número zero é resposta válida e escolha duplicada ou inexistente é rejeitada',()=>{
 const a={...answers,km:{value:0},items:{value:['A','A']}};
 assert.equal(F.validateAnswers(schema,a,true).errors.length,1);
 a.items.value=['Z'];assert.equal(F.validateAnswers(schema,a,true).errors.length,1);
 a.items.value=['A','B'];assert.equal(F.validateAnswers(schema,a,true).errors.length,0);
});
test('datas inexistentes, notas extensas e números fora dos limites são rejeitados',()=>{
 const a={...answers,date:{value:'2026-02-30'},km:{value:-1},__sections:{checks:'x'.repeat(2001)}};
 assert.equal(F.validateAnswers(schema,a,true).errors.length,3);
});
test('observações de seção e planos válidos são preservados',()=>{
 const r=F.validateAnswers(schema,answers,true);
 assert.equal(r.answers.__sections.checks,'Inspeção presencial');
 assert.equal(r.answers.state.plan,'Revisar');
 assert.equal(r.answers.ok.plan,'');
});
test('validar modelos impede IDs repetidos, escolha sem opções e campo com score indevido',()=>{
 assert.equal(F.validateSchema(schema),schema);
 const s=structuredClone(schema);s.sections[1].fields[0].id='name';assert.throws(()=>F.validateSchema(s),/repetido/);
 const t=structuredClone(schema);t.sections[1].fields[2].options=['Bom'];assert.throws(()=>F.validateSchema(t),/opções/);
 const u=structuredClone(schema);u.sections[0].fields[0].scored=true;assert.throws(()=>F.validateSchema(u),/Somente/);
});
test('painel agrega respostas avaliadas, exclui rascunhos e respeita o fuso brasileiro',()=>{
 const rows=[{status:'COMPLETED',schema_snapshot:schema,answers,started_at:'2026-11-01T01:00:00Z'},
  {status:'DRAFT',schema_snapshot:schema,answers:{}}];
 assert.equal(F.summarize(rows).percent,50);
 assert.equal(F.annual(rows,2026)[9].completed,1);
 assert.equal(F.annual(rows,2026)[10].completed,0);
});
test('inconsistências utilizam a versão histórica e associam o plano à pergunta correta',()=>{
 const rows=[{id:'r1',status:'COMPLETED',schema_snapshot:schema,answers}];
 const issues=F.issues(rows,[{response_id:'r1',field_id:'state',status:'DONE'}]);
 assert.equal(issues.length,1);assert.equal(issues[0].field.id,'state');assert.equal(issues[0].plan.status,'DONE');
});
test('CSV protege fórmulas e preserva aspas, acentos e quebras de linha',()=>{
 const csv=F.csv([['=1+1','@malicioso','Descrição "teste"','a\nb']]);
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('"\'@malicioso"'));
 assert.ok(csv.includes('Descrição ""teste""'));
});
test('Excel gerado pode ser reaberto com acentos e conteúdos tratados como texto',async()=>{
 const rows=[['Registro','Pergunta','Resposta'],['FORM-1','Condições da carreta','=1+1'],['FORM-2','Nome','José & Maria']];
 const file=F.xlsx(rows);assert.equal(new DataView(file.buffer).getUint32(0,true),0x04034b50);
 const read=await readXlsx(Buffer.from(file));assert.deepEqual(read[0].data,rows);
});
test('exportação usa cabeçalho, versão e perguntas do histórico',()=>{
 const rows=F.exportRows([{id:'r1',code:'FORM-1',form_name:'Inspeção antiga',form_version:1,unit:'Matriz Caicó',respondent_name:'Roberto',status:'COMPLETED',schema_snapshot:schema,answers}]);
 assert.equal(rows[1][1],'Inspeção antiga');assert.equal(rows[1][2],1);assert.equal(rows[2][10],'Veículo em condições?');
});
