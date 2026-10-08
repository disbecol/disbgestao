import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const note=require('../invoice-note.js');

test('soma linhas repetidas da nota antes de converter para paletes',()=>{
  const rows=note.groupLines([
    {reference_code:'25078',description:'BRAHMA CHOPP 600ML',commercial_unit:'DZ',quantity:72},
    {reference_code:'25078',description:'BRAHMA CHOPP 600ML',commercial_unit:'DZ',quantity:408},
    {reference_code:'25078',description:'BRAHMA CHOPP 600ML',commercial_unit:'DZ',quantity:108},
    {reference_code:'26382',description:'ORIGINAL',commercial_unit:'CX',quantity:1397},
    {reference_code:'26382',description:'ORIGINAL',commercial_unit:'CX',quantity:313}
  ]);
  const matched=note.matchProducts(rows,[
    {code:'988',name:'BRAHMA CHOPP 600ML',nf_reference_code:'25078',commercial_units_per_pallet:84},
    {code:'20217',name:'ORIGINAL',nf_reference_code:'26382',commercial_units_per_pallet:90}
  ]);
  assert.deepEqual(matched.map(x=>[x.product_code,x.quantity,x.full_pallets,x.remaining_units]),[
    ['988',588,7,0],['20217',1710,19,0]
  ]);
});

test('mantém um palete parcial separado e exige referência cadastrada',()=>{
  const rows=[{reference_code:'123',description:'Produto',commercial_unit:'CX',quantity:205}];
  assert.deepEqual(note.matchProducts(rows,[{code:'55',name:'Produto',nf_reference_code:'123',commercial_units_per_pallet:100}]).map(x=>[x.full_pallets,x.remaining_units]),[[2,5]]);
  assert.throws(()=>note.matchProducts(rows,[]),/123.*não encontrado/);
});

test('não soma o mesmo produto em unidades comerciais incompatíveis',()=>{
  assert.throws(()=>note.groupLines([
    {reference_code:'25078',commercial_unit:'DZ',quantity:12},
    {reference_code:'25078',commercial_unit:'UN',quantity:24}
  ]),/unidades comerciais diferentes/);
});

test('usa a referência da unidade de origem sem duplicar o produto',()=>{
  const product={code:'988',name:'BRAHMA CHOPP',nf_reference_code:'25078',nf_reference_code_filial:'FIL-988',commercial_units_per_pallet:84};
  const row=reference_code=>[{reference_code,description:'BRAHMA CHOPP',commercial_unit:'DZ',quantity:168}];
  assert.equal(note.matchProducts(row('25078'),[product],'Matriz Caicó')[0].product_code,'988');
  assert.equal(note.matchProducts(row('FIL-988'),[product],'Filial Pau dos Ferros')[0].product_code,'988');
  assert.throws(()=>note.matchProducts(row('25078'),[product],'Filial Pau dos Ferros'),/não encontrado/);
});
