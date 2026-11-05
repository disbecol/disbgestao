import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import PDFLib from '../vendor/pdf-lib.min.js';
import { createDamageReceiptPdf } from '../supabase/functions/send-damage-receipt/receipt-pdf.mjs';

// Exemplo fictício: pode ser usado como amostra do modelo na Meta.
const damage = {
  customer_code: '000', customer_name: 'COMÉRCIO EXEMPLO', map_number: '123456',
  occurrence_date: '2026-11-05', created_at: '2026-11-05T13:15:00Z',
};
const items = [
  { product_text: '33734 - BEATS RED MIX LATA 269ML SH C/8', quantity: 13, quantity_unit: 'UNIDADE' },
  { product_text: '988 - BRAHMA CHOPP 600ML', quantity: 2, quantity_unit: 'CAIXA' },
];
const images = new Map();
for (const code of ['33734', '988']) images.set(code, new Uint8Array(await readFile(new URL(`../imagens_produtos/${code}.jpg`, import.meta.url))));
const out = path.resolve(process.argv[2] || 'output/pdf/comprovante-avaria-exemplo.pdf');
await mkdir(path.dirname(out), { recursive: true });
const signature=new Uint8Array(await readFile(new URL('../tests/fixtures/receipt-signature.png',import.meta.url)));
const bytes = await createDamageReceiptPdf(damage, items, PDFLib, images, {code:'DGB-11111111-22224444-88889999-AAAAAAAA',signature});
await writeFile(out, bytes);
console.log(JSON.stringify({ path: out, bytes: bytes.length }));
