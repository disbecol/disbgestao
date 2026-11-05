import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import PDFLib from '../vendor/pdf-lib.min.js';
import { createDamageReceiptPdf as renderPdf, loadReceiptCatalogImages, receiptFileName, receiptGreeting, receiptProduct, receiptQuantity, receiptTemplateComponents } from '../supabase/functions/send-damage-receipt/receipt-pdf.mjs';

const signature=new Uint8Array(await readFile(new URL('./fixtures/receipt-signature.png',import.meta.url)));
const verification={code:'DGB-11111111-22224444-88889999-AAAAAAAA',signature};
const createDamageReceiptPdf=(d,i,l,m)=>renderPdf(d,i,l,m,verification);
const damage = { customer_code: '371', customer_name: 'Comércio Teste', map_number: '131313', occurrence_date: '2026-11-04', created_at: '2026-11-04T20:30:00Z' };
const item = { product_text: '988 - BRAHMA CHOPP 600ML', quantity: 13, quantity_unit: 'UNIDADE' };

test('PDF real em A4 inclui imagem do catálogo e assinatura na mesma folha', async () => {
  const jpg = new Uint8Array(await readFile(new URL('../imagens_produtos/988.jpg', import.meta.url)));
  const bytes = await createDamageReceiptPdf(damage, [item], PDFLib, new Map([['988', jpg]]));
  const pdf = await PDFLib.PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getTitle(), 'Comprovante de avaria - Disbecol');
  assert.ok(pdf.getPage(0).node.Resources().lookup(PDFLib.PDFName.of('XObject')).keys().length > 0);
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - 595.28) < .01);
  const many = await PDFLib.PDFDocument.load(await createDamageReceiptPdf(damage, Array.from({ length: 8 }, (_, i) => ({ ...item, product_text: `${i + 1} - Produto de descrição extensa para verificar a continuidade de cada registro`, quantity: i + 1 })), PDFLib));
  assert.equal(many.getPageCount(), 1);
  for (const page of many.getPages()) assert.ok(Math.abs(page.getHeight() - 841.89) < .01);
});

test('não omite produtos para forçar uma folha e exige assinatura e código',async()=>{
 await assert.rejects(()=>createDamageReceiptPdf(damage,[{...item,product_text:'Descricao '.repeat(450)}],PDFLib),/LAYOUT_TOO_LARGE/);
 await assert.rejects(()=>createDamageReceiptPdf(damage,[],PDFLib),/RECEIPT_CANCELLED/);
 await assert.rejects(()=>renderPdf(damage,[item],PDFLib),/CODE_INVALID/);
 await assert.rejects(()=>renderPdf(damage,[item],PDFLib,new Map(),{code:verification.code}),/SIGNATURE_MISSING/);
 assert.throws(()=>receiptQuantity({quantity:NaN}),/QUANTITY_INVALID/);
});

test('saudação usa fuso brasileiro nos limites e na mudança de dia UTC', () => {
  assert.equal(receiptGreeting('2026-11-05T14:59:59Z'), 'bom dia');
  assert.equal(receiptGreeting('2026-11-05T15:00:00Z'), 'boa tarde');
  assert.equal(receiptGreeting('2026-11-05T20:59:59Z'), 'boa tarde');
  assert.equal(receiptGreeting('2026-11-05T21:00:00Z'), 'boa noite');
  assert.equal(receiptGreeting('2026-11-06T01:00:00Z'), 'boa noite');
  assert.equal(receiptGreeting('2026-11-06T03:00:00Z'), 'bom dia');
  assert.throws(() => receiptGreeting('invalid'), /DATE_INVALID/);
  assert.equal(receiptTemplateComponents(damage, '123', 'recibo.pdf')[1].parameters[1].text, '04/11/2026');
});

test('arquivo e imagem não aceitam caminhos fornecidos pelo cliente ou pelo motorista', async () => {
  const requests = [];
  const result = await loadReceiptCatalogImages([
    { ...item, photo_path: 'private/segredo.jpg' },
    { ...item, photo_path: 'https://127.0.0.1/admin' },
    { ...item, product_text: '../../private/segredo.jpg' },
  ], async (url, options) => { requests.push({ url, options }); return new Response(null, { status: 404 }); });
  assert.equal(result.size, 0);
  assert.deepEqual(requests.map(r => r.url), ['jpg', 'png', 'jpeg'].map(ext => `https://disbecol.github.io/disbgestao/imagens_produtos/988.${ext}`));
  assert.ok(requests.every(r => r.options.redirect === 'error' && !r.options.headers));
  assert.equal(receiptProduct('988 - BRAHMA').code, '988');
  assert.equal(receiptProduct('Produto sem código').name, 'Produto sem código');
  assert.ok(!receiptFileName({ ...damage, customer_code: '../../371' }).includes('..'));
});

test('falha e MIME incorreto no catálogo não bloqueiam o comprovante', async () => {
  let calls = 0;
  const result = await loadReceiptCatalogImages([item], async () => {
    calls++;
    if (calls === 1) throw new Error('timeout');
    return new Response('<html>not an image</html>', { headers: { 'Content-Type': 'text/html' } });
  });
  assert.equal(result.size, 0);
  assert.equal(calls, 3);
  assert.equal((await PDFLib.PDFDocument.load(await createDamageReceiptPdf(damage, [item], PDFLib, result))).getPageCount(), 1);
});
