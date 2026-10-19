// Correcoes administrativas de contagens FEFO finalizadas.
// O backend registra cada alteracao; esta tela nao publica dados em Vendas.
let fefoCorrectionContext=null;
const originalOpenFefoReport=openFefoReport;
openFefoReport=function(id){
  originalOpenFefoReport(id);
  const count=fefoReports.find(row=>row.id===id);
  if(!count||count.status!=='COMPLETED'||!isAdmin()||!hasPerm('FEFO_REPORT'))return;
  const button=document.createElement('button');
  button.className='btn secondary';
  button.textContent='Editar contagem';
  button.addEventListener('click',()=>openFefoCorrection(id));
  $('modalActions').prepend(button);
};

function fefoCorrectionCount(){return fefoReports.find(row=>row.id===fefoCorrectionContext?.countId);}
function fefoCorrectionItems(){return [...(fefoItemsByCount.get(fefoCorrectionContext?.countId)||[])].sort(fefoItemSort);}
function fefoLocalDateTime(value){
  if(!value)return '';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function fefoTimestampFromInput(value){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value||''))return '';
  const date=new Date(`${value}:00-03:00`);
  return Number.isNaN(date.getTime())?'':date.toISOString();
}
function fefoCorrectionReason(){return $('fefoCorrectionReason')?.value.trim()||'';}
function requireFefoReason(){
  const reason=fefoCorrectionReason();
  if(reason.length<5||reason.length>500){toast('Descreva a correção em pelo menos 5 caracteres.','error');$('fefoCorrectionReason')?.focus();return '';}
  return reason;
}

async function openFefoCorrection(countId){
  if(!isAdmin()||!hasPerm('FEFO_REPORT'))return;
  const count=fefoReports.find(row=>row.id===countId);
  if(!count||count.status!=='COMPLETED')return;
  fefoCorrectionContext={countId,profiles:[],units:[],edits:[],search:''};
  openModal(`Editar • ${count.count_code}`,'Carregando dados da contagem…','<p class="notice">Carregando…</p>',[{label:'Voltar ao relatório',class:'secondary',onClick:()=>openFefoReport(countId)}]);
  try{
    const [profiles,units,edits]=await Promise.all([
      sb.from('profiles').select('id,username,name').order('name'),
      sb.from('units').select('name').eq('active',true).order('name'),
      sb.from('fefo_completed_edits').select('target,action,before_data,after_data,reason,edited_by,edited_at').eq('count_id',countId).order('edited_at',{ascending:false}).limit(30)
    ]);
    for(const result of [profiles,units,edits])if(result.error)throw result.error;
    if(fefoCorrectionContext?.countId!==countId)return;
    fefoCorrectionContext.profiles=profiles.data||[];
    fefoCorrectionContext.units=units.data||[];
    fefoCorrectionContext.edits=edits.data||[];
    renderFefoCorrection();
  }catch(error){toast(humanFefoError(error),'error');openFefoReport(countId);}
}

function renderFefoCorrection(){
  const context=fefoCorrectionContext,count=fefoCorrectionCount();if(!context||!count)return;
  const items=fefoCorrectionItems();
  const unitOptions=context.units.map(row=>`<option value="${esc(row.name)}" ${row.name===count.unit?'selected':''}>${esc(row.name)}</option>`).join('');
  const profileOptions=context.profiles.map(row=>`<option value="${esc(row.id)}" ${row.id===count.counter_id?'selected':''}>${esc(row.name)} (${esc(row.username)})</option>`).join('');
  const body=`<div class="fefo-correction">
    <p class="notice">Corrija os dados e informe o motivo. Cada alteração fica registrada com o administrador e o horário. A contagem continua finalizada.</p>
    <section class="fefo-correction-section"><h3>Dados do cabeçalho</h3>
      <div class="fefo-correction-grid">
        <label class="field"><span>Unidade</span><select id="fefoCorrectionUnit">${unitOptions}</select></label>
        <label class="field"><span>Responsável</span><select id="fefoCorrectionCounter">${profileOptions}</select></label>
        <label class="field"><span>Início</span><input id="fefoCorrectionStart" type="datetime-local" value="${esc(fefoLocalDateTime(count.started_at))}"></label>
        <label class="field"><span>Finalização</span><input id="fefoCorrectionEnd" type="datetime-local" value="${esc(fefoLocalDateTime(count.completed_at))}"></label>
      </div><button class="mini-btn" id="fefoCorrectionSaveHeader" type="button">Salvar cabeçalho</button>
    </section>
    <section class="fefo-correction-section"><div class="fefo-correction-heading"><div><h3>Itens da contagem</h3><small>${items.length} item(ns) • selecione um para corrigir</small></div><button class="mini-btn" id="fefoCorrectionAdd" type="button">+ Adicionar item</button></div>
      <input id="fefoCorrectionSearch" type="search" placeholder="Buscar código, produto, validade ou rua" value="${esc(context.search)}" aria-label="Buscar itens da contagem">
      <div id="fefoCorrectionList" class="fefo-correction-list"></div>
    </section>
    <section class="fefo-correction-section"><h3>Motivo da correção</h3><textarea id="fefoCorrectionReason" rows="2" maxlength="500" placeholder="Ex.: Corrigir validade informada na conferência"></textarea><small>Obrigatório ao salvar cabeçalho, incluir, alterar ou excluir item.</small></section>
    <details class="fefo-correction-history"><summary>Histórico de correções (${context.edits.length}${context.edits.length===30?'+':''})</summary>${context.edits.map(row=>{const actor=context.profiles.find(p=>p.id===row.edited_by);return `<div><strong>${row.target==='HEADER'?'Cabeçalho':'Item'} • ${row.action==='ADD'?'Adicionado':row.action==='DELETE'?'Excluído':'Alterado'}</strong><span>${esc(actor?.name||'Administrador')} • ${fmtDateTime(row.edited_at)}</span><p>${esc(row.reason)}</p></div>`;}).join('')||'<p>Nenhuma correção registrada.</p>'}</details>
  </div>`;
  openModal(`Editar • ${count.count_code}`,'Contagem finalizada',body,[{label:'Voltar ao relatório',class:'secondary',onClick:()=>openFefoReport(count.id)}]);
  $('fefoCorrectionSaveHeader').addEventListener('click',saveFefoCorrectionHeader);
  $('fefoCorrectionAdd').addEventListener('click',()=>openFefoCorrectionItem(null));
  $('fefoCorrectionSearch').addEventListener('input',event=>{context.search=event.target.value;renderFefoCorrectionItems();});
  $('fefoCorrectionList').addEventListener('click',event=>{
    const edit=event.target.closest('[data-fefo-correction-edit]');
    const del=event.target.closest('[data-fefo-correction-delete]');
    if(edit)openFefoCorrectionItem(edit.dataset.fefoCorrectionEdit);
    else if(del)deleteFefoCorrectionItem(del.dataset.fefoCorrectionDelete);
  });
  renderFefoCorrectionItems();
}

function renderFefoCorrectionItems(){
  const needle=String(fefoCorrectionContext?.search||'').trim().toLocaleLowerCase('pt-BR');
  const rows=fefoCorrectionItems().filter(item=>!needle||[item.product_code,item.product_name,item.lot,item.street,fmtDate(item.validity_date)].join(' ').toLocaleLowerCase('pt-BR').includes(needle));
  $('fefoCorrectionList').innerHTML=rows.map(item=>`<div class="fefo-correction-row"><div><strong>${esc(item.product_code)} • ${esc(item.product_name)}</strong><small>Validade ${fmtDate(item.validity_date)} • Rua ${esc(item.street||'—')} • Lote ${esc(item.lot||'—')}</small><small>Palete ${Number(item.pallet||0)} · Lastro ${Number(item.layer||0)} · Caixa ${Number(item.box||0)} · Unidade ${Number(item.loose_unit||0)}</small></div><div class="mini-actions"><button class="mini-btn" data-fefo-correction-edit="${item.id}">Editar</button><button class="mini-btn danger" data-fefo-correction-delete="${item.id}">Excluir</button></div></div>`).join('')||'<p class="notice">Nenhum item encontrado.</p>';
}

function openFefoCorrectionItem(itemId){
  const count=fefoCorrectionCount(),item=fefoCorrectionItems().find(row=>row.id===itemId)||null;
  if(!count)return;
  const productOptions=[...productsByCode.values()].filter(row=>row.active!==false).sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR')).map(row=>`<option value="${esc(row.code)}">${esc(row.code)} • ${esc(row.name)}</option>`).join('');
  openModal(`${item?'Editar':'Adicionar'} item • ${count.count_code}`,'Correção da contagem finalizada',`<form id="fefoCorrectionItemForm" class="fefo-correction-section">
    <div class="fefo-correction-grid">
      <label class="field"><span>Produto</span><select id="fefoCorrectionProduct" required><option value="">Selecione</option>${productOptions}</select></label>
      <label class="field"><span>Validade</span><input id="fefoCorrectionValidity" type="date" required value="${esc(item?.validity_date||'')}"></label>
      <label class="field"><span>Lote</span><input id="fefoCorrectionLot" maxlength="120" value="${esc(item?.lot||'')}"></label>
      <label class="field"><span>Rua</span><input id="fefoCorrectionStreet" maxlength="100" value="${esc(item?.street||'')}"></label>
      ${[['Pallet','pallet'],['Lastro','layer'],['Caixa','box'],['Unidade','loose_unit']].map(([label,key])=>`<label class="field"><span>${label}</span><input id="fefoCorrection${key}" type="number" min="0" step="1" required value="${Number(item?.[key]||0)}"></label>`).join('')}
    </div>
    <label class="field"><span>Motivo da correção</span><textarea id="fefoCorrectionItemReason" rows="2" minlength="5" maxlength="500" required placeholder="Descreva o que foi corrigido"></textarea></label>
    <button class="btn primary" type="submit">${item?'Salvar item':'Adicionar item'}</button>
  </form>`,[{label:'Voltar à contagem',class:'secondary',onClick:renderFefoCorrection}]);
  $('fefoCorrectionProduct').value=item?.product_code||'';
  if(item&&!$('fefoCorrectionProduct').value){
    const option=document.createElement('option');option.value=item.product_code;option.textContent=`${item.product_code} • ${item.product_name} (histórico)`;$('fefoCorrectionProduct').append(option);$('fefoCorrectionProduct').value=item.product_code;
  }
  $('fefoCorrectionItemForm').addEventListener('submit',event=>saveFefoCorrectionItem(event,item));
}

async function refreshFefoCorrection(countId){
  const [countResult,items]=await Promise.all([
    sb.from('fefo_counts').select('*').eq('id',countId).single(),fetchFefoItemsForCount(countId)
  ]);
  if(countResult.error)throw countResult.error;
  const index=fefoReports.findIndex(row=>row.id===countId);
  if(index>=0)fefoReports[index]=countResult.data;else fefoReports.unshift(countResult.data);
  rememberFefoItems(items,[countId]);renderFefoReports();
  return countResult.data;
}
async function reloadFefoCorrection(countId){
  const count=await refreshFefoCorrection(countId);
  if(count.unit!==activeUnit){closeModal();await loadFefoReports(true);toast('Contagem movida para '+count.unit+'. Selecione essa unidade para consultá-la.','success');return;}
  await openFefoCorrection(countId);
}
async function saveFefoCorrectionHeader(){
  const count=fefoCorrectionCount(),reason=requireFefoReason();if(!count||!reason)return;
  const p_started_at=$('fefoCorrectionStart').value===fefoLocalDateTime(count.started_at)
    ?count.started_at:fefoTimestampFromInput($('fefoCorrectionStart').value);
  const p_completed_at=$('fefoCorrectionEnd').value===fefoLocalDateTime(count.completed_at)
    ?count.completed_at:fefoTimestampFromInput($('fefoCorrectionEnd').value);
  if(!p_started_at||!p_completed_at||new Date(p_started_at).getTime()>new Date(p_completed_at).getTime()){
    toast('Confira as datas e horários do início e da finalização.','error');return;
  }
  if($('fefoCorrectionUnit').value===count.unit&&$('fefoCorrectionCounter').value===count.counter_id
    &&new Date(p_started_at).getTime()===new Date(count.started_at).getTime()
    &&new Date(p_completed_at).getTime()===new Date(count.completed_at).getTime()){
    toast('Nenhum dado do cabeçalho foi alterado.','error');return;
  }
  const button=$('fefoCorrectionSaveHeader');button.disabled=true;
  try{
    const {error}=await sb.rpc('edit_completed_fefo_header_v2',{p_count_id:count.id,p_unit:$('fefoCorrectionUnit').value,p_counter_id:$('fefoCorrectionCounter').value,p_started_at,p_completed_at,p_reason:reason});
    if(error)throw error;
    toast('Cabeçalho corrigido.','success');await reloadFefoCorrection(count.id);
  }catch(error){toast(humanFefoError(error),'error');button.disabled=false;}
}
async function saveFefoCorrectionItem(event,item){
  event.preventDefault();
  const count=fefoCorrectionCount(),form=event.currentTarget,reason=$('fefoCorrectionItemReason').value.trim();if(!count)return;
  if(reason.length<5){toast('Descreva a correção em pelo menos 5 caracteres.','error');return;}
  const values={};
  for(const key of ['pallet','layer','box','loose_unit']){
    const value=Number($(`fefoCorrection${key}`).value);
    if(!Number.isSafeInteger(value)||value<0){toast('As quantidades devem ser números inteiros não negativos.','error');return;}
    values[`p_${key}`]=value;
  }
  const button=form.querySelector('button[type=submit]');button.disabled=true;
  try{
    const {error}=await sb.rpc('edit_completed_fefo_item_v2',{p_count_id:count.id,p_action:item?'UPDATE':'ADD',p_item_id:item?.id||null,p_product_code:$('fefoCorrectionProduct').value,p_validity_date:$('fefoCorrectionValidity').value,p_lot:$('fefoCorrectionLot').value.trim(),p_street:$('fefoCorrectionStreet').value.trim(),...values,p_reason:reason});
    if(error)throw error;
    toast(item?'Item corrigido.':'Item adicionado.','success');await reloadFefoCorrection(count.id);
  }catch(error){toast(humanFefoError(error),'error');button.disabled=false;}
}
async function deleteFefoCorrectionItem(itemId){
  const count=fefoCorrectionCount(),item=fefoCorrectionItems().find(row=>row.id===itemId),reason=requireFefoReason();
  if(!count||!item||!reason)return;
  if(!window.confirm(`Excluir o item ${item.product_code} • ${item.product_name} da contagem ${count.count_code}?`))return;
  try{
    const {error}=await sb.rpc('edit_completed_fefo_item_v2',{p_count_id:count.id,p_action:'DELETE',p_item_id:itemId,p_product_code:null,p_validity_date:null,p_lot:null,p_street:null,p_pallet:null,p_layer:null,p_box:null,p_loose_unit:null,p_reason:reason});
    if(error)throw error;
    toast('Item excluído da contagem.','success');await reloadFefoCorrection(count.id);
  }catch(error){toast(humanFefoError(error),'error');}
}
