/* Ícones locais e rótulos acessíveis. Não participa dos fluxos ou permissões. */
(() => {
  'use strict';
  const paths={
    home:'m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
    warehouse:'m3 9 9-6 9 6v12H3z M7 21V11h10v10 M7 16h10 M12 11v10',
    truck:'M3 5h11v12H3z M14 10h4l3 4v3h-7 M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    sales:'M3 4h3l3 11h10l2-8H7 M10 20h.01 M18 20h.01',
    form:'M8 4H5v17h14V4h-3 M8 3h8v4H8z M8 12h8 M8 16h5',
    settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l.7 3 2.6 1.5 2.9-.8 3 5.2-2.2 2.2v3l-2.8 1 1 2.9-5.2 3-2.2-2.2h-3l-2.2 2.2-5.2-3 .8-2.9L1 15v-6l3-.7L5.5 6 4.7 3.1',
    box:'m3 7 9-4 9 4v11l-9 4-9-4z M3 7l9 5 9-5 M12 12v10 M7 5l9 5',
    check:'M9 5H5v16h14V5h-4 M9 3h6v4H9z M8 13l3 3 5-6',
    calendar:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2',
    chart:'M4 3v18h17 M8 16v-5 M13 16V7 M18 16v-8',
    history:'M4 8a9 9 0 1 1-1 8 M4 3v5h5 M12 7v6l4 2',
    alert:'m12 3 10 18H2z M12 9v5 M12 17h.01',
    users:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-2a7 7 0 0 1 14 0v2 M17 4a4 4 0 0 1 0 8 M22 21v-2a7 7 0 0 0-4-6',
    plus:'M12 5v14 M5 12h14',
    list:'M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01',
    search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
    arrow:'M5 12h14 M14 7l5 5-5 5'
  };
  const icon=name=>`<svg class="ui-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]||paths.list}"/></svg>`;
  function enhance(){
    const areas={armazem:'warehouse',entrega:'truck',vendas:'sales',formularios:'form',puxada:'truck',configuracoes:'settings'};
    const modules={nri:'box',conferencia:'check',fefo:'calendar','ativo-giro':'box',refugo:'box',materiais:'warehouse'};
    document.querySelectorAll('.nav-area').forEach(el=>{const span=el.querySelector('.area-icon');if(span)span.innerHTML=icon(areas[el.dataset.area]);});
    document.querySelectorAll('.nav-module').forEach(el=>{const span=el.querySelector('.module-icon');if(span)span.innerHTML=icon(modules[el.dataset.module]||'form');});
    document.querySelectorAll('.nav-item[data-view]').forEach(el=>{
      const view=el.dataset.view||'';
      const name=view==='home'?'home':/dashboard|farol|metas/.test(view)?'chart':/historico|minhas|andamento/.test(view)?'history':/config|bases|modulos/.test(view)?'settings':/usuarios|contatos/.test(view)?'users':/cadastro|contagem|afericao/.test(view)?'plus':/avaria/.test(view)?'alert':/schedule/.test(view)?'calendar':'list';
      const span=el.querySelector(':scope > span');if(span){span.innerHTML=icon(name);span.setAttribute('aria-hidden','true');}
    });
    const modal=document.querySelector('#modal .modal-box');
    if(modal){modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','modalTitle');modal.setAttribute('aria-describedby','modalSubtitle');}
    for(const id of ['loginUsuario','loginSenha']){
      const field=document.getElementById(id),label=field?.closest('.field')?.querySelector('label');if(label)label.htmlFor=id;
    }
  }
  document.addEventListener('DOMContentLoaded',enhance,{once:true});
})();
