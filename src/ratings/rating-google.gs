const RATING_SPREADSHEET_ID = '1hYle_7TyEitARZOYgYPoO5hUcxHsj0xxhTP7YCccGTM';
const RATING_SHEETS = {
  'Matriz Caicó': 'RATING - MATRIZ',
  'Filial Pau dos Ferros': 'RATING - FILIAL'
};
const RATING_FIELDS = {
  date: ['data da avaliacao', 'data avaliacao'],
  code: ['codigo do pdv', 'cod pdv'],
  name: ['nome pdv'],
  city: ['cidade'],
  driver: ['motorista'],
  motive: ['motivo'],
  comment: ['comentario']
};

function configureRatingBridgeSecret() {
  const secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('RATING_BRIDGE_SECRET', secret);
  console.log('RATING_BRIDGE_SECRET=' + secret);
}

function doPost(event) {
  try {
    const request = JSON.parse(event?.postData?.contents || '{}');
    const configuredSecret = PropertiesService.getScriptProperties().getProperty('RATING_BRIDGE_SECRET');
    if (!configuredSecret || request.secret !== configuredSecret) return output({ ok: false, error: 'UNAUTHORIZED' });
    const sheetName = RATING_SHEETS[String(request.unit || '')];
    if (!sheetName) return output({ ok: false, error: 'INVALID_UNIT' });
    if (request.action === 'list') return output({ ok: true, rows: listRows(sheetName) });
    if (request.action === 'save') return output(saveComment(sheetName, request));
    return output({ ok: false, error: 'INVALID_ACTION' });
  } catch (error) {
    console.error(error);
    return output({ ok: false, error: String(error?.message || error) });
  }
}

function output(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizedHeader(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function columnIndexes(headers) {
  const normalized = headers.map(normalizedHeader);
  const indexes = {};
  for (const [field, labels] of Object.entries(RATING_FIELDS)) {
    const matches = normalized.reduce((found, value, index) => {
      if (labels.includes(value)) found.push(index);
      return found;
    }, []);
    if (matches.length !== 1) throw new Error('INVALID_HEADERS');
    indexes[field] = matches[0];
  }
  return indexes;
}

function ratingSheet(sheetName) {
  const spreadsheet = SpreadsheetApp.openById(RATING_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('SHEET_NOT_FOUND');
  return sheet;
}

function listRows(sheetName) {
  const sheet = ratingSheet(sheetName);
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) throw new Error('INVALID_HEADERS');
  const columns = columnIndexes(values[0]);
  return values.slice(1).flatMap((cells, index) => {
    const row = {
      rowNumber: index + 2,
      date: cells[columns.date] || '',
      code: cells[columns.code] || '',
      name: cells[columns.name] || '',
      city: cells[columns.city] || '',
      driver: cells[columns.driver] || '',
      motive: cells[columns.motive] || '',
      comment: cells[columns.comment] || '',
      fingerprint: rowFingerprint(cells)
    };
    return row.date || row.code || row.name ? [row] : [];
  });
}

function rowFingerprint(cells) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(cells),
    Utilities.Charset.UTF_8
  ).map(value => (value + 256).toString(16).slice(-2)).join('');
}

function saveComment(sheetName, request) {
  const rowNumber = Number(request.rowNumber);
  const comment = String(request.comment ?? '');
  const expected = request.expected || {};
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || comment.length > 5000
      || !/^[0-9a-f]{64}$/.test(String(expected.fingerprint || ''))) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const sheet = ratingSheet(sheetName);
  const lastColumn = sheet.getLastColumn();
  const columns = columnIndexes(sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]);
  if (rowNumber > sheet.getLastRow()) return { ok: false, error: 'ROW_CHANGED' };
  const cells = sheet.getRange(rowNumber, 1, 1, lastColumn).getDisplayValues()[0];
  if (rowFingerprint(cells) !== expected.fingerprint) return { ok: false, error: 'ROW_CHANGED' };
  const safeComment = comment.startsWith('=') ? "'" + comment : comment;
  sheet.getRange(rowNumber, columns.comment + 1).setValue(safeComment);
  SpreadsheetApp.flush();
  const updatedCells = sheet.getRange(rowNumber, 1, 1, lastColumn).getDisplayValues()[0];
  return { ok: true, comment, fingerprint: rowFingerprint(updatedCells) };
}
