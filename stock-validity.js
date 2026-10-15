// Importacao e consulta da validade do estoque. O arquivo nunca e enviado ao
// servidor; somente as linhas conferidas sao gravadas na unidade selecionada.
(() => {
  'use strict';
  const DAY=86400000;
  const clean=value=>String(value??'').trim();
  const key=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');

  function parseCsv(text){
    const first=clean(text).replace(/^\uFEFF/,'').split(/\r?\n/,1)[0]||'';
    const sep=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
    const rows=[];let row=[],cell='',quoted=false;
    text=String(text||'').replace(/^\uFEFF/,'');
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
        else if(ch==='"')quoted=false;
        else cell+=ch;
      }else if(ch==='"')quoted=true;
      else if(ch===sep){row.push(cell);cell='';}
      else if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
      else cell+=ch;
    }
    if(quoted)throw new Error('O CSV contém aspas sem fechamento.');
    if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
    return rows;
  }

  function isoDate(value){
    if(value instanceof Date){
      if(Number.isNaN(value.getTime()))return '';
      return value.toISOString().slice(0,10);
    }
    if(typeof value==='number'&&Number.isFinite(value)){
      const date=new Date(Date.UTC(1899,11,30)+Math.round(value)*DAY);
      return date.toISOString().slice(0,10);
    }
    const input=clean(value);let year,month,day;
    let match=input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if(match){year=Number(match[1]);month=Number(match[2]);day=Number(match[3]);}
    else{
      match=input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if(!match)return '';
      day=Number(match[1]);month=Number(match[2]);year=Number(match[3]);
    }
    const date=new Date(Date.UTC(year,month-1,day));
    if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return '';
    return date.toISOString().slice(0,10);
  }

  function quantity(value){
    if(value==null||clean(value)==='')return null;
    if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:NaN;
    let text=clean(value).replace(/\s/g,'');
    if(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text))text=text.replace(/\./g,'').replace(',','.');
    else text=text.replace(',','.');
    if(!/^\d+(\.\d{1,3})?$/.test(text))return NaN;
    return Number(text);
  }

  function normalizeMatrix(matrix){
    if(!Array.isArray(matrix))throw new Error('Não foi possível ler as linhas do arquivo.');
    const headerRow=matrix.findIndex(row=>{
      const cells=(row||[]).map(key);
      return cells.includes('vencimento')||cells.includes('validade')||cells.includes('datavalidade')||cells.includes('datadevencimento');
    });
    if(headerRow<0)throw new Error('Cabeçalho não encontrado. O arquivo precisa das colunas PRODUTO, DESCRIÇÃO e VENCIMENTO.');
    const headers=(matrix[headerRow]||[]).map(key);
    const find=(...names)=>headers.findIndex(h=>names.includes(h));
    let code=find('codigo','codigoproduto','codproduto','sku');
    if(code<0)code=find('produto');
    let name=find('descricao','descricaoproduto','descricaodoproduto','nome','nomeproduto');
    if(name<0&&find('produto')!==code)name=find('produto');
    const expiry=find('vencimento','validade','datavalidade','datadevencimento');
    const qty=find('quantidade','qtd','qtde');
    const location=find('local','localizacao');
    const street=find('rua','endereco');
    if(code<0||name<0||expiry<0)throw new Error('O arquivo precisa de código, descrição e vencimento.');
    const rows=[],names=new Map();
    for(let i=headerRow+1;i<matrix.length;i++){
      const raw=matrix[i]||[];
      if(!raw.some(value=>clean(value)))continue;
      const product_code=clean(raw[code]),product_name=clean(raw[name]);
      const expiry_date=isoDate(raw[expiry]);
      const amount=qty<0?null:quantity(raw[qty]);
      if(!product_code||!product_name)throw new Error(`Linha ${i+1}: informe código e descrição do produto.`);
      if(!expiry_date)throw new Error(`Linha ${i+1}: vencimento inválido. Use DD/MM/AAAA.`);
      if(Number.isNaN(amount)||amount!=null&&(amount<0||amount>99999999999))throw new Error(`Linha ${i+1}: quantidade inválida.`);
      if(product_code.length>40||product_name.length>300)throw new Error(`Linha ${i+1}: código ou descrição muito longo.`);
      if(names.has(product_code)&&names.get(product_code)!==product_name)throw new Error(`Linha ${i+1}: o código ${product_code} tem descrições diferentes no arquivo.`);
      names.set(product_code,product_name);
      rows.push({product_code,product_name,expiry_date,quantity:amount,
        location:location<0?'':clean(raw[location]).slice(0,100),
        street:street<0?'':clean(raw[street]).slice(0,100)});
      if(rows.length>20000)throw new Error('O arquivo excede 20.000 linhas.');
    }
    if(!rows.length)throw new Error('O arquivo não contém produtos válidos.');
    return {rows,productCount:names.size};
  }

  async function readFile(file,readXlsx){
    if(!file)throw new Error('Selecione um arquivo CSV ou XLSX.');
    if(file.size>5*1024*1024)throw new Error('O arquivo deve ter no máximo 5 MB.');
    const extension=clean(file.name).toLowerCase().split('.').pop();
    let matrix;
    if(extension==='xlsx'){
      if(typeof readXlsx!=='function')throw new Error('Leitor XLSX indisponível. Atualize o aplicativo.');
      matrix=await readXlsx(file);
    }else if(extension==='csv'){
      const bytes=await file.arrayBuffer();let text;
      try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
      catch{text=new TextDecoder('windows-1252').decode(bytes);}
      matrix=parseCsv(text);
    }else throw new Error('Envie um arquivo .csv ou .xlsx.');
    return normalizeMatrix(matrix);
  }

  function daysUntil(iso,today=new Date()){
    const [year,month,day]=String(iso||'').split('-').map(Number);
    if(!year||!month||!day)return NaN;
    return Math.round((Date.UTC(year,month-1,day)-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/DAY);
  }

  function products(rows,today=new Date()){
    const byCode=new Map();
    for(const row of rows||[]){
      const code=clean(row.product_code),date=clean(row.expiry_date);
      if(!code||!date)continue;
      const item=byCode.get(code)||{code,name:clean(row.product_name),expiry:date,positions:0,quantity:0,hasQuantity:false};
      if(date<item.expiry)item.expiry=date;
      item.positions++;
      if(row.quantity!=null){item.quantity+=Number(row.quantity)||0;item.hasQuantity=true;}
      byCode.set(code,item);
    }
    return [...byCode.values()].map(item=>({...item,days:daysUntil(item.expiry,today)}))
      .sort((a,b)=>a.days-b.days||a.name.localeCompare(b.name,'pt-BR'));
  }

  window.DISB_STOCK_VALIDITY={parseCsv,normalizeMatrix,readFile,daysUntil,products};
})();
