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

test('resposta comum e individual produzem notas separadas e não avaliam o aplicador',()=>{
 const schema={evaluation:{enabled:true,area:'Entrega',user_ids:['daniel','francos']},sections:[{id:'s',title:'Rotina',fields:[{id:'group',label:'Pontualidade',type:'BOOLEAN',scope:'GROUP',scored:true,expected:'YES'},{id:'keys',label:'Guardou as chaves',type:'BOOLEAN',scope:'INDIVIDUAL',scored:true,expected:'YES'}]}]};
 const answers={group:{value:'YES'},__evaluations:{daniel:{keys:{value:'NO',observation:'Deixou na mesa'}},francos:{keys:{value:'YES'}}}},row={id:'r',respondent_id:'marcelo',respondent_name:'Marcelo',evaluated_people:[{id:'daniel',name:'Daniel',area:'Entrega'},{id:'francos',name:'Francos',area:'Entrega'}],schema_snapshot:schema,answers,status:'COMPLETED',started_at:'2026-10-30T10:00:00Z'};
 const views=F.assessmentRows([row]);assert.equal(F.score(schema,answers).percent,75);assert.deepEqual(views.map(r=>[r.evaluated_name,r.score]),[['Daniel',50],['Francos',100]]);assert.ok(views.every(r=>r.respondent_id==='marcelo'));
 const issues=F.issues([row],[{response_id:'r',field_id:'keys@daniel',status:'DONE'}]);assert.equal(issues.length,1);assert.equal(issues[0].response.evaluated_name,'Daniel');assert.equal(issues[0].plan.status,'DONE');
 const months=F.questionMonths([row],'daniel',2026);assert.equal(months.find(q=>q.id==='keys').months[9].percent,0);assert.equal(months.find(q=>q.id==='group').months[9].percent,100);assert.equal(months[0].months[8].percent,null);
 assert.equal(F.assessmentRows([{...row,evaluated_people:[]}])[0].evaluated_user_id,undefined);
});
test('validação individual identifica a pessoa que deixou uma obrigatória em branco',()=>{
 const schema={evaluation:{enabled:true},sections:[{id:'s',title:'Condição',fields:[{id:'q',label:'Chaves',type:'BOOLEAN',scope:'INDIVIDUAL',required:true,scored:true,expected:'YES',require_note:true}]}]};
 const check=F.validateResponse(schema,{__evaluations:{a:{q:{value:'NO'}}}},[{id:'a',name:'Daniel'},{id:'b',name:'Francos'}],true);assert.ok(check.errors.some(e=>e.person==='a'&&e.message.includes('Daniel')));assert.ok(check.errors.some(e=>e.person==='b'&&e.message.includes('Francos')));
});
test('calendário mantém sete dias por semana e inclui meses com fevereiro curto',()=>{
 const days=F.calendarDays('2026-02');assert.equal(days.length,42);assert.equal(new Date(days[0]+'T12:00:00Z').getUTCDay(),0);assert.equal(days.filter(d=>d.startsWith('2026-02')).length,28);assert.equal(F.calendarDays('2028-02').filter(d=>d.startsWith('2028-02')).length,29);
});
test('pergunta de fotos valida obrigatoriedade e preserva evidências NOK',()=>{
 const schema={sections:[{id:'s',title:'Fotos',fields:[{id:'p',label:'Anexar fotos',type:'PHOTO',required:true},{id:'q',label:'Condição',type:'BOOLEAN',scored:true,expected:'YES'}]}]};
 assert.ok(F.validateAnswers(schema,{},true).errors.length);const a={p:{photos:['user/response/photo.jpg']},q:{value:'NO',photos:['user/response/nok.jpg']}};assert.equal(F.validateAnswers(schema,a,true).errors.length,0);assert.deepEqual(F.validateAnswers(schema,a,true).answers.p.value,a.p.photos);assert.equal(F.answerText(schema.sections[0].fields[0],{value:a.p.photos,photos:a.p.photos}),'1 foto(s)');assert.equal(F.evidencePaths(a).length,2);
});
