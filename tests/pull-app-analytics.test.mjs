import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window={};vm.runInNewContext(fs.readFileSync(new URL('../src/puxada/app-analytics.js',import.meta.url),'utf8'),{window,Date,Map,Set});const api=window.DISB_PULL_ANALYTICS;
const trip=(id,extra={})=>({id,code:id,unitId:'A',unitName:'Matriz',type:'PULL',status:'ARRIVED',plate:id,carrier:'Empresa',destination:'Fábrica',driver1Id:'d1',driver1Name:'Motorista 1',driver2Id:'d2',driver2Name:'Motorista 2',startedAt:'2026-11-03T09:00:00Z',arrivedFactoryAt:'2026-11-03T10:00:00Z',leftFactoryAt:'2026-11-03T12:00:00Z',endedAt:'2026-11-03T13:00:00Z',nextStartedAt:null,...extra});
test('waiting for the next departure is missing time, while a completed zero is valid',()=>{
 const report=api.build([trip('a'),trip('b',{nextStartedAt:'2026-11-03T13:00:00Z'})],{unitTargetMinutes:30},{year:'2026',month:'11'});
 assert.equal(report.metrics.unit.count,1);assert.equal(report.metrics.unit.missingCount,1);assert.equal(report.metrics.unit.averageMinutes,0);assert.equal(report.metrics.unit.adherencePercent,100);assert.equal(report.metrics.cycle.averageMinutes,240);
});
test('transfer applies only to complete cycle and cancelled rows do not enter indicators',()=>{
 const report=api.build([trip('t',{type:'TRANSFER'}),trip('c',{status:'CANCELLED'})],{cycleTargetMinutes:200},{year:'2026'});
 assert.equal(report.overview.total,1);assert.equal(report.metrics.tmvOut.notApplicableCount,1);assert.equal(report.metrics.tmvOut.missingCount,0);assert.equal(report.metrics.cycle.averageMinutes,240);assert.equal(report.metrics.cycle.adherencePercent,0);
});
test('monthly planner keeps the other months and all selected dimensions while local dates use UTC-3',()=>{
 const rows=[trip('a'),trip('b',{startedAt:'2026-10-31T10:00:00Z'}),trip('c',{startedAt:'2026-11-01T01:00:00Z'}),trip('d',{unitId:'B'})];
 const report=api.build(rows,{}, {year:'2026',month:'11',unitId:'A'});
 assert.equal(report.overview.total,1);assert.equal(report.monthly[9].total,2);assert.equal(report.monthly[10].total,1);assert.equal(report.monthly.length,12);assert.equal(report.metrics.factory.adherencePercent,null);
});
test('drivers are counted once per trip, and filters and weighted averages use individual trips',()=>{
 const rows=[trip('a',{driver2Id:'d1',driver2Name:'Motorista 1'}),trip('b',{driver1Id:'d3',driver1Name:'Outro',arrivedFactoryAt:'2026-11-03T12:00:00Z'})];
 const report=api.build(rows,{tmvOutTargetMinutes:60},{year:'2026'});assert.equal(report.metrics.tmvOut.averageMinutes,120);assert.equal(report.metrics.tmvOut.adherencePercent,50);assert.equal(report.breakdowns.driver.find(g=>g.key==='d1').total,1);
 assert.equal(api.build(rows,{}, {year:'2026',driverId:'d3'}).overview.total,1);
});
test('arrival medians, tied peaks, and empty hours retain all 24 bins',()=>{
 const stat=api.arrivalStats(['2026-11-03T09:10:00Z','2026-11-03T11:30:00Z']);assert.equal(stat.medianMinute,440);assert.equal(stat.bins.length,24);assert.deepEqual(Array.from(stat.peakHours),[6,8]);assert.equal(api.arrivalStats([]).medianMinute,null);
});
test('legacy metrics remain authoritative and CSV neutralizes formulas in external names',()=>{
 const metrics=api.metrics(trip('i',{imported:true,legacyMetrics:{cycle:30}}));assert.equal(metrics.cycle,30);assert.equal(metrics.factory,null);
 const csv=api.csv([['=HYPERLINK("x")','+CMD','@name','Texto; com acento ç']]);assert.ok(csv.startsWith('\ufeff'));assert.match(csv,/'=HYPERLINK/);assert.match(csv,/'\+CMD/);assert.match(csv,/'@name/);assert.match(csv,/Texto; com acento ç/);
});
