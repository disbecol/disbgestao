(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DisbSignaturePad=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';

  function pointerPosition(event,rect,rotated){
    const clamp=value=>Math.max(0,Math.min(1,value));
    if(rotated)return {x:clamp((event.clientY-rect.top)/rect.height),y:clamp(1-(event.clientX-rect.left)/rect.width)};
    return {x:clamp((event.clientX-rect.left)/rect.width),y:clamp((event.clientY-rect.top)/rect.height)};
  }
  function containRect(sourceWidth,sourceHeight,width,height,padding=0){
    const scale=Math.min(Math.max(0,width-padding*2)/sourceWidth,Math.max(0,height-padding*2)/sourceHeight);
    return {x:(width-sourceWidth*scale)/2,y:(height-sourceHeight*scale)/2,width:sourceWidth*scale,height:sourceHeight*scale};
  }
  function inkBounds(image){
    let left=image.width,top=image.height,right=-1,bottom=-1;
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
      const index=(y*image.width+x)*4,data=image.data;
      if(data[index+3]>24&&Math.min(data[index],data[index+1],data[index+2])<235){
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      }
    }
    return right<left?null:{x:left,y:top,width:right-left+1,height:bottom-top+1};
  }
  function copyInk(source,document){
    const bounds=inkBounds(source.getContext('2d').getImageData(0,0,source.width,source.height));
    if(!bounds)return null;
    const result=document.createElement('canvas');result.width=bounds.width;result.height=bounds.height;
    result.getContext('2d').drawImage(source,bounds.x,bounds.y,bounds.width,bounds.height,0,0,result.width,result.height);
    return result;
  }

  function bind({canvas,button,isSigned,onSave,getContext=()=>'',canOpen=()=>true,onContextChanged=()=>{}}){
    if(!canvas||!button)return null;
    const document=canvas.ownerDocument,view=document.defaultView;
    let dialog=null,stage,pad,saveButton,guide,observer,session=null,rotated=false,logicalWidth=1,logicalHeight=1;
    const isCurrent=()=>session&&session.context===getContext()&&canOpen();
    const white=target=>{const ctx=target.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,target.width,target.height);return ctx;};
    function drawStroke(ctx,stroke){
      const points=stroke.points;if(!points.length)return;
      ctx.strokeStyle=ctx.fillStyle='#17202a';ctx.lineWidth=3;ctx.lineCap=ctx.lineJoin='round';
      ctx.beginPath();ctx.arc(points[0].x*logicalWidth,points[0].y*logicalHeight,1.5,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.moveTo(points[0].x*logicalWidth,points[0].y*logicalHeight);
      for(const point of points.slice(1))ctx.lineTo(point.x*logicalWidth,point.y*logicalHeight);
      ctx.stroke();
    }
    function repaint(){
      if(!session)return;
      const ctx=white(pad);ctx.setTransform(pad.width/logicalWidth,0,0,pad.height/logicalHeight,0,0);
      if(session.base){const box=containRect(session.base.width,session.base.height,logicalWidth,logicalHeight,30);ctx.drawImage(session.base,box.x,box.y,box.width,box.height);}
      session.strokes.forEach(stroke=>drawStroke(ctx,stroke));
      refreshControls();
    }
    function refreshControls(){const signed=!!session.base||session.strokes.length>0;saveButton.disabled=!signed;guide.hidden=signed;}
    function layout(){
      if(!session||!stage.clientWidth||!stage.clientHeight)return;
      const width=stage.clientWidth,height=stage.clientHeight;rotated=height>width;
      logicalWidth=rotated?height:width;logicalHeight=rotated?width:height;
      const ratio=Math.min(2,Math.max(1,view.devicePixelRatio||1));
      const pixelWidth=Math.round(logicalWidth*ratio),pixelHeight=Math.round(logicalHeight*ratio);
      if(pad.width===pixelWidth&&pad.height===pixelHeight&&pad.dataset.rotated===String(rotated))return;
      pad.width=pixelWidth;pad.height=pixelHeight;pad.dataset.rotated=String(rotated);
      pad.style.width=logicalWidth+'px';pad.style.height=logicalHeight+'px';
      pad.style.transform=`translate(-50%,-50%)${rotated?' rotate(90deg)':''}`;
      guide.classList.toggle('is-rotated',rotated);repaint();
    }
    function stop(event){
      if(!session||event&&event.pointerId!==session.pointer)return;
      const pointer=session.pointer;session.pointer=null;
      if(pointer!=null&&pad.hasPointerCapture?.(pointer))pad.releasePointerCapture(pointer);
    }
    function finish(){
      if(!session)return;
      stop();session=null;observer?.disconnect();view.removeEventListener('resize',layout);
      if(dialog.open)dialog.close();button.focus();
    }
    function save(){
      if(!session)return false;
      if(!isCurrent()){finish();onContextChanged();return false;}
      stop();
      const ink=copyInk(pad,document);if(!ink)return false;
      const box=containRect(ink.width,ink.height,canvas.width,canvas.height,24),ctx=white(canvas);
      ctx.drawImage(ink,box.x,box.y,box.width,box.height);
      onSave();finish();return true;
    }
    function create(){
      dialog=document.createElement('dialog');dialog.className='signature-sheet';dialog.setAttribute('aria-labelledby','expandedSignatureTitle');
      dialog.innerHTML='<header class="signature-sheet-header"><div><h2 id="expandedSignatureTitle">Assinatura do cliente</h2><p>Vire o celular de lado e use a área branca para assinar.</p></div><button type="button" class="signature-sheet-cancel" data-signature-cancel>Cancelar</button></header><div class="signature-sheet-stage"><canvas aria-label="Área ampliada para a assinatura do cliente"></canvas><span class="signature-sheet-guide" aria-hidden="true">Assine aqui</span></div><footer class="signature-sheet-footer"><button type="button" class="btn secondary" data-signature-clear>Limpar</button><button type="button" class="btn primary" data-signature-save disabled>Salvar assinatura</button></footer>';
      document.body.append(dialog);stage=dialog.querySelector('.signature-sheet-stage');pad=stage.querySelector('canvas');guide=stage.querySelector('.signature-sheet-guide');saveButton=dialog.querySelector('[data-signature-save]');
      dialog.querySelector('[data-signature-cancel]').addEventListener('click',finish);
      dialog.querySelector('[data-signature-clear]').addEventListener('click',()=>{if(!session)return;stop();session.base=null;session.strokes=[];repaint();pad.focus();});
      saveButton.addEventListener('click',save);
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});
      dialog.addEventListener('close',()=>{if(!dialog.open)finish();});
      pad.tabIndex=0;
      pad.addEventListener('pointerdown',event=>{
        if(!session||session.pointer!=null||event.button!=null&&event.button!==0)return;
        event.preventDefault();session.pointer=event.pointerId;
        const stroke={points:[pointerPosition(event,pad.getBoundingClientRect(),rotated)]};session.strokes.push(stroke);
        try{pad.setPointerCapture(event.pointerId);}catch(_error){}
        drawStroke(pad.getContext('2d'),stroke);refreshControls();
      });
      pad.addEventListener('pointermove',event=>{
        if(!session||session.pointer!==event.pointerId)return;
        event.preventDefault();
        const samples=event.getCoalescedEvents?.(),points=session.strokes.at(-1).points,rect=pad.getBoundingClientRect(),segment=[points.at(-1)];
        for(const sample of samples?.length?samples:[event]){const point=pointerPosition(sample,rect,rotated);points.push(point);segment.push(point);}
        drawStroke(pad.getContext('2d'),{points:segment});
      });
      for(const name of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(name,stop);
      if(view.ResizeObserver)observer=new view.ResizeObserver(layout);
    }
    function open(){
      if(session||!canOpen())return false;
      if(!dialog)create();
      session={context:getContext(),base:isSigned()?copyInk(canvas,document):null,strokes:[],pointer:null};
      dialog.showModal();layout();repaint();observer?.observe(stage);view.addEventListener('resize',layout);pad.focus();return true;
    }
    button.addEventListener('click',open);
    return {open,cancel:finish,save};
  }
  return {bind,pointerPosition,containRect,inkBounds};
});
