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
  assert.deepEqual(result.diffs.g300.sold,{containers:1,bottles:23,complete:1,looseBottles:0});
});

test('garrafas avulsas são descontadas do total estimado sem inventar contagem física',()=>{
  const conf={g300:15,g600_green:2,g600_brown:1,g_litrao:1,sales:[{type:'g300',mode:'bottle',quantity:3}]};
  assert.deepEqual(conference.bottlesFromCrates(conf),{gross:429,looseSales:3,estimated:426});
  const row=conference.compare([{...mapA,g300:15,g600_green:2,g600_brown:1,g_litrao:1}],{...conf,map_number:'122357'});
  assert.equal(row.diffs.g300.diff,0);
  assert.equal(row.diffs.g300.sold.bottles,3);
});

test('campos ausentes da planilha não geram divergência artificial',()=>{
  const row=conference.compare([mapA],{map_number:'122357',g300:5,g600_brown:17,chapatex:4,pbr1:2});
  assert.equal(row.diffs.chapatex.plan,null);
  assert.equal(row.diffs.chapatex.diff,null);
  assert.equal(row.status,'OK');
});
