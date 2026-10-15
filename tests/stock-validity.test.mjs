import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function stock(){
  const window={};
  vm.runInNewContext(fs.readFileSync(new URL('../stock-validity.js',import.meta.url),'utf8'),
    {window,Date,TextDecoder},{timeout:3000});
  return window.DISB_STOCK_VALIDITY;
}

test('CSV Windows-1252 preserva descrições e lotes de validade do mesmo produto',async()=>{
  const api=stock();
  const source='LOCAL;RUA;PRODUTO;DESCRIÇÃO;QUANTIDADE;VENCIMENTO\r\n'+
    'ESTOQUE;C3;9276;PEPSI ZERO PET 2L CAIXA C/6;100;31/12/2026\r\n'+
    'PICKING;VIRTUAL;9276;PEPSI ZERO PET 2L CAIXA C/6;65;20/11/2026\r\n'+
    'ESTOQUE;CF;838;CHOPP BRAHMA CLARO BARRIL KEG 50L;14;20/10/2026\r\n';
  const bytes=Buffer.from(source,'latin1');
  const file={name:'estoque.csv',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  const parsed=await api.readFile(file);
  assert.equal(parsed.rows.length,3);
  assert.equal(parsed.productCount,2);
  assert.equal(parsed.rows[0].product_name,'PEPSI ZERO PET 2L CAIXA C/6');
  const products=api.products(parsed.rows,new Date('2026-10-15T12:00:00Z'));
  assert.equal(products[0].code,'838');
  assert.equal(products[0].days,5);
  assert.equal(products[1].expiry,'2026-11-20');
  assert.equal(products[1].quantity,165);
});

test('XLSX aceita a primeira aba com células de data e rejeita vencimento inválido',async()=>{
  const api=stock();
  const file={name:'estoque.xlsx',size:500};
  const parsed=await api.readFile(file,async()=>[
    ['CÓDIGO','NOME','VALIDADE'],
    [123,'PRODUTO TESTE',new Date('2027-02-01T00:00:00Z')]
  ]);
  assert.equal(parsed.rows[0].product_code,'123');
  assert.equal(parsed.rows[0].expiry_date,'2027-02-01');
  assert.equal(parsed.rows[0].quantity,null);
  assert.throws(()=>api.normalizeMatrix([
    ['PRODUTO','DESCRIÇÃO','VENCIMENTO'],
    ['123','PRODUTO TESTE','31/02/2027']
  ]),/Linha 2: vencimento inválido/);
});
