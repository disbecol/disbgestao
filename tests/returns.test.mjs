import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {DOMParser} from 'linkedom';
const require=createRequire(import.meta.url),R=require('../returns.js'),F=require('../returns-file.js'),{zipSync,unzipSync,strToU8}=require('../vendor/fflate.min.js');
const headers=['Mapa','Data','Unb Nota','Nota','Serie','Unb Cliente','Cod. Cliente','Nome Cliente','Telefone','Area','Setor','Placa','Valor','Volume','Data Devol.','Cod. Motivo','MOTIVO','Orig. Pedido','Usuario','Hora'];
const reportRow=over=>Object.assign(['12','01/11/2026','47','77','1','47','42','Loja','','','','ABC1234','1.234,56','1,25','02/11/2026','1','Recusa','','Operador','10:00'],over);
test('datas e números brasileiros não aceitam dias inexistentes e preservam zero',()=>{
 assert.equal(R.day('31/02/2026'),null);assert.equal(R.day('29/02/2024'),'2024-02-29');assert.equal(R.day(46327),'2026-11-01');
 assert.equal(R.cents('R$ 1.234,56'),123456);assert.equal(R.cents(''),null);assert.equal(R.cents('0'),0);assert.equal(R.cents(-1),null);assert.equal(R.volume('0,0105'),.0105);
});
test('03.02.24 ignora A:E, agrupa motivos da nota, elimina cópia exata e conta PDVs por mapa/data',()=>{
 const prefix=['cálculo','inválido','ignorar','x','y'],one=reportRow(),two=reportRow({12:'10,00',13:'0,1',16:'Preço'});
 const p=R.report([[...prefix,...headers],[...prefix,...one],[...prefix,...one],[...prefix,...two]]);
 assert.equal(p.errors.length,0);assert.equal(p.rows.length,1);assert.equal(p.duplicates,1);assert.equal(p.rows[0].amount_cents,124456);assert.equal(p.rows[0].volume_hl,1.35);assert.equal(p.rows[0].reasons.length,2);assert.equal(R.totals(p.rows).outlets,1);
});
test('03.02.24 recusa estrutura errada e relata linha sem valor',()=>{
 assert.throws(()=>R.report([['Data','Mapa','Valor','Volume']]));assert.equal(R.report([headers,reportRow({12:''})]).errors.length,1);
});
test('pedidos ignoram fórmulas auxiliares vazias e notas canceladas, sem contar o mesmo item duas vezes',()=>{
 const h=['Mapa','Cliente','Emissao','Nota','Total','Nome','Status','Produto','Qtde'];
 const p=R.orders([h,[1,42,'01/11/2026',10,100,'Loja','A',7,2],[1,42,'01/11/2026',10,100,'Loja','A',7,2],[1,42,'01/11/2026',10,50,'Loja','A',8,1],[1,42,'01/11/2026',11,90,'Loja','C',7,2],[]]);
 assert.equal(p.rows.length,1);assert.equal(p.rows[0].order_amount_cents,15000);assert.equal(p.duplicates,1);
});
test('equipe distingue os dois ajudantes e não usa linhas sem mapa de fórmulas auxiliares',()=>{
 const p=R.journeys([['DATA','MAPA','MOTORISTA','AJUDANTE','AJUDANTE','ROTA'],['01/11/2026',1,'Motorista','A','B','DROP'],['01/11/2026','','','','','#REF!']]);assert.equal(p.errors.length,0);assert.equal(p.rows[0].helper2,'B');assert.equal(p.rows[0].is_drop,true);
});
test('diretório de pedidos não troca o cliente de uma revenda pelo mesmo código de outra',()=>{
 const rows=[[],[null,null,null,null,null,null,42,'Loja Matriz',null,'Vendedor M','Caicó','Caicó'],[null,null,null,null,null,null,42,'Loja Filial',null,'Vendedor F','Pau dos Ferros','Pau dos Ferros']];
 assert.equal(R.customers(rows,'Matriz Caicó').rows[0].customer_name,'Loja Matriz');assert.equal(R.customers(rows,'Filial Pau dos Ferros').rows[0].seller,'Vendedor F');
});
test('17.03 importa totais diários ou indicadores por filial, valida mês e não lê MAPAS como rota',()=>{
 const p=R.routeTotals([['DATA','PDVS EM ROTA','HL EM ROTA','UNIDADE'],['01/11/2026',100,200,'Matriz Caicó'],['01/11/2026',50,80,'Filial Pau dos Ferros']],'Matriz Caicó');assert.equal(p.rows.length,1);
 assert.throws(()=>R.routeTotals([['MAPAS','DATA','CIDADE','MOTORISTA'],[1,'01/11/2026','Cidade','Pessoa']]));
 const rows=[['Filial','Cod. ID','Dia 01','Dia 02'],[1,697,100,200],[1,563,20,30],[6,697,12,25],[6,563,4,7]];
 assert.equal(R.routeReport(rows,'2026-11','Matriz Caicó').rows[1].planned_outlets,200);assert.equal(R.routeReport(rows,'2026-11','Filial Pau dos Ferros').rows[0].planned_hl,4);
 assert.throws(()=>R.routeReport(rows,'','Matriz Caicó'));assert.equal(R.routeTotals([['DATA','PDV','HL'],['01/11/2026',0,0]]).rows[0].planned_hl,0);
});
const record=(over={})=>({operation_date:'2026-11-01',customer_code:'42',map_number:'1',amount_cents:1000,volume_hl:1,city:'Caicó',driver:'Pessoa',helper1:'A',helper2:'A',reason:'Recusa',...over});

test('cidades com diferenças de caixa e acento têm um único filtro e agrupamento',()=>{
 const rows=[record({city:'SAO JOAO'}),record({city:'São João',customer_code:'43'})];const a=R.analytics({reports:rows});assert.equal(a.cities.length,1);assert.equal(a.cities[0].label,'SÃO JOÃO');assert.equal(a.cities[0].outlets,2);assert.equal(R.labels(rows,'city').length,1);assert.equal(R.filterRows(rows,{city:'sao joao'}).length,2);assert.equal(R.cityLabel('RN00007148'),'');
});
test('motivos equivalentes e erro de digitação conhecido se agrupam sem alterar o texto registrado',()=>{
 const rows=['CLIENTE CANCELOU','Cliente Cancelou.','Cliente Canelou','Cliente não cancelou'].map((reason,i)=>record({reason,customer_code:String(i)}));const a=R.analytics({reports:rows,cases:rows.map(r=>({...r,driver_reason:r.reason,client_reason:'SEM VASILHAME.'}))});assert.equal(a.reasons.length,2);assert.equal(a.reasons.find(r=>r.label==='Cliente cancelou').outlets,3);assert.equal(R.filterRows(rows,{reason:'cliente cancelou'}).length,3);assert.equal(R.labels(rows,'reason').length,2);assert.equal(a.reasonMatrix.find(r=>r.driver==='Cliente cancelou').count,3);assert.equal(rows[2].reason,'Cliente Canelou');
});
test('evolução omite dias com rota zerada e nenhuma devolução, sem esconder devolução sem rota',()=>{
 const a=R.analytics({reports:[record({operation_date:'2026-11-03'})],routes:[{operation_date:'2026-11-01',planned_outlets:0,planned_hl:0},{operation_date:'2026-11-02',planned_outlets:100,planned_hl:200},{operation_date:'2026-11-04',planned_outlets:0,planned_hl:0}]});assert.deepEqual(a.daily.map(r=>r.date),['2026-11-02','2026-11-03']);assert.equal(a.daily[1].outlets,1);assert.equal(a.route.hl_rate,null);
});
test('taxa mensal usa soma dos denominadores, ausência não vira zero e filtros locais não usam rota global',()=>{
 const s={reports:[record(),record({operation_date:'2026-11-02'})],routes:[{operation_date:'2026-11-01',planned_outlets:10,planned_hl:10},{operation_date:'2026-11-02',planned_outlets:100,planned_hl:100}]};
 const a=R.analytics(s,{from:'2026-11-01',to:'2026-11-30'});assert.equal(a.route.outlet_rate,2/110);assert.equal(a.helpers[0].outlets,2);assert.equal(R.analytics({...s,routes:s.routes.slice(0,1)}).route.hl_rate,null);assert.equal(R.analytics(s,{city:'Caicó'}).route.hl_rate,null);assert.equal(R.analytics({reports:[]}).route.hl_rate,null);
});
test('recorrência exige datas distintas na janela e reversão depende de decisão explícita',()=>{
 const s={reports:[record({operation_date:'2026-10-01'}),record(),record({invoice_number:'2'}),record({operation_date:'2026-11-02'})],cases:[record({status:'REVERTIDO'}),record({status:'DEVOLVIDO'}),record({status:'AGUARDANDO_REPASSE'})]};const a=R.analytics(s,{to:'2026-11-30'});assert.equal(a.recurrence[0].days,2);assert.equal(a.reversal_rate,.5);assert.equal(a.reversal_all,1/3);assert.equal(R.analytics({reports:s.reports,cases:[]}).reversal_rate,null);
});
test('CSV preserva campos citados e protege exportação contra fórmulas',()=>{
 assert.deepEqual(R.csv('A;B\n"loja;nome";"a""b"'),[['A','B'],['loja;nome','a"b']]);assert.throws(()=>R.csv('A\n"ab'));assert.ok(R.toCSV(['Nome'],[['=IMPORTXML("x")']]).includes("'=IMPORTXML"));
});
test('leitor XLSX extrai apenas aba solicitada, shared strings e valores armazenados',()=>{
 const files={'xl/workbook.xml':'<workbook><sheets><sheet name="03.02.24" r:id="r1"/><sheet name="Privada" r:id="r2"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>','xl/sharedStrings.xml':'<sst><si><t>Mapa</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>1+1</f><v>2</v></c></row><row r="1000000"><c r="A1000000"/></row></sheetData></worksheet>','xl/worksheets/sheet2.xml':'invalido'};
 const b=zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)]))),opened=F.open(b,{unzip:unzipSync,XML:DOMParser});assert.deepEqual(opened.read('03.02.24'),[['Mapa',2]]);assert.throws(()=>opened.read('inexistente'));
});
