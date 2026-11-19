/* Leitura somente das abas necessárias; ignora áreas vazias formatadas no XLSX. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DISB_RETURNS_FILE=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  function open(buffer,{unzip=globalThis.fflate?.unzipSync,XML=globalThis.DOMParser}={}){
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);if(bytes.length>40*1024*1024)throw Error('O arquivo ultrapassa 40 MB. Exporte somente o relatório necessário.');if(!unzip||!XML)throw Error('Leitor XLSX indisponível.');
    const decoder=new TextDecoder();
    function extract(names){const allowed=new Set(names);let total=0;return unzip(bytes,{filter:f=>{if(!allowed.has(f.name))return false;total+=f.originalSize;if(f.originalSize>80*1024*1024||total>120*1024*1024)throw Error('A aba é grande demais. Exporte apenas os dados do relatório, sem linhas vazias formatadas.');return true;}});}
    function xml(data){if(!data)throw Error('Arquivo XLSX incompleto.');const doc=new XML().parseFromString(decoder.decode(data),'text/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('O arquivo contém XML inválido.');return doc;}
    const meta=extract(['xl/workbook.xml','xl/_rels/workbook.xml.rels']),book=xml(meta['xl/workbook.xml']),rels=xml(meta['xl/_rels/workbook.xml.rels']);
    const targets=new Map([...rels.getElementsByTagName('Relationship')].map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
    const sheets=[...book.getElementsByTagName('sheet')].map(s=>{const target=targets.get(s.getAttribute('r:id'));return {name:s.getAttribute('name'),path:target?.startsWith('/')?target.slice(1):'xl/'+target};});
    let shared=null;
    function read(name,maxColumn=40){
      const selected=sheets.find(s=>s.name===name);if(!selected)throw Error('Aba não encontrada: '+name);
      if(!/^xl\/worksheets\/[^/]+\.xml$/.test(selected.path))throw Error('Referência de aba inválida.');
      const files=extract([selected.path,...(shared?[]:['xl/sharedStrings.xml'])]);
      if(!shared)shared=files['xl/sharedStrings.xml']?[...xml(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
      const doc=xml(files[selected.path]),rows=[];
      for(const row of doc.getElementsByTagName('row')){
        const result=[];let found=false;
        for(const cell of row.getElementsByTagName('c')){
          const coordinate=cell.getAttribute('r')||'',letters=coordinate.match(/^[A-Z]+/)?.[0];if(!letters)continue;let col=0;for(const ch of letters)col=col*26+ch.charCodeAt(0)-64;if(col>maxColumn)continue;
          const type=cell.getAttribute('t'),v=cell.getElementsByTagName('v')[0]?.textContent;let value=null;
          if(type==='s')value=shared[Number(v)]??null;else if(type==='inlineStr')value=[...cell.getElementsByTagName('t')].map(t=>t.textContent).join('');else if(type==='e')value=v||'#ERRO';else if(v!==undefined)value=type==='str'?v:Number.isFinite(Number(v))?Number(v):v;
          if(value!==null&&String(value).trim()!==''){result[col-1]=value;found=true;}
        }
        if(found)rows.push(result);if(rows.length>100000)throw Error('O relatório tem mais de 100 mil linhas preenchidas. Divida o período.');
      }return rows;
    }
    return {sheets:sheets.map(s=>s.name),read};
  }
  return {open};
});
