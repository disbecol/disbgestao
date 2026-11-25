/* Catálogo das telas atuais e acabamento dos componentes renderizados. */
(() => {
 'use strict';
 const SCREENS={
  home:['inicio','home'], 'modulos-config':['configuracoes','modules'],
  'nri-cadastro':['nri','receipt'], 'nri-carretas':['nri','receiving'], 'marketplace-recebimento':['nri','marketplace'], 'nri-pendentes':['nri','printing'], 'nri-historico':['nri','history'], 'nri-avarias-historico':['nri','damaged-pallets'],
  'conf-cadastro':['conferencia','bottles'], 'conf-minhas':['conferencia','history'], 'conf-historico':['conferencia','history'], 'conf-dashboard':['conferencia','dashboard'],
  'fefo-contagem':['fefo','count'], 'fefo-andamento':['fefo','running'], 'fefo-relatorios':['fefo','history'],
  'ativo-giro-contagem':['ativo','count'], 'ativo-giro-historico':['ativo','history'],
  'materiais-contagem':['materiais','inventory'], 'materiais-estoque':['materiais','stock'], 'materiais-cadastro':['materiais','catalog'], 'materiais-movimentacoes':['materiais','movement'],
  'refugo-afericao':['refugo','count'], 'refugo-historico':['refugo','history'], 'refugo-cadastros':['refugo','catalog'],
  'avaria-cadastro':['avarias','entry'], 'avaria-minhas':['avarias','own'], 'avaria-admin':['avarias','management'], 'avaria-dashboard':['avarias','dashboard'],
  'sales-avaria-cadastro':['vendas','damage-entry'], 'sales-avaria-minhas':['vendas','damage-own'], 'sales-avaria-gestao':['vendas','damage-management'], 'sales-stock-validity':['vendas','validity'], 'sales-pricing':['vendas','pricing'], 'rating-clients':['vendas','rating'],
  'returns-followup':['devolucoes','followup'], 'returns-summary':['devolucoes','summary'], 'returns-panel':['devolucoes','panel'], 'returns-city':['devolucoes','city'], 'returns-clients':['devolucoes','clients'], 'returns-new-clients':['devolucoes','new-clients'], 'returns-sellers':['devolucoes','sellers'], 'returns-team':['devolucoes','team'], 'returns-reasons':['devolucoes','reasons'],
  'returns-penalties':['devolucoes','penalties'], 'returns-monitoring':['devolucoes','monitoring'], 'returns-audited':['devolucoes','audited'], 'returns-priority-sheet':['devolucoes','priority-sheet'], 'returns-goals':['devolucoes','goals'], 'returns-import':['devolucoes','sources'],
  'fdr-reports':['raio','reports'], 'fdr-dashboard':['raio','dashboard'],
  'orders-new':['pedidos','new'], 'orders-own':['pedidos','own'], 'orders-queue':['pedidos','queue'], 'orders-manage':['pedidos','management'], 'orders-dashboard':['pedidos','dashboard'], 'orders-productivity':['pedidos','productivity'], 'orders-audit':['pedidos','audit'], 'orders-config':['pedidos','settings'],
  'forms-manage':['formularios','builder'], 'forms-fill':['formularios','application'], 'forms-self':['formularios','self'], 'forms-report':['formularios','report'], 'forms-schedule':['formularios','schedule'],
  'puxada-app-operations':['puxada','operations'], 'puxada-app-plans':['puxada','plans'], 'puxada-app-control':['puxada','control'], 'puxada-app-history':['puxada','history'], 'puxada-app-dashboard':['puxada','dashboard'], 'puxada-app-settings':['puxada','settings'],
  usuarios:['configuracoes','users'], 'contatos-clientes':['configuracoes','contacts'], produtos:['configuracoes','products'], bases:['configuracoes','imports']
 };
 const paths={
  box:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/>',
  money:'<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M7 9h.01M17 15h.01"/>',
  people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5"/>'
 };
 let sequence=0,mounted=false,pending=false;
 function enhance(root=document){
  for(const view of root.querySelectorAll?.('.view[id]')||[]){
   const config=SCREENS[view.id.slice(5)];if(!config)continue;
   view.classList.add('screen-workspace');view.dataset.screenArea=config[0];view.dataset.screenLayout=config[1];
  }
  for(const scope of root.querySelectorAll?.('.screen-workspace,#modalBody,#loginScreen')||[]){
   for(const field of scope.querySelectorAll('.field,.rt-field,.od-field,.fdr-field,.fm-field')){
    const control=field.querySelector('input:not([type=hidden]),select,textarea');if(!control)continue;
    field.classList.toggle('screen-field-automatic',!!control.readOnly||control.hasAttribute('readonly'));
    const label=field.matches('label')?field:field.querySelector('label');
    if(label&&!label.contains(control)&&!label.getAttribute('for')){if(!control.id)control.id='screen-control-'+(++sequence);label.setAttribute('for',control.id);}
   }
   for(const wrapper of scope.querySelectorAll('.table-wrap,.rt-table-wrap,.od-table-wrap,.fdr-table-wrap,.fm-table-wrap')){
    if(!wrapper.hasAttribute('tabindex'))wrapper.tabIndex=0;
    if(!wrapper.hasAttribute('role'))wrapper.setAttribute('role','region');
    if(!wrapper.hasAttribute('aria-label'))wrapper.setAttribute('aria-label','Tabela de '+(scope.querySelector('h1')?.textContent.trim()||'registros'));
    for(const th of wrapper.querySelectorAll('thead th'))if(!th.hasAttribute('scope'))th.setAttribute('scope','col');
   }
   for(const cell of scope.querySelectorAll('tbody td[colspan]'))cell.classList.toggle('screen-empty-cell',/^(nenhum|nenhuma|sem |aguardando|não há)/i.test(cell.textContent.trim()));
   for(const metric of scope.querySelectorAll('.kpi,.mat-kpi')){
    if(metric.querySelector('.screen-metric-icon'))continue;
    const label=(metric.querySelector('span,small')?.textContent||'').toLocaleLowerCase('pt-BR');
    const type=/r\$|valor|divergência.*(posit|negat)/.test(label)?'money':/pend|diferen|problema|sem base/.test(label)?'alert':/colabor|pessoa|motorista/.test(label)?'people':/confer|conclu|entreg/.test(label)?'check':'box';
    const icon=document.createElement('i');icon.className='screen-metric-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+paths[type]+'</svg>';metric.prepend(icon);
   }
  }
 }
 function mount(){
  if(mounted)return;mounted=true;enhance();
  if(typeof MutationObserver==='undefined')return;
  const observer=new MutationObserver(records=>{
   if(pending||!records.some(r=>r.addedNodes.length||r.removedNodes.length))return;
   pending=true;(typeof requestAnimationFrame==='function'?requestAnimationFrame:setTimeout)(()=>{pending=false;enhance();});
  });
  for(const id of ['mainContent','modalBody']){const el=document.getElementById(id);if(el)observer.observe(el,{childList:true,subtree:true});}
 }
 window.DISB_SCREEN_DESIGN={SCREENS,enhance,mount};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
