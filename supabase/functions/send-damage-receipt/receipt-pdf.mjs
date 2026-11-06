// O PDF inclui os dados do comprovante e a assinatura já registrada pelo cliente.
// Fotos de evidência, localização, motivo e decisões internas são excluídos.
export const RECEIPT_NOTE = 'O produto avariado será enviado junto ao próximo pedido realizado pelo cliente.';
export const RECEIPT_SUPPORT = 'Em caso de dúvidas, entre em contato com nossa central de atendimento.';
export const CATALOG_IMAGE_BASE = 'https://disbecol.github.io/disbgestao/imagens_produtos/';

export const cleanReceiptText = value => String(value ?? '').normalize('NFC')
  .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
  .replace(/\s+/g, ' ').trim();

export function receiptDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export function receiptGreeting(createdAt) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) throw new Error('RECEIPT_DATE_INVALID');
  const hour = Number(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23',
  }).format(date));
  return hour < 12 ? 'bom dia' : hour < 18 ? 'boa tarde' : 'boa noite';
}

export function receiptProduct(value) {
  const text = cleanReceiptText(value);
  const match = text.match(/^(\d{1,12})\s*[-–—•·]\s*(.+)$/);
  return match ? { code: match[1], name: match[2] } : { code: '', name: text };
}

export function receiptQuantity(item) {
  const value = Number(item.quantity);
  if (!Number.isFinite(value) || value < 0) throw new Error('RECEIPT_QUANTITY_INVALID');
  const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);
  const unit = item.quantity_unit === 'CAIXA' ? (value === 1 ? 'caixa' : 'caixas')
    : (value === 1 ? 'unidade' : 'unidades');
  return `${number} ${unit}`;
}

export function receiptFileName(damage) {
  const code = String(damage.customer_code || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30) || 'cliente';
  const date = String(damage.occurrence_date || '').slice(0, 10).replace(/[^0-9-]/g, '');
  return `Comprovante_avaria_PDV_${code}_${date}.pdf`;
}

export function receiptTemplateComponents(damage, mediaId, filename) {
  if (!mediaId) throw new Error('RECEIPT_MEDIA_INVALID');
  const date = receiptDate(damage.occurrence_date);
  if (!date) throw new Error('RECEIPT_DATE_INVALID');
  return [
    { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename } }] },
    { type: 'body', parameters: [receiptGreeting(damage.created_at), date].map(text => ({ type: 'text', text })) },
  ];
}

// Apenas arquivos do catálogo oficial, com nome numérico; nunca usa photo_path.
export async function loadReceiptCatalogImages(items, fetcher = fetch) {
  const codes = [...new Set(items.map(item => receiptProduct(item.product_text).code).filter(Boolean))];
  const result = new Map();
  const deadline = Date.now() + 4500;
  let cursor = 0, totalBytes = 0;
  async function worker() {
    while (cursor < codes.length && Date.now() < deadline) {
      const code = codes[cursor++];
      for (const ext of ['jpg', 'png', 'jpeg']) {
        try {
          if (Date.now() >= deadline || totalBytes >= 3000000) break;
          const response = await fetcher(`${CATALOG_IMAGE_BASE}${code}.${ext}`, {
            signal: AbortSignal.timeout(Math.max(1, Math.min(2000, deadline - Date.now()))), redirect: 'error',
          });
          if (!response.ok) { await response.body?.cancel(); continue; }
          if (!/^image\/(jpeg|png)(?:;|$)/i.test(response.headers.get('content-type') || '')
              || Number(response.headers.get('content-length') || 0) > 1500000) {
            await response.body?.cancel(); continue;
          }
          const chunks = [], reader = response.body?.getReader();
          if (!reader) continue;
          let length = 0;
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.length;
            if (length > 1500000) { await reader.cancel(); throw new Error('CATALOG_IMAGE_TOO_LARGE'); }
            chunks.push(part.value);
          }
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
          if (length && totalBytes + length <= 3000000) { result.set(code, bytes); totalBytes += length; }
          break;
        } catch { /* Imagem opcional: o comprovante continua disponível. */ }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, codes.length) }, worker));
  return result;
}

export const receiptCode = value => {
  const code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^DGB[0-9A-F]{32}$/.test(code)) throw new Error('RECEIPT_CODE_INVALID');
  return 'DGB-' + code.slice(3).match(/.{8}/g).join('-');
};
export async function receiptSha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export function receiptSnapshot(damage, items, signatureHash) {
  return { version: 1, customer_code: cleanReceiptText(damage.customer_code),
    customer_name: cleanReceiptText(damage.customer_name), map_number: cleanReceiptText(damage.map_number),
    occurrence_date: String(damage.occurrence_date).slice(0, 10), created_at: damage.created_at,
    note: RECEIPT_NOTE, signature_sha256: signatureHash,
    items: items.map(item => ({ product_text: cleanReceiptText(item.product_text),
      quantity: Number(item.quantity), quantity_unit: item.quantity_unit })) };
}
// Exatamente uma folha A4. Nunca corta itens, assinatura ou identificador para caber.
export async function createDamageReceiptPdf(damage, items, PDFLib, images = new Map(), verification = {}) {
  if (!items.length) throw new Error('RECEIPT_CANCELLED');
  const code = receiptCode(verification.code);
  if (!verification.signature?.length) throw new Error('RECEIPT_SIGNATURE_MISSING');
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdf = await PDFDocument.create();
  pdf.setTitle('Comprovante de avaria - Disbecol');
  pdf.setAuthor('Equipe de Logística da Disbecol');
  pdf.setSubject(`Comprovante ${code}`);pdf.setCreator('Disb Gestão');
  const created = new Date(verification.generatedAt || damage.created_at);
  if (Number.isFinite(created.getTime())) { pdf.setCreationDate(created); pdf.setModificationDate(created); }
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const colors = { blue: rgb(.06,.32,.66), navy: rgb(.08,.17,.28), muted: rgb(.35,.43,.52),
    line: rgb(.82,.87,.93), pale: rgb(.96,.98,1), white: rgb(1,1,1), note: rgb(1,.98,.93) };
  const width=595.28, height=841.89, left=36, cw=width-72;
  const page=pdf.addPage([width,height]);
  const safe=value=>Array.from(cleanReceiptText(value)).map(c=>{try{regular.encodeText(c);return c;}catch{return '?';}}).join('');
  const text=(value,x,top,size=10,font=regular,color=colors.navy)=>page.drawText(safe(value),{x,y:top-size,size,font,color});
  function wrap(value,maxWidth,size=10,font=regular) {
    const lines=[];let line='';
    for(let word of safe(value).split(' ')) {
      if(line&&font.widthOfTextAtSize(`${line} ${word}`,size)>maxWidth){lines.push(line);line='';}
      while(font.widthOfTextAtSize(word,size)>maxWidth){let end=1;while(end<word.length&&font.widthOfTextAtSize(word.slice(0,end+1),size)<=maxWidth)end++;if(line){lines.push(line);line='';}lines.push(word.slice(0,end));word=word.slice(end);}
      line=line?`${line} ${word}`:word;
    }
    if(line)lines.push(line);return lines.length?lines:[''];
  }
  const box=(top,h,color=colors.pale)=>page.drawRectangle({x:left,y:top-h,width:cw,height:h,color,borderColor:colors.line,borderWidth:.6});
  let signature;
  try { signature=verification.signature[0]===0x89?await pdf.embedPng(verification.signature):await pdf.embedJpg(verification.signature); }
  catch { throw new Error('RECEIPT_SIGNATURE_INVALID'); }
  const customer=wrap(damage.customer_name,cw-24,11,bold);
  const headerHeight=80+(customer.length-1)*13;
  const note=wrap(RECEIPT_NOTE,cw-24,9), noteHeight=27+note.length*12;
  const productTop=672-headerHeight-22, productsBottom=68+85+noteHeight+27;
  let layout;
  for(const size of [10,9,8]) {
    const withImages=size===10&&items.length<=5;
    const rows=items.map(item=>{
      const product=receiptProduct(item.product_text),lines=wrap(`${product.code?product.code+' - ':''}${product.name}`,withImages?330:395,size,bold);
      const quantityLines=wrap(receiptQuantity(item),88,size,bold);
      return {item,product,lines,h:Math.max(withImages?58:24,14+Math.max(lines.length,quantityLines.length)*(size+3))};
    });
    if(rows.reduce((n,r)=>n+r.h+4,0)<=productTop-productsBottom){layout={size,withImages,rows};break;}
  }
  if(!layout)throw new Error('RECEIPT_LAYOUT_TOO_LARGE');
  text('DISBECOL',left,802,19,bold,colors.blue);text('EQUIPE DE LOGÍSTICA',left,779,8,bold,colors.muted);
  text('Comprovante de avaria',left,750,22,bold);text('Produtos registrados na entrega',left,719,9,regular,colors.muted);
  box(672,headerHeight);text('CLIENTE',left+12,661,7,bold,colors.muted);
  customer.forEach((line,i)=>text(line,left+12,647-i*13,11,bold));
  const infoTop=627-(customer.length-1)*13;
  [['PDV',damage.customer_code],['MAPA',damage.map_number],['DATA DA AVARIA',receiptDate(damage.occurrence_date)]].forEach(([label,value],i)=>{
    const x=left+12+i*(cw-24)/3;text(label,x,infoTop,7,bold,colors.muted);text(value,x,infoTop-12,9,bold);
  });
  text('PRODUTOS',left,productTop+17,8,bold,colors.blue);
  let y=productTop;
  for(const row of layout.rows){
    box(y,row.h,colors.white);page.drawRectangle({x:left,y:y-row.h,width:3,height:row.h,color:colors.blue});
    let x=left+10;
    if(layout.withImages){
      const imageBytes=images.get(row.product.code);let image;
      if(imageBytes){try{image=imageBytes[0]===0x89?await pdf.embedPng(imageBytes):await pdf.embedJpg(imageBytes);}catch{}}
      if(image){const scale=Math.min(35/image.width,42/image.height),iw=image.width*scale,ih=image.height*scale;page.drawImage(image,{x:left+10+(35-iw)/2,y:y-8-ih,width:iw,height:ih});}
      x=left+56;
    }
    row.lines.forEach((line,i)=>text(line,x,y-8-i*(layout.size+3),layout.size,bold));
    wrap(receiptQuantity(row.item),88,layout.size,bold).forEach((line,i)=>text(line,width-left-10-bold.widthOfTextAtSize(safe(line),layout.size),y-8-i*(layout.size+3),layout.size,bold,colors.blue));
    y-=row.h+4;
  }
  y-=10;box(y,noteHeight,colors.note);text('OBSERVAÇÃO',left+12,y-8,7,bold,colors.muted);
  note.forEach((line,i)=>text(line,left+12,y-21-i*12,9));y-=noteHeight+14;
  box(y,85,colors.white);text('ASSINATURA DO CLIENTE',left+12,y-9,7,bold,colors.muted);
  const ss=Math.min(270/signature.width,53/signature.height),sw=signature.width*ss,sh=signature.height*ss;
  page.drawImage(signature,{x:left+(cw-sw)/2,y:y-25-sh,width:sw,height:sh});
  text(RECEIPT_SUPPORT,left,54,9,regular,colors.blue);
  page.drawLine({start:{x:left,y:36},end:{x:width-left,y:36},thickness:.6,color:colors.line});
  const footerSize=7, pageLabel='1 / 1', pageX=width-left-regular.widthOfTextAtSize(pageLabel,footerSize);
  text('Comprovante emitido pelo Disb Gestão. Não substitui documento fiscal.',left,29,footerSize,regular,colors.muted);
  text(code,pageX-12-regular.widthOfTextAtSize(code,footerSize),29,footerSize,regular,colors.muted);
  text(pageLabel,pageX,29,footerSize,regular,colors.muted);
  return pdf.save();
}
