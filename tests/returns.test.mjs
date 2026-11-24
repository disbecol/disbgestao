import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {DOMParser} from 'linkedom';
const require=createRequire(import.meta.url),R=require('../src/devolucoes/returns.js'),F=require('../src/devolucoes/returns-file.js'),{zipSync,unzipSync,strToU8}=require('../vendor/fflate.min.js');
const headers=['Mapa','Data','Unb Nota','Nota','Serie','Unb Cliente','Cod. Cliente','Nome Cliente','Telefone','Area','Setor','Placa','Valor','Volume','Data Devol.','Cod. Motivo','MOTIVO','Orig. Pedido','Usuario','Hora'];
const reportRow=over=>Object.assign(['12','01/11/2026','47','77','1','47','42','Loja','','','','ABC1234','1.234,56','1,25','02/11/2026','1','Recusa','','Operador','10:00'],over);
test('datas e números brasileiros não aceitam dias inexistentes e preservam zero',()=>{
 assert.equal(R.day('31/02/2026'),null);assert.equal(R.day('29/02/2024'),'2024-02-29');assert.equal(R.day(46327),'2026-11-01');
 assert.equal(R.day('3/2/2026'),'2026-02-03');
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
test('03.02.24 aceita datas textuais sem zero à esquerda',()=>{
 const parsed=R.report([headers,reportRow({1:'3/2/2026',14:'4/2/2026'})]);
 assert.equal(parsed.errors.length,0);assert.equal(parsed.rows[0].operation_date,'2026-02-03');assert.equal(parsed.rows[0].return_date,'2026-02-04');
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

test('raio agrupa notas, soma valores e HL e usa denominadores por ocorrência',()=>{
 const rows=[record({invoice_number:'1'}),record({invoice_number:'2'}),record({customer_code:'43'}),record({customer_code:'44'})],source={available:true,matches:[{...rows[0],state:'OUTSIDE',justified:true,match_count:2},{...rows[2],state:'INSIDE'},{...rows[3],state:'PENDING'}]};
 const a=R.radiusAnalysis(rows,source);assert.equal(a.rows.length,3);assert.equal(a.totals.total,3);assert.equal(a.totals.amount_cents,4000);assert.equal(a.totals.volume_hl,4);assert.equal(a.totals.outside_share,1/3);assert.equal(a.totals.justified_share,1);assert.equal(a.drivers[0].outside,1);
 assert.equal(R.radiusAnalysis(rows,source,'JUSTIFIED').totals.total,1);assert.equal(R.radiusAnalysis(rows,source,'INSIDE').totals.total,1);assert.equal(R.radiusAnalysis(rows,source,'UNJUSTIFIED').totals.total,0);
 assert.equal(R.radiusAnalysis(rows,{available:false}).available,false);assert.equal(R.radiusAnalysis(rows,{available:true,matches:[]}).totals.pending,3);assert.equal(R.radiusAnalysis([],{available:true,matches:[]}).totals.outside_share,null);
});
test('pedidos originais reconhecem cabeçalhos repetidos, filial com zeros e campos automáticos no final',()=>{
 const h=Array.from({length:96},(_,i)=>'Extra '+i),row=Array(96).fill('');for(const [i,v] of Object.entries({1:'Filial',2:'Mapa .....',3:'Cliente ..',5:'Dt. Operacao',6:'Emissao   ',7:'Nota',8:'Serie',9:'Status',12:'Cliente',13:'Nome',15:'Produto',19:'Qtde',25:'Total',26:'Mapa',94:'Cidade',95:'Vendedor'}))h[+i]=v;
 for(const [i,v] of Object.entries({1:'0001',2:'999999',3:'999999',5:'31/10/2026',6:'03/11/2026',7:'0000077',8:'004',9:'A',12:'0000042',13:'Exemplo',15:9,19:2,25:'443,50',26:'122.948',94:'Caicó',95:'135'}))row[+i]=v;
 const parsed=R.orders([h,row],'Matriz Caicó');assert.equal(parsed.errors.length,0);assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].operation_date,'2026-11-03');assert.equal(parsed.rows[0].map_number,'122948');assert.equal(parsed.rows[0].customer_code,'42');assert.equal(parsed.rows[0].invoice_series,'4');assert.equal(parsed.rows[0].city,'Caicó');assert.equal(parsed.rows[0].seller,'135');assert.equal(parsed.rows[0].order_amount_cents,44350);assert.equal(R.orders([h,row],'Filial Pau dos Ferros').rows.length,0);
});

test('cidades com diferenças de caixa e acento têm um único filtro e agrupamento',()=>{
 const rows=[record({city:'SAO JOAO'}),record({city:'São João',customer_code:'43'})];const a=R.analytics({reports:rows});assert.equal(a.cities.length,1);assert.equal(a.cities[0].label,'SÃO JOÃO');assert.equal(a.cities[0].outlets,2);assert.equal(R.labels(rows,'city').length,1);assert.equal(R.filterRows(rows,{city:'sao joao'}).length,2);assert.equal(R.cityLabel('RN00007148'),'');
});
test('motivos equivalentes e erro de digitação conhecido se agrupam sem alterar o texto registrado',()=>{
 const rows=['CLIENTE CANCELOU','Cliente Cancelou.','Cliente Canelou','Cliente não cancelou'].map((reason,i)=>record({reason,customer_code:String(i)}));const a=R.analytics({reports:rows,cases:rows.map(r=>({...r,driver_reason:r.reason,client_reason:'SEM VASILHAME.'}))});assert.equal(a.reasons.length,2);assert.equal(a.reasons.find(r=>r.label==='Cliente cancelou').outlets,3);assert.equal(R.filterRows(rows,{reason:'cliente cancelou'}).length,3);assert.equal(R.labels(rows,'reason').length,2);assert.equal(a.reasonMatrix.find(r=>r.driver==='Cliente cancelou').count,3);assert.equal(rows[2].reason,'Cliente Canelou');
});
test('evolução omite dias com rota zerada e nenhuma devolução, sem esconder devolução sem rota',()=>{
 const a=R.analytics({reports:[record({operation_date:'2026-11-03'})],routes:[{operation_date:'2026-11-01',planned_outlets:0,planned_hl:0},{operation_date:'2026-11-02',planned_outlets:100,planned_hl:200},{operation_date:'2026-11-04',planned_outlets:0,planned_hl:0}]});assert.deepEqual(a.daily.map(r=>r.date),['2026-11-02','2026-11-03']);assert.equal(a.daily[1].outlets,1);assert.equal(a.route.hl_rate,null);
});
test('análise por clientes agrupa por PDV, soma notas sem duplicar devoluções e respeita o período',()=>{
 const rows=[record({customer_name:'Nome antigo'}),record({invoice_number:'2',amount_cents:500}),record({operation_date:'2026-11-02',customer_name:'Nome atual',volume_hl:.5}),record({customer_code:'43',customer_name:'Nome atual',amount_cents:800}),record({operation_date:'2026-10-01',amount_cents:90000})];const a=R.analytics({reports:rows},{from:'2026-11-01',to:'2026-11-30'});assert.equal(a.clients.length,2);const c=a.clients.find(r=>r.customer_code==='42');assert.equal(c.customer_name,'Nome atual');assert.equal(c.outlets,2);assert.equal(c.days,2);assert.equal(c.amount_cents,2500);assert.equal(c.volume_hl,2.5);assert.equal(c.share,2/3);assert.equal(a.clients.reduce((s,r)=>s+r.amount_cents,0),a.totals.amount_cents);assert.equal(a.clients.reduce((s,r)=>s+r.share,0),1);
});
test('notas do mesmo cliente, mapa e dia formam uma devolução com valores e HL somados',()=>{
 const rows=[record({invoice_number:'198644',invoice_series:'1',amount_cents:9600,volume_hl:1,reason:'NF ERRADA'}),record({invoice_number:'198645',invoice_series:'1',amount_cents:6900,volume_hl:.5,reason:'NF errada.'})],original=JSON.stringify(rows),groups=R.occurrences(rows);assert.equal(R.totals(rows).outlets,1);assert.equal(groups.length,1);assert.equal(groups[0].amount_cents,16500);assert.equal(groups[0].volume_hl,1.5);assert.equal(groups[0].note_count,2);assert.equal(groups[0].notes_display,'198644 / 198645');assert.equal(groups[0].reason,'NF errada');assert.equal(R.analytics({reports:rows}).largest.length,1);assert.equal(JSON.stringify(rows),original);assert.equal(R.occurrences([...rows,record({map_number:'2',invoice_number:'3'})]).length,2);
});
test('devolução parcial possui contador próprio e integra o denominador dos casos encerrados',()=>{
 const a=R.analytics({cases:[record({status:'PARCIAL'}),record({status:'DEVOLVIDO'}),record({status:'REVERTIDO'}),record({status:'AGUARDANDO_REPASSE'})]});assert.equal(R.STATUS.PARCIAL,'Devolução parcial');assert.equal(a.counts.PARCIAL,1);assert.equal(a.reversal_rate,1/3);assert.equal(a.reversal_all,.25);
});
test('cliente novo considera 0 até 60 dias na data da devolução, com limite inclusivo e desconhecidos expostos',()=>{
 const make=(age,id)=>record({customer_code:id,registration_date:age===null?null:R.dateShift('2026-11-01',-age)}),a=R.analytics({reports:[make(0,'1'),make(60,'2'),make(61,'3'),make(null,'4'),make(-1,'5')]});assert.equal(a.newCustomers.totals.outlets,2);assert.equal(a.newCustomers.clients.length,2);assert.equal(a.newCustomers.unknown,2);assert.equal(R.registrationAge(make(60,'2')),60);assert.equal(R.analytics({reports:[make(60,'2')]},{from:'2026-11-02'}).newCustomers.rows.length,0);
});
test('taxa mensal usa soma dos denominadores, ausência não vira zero e filtros locais não usam rota global',()=>{
 const s={reports:[record(),record({operation_date:'2026-11-02'})],routes:[{operation_date:'2026-11-01',planned_outlets:10,planned_hl:10},{operation_date:'2026-11-02',planned_outlets:100,planned_hl:100}]};
 const a=R.analytics(s,{from:'2026-11-01',to:'2026-11-30'});assert.equal(a.route.outlet_rate,2/110);assert.equal(a.helpers[0].outlets,2);assert.equal(R.analytics({...s,routes:s.routes.slice(0,1)}).route.hl_rate,null);assert.equal(R.analytics(s,{city:'Caicó'}).route.hl_rate,null);assert.equal(R.analytics({reports:[]}).route.hl_rate,null);
});
test('recorrência respeita todo o período selecionado e reversão depende de decisão explícita',()=>{
 const s={reports:[record({operation_date:'2026-10-01'}),record(),record({invoice_number:'2'}),record({operation_date:'2026-11-02'})],cases:[record({status:'REVERTIDO'}),record({status:'DEVOLVIDO'}),record({status:'AGUARDANDO_REPASSE'})]};const a=R.analytics(s,{from:'2026-11-01',to:'2026-11-30'});assert.equal(a.recurrence[0].days,2);assert.equal(a.reversal_rate,.5);assert.equal(a.reversal_all,1/3);assert.equal(R.analytics(s,{from:'2026-10-01',to:'2026-11-30'}).recurrence[0].days,3);assert.equal(R.analytics(s,{from:'2026-11-02',to:'2026-11-30'}).recurrence.length,0);assert.equal(R.analytics(s,{from:'2026-10-01',to:'2026-11-30',city:'Outra cidade'}).recurrence.length,0);assert.equal(R.analytics({reports:s.reports,cases:[]}).reversal_rate,null);
});
test('CSV preserva campos citados e protege exportação contra fórmulas',()=>{
 assert.deepEqual(R.csv('A;B\n"loja;nome";"a""b"'),[['A','B'],['loja;nome','a"b']]);assert.throws(()=>R.csv('A\n"ab'));assert.ok(R.toCSV(['Nome'],[['=IMPORTXML("x")']]).includes("'=IMPORTXML"));
});
test('leitor XLSX extrai apenas aba solicitada, shared strings e valores armazenados',()=>{
 const files={'xl/workbook.xml':'<workbook><sheets><sheet name="03.02.24" r:id="r1"/><sheet name="Privada" r:id="r2"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>','xl/sharedStrings.xml':'<sst><si><t>Mapa</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>1+1</f><v>2</v></c></row><row r="1000000"><c r="A1000000"/></row></sheetData></worksheet>','xl/worksheets/sheet2.xml':'invalido'};
 const b=zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)]))),opened=F.open(b,{unzip:unzipSync,XML:DOMParser});assert.deepEqual(opened.read('03.02.24'),[['Mapa',2]]);assert.throws(()=>opened.read('inexistente'));
});
