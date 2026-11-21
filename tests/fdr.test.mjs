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
