/* DANFE text extraction and commercial-unit to pallet conversion. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.DISB_INVOICE_NOTE=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const units=new Set(['CX','DZ','UN','UND','UNID','UNIDADE','DUZIA','DÚZIA','CAIXA']);
  const clean=v=>String(v??'').trim();
  const numeric=v=>{const s=clean(v).replace(/\./g,'').replace(',','.');return /^\d+(?:\.\d+)?$/.test(s)?Number(s):NaN;};
  function textRows(items){
    const lines=[];
    for(const item of items||[]){if(!clean(item.str))continue;const x=Number(item.transform?.[4]),y=Number(item.transform?.[5]);if(!Number.isFinite(x)||!Number.isFinite(y))continue;
      let line=lines.find(row=>Math.abs(row.y-y)<1.2);if(!line){line={y,parts:[]};lines.push(line);}line.parts.push({x,text:clean(item.str)});
    }
    return lines.sort((a,b)=>b.y-a.y).map(row=>({...row,parts:row.parts.sort((a,b)=>a.x-b.x)}));
  }
  function parsePage(items){
    const rows=textRows(items);let inProducts=false;const output=[];
    for(const row of rows){const joined=row.parts.map(p=>p.text).join(' ').toUpperCase();
      if(/DADOS\s+DOS\s+PRODUTOS/.test(joined)){inProducts=true;continue;}
      if(/DADOS\s+ADICIONAIS/.test(joined)){inProducts=false;continue;}
      if(!inProducts)continue;
      const codePart=row.parts.find(p=>p.x<45&&/^[A-Z0-9]{3,20}$/i.test(p.text));if(!codePart)continue;
      const unitPart=row.parts.find(p=>p.x>codePart.x+65&&p.x<codePart.x+260&&units.has(p.text.toUpperCase()));if(!unitPart)continue;
      const qtyPart=row.parts.find(p=>p.x>unitPart.x+5&&p.x<unitPart.x+85&&Number.isFinite(numeric(p.text)));if(!qtyPart)continue;
      const description=row.parts.filter(p=>p.x>codePart.x+10&&p.x<unitPart.x-4).map(p=>p.text).join(' ').replace(/\s+/g,' ').trim();
      if(!description)continue;
      output.push({reference_code:codePart.text.toUpperCase(),description,commercial_unit:unitPart.text.toUpperCase(),quantity:numeric(qtyPart.text)});
    }
    return output;
  }
  function groupLines(lines){
    const grouped=new Map();for(const row of lines||[]){const code=clean(row.reference_code).toUpperCase(),unit=clean(row.commercial_unit).toUpperCase(),qty=Number(row.quantity);if(!code||!units.has(unit)||!Number.isFinite(qty)||qty<=0)throw new Error('A nota contém um item com código, unidade ou quantidade inválida.');const key=code+'|'+unit;
      if(!grouped.has(key))grouped.set(key,{reference_code:code,description:clean(row.description),commercial_unit:unit,quantity:0,source_lines:0});const target=grouped.get(key);target.quantity+=qty;target.source_lines++;
    }
    const unitsByReference=new Map();for(const row of grouped.values()){const old=unitsByReference.get(row.reference_code);if(old&&old!==row.commercial_unit)throw new Error(`A referência ${row.reference_code} aparece com unidades comerciais diferentes (${old} e ${row.commercial_unit}). Confira a nota antes de converter.`);unitsByReference.set(row.reference_code,row.commercial_unit);}
    return [...grouped.values()];
  }
  function matchProducts(lines,products,originUnit='Matriz Caicó'){
    const field=originUnit==='Filial Pau dos Ferros'?'nf_reference_code_filial':'nf_reference_code';
    const byReference=new Map();for(const p of products||[]){const ref=clean(p[field]).toUpperCase();if(ref&&ref!=='#N/D'){if(byReference.has(ref))throw new Error(`O código de referência ${ref} está cadastrado em mais de um produto para ${originUnit}.`);byReference.set(ref,p);}}
    return groupLines(lines).map(row=>{const p=byReference.get(row.reference_code);if(!p)throw new Error(`Código de referência ${row.reference_code} não encontrado. Cadastre-o em Configurações > Produtos.`);const capacity=Number(p.commercial_units_per_pallet);if(!Number.isInteger(capacity)||capacity<1)throw new Error(`Informe a capacidade do palete do produto ${p.code} em Configurações > Produtos.`);if(p.invoice_unit&&clean(p.invoice_unit).toUpperCase()!==row.commercial_unit)throw new Error(`A unidade ${row.commercial_unit} da nota não confere com a unidade cadastrada para ${p.code}.`);
      const full=Math.floor(row.quantity/capacity),remainder=Number((row.quantity-full*capacity).toFixed(6));return {...row,product_code:p.code,product_name:p.name,commercial_units_per_pallet:capacity,full_pallets:full,remaining_units:remainder,pallets_exact:row.quantity/capacity};});
  }
  async function readPdf(file,pdfjs){
    if(!pdfjs?.getDocument)throw new Error('Leitor de PDF indisponível.');const data=new Uint8Array(await file.arrayBuffer());const task=pdfjs.getDocument({data});const pdf=await task.promise;const lines=[];let invoiceNumber='';
    try{for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){const page=await pdf.getPage(pageNumber),content=await page.getTextContent(),pageRows=textRows(content.items);if(!invoiceNumber){const all=pageRows.map(r=>r.parts.map(p=>p.text).join(' ')).join('\n');const found=all.match(/N[º°.]?\s*([0-9]{6,12})/i)?.[1];if(found)invoiceNumber=String(Number(found));}lines.push(...parsePage(content.items));}}
    finally{await pdf.destroy();}
    if(!lines.length)throw new Error('Não encontrei produtos na nota. Envie um PDF DANFE com texto selecionável; imagem escaneada não pode ser lida automaticamente.');
    return {invoice_number:invoiceNumber,lines:groupLines(lines)};
  }
  return {parsePage,groupLines,matchProducts,readPdf};
});
