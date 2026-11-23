import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const FDR=require('../src/fdr/fdr.js');

const rows=[
 {report_date:'2026-11-20',city:'Caicó',driver:'Ana',branch:'MATRIZ',justified:false},
 {report_date:'2026-11-21',city:'Pau dos Ferros',driver:'Bia',branch:'FILIAL',justified:true},
 {report_date:'2026-10-31',city:'Caicó',driver:'Bia',branch:'MATRIZ',justified:true}
];

test('filtros FDR combinam intervalo, cidade, motorista, revenda e justificativa',()=>{
 assert.deepEqual(FDR.filterRows(rows,{from:'2026-11-01',to:'2026-11-30',city:'caico',driver:'ANA',branch:'MATRIZ',justified:'false'}),[rows[0]]);
 assert.deepEqual(FDR.filterRows(rows,{from:'2026-11-21',justified:'true'}),[rows[1]]);
});

test('filtros vazios preservam todos os registros',()=>{
 assert.deepEqual(FDR.filterRows(rows,{}),rows);
});
test('dashboard conta apontamentos uma vez, aplica filtros e distingue vazio de percentual zero',()=>{
 const values=rows.map((r,i)=>({...r,id:String(i),customer_code:String(i),map_number:i?'9':''}));
 const a=FDR.analytics([...values,values[0]],{from:'2026-11-01'});assert.equal(a.total,2);assert.equal(a.justified_share,.5);assert.equal(a.missing_maps,1);assert.equal(a.customers,2);assert.equal(a.drivers.reduce((s,r)=>s+r.total,0),2);assert.equal(FDR.analytics(values,{justified:'false'}).justified_share,0);assert.equal(FDR.analytics([]).justified_share,null);
});
