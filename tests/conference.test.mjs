import test from 'node:test';
import assert from 'node:assert/strict';
import conference from '../conference.js';

const mapA={map_number:'122357',map_date:'2026-10-09',city:'CURRAIS NOVOS',g300:5,g600_green:0,g600_brown:17,g_litrao:0,keg30:0,keg50:0};
const mapB={map_number:'122358',map_date:'2026-10-09',city:'DROP',g300:18,g600_green:2,g600_brown:20,g_litrao:1,keg30:0,keg50:0};

test('dois mapas somam a base antes de calcular a diferença',()=>{
  const row=conference.compare([mapA,mapB],{map_number:'122357',map_numbers:['122357','122358'],g300:23,g600_green:2,g600_brown:37,g_litrao:1});
  assert.equal(row.status,'OK');
  assert.equal(row.diffs.g300.plan,23);
  assert.equal(row.diffs.g600_brown.plan,37);
  assert.equal(row.divCount,0);
});

test('não compara uma carga de dois mapas quando falta uma base',()=>{
  const row=conference.compare([mapA],{map_number:'122357',map_numbers:['122357','122358'],g300:23});
  assert.equal(row.status,'SEM_BASE');
  assert.deepEqual(row.missing,['122358']);
  assert.equal(row.diffs.g300.diff,null);
});

test('três ou mais mapas são somados no mesmo lançamento',()=>{
  const third={...mapB,map_number:'122359',g300:7};
  const row=conference.compare([mapA,mapB,third],{map_number:'122357',map_numbers:['122357','122358','122359'],g300:30,g600_green:4,g600_brown:57,g_litrao:2});
  assert.equal(row.status,'OK');
  assert.equal(row.diffs.g300.plan,30);
});

test('venda de garrafeira completa abate garrafeira e garrafas',()=>{
  const result=conference.compare([{...mapA,g300:15}],{map_number:'122357',g300:14,sales:[{type:'g300',mode:'both',quantity:1}]});
  assert.equal(result.diffs.g300.diff,0);
  assert.equal(result.diffs.g300.planBottles,345);
  assert.equal(result.diffs.g300.expectedBottles,322);
  assert.equal(result.diffs.g300.actualBottles,322);
  assert.deepEqual(result.diffs.g300.sold,{containers:1,bottles:23,complete:1,looseBottles:0});
});

test('garrafas avulsas são descontadas do total estimado sem inventar contagem física',()=>{
  const conf={g300:15,g600_green:2,g600_brown:1,g_litrao:1,sales:[{type:'g300',mode:'bottle',quantity:3}]};
  assert.deepEqual(conference.bottlesFromCrates(conf),{gross:429,emptyCrateBottles:0,looseSales:3,estimated:426});
  const row=conference.compare([{...mapA,g300:15,g600_green:2,g600_brown:1,g_litrao:1}],{...conf,map_number:'122357'});
  assert.equal(row.diffs.g300.diff,0);
  assert.equal(row.diffs.g300.expectedBottles,342);
  assert.equal(row.diffs.g300.actualBottles,342);
  assert.equal(row.diffs.g300.sold.bottles,3);
});

test('venda de garrafeira vazia desconta só a garrafeira',()=>{
  const conf={map_number:'122357',g300:184,sales:[{type:'g300',mode:'crate',quantity:1}]};
  const row=conference.compare([{...mapA,g300:185}],conf).diffs.g300;
  assert.equal(row.planBottles,4255);
  assert.equal(row.expected,184);
  assert.equal(row.expectedBottles,4255);
  assert.equal(row.actualBottles,4255);
  assert.equal(row.diff,0);
  assert.equal(row.diffUnits,0);
  assert.equal(conference.bottlesFromCrates(conf).estimated,4255);
});

test('venda avulsa desconta só garrafas e a completa desconta ambos',()=>{
  const base={...mapA,g300:185};
  const bottle=conference.compare([base],{map_number:'122357',g300:185,sales:[{type:'g300',mode:'bottle',quantity:15}]}).diffs.g300;
  assert.equal(bottle.expected,185);
  assert.equal(bottle.expectedBottles,4240);
  assert.equal(bottle.actualBottles,4240);
  const both=conference.compare([base],{map_number:'122357',g300:184,sales:[{type:'g300',mode:'both',quantity:1}]}).diffs.g300;
  assert.equal(both.expected,184);
  assert.equal(both.expectedBottles,4232);
  assert.equal(both.actualBottles,4232);
});

test('divergência cobra garrafeira e garrafa separadamente com os valores corretos',()=>{
  const result=conference.compare([{...mapA,g300:185,g600_green:0}],{map_number:'122357',g300:100,g600_brown:17,sales:[{type:'g300',mode:'bottle',quantity:15},{type:'g300',mode:'crate',quantity:1}]});
  const row=result.diffs.g300;
  assert.equal(row.expected,184);
  assert.equal(row.expectedBottles,4240);
  assert.equal(row.actualBottles,2308);
  assert.equal(row.diff,-84);
  assert.equal(row.diffUnits,-1932);
  assert.equal(row.containerValue,5838);
  assert.equal(row.bottleValue,2898);
  assert.equal(row.value,8736);
  assert.equal(result.neg,8736);
});

test('valores unitários incluem garrafa verde, Chapatex e PBR quando a base existir',()=>{
  const map={...mapA,g600_green:2,chapatex:3,pbr1:2,pbr2:1};
  const result=conference.compare([map],{map_number:'122357',g300:5,g600_brown:17,g600_green:1,chapatex:2,pbr1:1,pbr2:0});
  assert.equal(result.diffs.g600_green.bottleValue,48);
  assert.equal(result.diffs.chapatex.value,8);
  assert.equal(result.diffs.pbr1.value,45);
  assert.equal(result.diffs.pbr2.value,45);
});

test('campos ausentes da planilha não geram divergência artificial',()=>{
  const row=conference.compare([mapA],{map_number:'122357',g300:5,g600_brown:17,chapatex:50,pbr1:2,pbr2:6});
  assert.equal(row.diffs.chapatex.plan,null);
  assert.equal(row.diffs.chapatex.diff,null);
  assert.equal(row.diffs.chapatex.checkedValue,400);
  assert.equal(row.diffs.pbr1.checkedValue,90);
  assert.equal(row.diffs.pbr2.checkedValue,270);
  assert.equal(row.pos,0);
  assert.equal(row.neg,0);
  assert.equal(row.status,'OK');
});
