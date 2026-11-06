import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const note=createRequire(import.meta.url)('../invoice-note.js');

function harness(){
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const source=app.replace(/\}\)\(\);\s*$/,`window.invoiceTest={plan:invoiceBatchDraftRows,values:invoiceLotValues,fields:invoiceLotFields,mask:maskFefoDate};})();`);
  assert.notEqual(source,app);
  let id=0;
  const window={addEventListener(){},DISB_INVOICE_NOTE:note};
  vm.runInNewContext(source,{window,document:{addEventListener(){}},navigator:{},crypto:{randomUUID:()=>`id-${++id}`},setInterval(){},setTimeout(){}},{timeout:3000});
  const api=window.invoiceTest;
  return {...api,plan:(...args)=>JSON.parse(JSON.stringify(api.plan(...args)))};
}
const item={product_code:'33857',product_name:'STELLA 600ML',commercial_unit:'CX',commercial_units_per_pallet:100,quantity:350,invoice_numbers:['1136623']};
const entry=(lot,pallets,validity='2027-10-12')=>({lot,pallets,validity});
const row=(values)=>({querySelector(selector){return {
  '[data-invoice-lot]':{value:values.lot??'L1'},
  '[data-invoice-no-validity]':{checked:values.withoutValidity??false},
  '[data-invoice-validity]':{value:values.date??'12/10/2027'},
  '[data-invoice-pallets]':{value:values.pallets??'1'}
}[selector];}});

test('salva vários lotes e separa o último palete parcial sem mudar o total da nota',()=>{
  const {plan}=harness();
  const rows=plan(item,[],[entry('L1',2),entry('L2',2,'2028-02-29')]);
  assert.deepEqual(rows.map(x=>[x.lot,x.validity_date,x.quantity,x.pallets]),[
    ['L1','2027-10-12',100,2],['L2','2028-02-29',100,1],['L2','2028-02-29',50,1]
  ]);
  assert.equal(rows[1].invoice_allocation_id,rows[2].invoice_allocation_id);
  assert.notEqual(rows[0].invoice_allocation_id,rows[1].invoice_allocation_id);
  assert.equal(rows.reduce((sum,x)=>sum+x.quantity*x.pallets,0),350);
  assert.equal(note.palletAllocationState(item,rows).remainingPallets,0);
});

test('a soma de vários lotes e os lotes já atribuídos respeitam o limite da nota',()=>{
  const {plan}=harness(),existing=[{id:'old',lot:'ANTERIOR',quantity:100,pallets:2}];
  const before=JSON.stringify(existing);
  assert.throws(()=>plan(item,existing,[entry('L1',1),entry('L2',2)]),/entre 1 e 1/);
  assert.equal(JSON.stringify(existing),before,'a falha não altera o rascunho existente');
  assert.deepEqual(plan(item,existing,[entry('L1',1),entry('L2',1)]).map(x=>[x.quantity,x.pallets]),[[100,1],[50,1]]);
});

test('não aceita quantidade vazia, negativa, fracionada ou acima do disponível',()=>{
  const {plan}=harness();
  for(const count of ['',0,-1,1.5,5,NaN])assert.throws(()=>plan(item,[],[entry('L1',count)]),/palete/);
});

test('editar o lote preserva a avaria e permite acrescentar outro lote na mesma operação',()=>{
  const {plan}=harness(),group=[{id:'original',invoice_allocation_id:'grupo',quantity:100,pallets:1,pallet_damaged:true,damaged_pallets:1,damagePhotos:['foto'],damage_reason:'Rasgado'}];
  const result=plan(item,[],[entry('CORRIGIDO',1),entry('NOVO',3)],group,'grupo');
  assert.equal(result[0].id,'original');
  assert.equal(result[0].invoice_allocation_id,'grupo');
  assert.equal(result[0].lot,'CORRIGIDO');
  assert.equal(result[0].pallet_damaged,true);
  assert.deepEqual(result[0].damagePhotos,['foto']);
  assert.notEqual(result[1].invoice_allocation_id,'grupo');
  assert.equal(result[1].pallet_damaged,false);
  assert.throws(()=>plan(item,[],[entry('L1',2),entry('L2',2)],group,'grupo'),/Remova a avaria/);
});

test('valida a data digitada, incluindo anos bissextos e formato de quatro dígitos',()=>{
  const {values,mask,fields}=harness();
  assert.equal(values(row({date:'29/02/2028'})).validity,'2028-02-29');
  assert.equal(mask('12102027'),'12/10/2027');
  for(const date of ['31/02/2027','29/02/2027','31/04/2027','00/10/2027','12/13/2027','12/10/27','2027-10-12','']){
    assert.throws(()=>values(row({date})),/validade válida/);
  }
  assert.equal(values(row({date:'',withoutValidity:true})).validity,null);
  assert.match(fields('L1','2028-02-29',1,4,false,2),/value="29\/02\/2028"/);
  assert.doesNotMatch(fields(),/type="date"/);
});

test('aceita atribuição parcial para continuar depois sem obrigar completar a nota na janela',()=>{
  const {plan}=harness();
  const rows=plan(item,[],[entry('L1',1,null),entry('L2',1)]);
  assert.equal(rows[0].validity_date,null);
  assert.equal(rows[0].block_date,null);
  assert.equal(note.palletAllocationState(item,rows).remainingPallets,2);
});
