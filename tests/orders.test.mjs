import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),O=require('../src/pedidos/orders.js');
test('períodos rápidos respeitam mês, virada de ano e os últimos sete dias',()=>{
 const now='2026-01-03T15:00:00Z';assert.deepEqual(O.period('3m',now),{from:'2025-11-01',to:'2026-01-03'});assert.deepEqual(O.period('7d',now),{from:'2025-12-28',to:'2026-01-03'});assert.deepEqual(O.period('previous',now),{from:'2025-12-01',to:'2025-12-31'});
});
test('média semanal conta dias transcorridos no filtro e não inclui os dias futuros',()=>{
 const rows=[{created_at:'2026-11-02T15:00:00Z'},{created_at:'2026-11-09T15:00:00Z'}],days=O.weekdays(rows,'2026-11-01','2026-11-30','2026-11-10T15:00:00Z');
 const monday=days.find(r=>r.label==='segunda-feira');assert.equal(monday.total,2);assert.equal(monday.days,2);assert.equal(monday.average,1);assert.equal(days.reduce((n,r)=>n+r.days,0),10);
});
test('janelas usam Brasília e incluem limites exatos independentemente do fuso do aparelho',()=>{
 for(const [iso,open] of [['2026-11-19T11:29:00Z',false],['2026-11-19T11:30:00Z',true],['2026-11-19T14:30:00Z',true],['2026-11-19T14:31:00Z',false],['2026-11-19T17:00:00Z',true],['2026-11-19T19:00:00Z',true],['2026-11-19T19:01:00Z',false]])assert.equal(O.windowState(O.DEFAULTS,Date.parse(iso)).open,open);
 assert.equal(O.windowState({...O.DEFAULTS,restricted_hours:false},0).open,true);
 assert.equal(O.localDate('2026-11-19T01:00:00Z'),'2026-11-18');
});
test('SLA distingue atenção, prazo exato e excesso e usa duração final imutável',()=>{
 const r={created_at:'2026-11-19T12:00:00Z',sla_minutes:30};assert.equal(O.sla(r,Date.parse('2026-11-19T12:16:00Z')).tone,'warning');assert.equal(O.sla(r,Date.parse('2026-11-19T12:30:00Z')).within,true);assert.equal(O.sla(r,Date.parse('2026-11-19T12:31:00Z')).within,false);
 assert.equal(O.sla({...r,resolved_at:'2026-11-19T12:10:00Z',resolution_minutes:10,within_sla:true},Date.now()).elapsed,10);
});
test('filtros, rankings e indicadores consideram todos os tipos e não contam pendentes como resolvidos',()=>{
 const rows=[{id:'1',kind:'BIPASSE',customer_code:'10',customer_name:'São João',status:'APROVADO',resolved_at:'2026-11-19',within_sla:true,resolution_minutes:10},{id:'2',kind:'FORA_ROTA',customer_code:'20',customer_name:'Outro',status:'PENDENTE'},{id:'3',kind:'CLIENTE_NOVO',customer_code:'10',customer_name:'São João',status:'REPROVADO',resolved_at:'2026-11-19',within_sla:false,resolution_minutes:50}];
 assert.equal(O.filterRows(rows,{search:'sao joao'}).length,2);assert.equal(O.filterRows(rows,{kind:'BIPASSE'}).length,1);assert.equal(O.stats(rows).rate,.5);assert.equal(O.stats(rows).average,30);assert.equal(O.groups(rows,r=>r.customer_code)[0].id,'10');assert.equal(O.stats([]).rate,null);
});
test('CSV mantém todas as linhas filtradas, aspas, observações e neutraliza fórmulas de planilha',()=>{
 const csv=O.csv([{id:'1',kind:'FORA_ROTA',status:'PENDENTE',customer_name:'=HYPERLINK("exemplo")',notes:'linha 1\nlinha 2; fim'}]);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('linha 1\nlinha 2; fim'));assert.ok(csv.includes('"Fora de rota"'));
});
