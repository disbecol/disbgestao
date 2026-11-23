/* Organização do detalhe de entrega; preserva os controles e seus eventos. */
(() => {
 'use strict';
 const labels={PENDENTE:'Aguardando análise',APROVADO:'Aguardando lançamento',LANCADO:'Aguardando entrega',ENTREGUE:'Entregue',REPROVADO:'Reprovada',CANCELADO:'Cancelada'};
 function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text)el.textContent=text;return el;}
 function setup(body,cards,actions){
  body.classList.add('damage-detail-v2');
  const hero=body.querySelector(':scope > .damage-request-hero');hero?.querySelector('.damage-counts')?.remove();
  const title=document.getElementById('modalTitle');if(title)title.textContent='Detalhes da avaria';
  const subtitle=document.getElementById('modalSubtitle');if(subtitle)subtitle.textContent='';
  const products=element('section','damage-v2-products'),information=element('section','damage-v2-information');products.id='damage-v2-products';information.id='damage-v2-information';information.hidden=true;
  const nav=element('div','damage-v2-tabs');nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Informações da avaria');
  const tabs=[['products',`Produtos e ações (${cards.length})`],['information','Dados e documentos']].map(([key,label])=>{const button=element('button','',label);button.type='button';button.id='damage-v2-tab-'+key;button.dataset.damageView=key;button.setAttribute('role','tab');button.setAttribute('aria-controls','damage-v2-'+key);nav.append(button);return button;});
  for(const [key,box] of [['products',products],['information',information]]){box.setAttribute('role','tabpanel');box.setAttribute('aria-labelledby','damage-v2-tab-'+key);}
  hero?.after(nav);body.append(products,information);
  const selection=body.querySelector('.delivery-selection-bar');if(selection){selection.querySelector('small').textContent='Selecione produtos da mesma etapa para uma ação em conjunto.';products.append(selection);selection.hidden=cards.length<2;}
  const context=body.querySelector(':scope > .damage-request-grid');
  if(context){const section=element('section','damage-v2-info-section');section.append(element('h3','','Dados do registro'),context);information.append(section);}
  const geo=body.querySelector(':scope > .damage-geo-details');if(geo)information.append(geo);
  const signature=body.querySelector(':scope > .signature-details');
  if(signature){const section=element('section','damage-v2-info-section');section.append(element('h3','','Assinatura do cliente'));for(const child of [...signature.children])if(child.tagName!=='SUMMARY')section.append(child);signature.remove();information.append(section);}
  const records=element('section','damage-v2-info-section damage-v2-history');records.append(element('h3','','Histórico por produto'));
  const administration=element('section','damage-v2-info-section damage-v2-administration');administration.append(element('h3','','Outras ações'));
  for(const card of cards){
   products.append(card);card.hidden=false;card.classList.remove('damage-stage-hidden');card.classList.add('is-expanded');
   const head=card.querySelector('.damage-product-head'),panel=card.querySelector('.damage-product-details');if(!head||!panel)continue;
   head.querySelector('[data-damage-details-toggle]')?.remove();panel.hidden=false;panel.removeAttribute('aria-labelledby');panel.setAttribute('aria-label','Informações do produto');
   const identity=head.querySelector('strong')?.textContent||'Produto';
   const status=panel.querySelector('.damage-detail-heading .status');if(status){status.textContent=labels[card.dataset.damageStatus]||status.textContent;status.classList.add('damage-v2-status');head.append(status);}
   panel.querySelector('.damage-detail-heading')?.remove();
   const summary=panel.querySelector('.damage-summary-grid');
   if(summary){for(const cell of [...summary.children])if(cell.querySelector('small')?.textContent==='QUANTIDADE')cell.remove();summary.classList.add('damage-v2-facts');}
   const lot=panel.querySelector('.damage-lot-row');if(lot){lot.classList.add('damage-v2-lot');const missing=lot.querySelector('.status.rejected');if(missing){missing.className='damage-v2-lot-note';missing.textContent='Sem correspondência na base NRI';}if(lot.querySelector('.damage-lot-info'))lot.remove();else summary?.firstElementChild?.append(lot);}
   const actionRow=panel.querySelector('.damage-product-actions'),actionButtons=[...panel.querySelectorAll('.damage-card-action')];
   const primary=element('div','damage-v2-primary-actions');
   for(const button of actionButtons){
    if(button.hasAttribute('data-delivery-cancel')){const row=element('div','damage-v2-admin-row');row.append(element('span','',identity),button);administration.append(row);}
    else{if(button.hasAttribute('data-delivery-delivered'))button.textContent='Confirmar entrega';if(button.hasAttribute('data-delivery-launch'))button.textContent='Registrar lançamento';primary.append(button);}
   }
   actionRow?.remove();if(primary.children.length)head.append(primary);
   const photos=panel.querySelector('.damage-evidence');if(photos){const count=photos.querySelectorAll('.damage-photo-open').length;const summary=photos.querySelector('summary');if(summary)summary.textContent=count?`Fotos do produto (${count})`:'Sem fotos anexadas';if(count)panel.append(photos);else photos.replaceWith(element('p','damage-v2-no-photos','Sem fotos anexadas.'));}
   const history=panel.querySelector('.damage-decision-history');if(history){const group=element('details','damage-v2-history-group');group.append(element('summary','',identity));for(const child of [...history.children])if(child.tagName!=='SUMMARY')group.append(child);history.remove();records.append(group);}
   const check=head.querySelector('.damage-check');if(check)check.hidden=cards.length<2;
  }
  const footerButtons=[...actions.querySelectorAll('.btn')];
  const receipt=footerButtons.find(button=>button.classList.contains('damage-receipts-action'));
  if(receipt){const section=element('section','damage-v2-info-section');section.append(element('h3','','Comprovantes'),receipt);information.prepend(section);}
  for(const button of footerButtons.filter(button=>button.classList.contains('damage-action-global')&&button!==receipt))administration.append(button);
  if(records.children.length>1)information.append(records);if(administration.children.length>1)information.append(administration);
  let current='products';
  const refresh=()=>{
   const checked=[...products.querySelectorAll('.delivery-review-check:checked')];
   for(const button of footerButtons){if(!actions.contains(button))continue;button.hidden=current!=='products'||!checked.some(check=>button.classList.contains('damage-action-'+check.dataset.reviewKind));}
   actions.hidden=![...actions.querySelectorAll('.btn')].some(button=>!button.hidden);
   const label=products.querySelector('#avariaSelectionSummary');if(label)label.textContent=`${checked.length} selecionado${checked.length===1?'':'s'}`;
   const all=products.querySelector('#deliveryDamageSelectAll'),available=[...products.querySelectorAll('.delivery-review-check')];
   if(all){all.checked=available.length>0&&checked.length===available.length;all.indeterminate=checked.length>0&&checked.length<available.length;}
  };
  function select(key){current=key;products.hidden=key!=='products';information.hidden=key!=='information';for(const tab of tabs){const active=tab.dataset.damageView===key;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;tab.classList.toggle('active',active);}refresh();}
  for(const tab of tabs){tab.addEventListener('click',()=>select(tab.dataset.damageView));tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const key=event.key==='Home'?'products':event.key==='End'?'information':current==='products'?'information':'products';select(key);tabs.find(tab=>tab.dataset.damageView===key).focus();});}
  products.addEventListener('change',event=>{
   const target=event.target;if(target.matches('.delivery-review-check')&&target.checked){for(const check of products.querySelectorAll('.delivery-review-check'))if(check.dataset.reviewKind!==target.dataset.reviewKind)check.checked=false;}
   if(target.id==='deliveryDamageSelectAll'&&target.checked){const first=[...products.querySelectorAll('.delivery-review-check')][0];for(const check of products.querySelectorAll('.delivery-review-check'))check.checked=check.dataset.reviewKind===first?.dataset.reviewKind;}
   refresh();
  });select('products');
 }
 window.DISB_DAMAGE_WORKSPACE={setup};
})();
