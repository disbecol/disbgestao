(() => {
  'use strict';
  const W=1080, pad=54, navy='#132744', blue='#2463eb', muted='#64748b', line='#dce5ef';
  const number=value=>new Intl.NumberFormat('pt-BR').format(Number(value)||0);
  const currency=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
  const date=value=>{if(!value)return '—';const parts=String(value).slice(0,10).split('-');return parts.length===3?`${parts[2]}/${parts[1]}/${parts[0]}`:String(value);};
  const crop=(value,max=38)=>{const text=String(value??'—');return text.length>max?text.slice(0,max-1)+'…':text;};
  function canvas(height){
    const c=document.createElement('canvas');c.width=W;c.height=height;
    const x=c.getContext('2d');x.fillStyle='#f5f8fc';x.fillRect(0,0,W,height);return {c,x};
  }
  function box(x,y,w,h,fill='#fff',stroke=line){
    x.beginPath();x.roundRect(pad,y,W-pad*2,h,22);x.fillStyle=fill;x.fill();if(stroke){x.strokeStyle=stroke;x.lineWidth=1;x.stroke();}
  }
  let x;
  function text(value,px,y,size=25,color=navy,weight=500,align='left'){
    x.fillStyle=color;x.font=`${weight} ${size}px Arial, sans-serif`;x.textAlign=align;x.textBaseline='middle';x.fillText(String(value??''),px,y);
  }
  function header(label,title,subtitle,accent=blue){
    x.fillStyle=accent;x.fillRect(0,0,W,14);
    text('DISB GESTÃO',pad,62,24,accent,800);
    text(label.toUpperCase(),W-pad,62,20,muted,700,'right');
    text(title,pad,122,39,navy,800);
    text(subtitle,pad,165,22,muted,500);
  }
  function footer(height){
    x.fillStyle=line;x.fillRect(pad,height-86,W-pad*2,1);
    text('Relatório gerado pelo Disb Gestão',pad,height-52,19,muted,500);
    text(new Date().toLocaleString('pt-BR'),W-pad,height-52,19,muted,500,'right');
  }
  function conference(row,types){
    const {c,x:ctx}=canvas(1035);x=ctx;
    const conf=row.conference||{},hasMap=row.status!=='SEM_BASE';
    header('Conferência de vasilhames',`Mapa ${row.map_number||'—'}`,`Rota: ${date(row.source_map_date)}  •  Conferência: ${date(conf.conference_date)}  •  ${crop(row.city||'Sem cidade',55)}`);
    box(x,202,W-pad*2,125);
    const people=[['MOTORISTA',row.driver],['AJUDANTE 1',row.helper1],['AJUDANTE 2',row.helper2],['CONFERENTE',conf.checker_name]];
    people.forEach(([label,value],i)=>{const left=pad+22+i*242;text(label,left,237,16,muted,800);text(crop(value||'—',16),left,276,23,navy,700);});
    box(x,352,W-pad*2,hasMap?420:390);
    x.fillStyle='#eef3fa';x.fillRect(pad+1,353,W-pad*2-2,62);
    const columns=hasMap?[pad+24,540,671,800,1025]:[pad+24,850];
    ['VASILHAME',...(hasMap?['PLANILHA','CONFERIDO','DIFERENÇA','VALOR']:['CONFERIDO'])].forEach((label,i)=>text(label,columns[i],386,16,muted,800,i?'right':'left'));
    types.forEach((type,i)=>{
      const diff=row.diffs?.[type.key]||{},y=445+i*52;
      if(i%2===1){x.fillStyle='#f8fafd';x.fillRect(pad+1,y-26,W-pad*2-2,52);}
      text(crop(type.label,29),pad+24,y,21,navy,600);
      if(hasMap){text(number(diff.plan),540,y,21,navy,600,'right');text(number(diff.actual),671,y,21,navy,700,'right');text(`${diff.diff>0?'+':''}${number(diff.diff)}`,800,y,21,diff.diff>0?'#087d41':diff.diff<0?'#c43b39':muted,700,'right');text(currency(diff.value),1025,y,20,diff.diff>0?'#087d41':diff.diff<0?'#c43b39':muted,700,'right');}
      else text(number(diff.actual),850,y,21,navy,700,'right');
    });
    if(hasMap){
      box(x,798,W-pad*2,113,'#eaf3ff','#bed3ff');
      text('DIVERGÊNCIAS POSITIVAS',pad+24,829,18,muted,800);text(currency(row.pos),pad+24,867,29,blue,800);
      text('DIVERGÊNCIAS NEGATIVAS',550,829,18,muted,800);text(currency(row.neg),550,867,29,'#c43b39',800);
    }else{box(x,775,W-pad*2,105,'#fff8e9','#f6df9d');text('Sem mapa-base cadastrado',pad+24,809,24,'#8b6200',800);text('O comparativo será exibido quando a planilha estiver disponível.',pad+24,846,20,muted,500);}
    footer(c.height);return [{name:`vasilhames-mapa-${row.map_number||'conferencia'}.png`,dataUrl:c.toDataURL('image/png')}];
  }
  function asset(count,view,rows){
    const accent=view==='PATIO'?'#0d9c5c':view==='REFUGO'?'#d54848':blue;
    const label=view==='PATIO'?'Pátio':view==='REFUGO'?'Refugo':'Total geral';
    const pages=[];const pageSize=13;
    for(let page=0;page<Math.max(1,Math.ceil(rows.length/pageSize));page++){
      const slice=rows.slice(page*pageSize,(page+1)*pageSize),tableRows=Math.max(1,slice.length),height=471+tableRows*68;
      const {c,x:ctx}=canvas(height);x=ctx;
      header('Ativo de giro',`${count.count_code||'Contagem'} • ${label}`,`${date(count.count_date)}  •  ${count.unit||'—'}  •  Conferente: ${count.counter_name||'—'}`,accent);
      text('P Palet/GFA  •  L Lastro/GFA  •  C Caixa/GFA  •  A Avulso  •  U Unidades',pad+8,205,16,muted,600);
      box(x,225,W-pad*2,65+tableRows*68);
      x.fillStyle='#eef3fa';x.fillRect(pad+1,226,W-pad*2-2,58);
      text('ATIVO / CÓDIGO',pad+22,255,17,muted,800);
      [['P',605],['L',693],['C',781],['A',869],['U',1015]].forEach(([name,cx])=>text(name,cx,255,18,muted,800,'right'));
      slice.forEach((row,i)=>{
        const y=316+i*68;if(i%2===1){x.fillStyle='#f8fafd';x.fillRect(pad+1,y-32,W-pad*2-2,68);}
        text(crop(row.description,33),pad+22,y-8,21,navy,700);
        text(`SAP ${row.sap_code||'—'}  •  Cód. ${row.asset_code||'—'}`,pad+22,y+17,15,muted,500);
        [['pallet_gfa',605],['layer_gfa',693],['box_gfa',781],['loose',869],['units',1015]].forEach(([key,cx])=>text(number(row[key]),cx,y,22,navy,700,'right'));
      });
      if(!slice.length)text('Nenhum lançamento nesta área.',pad+23,319,22,muted,500);
      text(`Página ${page+1} de ${Math.max(1,Math.ceil(rows.length/pageSize))}`,W-pad,height-104,18,muted,600,'right');
      footer(height);
      pages.push({name:`ativo-giro-${count.count_code||'contagem'}-${view.toLowerCase()}-${page+1}.png`,dataUrl:c.toDataURL('image/png')});
    }
    return pages;
  }
  async function assetPdf(images,PDFLib){
    if(!images?.length)throw new Error('Nenhuma página para gerar o PDF.');
    const pdf=await PDFLib.PDFDocument.create();
    pdf.setTitle('Ativo de Giro • Disb Gestão');
    for(const image of images){
      const png=await pdf.embedPng(image.dataUrl);
      const page=pdf.addPage(PDFLib.PageSizes.A4);
      const margin=18,scale=Math.min((page.getWidth()-margin*2)/png.width,(page.getHeight()-margin*2)/png.height);
      const width=png.width*scale,height=png.height*scale;
      page.drawImage(png,{x:(page.getWidth()-width)/2,y:page.getHeight()-margin-height,width,height});
    }
    return pdf.save();
  }
  window.DISB_REPORT_IMAGES={conference,asset,assetPdf};
})();
