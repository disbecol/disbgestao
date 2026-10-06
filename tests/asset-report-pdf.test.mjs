import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import PDFLib from '../vendor/pdf-lib.min.js';

test('Ativo de Giro reúne Pátio, Refugo e Total em um PDF A4', async () => {
  const window = {};
  vm.runInNewContext(readFileSync(new URL('../share-reports.js', import.meta.url), 'utf8'), { window });
  const image = `data:image/png;base64,${readFileSync(new URL('../assets/icon-192.png', import.meta.url)).toString('base64')}`;
  const bytes = await window.DISB_REPORT_IMAGES.assetPdf([
    { dataUrl: image }, { dataUrl: image }, { dataUrl: image },
  ], PDFLib);
  const pdf = await PDFLib.PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 3);
  for (const page of pdf.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1);
    assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
  }
});
