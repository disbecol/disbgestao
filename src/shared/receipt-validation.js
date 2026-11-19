(function(root){
  const normalizeCode=value=>{const s=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return /^DGB[0-9A-F]{32}$/.test(s)?'DGB-'+s.slice(3).match(/.{8}/g).join('-'):'';};
  const isCodeSearch=value=>/^DGB/i.test(String(value||'').trim());
  async function verifyFile(file,expectedHash){
    if(!file||file.size>10000000)throw new Error('Selecione o PDF original de até 10 MB.');
    const bytes=await file.arrayBuffer();
    if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('O arquivo selecionado não é um PDF.');
    const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    return {matches:/^[a-f0-9]{64}$/.test(expectedHash||'')&&actual===expectedHash,hash:actual};
  }
  const api={normalizeCode,isCodeSearch,verifyFile};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DisbReceiptValidation=api;
})(typeof globalThis==='object'?globalThis:this);
