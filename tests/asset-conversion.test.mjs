import test from 'node:test';
import assert from 'node:assert/strict';
import conversion from '../asset-conversion.js';

const beer = { sap_code: '27983', asset_code: '30491', description: 'CERVEJA 600ML' };

test('converte caixas e lastros do exemplo do conferente após a soma', () => {
  const result = conversion.normalize({ ...beer, pallet_gfa: 5, layer_gfa: 6, box_gfa: 7, units: 0, loose: 2 });
  assert.deepEqual([result.pallet_gfa, result.layer_gfa, result.box_gfa, result.units, result.loose], [6, 1, 0, 0, 2]);
});

test('converte unidades, caixas e lastros em cascata e preserva os restos', () => {
  const result = conversion.normalize({ ...beer, pallet_gfa: 0, layer_gfa: 5, box_gfa: 6, units: 25 });
  assert.deepEqual([result.pallet_gfa, result.layer_gfa, result.box_gfa, result.units], [1, 0, 0, 1]);
});

test('usa as proporções dos outros ativos presentes na planilha', () => {
  const cases = [
    ['786238', '30491', 'GFA VERDE 600ML', 24, 7, 6],
    ['28741', '296156', 'CERVEJA 300ML', 23, 10, 9],
    ['188006', '188005', 'CERVEJA 1 LITRO', 12, 10, 5],
    ['235894', '188005', 'GUARANA 1 LITRO', 12, 10, 5],
    ['29043', '188005', 'PEPSI 1 LITRO', 12, 10, 5],
  ];
  for (const [sap_code, asset_code, description, unitsPerBox, boxesPerLayer, layersPerPallet] of cases) {
    const result = conversion.normalize({ sap_code, asset_code, description, pallet_gfa: 0, layer_gfa: layersPerPallet - 1, box_gfa: boxesPerLayer - 1, units: unitsPerBox });
    assert.deepEqual([result.pallet_gfa, result.layer_gfa, result.box_gfa, result.units], [1, 0, 0, 0], description);
  }
});

test('não altera ativos fora das seis correspondências exatas', () => {
  const original = { sap_code: '', asset_code: '37108', description: 'CHAPATEX (UND)', pallet_gfa: 1, layer_gfa: 6, box_gfa: 7, units: 30, loose: 4 };
  assert.deepEqual(conversion.normalize(original), original);
  assert.deepEqual(conversion.normalize({ ...original, sap_code: '27983' }), { ...original, sap_code: '27983' });
});
