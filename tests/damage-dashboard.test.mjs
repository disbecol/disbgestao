import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const D=createRequire(import.meta.url)('../src/avarias/damage-dashboard.js');
const item=(id,extra={})=>({id,product_text:'982 - SKOL 600ML',quantity:2,quantity_unit:'UNIDADE',reason:'Quebrado',status:'PENDENTE',...extra});
const request=(id,items,extra={})=>({id,occurrence_date:'2026-11-12',created_at:'2026-11-12T12:00:00Z',customer_code:'10',customer_name:'Cliente',city:'São João',delivery_name:'Motorista',items,...extra});
test('conta uma ocorrência com vários itens e não soma caixas com unidades',()=>{
 const rows=D.flatten([request('r1',[item('a'),item('b',{quantity:3,quantity_unit:'CAIXA'})])]),s=D.stats(rows);assert.equal(s.occurrences,1);assert.equal(s.items,2);assert.equal(s.units,2);assert.equal(s.boxes,3);assert.equal(s.customers,1);
});
test('atendimento completo não vira 100% ao filtrar somente um item já entregue',()=>{
 const rows=D.flatten([request('r1',[item('a',{status:'ENTREGUE',delivered_at:'2026-11-14T12:00:00Z'}),item('b')]),request('r2',[item('c',{status:'ENTREGUE',delivered_at:'2026-11-13T12:00:00Z'})])]);
 assert.equal(D.stats(rows).infull,.5);assert.equal(D.stats(D.filter(rows,{status:'ENTREGUE'})).infull,.5);assert.equal(D.stats(rows).averageDays,1.5);
});
test('cancelados e reprovados não criam falsa pendência ou atendimento completo',()=>{
 const rows=D.flatten([request('r1',[item('a',{status:'CANCELADO'}),item('b',{status:'REPROVADO'})])]);const s=D.stats(rows);assert.equal(s.open,0);assert.equal(s.infull,null);assert.equal(s.cancelled,1);assert.equal(s.rejected,1);
});
test('classifica os motivos disponíveis e mantém motivos desconhecidos identificados',()=>{
 assert.equal(D.type('Não foi no caminhão'),'REPOSICAO');assert.equal(D.type('Faltando na Grade'),'REPOSICAO');assert.equal(D.type('Furada'),'TROCA');assert.equal(D.type('Motivo novo'),'NAO_CLASSIFICADA');
});
test('filtros e agrupamentos normalizam cidade, preservam identidades e respeitam tipo',()=>{
 const rows=D.flatten([request('r1',[item('a')]),request('r2',[item('b',{reason:'Não foi no caminhão'})],{city:'SAO JOAO',customer_code:'20'})]);assert.equal(D.group(rows,r=>D.norm(r.city),r=>r.city).length,1);assert.equal(D.filter(rows,{city:'sao joao'}).length,2);assert.equal(D.filter(rows,{type:'REPOSICAO'}).length,1);assert.equal(D.filter(rows,{search:'skol'}).length,2);
});
test('sem data de entrega não inventa lead time; comparação anual sem histórico não vira zero',()=>{
 const rows=D.flatten([request('r1',[item('a',{status:'ENTREGUE'})])]);assert.equal(D.stats(rows).averageDays,null);assert.equal(D.stats(rows).missingLead,1);assert.equal(D.comparison(rows,[])[0].previous,null);assert.equal(D.comparison(rows,[])[0].delta,null);
});
test('a fila de espera usa dias desde o registro e duplicatas de item não inflam totais',()=>{
 const r=request('r1',[item('a')]),rows=D.flatten([r,r]);assert.equal(rows.length,1);assert.equal(D.aging(rows,Date.parse('2026-11-30T12:00:00Z'))[3].total,1);
});
