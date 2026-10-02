(() => {
  'use strict';

  const WIDTH=595.28, HEIGHT=841.89, MARGIN=42, BOTTOM=48;
  const NAVY='#15344e', BLUE='#1764d9', MUTED='#64748b', PALE='#eef5ff', LINE='#dbe5ef';
  const safe=value=>String(value??'—').replace(/[\u2010-\u2015]/g,'-').replace(/→/g,' -> ').replace(/•/g,' - ').replace(/[^\x20-\x7e\xa0-\xff]/g,' ').replace(/\s+/g,' ').trim()||'—';
  const date=value=>{
    if(!value)return '—';
    const parsed=new Date(value);
    return Number.isNaN(parsed.getTime())?'—':parsed.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  };
  const duration=minutes=>minutes==null||!Number.isFinite(Number(minutes))?'Aguardando':`${String(Math.floor(Math.max(0,Number(minutes))/60)).padStart(2,'0')}:${String(Math.round(Math.max(0,Number(minutes)))%60).padStart(2,'0')}`;
  const coord=(lat,lon,accuracy)=>{
    if(lat==null||lon==null||!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon)))return 'Sem GPS';
    return `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}${accuracy==null?'':` | precisão ±${Math.round(Number(accuracy))} m`}`;
  };
  const meters=(a,b,c,d)=>{
    const rad=Math.PI/180,dp=(c-a)*rad,dl=(d-b)*rad;
    const h=Math.sin(dp/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin(dl/2)**2;
    return 12742000*Math.asin(Math.sqrt(h));
  };
  const rgbFrom=(lib,hex)=>lib.rgb(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255));

  async function buildPdf(report,lib=globalThis.PDFLib){
    if(!lib?.PDFDocument)throw new Error('Biblioteca de PDF indisponível. Recarregue a página e tente novamente.');
    const doc=await lib.PDFDocument.create(),normal=await doc.embedFont(lib.StandardFonts.Helvetica),bold=await doc.embedFont(lib.StandardFonts.HelveticaBold);
    const color={navy:rgbFrom(lib,NAVY),blue:rgbFrom(lib,BLUE),muted:rgbFrom(lib,MUTED),pale:rgbFrom(lib,PALE),line:rgbFrom(lib,LINE),white:lib.rgb(1,1,1)};
    const trip=report.trip||{},metrics=report.metrics||{},events=report.events||[],occurrences=report.occurrences||[],track=report.track||[],changes=report.appointmentChanges||[],adjustments=report.tmaAudit||[],requests=report.nriRequests||[],nris=report.nris||[],photos=report.attachments||[];
    const pages=[];let page,y;
    const line=(value,x,at,size=10,heavy=false,tint=color.navy)=>page.drawText(safe(value),{x,y:at,size,font:heavy?bold:normal,color:tint});
    const newPage=()=>{
      page=doc.addPage([WIDTH,HEIGHT]);pages.push(page);y=HEIGHT-56;
      page.drawRectangle({x:0,y:HEIGHT-12,width:WIDTH,height:12,color:color.blue});
      line('DISB GESTÃO  /  PUXADA',MARGIN,HEIGHT-38,10,true,color.blue);
      line(trip.trip_code||'Ciclo',WIDTH-MARGIN-125,HEIGHT-38,9,true,color.muted);
      y=HEIGHT-70;
    };
    const ensure=height=>{if(y-height<BOTTOM)newPage();};
    const wrap=(value,font,size,width)=>{
      const words=safe(value).split(/\s+/),lines=[];let current='';
      for(const word of words){
        const candidate=current?`${current} ${word}`:word;
        if(font.widthOfTextAtSize(candidate,size)<=width){current=candidate;continue;}
        if(current){lines.push(current);current='';}
        let part='';
        for(const char of word){
          if(part&&font.widthOfTextAtSize(part+char,size)>width){lines.push(part);part='';}
          part+=char;
        }
        current=part;
      }
      if(current)lines.push(current);
      return lines.length?lines:['—'];
    };
    const paragraph=(value,{size=10,heavy=false,tint=color.navy,indent=0,leading=15}={})=>{
      const font=heavy?bold:normal,lines=wrap(value,font,size,WIDTH-MARGIN*2-indent);
      for(const part of lines){ensure(leading);line(part,MARGIN+indent,y,size,heavy,tint);y-=leading;}
    };
    const section=title=>{
      ensure(90);y-=7;
      page.drawRectangle({x:MARGIN,y:y-22,width:WIDTH-MARGIN*2,height:27,color:color.pale});
      line(title.toUpperCase(),MARGIN+10,y-13,10,true,color.blue);
      y-=38;
    };
    const field=(label,value)=>{
      const lines=wrap(value,normal,9.5,WIDTH-MARGIN*2-145),height=Math.max(18,lines.length*13+3);
      ensure(height);
      line(label,MARGIN,y,9,true,color.muted);
      lines.forEach((part,index)=>line(part,MARGIN+145,y-index*13,9.5));
      y-=height;
    };
    const card=(title,details)=>{
      const count=details.reduce((n,x)=>n+wrap(x,normal,9,WIDTH-MARGIN*2-23).length,0),height=29+count*13;
      ensure(height+5);
      page.drawRectangle({x:MARGIN,y:y-height+10,width:WIDTH-MARGIN*2,height:height,color:color.white,borderColor:color.line,borderWidth:1});
      line(title,MARGIN+11,y-9,10,true,color.navy);y-=28;
      details.forEach(value=>paragraph(value,{size:9,indent:11,leading:13}));
      y-=10;
    };
    newPage();
    line('RESUMO DO CICLO',MARGIN,y,18,true,color.navy);y-=24;
    paragraph(`${trip.cycle_type==='TRANSFER'?'Transferência':'Puxada'} | ${trip.trip_code||'Sem código'} | ${trip.plate||'Sem placa'}`,{size:11,heavy:true,tint:color.blue});
    paragraph(`Emitido em ${date(report.generatedAt||new Date())} | ${report.statusLabel||trip.kpi_status||trip.status||'—'}`,{size:9,tint:color.muted});
    section('Identificação da viagem');
    field('Código / ID',`${trip.trip_code||'—'} / ${trip.id||'—'}`);
    field('Tipo / situação',`${trip.cycle_type==='TRANSFER'?'Transferência':'Puxada'} / ${report.statusLabel||trip.kpi_status||trip.status||'—'}`);
    field('Origem / destino',`${trip.origin_unit||'—'} / ${trip.factory||'—'}`);
    field('Placa / parceiro',`${trip.plate||'—'} / ${trip.carrier||'—'}`);
    field('Motorista 1',trip.driver1_name||'—');
    field('Motorista 2',report.solo?'Viagem sozinho':trip.driver2_name||'—');
    field('Motorista ativo',trip.active_driver_name||'—');
    field('Início / fim',`${date(trip.started_at)} / ${date(trip.ended_at)}`);
    field('Encerrado por',trip.ended_by_name||'—');
    field('Próxima saída',date(trip.next_started_at));
    field('Situação NRI',trip.nri_status||'—');
    field('GPS inicial',coord(trip.start_latitude,trip.start_longitude,trip.start_accuracy));
    field('GPS final',coord(trip.end_latitude,trip.end_longitude,trip.end_accuracy));
    if(trip.cycle_type!=='TRANSFER'){
      section('Agendamento e fábrica');
      field('Agendamento atual',date(trip.appointment_at));
      field('Chegada à fábrica',date(trip.arrived_factory_at));
      field('Saída da fábrica',date(trip.left_factory_at));
      if(report.appointmentMetrics){
        field('Antecedência real',duration(report.appointmentMetrics.actual));
        field('Considerada fábrica',duration(report.appointmentMetrics.factory));
      }
    }
    section('Indicadores de tempo');
    if(trip.cycle_type==='TRANSFER')field('Ciclo transferência',duration(metrics.CYCLE));
    else{
      field('TMV Ida',duration(metrics.TMV_OUT));field('TMA Fábrica',duration(metrics.FACTORY));
      field('TMV Volta',duration(metrics.TMV_RETURN));field('TMA Revenda bruto',duration(metrics.UNIT_RAW));
      field('Desconto TMA',duration(trip.tma_adjust_minutes||0));field('TMA Revenda ajustado',duration(metrics.UNIT));
      field('Ciclo KPI',duration(metrics.CYCLE));field('Motivo do ajuste',trip.tma_adjust_reason||'—');
      field('Ajuste TMA por / em',`${trip.tma_adjusted_by_name||'—'} / ${date(trip.tma_adjusted_at)}`);
    }
    section(`Etapas registradas (${events.length})`);
    if(!events.length)paragraph('Nenhuma etapa registrada.');
    events.forEach((row,index)=>card(`${index+1}. ${row.report_name||row.step_name||row.action_code||'Etapa'}`,[
      `Registro: ${date(row.recorded_at)} | aparelho: ${date(row.device_at)} | por ${row.user_name||'—'}`,
      `Código: ${row.action_code||'—'} | ordem: ${row.step_order??'—'} | GPS: ${coord(row.latitude,row.longitude,row.gps_accuracy)}`,
      `Auditoria da fábrica: ${row.geofence_status||'—'} | distância: ${row.distance_factory_m==null?'—':`${Math.round(Number(row.distance_factory_m))} m`} | raio: ${row.factory_radius_m==null?'—':`${row.factory_radius_m} m`}`,
      row.exception_reason?`Justificativa da exceção: ${row.exception_reason}`:'Sem justificativa de exceção.'
    ]));
    section(`Ocorrências (${occurrences.length})`);
    if(!occurrences.length)paragraph('Nenhuma ocorrência registrada.');
    occurrences.forEach((row,index)=>card(`${index+1}. ${row.occurrence_name||'Ocorrência'} | ${row.status||'—'}`,[
      `Início: ${date(row.started_at)} | por ${row.started_by_name||'—'} | GPS ${coord(row.start_latitude,row.start_longitude,row.start_accuracy)}`,
      `Fim: ${date(row.ended_at)} | por ${row.ended_by_name||'—'} | GPS ${coord(row.end_latitude,row.end_longitude,row.end_accuracy)}`,
      `Duração: ${row.ended_at?duration((Date.parse(row.ended_at)-Date.parse(row.started_at))/60000):'Em andamento'} | modo: ${row.duration_mode||'—'} | sugere desconto TMA: ${row.suggest_tma_discount?'sim':'não'}`,
      `Observação: ${row.note||'—'}`
    ]));
    section(`Alterações do agendamento (${changes.length})`);
    if(!changes.length)paragraph('Nenhuma alteração registrada após o início da viagem.');
    changes.forEach((row,index)=>card(`${index+1}. ${date(row.changed_at)} | ${row.changed_by_name||'Analista'}`,[
      `Horário de agendamento antigo: ${date(row.old_appointment_at)}`,
      `Horário de agendamento novo: ${date(row.new_appointment_at)}`,
      `Justificativa: ${row.reason||'—'}`
    ]));
    section(`Auditoria de TMA (${adjustments.length})`);
    if(!adjustments.length)paragraph('Nenhum ajuste de TMA registrado.');
    adjustments.forEach((row,index)=>card(`${index+1}. ${date(row.changed_at)} | ${row.changed_by_name||'—'}`,[
      `Desconto antigo: ${duration(row.old_minutes)} | novo: ${duration(row.new_minutes)}`,
      `Justificativa antiga: ${row.old_reason||'—'}`,
      `Justificativa nova: ${row.new_reason||'—'}`
    ]));
    section(`NRI vinculados (${nris.length})`);
    if(!requests.length&&!nris.length)paragraph('Nenhum NRI vinculado a este ciclo.');
    requests.forEach((row,index)=>card(`Solicitação ${index+1} | ${date(row.created_at)}`,[
      `Tipo: ${row.request_type||'—'} | unidade: ${row.unit||'—'} | fábrica: ${row.factory||'—'}`,
      `Conferente: ${row.checker_name||'—'} | motorista: ${row.driver||'—'} | placa: ${row.plate||'—'}`,
      `Recebimento: ${row.receipt_date||'—'} ${row.receipt_time||''} | NRIs: ${nris.filter(n=>n.request_id===row.id).map(n=>n.nri).join(', ')||'—'}`
    ]));
    nris.forEach((row,index)=>card(`${index+1}. ${row.nri||'NRI'} | ${row.status||'—'}`,[
      `Produto: ${row.product_code||'—'} - ${row.product_name||'—'} | quantidade: ${row.quantity??'—'}`,
      `Lote: ${row.lot||'—'} | validade: ${row.validity_date||'—'} | bloqueio: ${row.block_date||'—'}`,
      `Criado: ${date(row.created_at)} | impresso: ${date(row.printed_at)} | removido: ${date(row.removed_at)}`
    ]));
    section(`Rastro GPS (${track.length} pontos)`);
    if(track.length){
      const sorted=[...track].sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at));
      let total=0,previous=null;
      sorted.forEach(row=>{if(previous){const seconds=(Date.parse(row.recorded_at)-Date.parse(previous.recorded_at))/1000,delta=meters(Number(previous.latitude),Number(previous.longitude),Number(row.latitude),Number(row.longitude));if(seconds>0&&delta/seconds<=60)total+=delta;}previous=row;});
      field('Primeiro / último',`${date(sorted[0].recorded_at)} / ${date(sorted.at(-1).recorded_at)}`);
      field('Distância aproximada',`${(total/1000).toFixed(1).replace('.',',')} km (GPS; saltos improváveis desconsiderados)`);
      paragraph('Registro cronológico completo: data/hora, coordenadas, precisão e origem do ponto.',{size:9,tint:color.muted});
      sorted.forEach((row,index)=>{
        ensure(13);
        line(`${String(index+1).padStart(5,'0')}  ${date(row.device_at||row.recorded_at)}  ${coord(row.latitude,row.longitude,row.gps_accuracy)}${row.source?` | ${row.source}`:''}`,MARGIN,y,8,false,color.navy);
        y-=13;
      });
    }else paragraph('Nenhum ponto de rastreio registrado.');
    section(`Anexos (${photos.length})`);
    paragraph('As fotos originais estão incorporadas neste PDF. Toque no clipe de cada foto para abrir ou salvar. Se o leitor não mostrar o clipe, use o painel Anexos do leitor de PDF.',{size:9,tint:color.muted});
    if(!photos.length)paragraph('Nenhuma foto anexada ao ciclo.');
    for(let index=0;index<photos.length;index++){
      const photo=photos[index],name=`${safe(trip.trip_code||'ciclo').replace(/[^A-Za-z0-9_-]/g,'_')}-foto-${String(index+1).padStart(2,'0')}.jpg`;
      const bytes=photo.bytes instanceof Uint8Array?photo.bytes:new Uint8Array(photo.bytes);
      const image=await doc.embedJpg(bytes);
      await doc.attach(bytes,name,{mimeType:'image/jpeg',description:safe(photo.observation||`Foto ${index+1} do ciclo`),creationDate:photo.created_at?new Date(photo.created_at):new Date()});
      const embedded=doc.embeddedFiles.at(-1);
      await embedded.embed();
      ensure(165);
      const top=y,boxY=top-154;
      page.drawRectangle({x:MARGIN,y:boxY,width:WIDTH-MARGIN*2,height:152,color:color.white,borderColor:color.line,borderWidth:1});
      const scale=Math.min(174/image.width,121/image.height),w=image.width*scale,h=image.height*scale;
      page.drawImage(image,{x:MARGIN+12+(174-w)/2,y:boxY+18+(121-h)/2,width:w,height:h});
      line(`FOTO ${index+1}  |  ${name}`,MARGIN+205,top-19,9,true,color.navy);
      line(`Registrada: ${date(photo.created_at)}`,MARGIN+205,top-37,8,false,color.muted);
      if(photo.uploaded_by)line(`Usuário: ${photo.uploaded_by}`,MARGIN+205,top-49,7,false,color.muted);
      wrap(`Observação: ${photo.observation||'Sem observação.'}`,normal,8.5,WIDTH-MARGIN*2-220).slice(0,4).forEach((part,i)=>line(part,MARGIN+205,top-61-i*12,8.5));
      const iconX=MARGIN+205,iconY=boxY+15;
      page.drawRectangle({x:iconX,y:iconY,width:183,height:28,color:color.pale,borderColor:color.line,borderWidth:1});
      line('Clique no clipe para baixar',iconX+26,iconY+9,8,true,color.blue);
      const annotation=doc.context.obj({Type:'Annot',Subtype:'FileAttachment',Rect:[iconX+3,iconY+3,iconX+23,iconY+25],FS:embedded.ref,Name:'Paperclip',Contents:lib.PDFHexString.fromText(`Abrir ou salvar ${name}`),F:4});
      page.node.addAnnot(doc.context.register(annotation));
      y=boxY-10;
    }
    pages.forEach((sheet,index)=>{
      sheet.drawLine({start:{x:MARGIN,y:34},end:{x:WIDTH-MARGIN,y:34},thickness:.5,color:color.line});
      sheet.drawText(safe(`Disb Gestão | ${trip.trip_code||'Ciclo'} | ${index+1}/${pages.length}`),{x:MARGIN,y:22,size:8,font:normal,color:color.muted});
    });
    doc.setTitle(`Resumo do ciclo ${trip.trip_code||''}`);
    doc.setAuthor('Disb Gestão');
    doc.setSubject('Histórico completo do ciclo de puxada');
    return await doc.save({useObjectStreams:false});
  }

  const api={buildPdf};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.DISB_PULL_REPORT=api;
})();
