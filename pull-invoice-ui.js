/* Nota de Puxada and product catalog UI. Loaded after app.js. */
let invoiceAdminProducts=[];
let nriInvoiceContext=null;

async function fetchInvoiceProducts(){
  return fetchReferencePages(()=>sb.from('products').select('code,name,active,nf_reference_code,commercial_units_per_pallet,invoice_unit').order('code'),PRODUCT_REF_LIMIT);
}
async function loadProductsAdmin(){
  if(!hasPerm('ADMIN_BASES'))return;
  try{invoiceAdminProducts=await fetchInvoiceProducts();renderProductsAdmin();}
  catch(error){toast(humanError(error),'error');}
}
function renderProductsAdmin(){
  const q=norm($('productAdminSearch')?.value||'');
  const rows=invoiceAdminProducts.filter(p=>!q||norm([p.code,p.name,p.nf_reference_code].join(' ')).includes(q));
  $('productAdminCount').textContent=`${rows.length} de ${invoiceAdminProducts.length} produtos`;
  $('productAdminRows').innerHTML=rows.map(p=>`<tr><td><strong>${esc(p.code)}</strong></td><td>${esc(p.name)}${p.active?'':' <span class="status rejected">Inativo</span>'}</td><td>${esc(p.nf_reference_code||'—')}</td><td>${p.commercial_units_per_pallet||'—'}</td><td>${esc(p.invoice_unit||'—')}</td><td><button type="button" class="mini-btn" data-product-edit="${esc(p.code)}">Editar</button></td></tr>`).join('')||'<tr><td colspan="6">Nenhum produto encontrado.</td></tr>';
}
function editProductAdmin(code){
  const p=invoiceAdminProducts.find(x=>String(x.code)===String(code));if(!p)return;
  $('productAdminOriginalCode').value=p.code;$('productAdminCode').value=p.code;$('productAdminCode').readOnly=true;
  $('productAdminName').value=p.name;$('productAdminReference').value=p.nf_reference_code||'';
  $('productAdminPallet').value=p.commercial_units_per_pallet||'';$('productAdminUnit').value=p.invoice_unit||'';
  $('productAdminActive').checked=!!p.active;$('formProductAdmin').scrollIntoView({behavior:'smooth',block:'start'});
}
function clearProductAdmin(){
  $('formProductAdmin').reset();$('productAdminOriginalCode').value='';$('productAdminCode').readOnly=false;$('productAdminActive').checked=true;
}
async function saveProductAdmin(event){
  event.preventDefault();if(!hasPerm('ADMIN_BASES'))return;
  const code=normalizeCode($('productAdminCode').value),name=$('productAdminName').value.trim(),reference=$('productAdminReference').value.trim().toUpperCase(),capacityText=$('productAdminPallet').value.trim(),capacity=capacityText?Number(capacityText):null,unit=$('productAdminUnit').value||null;
  if(!code||!name)return toast('Informe código Promax e nome do produto.','error');
  if(capacity!==null&&(!Number.isInteger(capacity)||capacity<1))return toast('Informe um número inteiro positivo para unidades por palete.','error');
  if(reference==='#N/D')return toast('Substitua #N/D pela referência correta ou deixe o campo vazio.','error');
  const row={code,name,active:$('productAdminActive').checked,nf_reference_code:reference||null,commercial_units_per_pallet:capacity,invoice_unit:unit,updated_at:new Date().toISOString()};
  const button=event.submitter||$('formProductAdmin').querySelector('button[type="submit"]');button.disabled=true;
  try{const {error}=await sb.from('products').upsert(row,{onConflict:'code'});if(error)throw error;clearProductAdmin();localStorage.removeItem(REF_CACHE_KEY);await Promise.all([loadProductsAdmin(),loadReferences(false)]);toast('Produto salvo.','success');}
  catch(error){toast(humanError(error),'error');}
  finally{button.disabled=false;}
}

let pdfScriptPromise=null;
async function invoicePdfLibrary(){
  if(!pdfScriptPromise)pdfScriptPromise=loadPullPdfScript('vendor/pdfjs.min.js').then(()=>{
    if(!window.pdfjsLib)throw new Error('Leitor de PDF indisponível.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdfjs.worker.min.js';return window.pdfjsLib;
  }).catch(error=>{pdfScriptPromise=null;throw error;});
  return pdfScriptPromise;
}
async function pullInvoiceByTrip(tripId){
  const {data,error}=await sb.from('pull_trip_invoices').select('*').eq('trip_id',tripId).maybeSingle();
  if(error)throw error;return data;
}
async function pullInvoiceLink(note){
  const {data,error}=await sb.storage.from('puxada-notas').createSignedUrl(note.pdf_path,3600);
  if(error)throw error;return data.signedUrl;
}
function invoiceItemSummary(items){
  return (items||[]).map(x=>`<div class="invoice-summary-row"><strong>${esc(x.product_code)} • ${esc(x.product_name)}</strong><span>${fmtNum(x.quantity)} ${esc(x.commercial_unit)} ÷ ${fmtNum(x.commercial_units_per_pallet)} = ${x.full_pallets}${Number(x.remaining_units)>0?` + 1 parcial (${fmtNum(x.remaining_units)} ${esc(x.commercial_unit)})`:''} NRI(s)</span></div>`).join('');
}
async function openPullInvoiceModal(tripId){
  if(!tripId)return;
  openModal('Nota de Puxada','Anexe um PDF DANFE com texto selecionável',`<div id="pullInvoiceExisting" class="notice compact">Consultando nota anexada…</div><div class="field"><label for="pullInvoicePdfFile">Nota em PDF</label><input id="pullInvoicePdfFile" type="file" accept="application/pdf,.pdf"></div><div class="field"><label for="pullInvoiceNumber">Número da nota</label><input id="pullInvoiceNumber" inputmode="numeric" placeholder="Preenchido automaticamente quando encontrado"></div><div id="pullInvoicePreview" class="import-result">Selecione um arquivo para conferir os produtos antes de anexar.</div>`,[
    {label:'Anexar PDF',class:'primary',onClick:()=>savePullInvoiceFromModal(tripId)},
    {label:'Fechar',class:'secondary',onClick:closeModal}
  ]);
  $('pullInvoicePdfFile').addEventListener('change',previewPullInvoiceFile);
  try{const note=await pullInvoiceByTrip(tripId);const box=$('pullInvoiceExisting');if(!box)return;
    if(!note){box.textContent='Nenhuma nota anexada a esta puxada.';return;}
    const url=await pullInvoiceLink(note);box.innerHTML=`<strong>Nota atual: ${esc(note.invoice_number||'sem número')}</strong> • ${(note.items||[]).length} produto(s) <a href="${esc(url)}" target="_blank" rel="noopener">Abrir PDF</a><div>${invoiceItemSummary(note.items)}</div>`;
  }catch(error){if($('pullInvoiceExisting'))$('pullInvoiceExisting').textContent=humanError(error);}
}
let invoicePrepared=null;
async function previewPullInvoiceFile(){
  const file=$('pullInvoicePdfFile')?.files?.[0],box=$('pullInvoicePreview');invoicePrepared=null;
  if(!file){box.textContent='Selecione um PDF.';return;}
  if(file.size>10*1024*1024||file.size<100||(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf')){box.textContent='Selecione um PDF de até 10 MB.';return;}
  box.textContent='Lendo os produtos da nota…';
  try{const [pdfjs,products]=await Promise.all([invoicePdfLibrary(),fetchInvoiceProducts()]);
    const parsed=await window.DISB_INVOICE_NOTE.readPdf(file,pdfjs),matched=window.DISB_INVOICE_NOTE.matchProducts(parsed.lines,products);
    if(parsed.invoice_number)$('pullInvoiceNumber').value=parsed.invoice_number;
    invoicePrepared={file,parsed,matched};
    const nris=matched.reduce((n,x)=>n+x.full_pallets+(x.remaining_units>0?1:0),0);
    box.innerHTML=`<strong>${matched.length} produto(s) • ${nris} NRI(s)</strong><p>As linhas repetidas foram somadas por referência antes da conversão.</p>${invoiceItemSummary(matched)}`;
  }catch(error){box.textContent=humanError(error);}
}
async function savePullInvoiceFromModal(tripId){
  const prepared=invoicePrepared,file=$('pullInvoicePdfFile')?.files?.[0];
  if(!prepared||prepared.file!==file)return toast('Selecione e confira uma nota PDF válida.','error');
  const button=[...$('modalActions').querySelectorAll('button')].find(b=>b.textContent==='Anexar PDF');button.disabled=true;button.textContent='Anexando…';
  let path='',uploaded=false;
  try{
    const previous=await pullInvoiceByTrip(tripId);
    path=`${tripId}/${authUser.id}/${uuid()}.pdf`;
    const upload=await sb.storage.from('puxada-notas').upload(path,file,{contentType:'application/pdf',upsert:false});if(upload.error)throw upload.error;uploaded=true;
    const saved=await sb.rpc('register_pull_trip_invoice',{p_trip_id:tripId,p_pdf_path:path,p_invoice_number:$('pullInvoiceNumber').value.trim(),p_lines:prepared.parsed.lines});if(saved.error)throw saved.error;
    if(previous?.pdf_path&&previous.pdf_path!==path)await sb.storage.from('puxada-notas').remove([previous.pdf_path]).catch(()=>{});
    closeModal();invoicePrepared=null;toast('Nota vinculada à puxada. Produtos e paletes estarão prontos no cadastro de NRIs.','success');
    if(pullActiveTrip?.id===tripId)void refreshPullInvoiceDriver();
    if(activeView==='nri-carretas')void loadPullNriPending(true);
  }catch(error){if(uploaded)await sb.storage.from('puxada-notas').remove([path]).catch(()=>{});toast(humanError(error),'error');}
  finally{button.disabled=false;button.textContent='Anexar PDF';}
}
async function refreshPullInvoiceDriver(){
  const box=$('pullInvoiceDriverStatus');if(!box||!pullActiveTrip||pullActiveTrip.cycle_type!=='PULL')return;
  try{const note=await pullInvoiceByTrip(pullActiveTrip.id);if(!note){box.textContent='Nenhuma nota anexada.';return;}
    const url=await pullInvoiceLink(note);box.innerHTML=`<strong>Nota ${esc(note.invoice_number||'anexada')}</strong> • ${(note.items||[]).length} produto(s) <a href="${esc(url)}" target="_blank" rel="noopener">Abrir PDF</a>`;
  }catch(error){box.textContent=humanError(error);}
}

const invoiceOriginalLoadPull=loadPullActiveTrip;
loadPullActiveTrip=async function(...args){const result=await invoiceOriginalLoadPull(...args);$('pullInvoiceDriverCard')?.classList.toggle('hidden',!pullActiveTrip||pullActiveTrip.cycle_type!=='PULL');if(pullActiveTrip?.cycle_type==='PULL')void refreshPullInvoiceDriver();return result;};
const invoiceOriginalRenderFarol=renderPullFarol;
renderPullFarol=function(...args){const result=invoiceOriginalRenderFarol(...args),box=$('pullFarolCards');box?.querySelectorAll('[data-pull-detail]').forEach(details=>{const id=details.dataset.pullDetail,t=box._rows?.find(x=>x.id===id);if(t?.cycle_type!=='PULL')return;const button=document.createElement('button');button.type='button';button.className='btn secondary wide';button.dataset.pullInvoice=id;button.textContent='Nota de Puxada';details.after(button);});return result;};
const invoiceOriginalPending=loadPullNriPending;
loadPullNriPending=async function(...args){const result=await invoiceOriginalPending(...args),box=$('pullNriCards'),ids=[...box?.querySelectorAll('[data-pull-nri]')||[]].map(b=>b.dataset.pullNri);if(!ids.length)return result;
  try{const {data,error}=await sb.from('pull_trip_invoices').select('trip_id,invoice_number').in('trip_id',ids);if(error)throw error;const byTrip=new Map((data||[]).map(x=>[x.trip_id,x]));box.querySelectorAll('[data-pull-nri]').forEach(action=>{const note=byTrip.get(action.dataset.pullNri);if(!note)return;const label=document.createElement('span');label.className='status approved';label.textContent=`Nota ${note.invoice_number||'anexada'}`;action.before(label);const btn=document.createElement('button');btn.type='button';btn.className='mini-btn';btn.dataset.pullInvoice=action.dataset.pullNri;btn.textContent='Ver nota';action.before(btn);});}
  catch(error){console.warn('Notas das puxadas pendentes',error);}return result;};

const invoiceOriginalPrefill=prefillNriFromPull;
prefillNriFromPull=async function(trip){
  invoiceOriginalPrefill(trip);nriInvoiceContext=null;
  try{const note=await pullInvoiceByTrip(trip.id);if(!note)return;
    nriInvoiceContext=note;nriDraftItems=[];
    for(const item of note.items||[]){const common={product_code:item.product_code,product_name:item.product_name,validity_date:null,lot:'',block_date:null,pallet_damaged:false,damaged_pallets:0,damage_reason:'',invoice_number:note.invoice_number||'',damagePhotos:[],invoice_pending:true};
      if(Number(item.full_pallets)>0)nriDraftItems.push({...common,id:uuid(),quantity:Number(item.commercial_units_per_pallet),pallets:Number(item.full_pallets)});
      if(Number(item.remaining_units)>0)nriDraftItems.push({...common,id:uuid(),quantity:Number(item.remaining_units),pallets:1});
    }
    renderNriDraftItems();const total=nriDraftItems.reduce((sum,x)=>sum+x.pallets,0);
    $('nriPullBanner').innerHTML=`<strong>${esc(trip.trip_code)} • Nota ${esc(note.invoice_number||'anexada')} • ${total} NRI(s)</strong><span>Produtos e quantidades preenchidos pela nota. Edite cada linha para informar lote e validade. Use “Dividir lotes” se um produto tiver mais de um lote ou validade.</span>`;
  }catch(error){toast(`Não foi possível carregar a nota da puxada: ${humanError(error)}`,'error');}
};
const invoiceOriginalClearNri=clearNriRequest;
clearNriRequest=function(...args){nriInvoiceContext=null;return invoiceOriginalClearNri(...args);};
const invoiceOriginalRenderNri=renderNriDraftItems;
renderNriDraftItems=function(...args){const result=invoiceOriginalRenderNri(...args);for(const row of $('nriItemList')?.querySelectorAll('.item-row[data-id]')||[]){const item=nriDraftItems.find(x=>x.id===row.dataset.id);if(!item)continue;
    const values=row.querySelectorAll('.info strong');if(item.invoice_pending){if(values[2])values[2].textContent='Preencher lote';if(values[1])values[1].textContent='Preencher validade';}
    if(nriInvoiceContext&&Number(item.pallets)>1){const actions=row.querySelector('.mini-actions');if(actions&&!actions.querySelector('[data-act="split"]')){const button=document.createElement('button');button.className='mini-btn';button.dataset.act='split';button.textContent='Dividir lotes';actions.prepend(button);}}
  }return result;};
const invoiceOriginalNriListClick=onNriDraftListClick;
onNriDraftListClick=function(event){const button=event.target.closest('button[data-act]');if(button?.dataset.act==='split'){const item=nriDraftItems.find(x=>x.id===button.closest('[data-id]')?.dataset.id);if(item)splitInvoiceNriItem(item);return;}
  const id=button?.closest('[data-id]')?.dataset.id,item=nriDraftItems.find(x=>x.id===id);const result=invoiceOriginalNriListClick(event);
  if(button?.dataset.act==='edit'&&item?.invoice_pending){$('nriSemValidade').checked=false;updateNriValidityMode();}
  if(button?.dataset.act==='edit'&&nriInvoiceContext&&!$('nriDamageInvoice').value)$('nriDamageInvoice').value=nriInvoiceContext.invoice_number||'';
  return result;};
function splitInvoiceNriItem(item){
  if(Number(item.pallets)<2)return;
  openModal('Dividir paletes',`${item.product_code} • ${item.product_name}`,`<p>Informe quantos paletes terão outro lote ou validade. O total da nota será mantido.</p><div class="field"><label for="invoiceSplitCount">Paletes da nova linha</label><input id="invoiceSplitCount" type="number" min="1" max="${item.pallets-1}" step="1" value="1"></div>`,[
    {label:'Dividir',class:'primary',onClick:()=>{const count=Number($('invoiceSplitCount').value);if(!Number.isInteger(count)||count<1||count>=item.pallets)return toast('Informe uma quantidade menor que os paletes da linha.','error');item.pallets-=count;nriDraftItems.push({...item,id:uuid(),pallets:count,lot:'',validity_date:null,block_date:null,invoice_pending:true,pallet_damaged:false,damagePhotos:[]});clearNriItemEditor();renderNriDraftItems();closeModal();}},
    {label:'Cancelar',class:'secondary',onClick:closeModal}
  ]);
}
const invoiceOriginalSubmitNri=submitNriRequestOnce;
submitNriRequestOnce=async function(){
  if(nriInvoiceContext){
    const pending=nriDraftItems.find(x=>x.invoice_pending||!sanitizeLot(x.lot));if(pending)return toast(`Preencha lote e validade de ${pending.product_code} antes de emitir os NRIs.`,'error');
    const expected=new Map(),actual=new Map();for(const x of nriInvoiceContext.items||[])expected.set(String(x.product_code),(expected.get(String(x.product_code))||0)+Number(x.quantity));
    for(const x of nriDraftItems)actual.set(String(x.product_code),(actual.get(String(x.product_code))||0)+Number(x.quantity)*Number(x.pallets));
    for(const [code,quantity] of expected)if(actual.get(code)!==quantity)return toast(`A quantidade do produto ${code} não confere com a nota: esperado ${fmtNum(quantity)}, lançado ${fmtNum(actual.get(code)||0)}.`,'error');
    for(const code of actual.keys())if(!expected.has(code))return toast(`O produto ${code} não está na nota da puxada.`,'error');
  }
  return invoiceOriginalSubmitNri();
};

window.addEventListener('DOMContentLoaded',()=>{
  $('formProductAdmin')?.addEventListener('submit',saveProductAdmin);
  $('productAdminNew')?.addEventListener('click',clearProductAdmin);
  $('productAdminRefresh')?.addEventListener('click',loadProductsAdmin);
  $('productAdminSearch')?.addEventListener('input',renderProductsAdmin);
  $('productAdminRows')?.addEventListener('click',event=>{const button=event.target.closest('[data-product-edit]');if(button)editProductAdmin(button.dataset.productEdit);});
  $('pullInvoiceDriverButton')?.addEventListener('click',()=>openPullInvoiceModal(pullActiveTrip?.id));
  $('pullFarolCards')?.addEventListener('click',event=>{const button=event.target.closest('[data-pull-invoice]');if(button)openPullInvoiceModal(button.dataset.pullInvoice);});
  $('pullNriCards')?.addEventListener('click',event=>{const button=event.target.closest('[data-pull-invoice]');if(button)openPullInvoiceModal(button.dataset.pullInvoice);});
});
