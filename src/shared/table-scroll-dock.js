// Navegação horizontal do histórico disponível no rodapé, em qualquer linha.
(function(){
  function setup(){
    const view=document.getElementById('view-puxada-historico');
    const wrap=view?.querySelector('.pull-history-wrap'),table=wrap?.querySelector('table');
    if(!view||!wrap||!table||document.getElementById('pullHistoryScrollDock'))return;
    wrap.id='pullHistoryTableViewport';
    const dock=document.createElement('div');dock.id='pullHistoryScrollDock';dock.className='pull-history-scroll-dock';dock.hidden=true;
    dock.setAttribute('role','region');dock.setAttribute('aria-label','Rolagem lateral do relatório de puxada');
    dock.innerHTML='<button type="button" aria-label="Rolar relatório para a esquerda" title="Rolar para a esquerda">‹</button><div class="pull-history-scroll-track" tabindex="0" role="region" aria-label="Arraste a barra para ver as colunas do relatório" aria-controls="pullHistoryTableViewport"><div class="pull-history-scroll-spacer"></div></div><button type="button" aria-label="Rolar relatório para a direita" title="Rolar para a direita">›</button>';
    document.body.appendChild(dock);
    wrap.classList.add('pull-history-dock-ready');
    const track=dock.querySelector('.pull-history-scroll-track'),spacer=dock.querySelector('.pull-history-scroll-spacer'),buttons=dock.querySelectorAll('button');
    let frame=0;const synchronized=new WeakMap();
    function sync(from,to){
      const range=from.scrollWidth-from.clientWidth,target=to.scrollWidth-to.clientWidth;
      const next=range>0?from.scrollLeft/range*Math.max(0,target):0;
      if(Math.abs(to.scrollLeft-next)>1){to.scrollLeft=next;synchronized.set(to,to.scrollLeft);}
    }
    function update(){
      frame=0;
      const r=wrap.getBoundingClientRect();
      const visible=wrap.getClientRects().length&&r.bottom>90&&r.top<window.innerHeight-30
        &&wrap.scrollWidth>wrap.clientWidth+1&&!document.querySelector('.modal.open');
      dock.hidden=!visible;if(!visible)return;
      const left=Math.max(8,r.left),right=Math.min(window.innerWidth-8,r.right);
      dock.style.left=left+'px';dock.style.width=Math.max(0,right-left)+'px';
      // As setas ocupam espaço no dock: preservar a mesma proporção da tabela.
      const ratio=wrap.clientWidth/wrap.scrollWidth;
      spacer.style.width=Math.max(track.clientWidth,track.clientWidth/ratio)+'px';
      sync(wrap,track);
      buttons[0].disabled=wrap.scrollLeft<=1;
      buttons[1].disabled=wrap.scrollLeft>=wrap.scrollWidth-wrap.clientWidth-1;
    }
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    function onScroll(from,to){const expected=synchronized.get(from);synchronized.delete(from);if(expected==null||Math.abs(from.scrollLeft-expected)>1)sync(from,to);schedule();}
    wrap.addEventListener('scroll',()=>onScroll(wrap,track),{passive:true});
    track.addEventListener('scroll',()=>onScroll(track,wrap),{passive:true});
    buttons.forEach((button,i)=>button.addEventListener('click',()=>wrap.scrollBy({left:(i?1:-1)*Math.max(240,wrap.clientWidth*.7),behavior:'smooth'})));
    track.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      wrap.scrollLeft=event.key==='Home'?0:event.key==='End'?wrap.scrollWidth:event.key==='ArrowLeft'?wrap.scrollLeft-64:wrap.scrollLeft+64;
    });
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});
    if(window.ResizeObserver){const observer=new ResizeObserver(schedule);observer.observe(wrap);observer.observe(table);}
    const observer=new MutationObserver(schedule);
    observer.observe(table,{childList:true,subtree:true});
    for(const el of [view,document.getElementById('appShell'),document.getElementById('modal')])if(el)observer.observe(el,{attributes:true,attributeFilter:['class','hidden']});
    schedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
