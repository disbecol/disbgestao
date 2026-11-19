(() => {
  'use strict';

  // Fonte: ativo.xlsx, aba Planilha1. Apenas os seis ativos já cadastrados.
  const conversions = [
    ['27983', '30491', 'CERVEJA 600ML', 24, 7, 6],
    ['786238', '30491', 'GFA VERDE 600ML', 24, 7, 6],
    ['28741', '296156', 'CERVEJA 300ML', 23, 10, 9],
    ['188006', '188005', 'CERVEJA 1 LITRO', 12, 10, 5],
    ['235894', '188005', 'GUARANA 1 LITRO', 12, 10, 5],
    ['29043', '188005', 'PEPSI 1 LITRO', 12, 10, 5],
  ];

  const key = row => [row.sap_code, row.asset_code, row.description || row.product_description]
    .map(value => String(value ?? '').trim().toUpperCase()).join('|');
  const byProduct = new Map(conversions.map(([sap_code, asset_code, description, unitsPerBox, boxesPerLayer, layersPerPallet]) => [
    key({ sap_code, asset_code, description }), { unitsPerBox, boxesPerLayer, layersPerPallet },
  ]));

  function normalize(row) {
    const factors = byProduct.get(key(row));
    if (!factors) return { ...row };
    const result = { ...row };
    let units = Number(result.units || 0);
    let boxes = Number(result.box_gfa || 0);
    let layers = Number(result.layer_gfa || 0);
    let pallets = Number(result.pallet_gfa || 0);
    boxes += Math.floor(units / factors.unitsPerBox);
    units %= factors.unitsPerBox;
    layers += Math.floor(boxes / factors.boxesPerLayer);
    boxes %= factors.boxesPerLayer;
    pallets += Math.floor(layers / factors.layersPerPallet);
    layers %= factors.layersPerPallet;
    return { ...result, units, box_gfa: boxes, layer_gfa: layers, pallet_gfa: pallets };
  }

  const api = { normalize };
  if (typeof window !== 'undefined') window.DISB_ASSET_CONVERSION = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
