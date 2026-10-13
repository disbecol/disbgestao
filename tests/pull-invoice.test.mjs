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

test('atribui lotes por paletes até completar a nota e preserva o palete parcial',()=>{
  const item={quantity:205,commercial_units_per_pallet:100};
  assert.deepEqual(note.planPalletAllocation(item,[],2),[{quantity:100,pallets:2}]);
  const first=[{quantity:100,pallets:2}];
  assert.deepEqual(note.palletAllocationState(item,first).remainingPallets,1);
  assert.deepEqual(note.planPalletAllocation(item,first,1),[{quantity:5,pallets:1}]);
  assert.deepEqual(note.planPalletAllocation(item,[],3),[{quantity:100,pallets:2},{quantity:5,pallets:1}]);
  assert.throws(()=>note.planPalletAllocation(item,first,2),/entre 1 e 1/);
  assert.equal(note.palletAllocationState(item,[...first,{quantity:5,pallets:1}]).remainingPallets,0);
});

test('soma o mesmo produto em duas NFs do ciclo antes de calcular os paletes',()=>{
  const item={product_code:'988',product_name:'BRAHMA CHOPP',commercial_unit:'DZ',commercial_units_per_pallet:84};
  const notes=[
    {invoice_number:'101',items:[{...item,quantity:70},{product_code:'20217',product_name:'ORIGINAL',commercial_unit:'CX',commercial_units_per_pallet:90,quantity:90}]},
    {invoice_number:'102',items:[{...item,quantity:98}]}
  ];
  const combined=note.combineInvoices(notes);
  assert.deepEqual(combined.map(x=>[x.product_code,x.quantity,x.full_pallets,x.remaining_units,x.invoice_numbers]),[
    ['988',168,2,0,['101','102']],['20217',90,1,0,['101']]
  ]);
  assert.equal(note.palletAllocationState(combined[0]).totalPallets,2);
  assert.deepEqual(note.combineInvoices([]),[]);
});

test('impede misturar capacidades diferentes para o mesmo produto entre NFs',()=>{
  assert.throws(()=>note.combineInvoices([
    {items:[{product_code:'988',commercial_unit:'DZ',commercial_units_per_pallet:84,quantity:84}]},
    {items:[{product_code:'988',commercial_unit:'DZ',commercial_units_per_pallet:90,quantity:90}]}
  ]),/capacidade por palete diferente/);
});

test('converte litros da NF de chopp 50 L em barris antes de calcular NRIs',()=>{
  const product={code:'838',name:'CHOPP BRAHMA CLARO BARRIL KEG 50L',nf_reference_code:'25066',invoice_unit:'L',invoice_liters_per_unit:50,commercial_units_per_pallet:16};
  const rows=note.groupLines([
    {reference_code:'25066',description:'CHOPP BRAHMA CLARO BARRIL KEG 50L',commercial_unit:'L',quantity:500},
    {reference_code:'25066',description:'CHOPP BRAHMA CLARO BARRIL KEG 50L',commercial_unit:'LT',quantity:200}
  ]);
  const [item]=note.matchProducts(rows,[product]);
  assert.deepEqual([item.source_quantity,item.source_unit,item.quantity,item.commercial_unit,item.full_pallets,item.remaining_units],[700,'L',14,'UN',0,14]);
  assert.equal(note.palletAllocationState(item).totalPallets,1);
  assert.throws(()=>note.matchProducts([{...rows[0],quantity:715}],[product]),/barris inteiros/);
});

test('converte chopp de 30 L e preserva a soma de NFs em barris',()=>{
  const product={code:'828',name:'CHOPP BRAHMA CLARO BARRIL KEG 30L',nf_reference_code:'25064',invoice_unit:'L',invoice_liters_per_unit:30,commercial_units_per_pallet:12};
  const item=note.matchProducts([{reference_code:'25064',description:product.name,commercial_unit:'L',quantity:390}],[product])[0];
  assert.deepEqual([item.quantity,item.full_pallets,item.remaining_units],[13,1,1]);
  const combined=note.combineInvoices([{invoice_number:'1',items:[item]},{invoice_number:'2',items:[{...item,quantity:11}]}]);
  assert.deepEqual([combined[0].quantity,combined[0].full_pallets,combined[0].remaining_units],[24,2,0]);
});
