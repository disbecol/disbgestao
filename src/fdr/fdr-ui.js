/* Interface FDR; permissões e isolamento são reforçados no Supabase. */
(() => {
 'use strict';
 const F=window.DISB_FDR,$=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Fortaleza'}).format(new Date());
 const date=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'—';
 const options=(values,current,placeholder)=>`<option value="">${esc(placeholder)}</option>${values.map(value=>`<option value="${esc(value)}" ${String(value)===String(current)?'selected':''}>${esc(value)}</option>`).join('')}`;
 const button=(action,label,attrs='')=>`<button type="button" class="btn secondary" data-fdr-action="${action}" ${attrs}>${label}</button>`;

 function create(adapter){
  const root=()=>$('view-'+view),ctx=()=>adapter.context(),canEdit=()=>adapter.hasPermission('FDR_EDIT');
  let view='fdr-reports',identity='',generation=0,request=0,rows=[],loading=false,busy=false,error='',draft=null,matches=[],lookupTimer=null,lookupKey='',clock=null;
  let filters={from:'',to:'',city:'',driver:'',branch:'',justified:''};
  function key(){return `${ctx().user?.id}|${ctx().unit}`;}
  function stop(){generation++;request++;clearTimeout(lookupTimer);clearInterval(clock);clock=null;identity='';rows=[];draft=null;matches=[];busy=false;loading=false;error='';lookupKey='';for(const name of Object.keys(F.VIEWS))$('view-'+name)?.replaceChildren();}
  function canLeave(){if(busy){adapter.toast('Aguarde a conclusão da operação.','error');return false;}if(draft&&!confirm('Há um apontamento que ainda não foi salvo. Deseja sair desta tela?'))return false;draft=null;matches=[];return true;}
  async function load(){
   if(!ctx().client||!ctx().user||!adapter.hasPermission('FDR_VIEW'))return;
   const token=generation,loadId=++request,unit=ctx().unit;loading=true;error='';render();
   try{
    const result=[];let offset=0;
    for(;;){
     const {data,error:queryError}=await ctx().client.from('delivery_radius_reports').select('*').eq('unit',unit).order('report_date',{ascending:false}).order('created_at',{ascending:false}).range(offset,offset+999);
     if(queryError)throw queryError;
     result.push(...(data||[]));if(!data||data.length<1000)break;offset+=data.length;
    }
    if(token!==generation||loadId!==request||unit!==ctx().unit)return;
    rows=result;
   }catch(e){if(token===generation&&loadId===request)error=message(e);}
   finally{if(token===generation&&loadId===request){loading=false;render();}}
  }
  function message(e){
   const value=String(e?.message||e||'Falha na operação.');
   if(/FORBIDDEN|42501/.test(value))return 'Você não tem acesso ao FDR nesta unidade. Confira as permissões e a disponibilidade do módulo.';
   if(/FDR_VERSION_CONFLICT/.test(value))return 'Este apontamento foi editado por outra pessoa. Atualize a lista antes de tentar novamente.';
   if(/PGRST202|42P01|Could not find.*fdr/i.test(value))return 'O FDR aguarda a atualização do banco (migração 89).';
   if(/Failed to fetch|NetworkError|fetch/i.test(value))return 'Não foi possível conectar ao servidor. Verifique a internet e tente novamente.';
   return value;
  }
  function selectedRows(){return F.filterRows(rows,filters);}
  function table(){
   const shown=selectedRows();
   if(!shown.length)return '<div class="fdr-empty">Nenhum apontamento encontrado para os filtros atuais.</div>';
   return `<div class="fdr-table-wrap" tabindex="0" role="region" aria-label="Tabela de apontamentos FDR"><table><thead><tr><th>Data</th><th>Código</th><th>Mapa</th><th>Revenda</th><th>Cidade</th><th>Fantasia</th><th>Motorista</th><th>Vendedor</th><th>Justificada</th><th>Tratativa / Motorista</th><th>Observações</th>${canEdit()?'<th>Ações</th>':''}</tr></thead><tbody>${shown.map(row=>`<tr><td>${date(row.report_date)}</td><td>${esc(row.customer_code)}</td><td>${esc(row.map_number||'—')}</td><td>${esc(row.branch)}</td><td>${esc(row.city||'—')}</td><td>${esc(row.customer_name||'—')}</td><td>${esc(row.driver||'—')}</td><td>${esc(row.seller||'—')}</td><td><span class="fdr-status ${row.justified?'is-yes':'is-no'}">${row.justified?'SIM':'NÃO'}</span></td><td>${esc(row.driver_treatment||'—')}</td><td>${esc(row.observations||'—')}</td>${canEdit()?`<td>${button('edit','Editar',`data-id="${esc(row.id)}"` )}</td>`:''}</tr>`).join('')}</tbody></table></div><p class="fdr-count">${shown.length} registro(s)</p>`;
  }
  function filterForm(){
   const unique=name=>[...new Set(rows.map(row=>row[name]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
   return `<form class="fdr-filters" data-fdr-filter-form><label class="fdr-field"><span>Data de</span><input name="from" type="date" value="${esc(filters.from)}"></label><label class="fdr-field"><span>Data até</span><input name="to" type="date" value="${esc(filters.to)}"></label><label class="fdr-field"><span>Cidade</span><select name="city">${options(unique('city'),filters.city,'Todas')}</select></label><label class="fdr-field"><span>Motorista</span><select name="driver">${options(unique('driver'),filters.driver,'Todos')}</select></label><label class="fdr-field"><span>Revenda</span><select name="branch">${options(['MATRIZ','FILIAL'],filters.branch,'Todas')}</select></label><label class="fdr-field"><span>Justificada</span><select name="justified"><option value="">Todas</option><option value="true" ${filters.justified==='true'?'selected':''}>SIM</option><option value="false" ${filters.justified==='false'?'selected':''}>NÃO</option></select></label><button class="btn primary" type="submit">Aplicar filtros</button>${button('clear-filters','Limpar')}</form>`;
  }
  function field(label,name,value='',attributes='',type='text',origin='manual'){
   const auto=origin==='auto';
   return `<label class="fdr-field ${auto?'is-auto':'is-manual'}"><span>${label}<small>${auto?'Automático · editável':'Preenchimento manual'}</small></span>${type==='textarea'?`<textarea name="${name}" rows="3" maxlength="2000" ${attributes}>${esc(value)}</textarea>`:`<input name="${name}" type="${type}" value="${esc(value)}" ${attributes}>`}</label>`;
  }
  function editor(){
   if(!draft)return '';
   const routeOptions=matches.length>1?`<label class="fdr-field is-auto"><span>Mapa encontrado<small>Selecione a entrega</small></span><select data-fdr-map><option value="">Selecione o mapa</option>${matches.map((row,index)=>`<option value="${index}" ${draft.map_number===row.map_number?'selected':''}>${esc(row.map_number)} · ${esc(row.driver||'Motorista não informado')}</option>`).join('')}</select></label>`:'';
   return `<section class="fdr-panel fdr-editor"><header><h2>${draft.revision?'Editar apontamento':'Novo apontamento'}</h2><p>Informe o código do cliente e a data. Os dados disponíveis nas bases de clientes, mapas e pedidos serão preenchidos automaticamente e continuam editáveis.</p></header><form data-fdr-entry-form><div class="fdr-grid">${field('Data *','report_date',draft.report_date,'required','date','manual')}${field('Código do cliente *','customer_code',draft.customer_code,'required maxlength="40" inputmode="numeric"')}${routeOptions||`<div class="fdr-lookup-status" data-fdr-lookup-status role="status">${esc(draft.lookupMessage||'Ao informar o cliente e a data, os dados disponíveis serão buscados.')}</div>`}</div><div class="fdr-grid">${field('Mapa','map_number',draft.map_number,'maxlength="40"','text','auto')}<label class="fdr-field is-auto"><span>Revenda<small>Automático · editável</small></span><select name="branch" required><option value="MATRIZ" ${draft.branch==='MATRIZ'?'selected':''}>MATRIZ</option><option value="FILIAL" ${draft.branch==='FILIAL'?'selected':''}>FILIAL</option></select></label>${field('Cidade','city',draft.city,'maxlength="200"','text','auto')}${field('Fantasia (nome do cliente)','customer_name',draft.customer_name,'maxlength="300"','text','auto')}${field('Motorista','driver',draft.driver,'maxlength="200"','text','auto')}${field('Vendedor','seller',draft.seller,'maxlength="200"','text','auto')}</div><div class="fdr-grid fdr-grid-two">${field('Tratativa / Motorista','driver_treatment',draft.driver_treatment,'','textarea')}${field('Observações','observations',draft.observations,'','textarea')}<label class="fdr-field is-manual"><span>Justificada *</span><select name="justified" required><option value="false" ${draft.justified?'':'selected'}>NÃO</option><option value="true" ${draft.justified?'selected':''}>SIM</option></select></label></div><p class="fdr-error" data-fdr-error role="alert"></p><div class="fdr-actions">${button('cancel','Cancelar')}<button class="btn primary" type="submit" ${busy?'disabled':''}>${busy?'Salvando…':'Salvar apontamento'}</button></div></form></section>`;
  }
  function render(){
   const box=root();if(!box)return;
   const old=box.querySelector('[data-fdr-filter-form]'),pending=old?Object.fromEntries(new FormData(old)):null;
   box.classList.add('fdr-workspace');
   const dashboard=view==='fdr-dashboard',meta=F.VIEWS[view];
   box.innerHTML=`<div class="page-head"><div><div class="breadcrumb">Entrega / Apontamento Fora do Raio</div><h1>${esc(meta[0])}</h1><p>${esc(meta[1])}</p></div><div class="fdr-actions">${canEdit()&&!dashboard?`<button type="button" class="btn primary" data-fdr-action="new">＋ Novo apontamento</button>`:''}${button('refresh',loading?'Atualizando…':'Atualizar',loading?'disabled':'')}</div></div><p class="fdr-live ${error?'has-error':''}" role="status" aria-live="polite">${esc(error||(loading?'Carregando apontamentos…':`${selectedRows().length} registro(s) no filtro atual. Atualização a cada 30 segundos.`))}</p>${editor()}${filterForm()}${dashboard?error?'<div class="fdr-empty" role="alert">Os indicadores não foram calculados. Atualize a consulta.</div>':loading&&!rows.length?'<div class="fdr-empty">Carregando indicadores…</div>':dashboardView():`<section class="fdr-panel"><header><h2>Apontamentos</h2><p>Os dados exibidos pertencem à unidade selecionada.</p></header>${table()}</section>`}`;
   if(pending)for(const [name,value] of Object.entries(pending)){const input=box.querySelector(`[data-fdr-filter-form] [name="${name}"]`);if(input?.tagName==='SELECT'){for(const option of input.options)option.selected=option.value===value;}else if(input)input.value=value;}
  }
  function dashboardView(){
   const a=F.analytics(rows,filters),number=n=>Number(n).toLocaleString('pt-BR'),pct=n=>n==null?'Sem base':(100*n).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
   const card=(label,value,detail,icon)=>`<article class="fdr-kpi"><span class="fdr-kpi-icon" aria-hidden="true">${icon}</span><div><span>${label}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div></article>`;
   const panel=(title,body)=>`<section class="fdr-panel"><header><h2>${title}</h2></header>${body}</section>`;
   const bars=groups=>!groups.length?'<div class="fdr-empty">Nenhum apontamento nos filtros atuais.</div>':`<div class="fdr-bars">${groups.slice(0,10).map(g=>`<div><span>${esc(g.label)}</span><strong>${number(g.total)} · ${pct(g.share)}</strong><div class="fdr-track"><i style="width:${100*g.total/groups[0].total}%"></i></div><small>${number(g.justified)} justificadas · ${number(g.unjustified)} não justificadas</small></div>`).join('')}</div>`;
   const daily=a.daily.length?`<div class="fdr-table-wrap" tabindex="0" role="region" aria-label="Evolução diária dos apontamentos"><table><thead><tr><th>Data</th><th>Apontamentos</th><th>Justificadas</th><th>Não justificadas</th><th>% justificadas</th></tr></thead><tbody>${a.daily.map(g=>`<tr><td>${date(g.label)}</td><td>${number(g.total)}</td><td>${number(g.justified)}</td><td>${number(g.unjustified)}</td><td>${pct(g.justified/g.total)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="fdr-empty">Nenhum apontamento nos filtros atuais.</div>';
   return `<div class="fdr-kpis">${card('Apontamentos fora do raio',number(a.total),'Registros nos filtros aplicados','⌖')}${card('Clientes',number(a.customers),'Clientes distintos','♙')}${card('Justificadas',pct(a.justified_share),number(a.justified)+' apontamentos','✓')}${card('Não justificadas',number(a.unjustified),'Dos apontamentos do período','!')}${card('Sem mapa',number(a.missing_maps),'Verifique os vínculos','↗')}</div><p class="fdr-dashboard-note">Este painel analisa os registros de apontamentos fora do raio. Para comparar devoluções dentro e fora do raio, acesse Devoluções → Acompanhamentos → Análise por raio. Os filtros valem para todos os indicadores abaixo.</p><div class="fdr-columns">${panel('Top 10 motoristas',bars(a.drivers))}${panel('Top 10 cidades',bars(a.cities))}</div>${panel('Evolução diária',daily)}`;
  }
  function newDraft(row=null){
   const branch=ctx().unit==='Matriz Caicó'?'MATRIZ':'FILIAL';
   return row?{...row,lookupMessage:'Dados do registro carregados.'}:{report_date:today(),customer_code:'',map_number:'',branch,city:'',customer_name:'',driver:'',seller:'',driver_treatment:'',justified:false,observations:'',revision:0,lookupMessage:''};
  }
  function applyMatch(match){
   if(!draft||!match)return;
   for(const name of ['map_number','branch','city','customer_name','driver','seller'])draft[name]=match[name]??draft[name]??'';
   draft.lookupMessage='Dados preenchidos pelas bases disponíveis. Você pode editá-los antes de salvar.';
  }
  async function lookup(){
   const form=root()?.querySelector('[data-fdr-entry-form]');if(!form||!draft)return;
   const customer=form.elements.customer_code.value.trim(),reportDate=form.elements.report_date.value;
   if(!customer||!reportDate)return;
   const requestedKey=customer+'|'+reportDate;if(requestedKey===lookupKey)return;
   lookupKey=requestedKey;const token=generation,unit=ctx().unit,editorDraft=draft;draft.lookupMessage='Buscando cliente, mapa, motorista e vendedor…';
   const notice=root()?.querySelector('[data-fdr-lookup-status]');if(notice)notice.textContent=draft.lookupMessage;
   try{
    const {data,error:rpcError}=await ctx().client.rpc('fdr_lookup',{p_unit:unit,p_customer:customer,p_date:reportDate});
    if(rpcError)throw rpcError;
    if(token!==generation||unit!==ctx().unit||draft!==editorDraft||lookupKey!==requestedKey||draft.customer_code.trim()!==customer||draft.report_date!==reportDate)return;
    matches=Array.isArray(data)?data:[];
    if(matches.length)applyMatch(matches[0]);else draft.lookupMessage='Não encontramos dados automáticos para este cliente e data. Você pode preencher os campos manualmente.';
   }catch(e){if(token===generation&&unit===ctx().unit&&lookupKey===requestedKey){draft.lookupMessage=message(e);adapter.toast(message(e),'error');}}
   finally{if(token===generation)render();}
  }
  function scheduleLookup(){clearTimeout(lookupTimer);lookupTimer=setTimeout(()=>void lookup(),350);}
  function collect(form){
   const values=Object.fromEntries(new FormData(form));
   for(const name of ['report_date','customer_code','map_number','branch','city','customer_name','driver','seller','driver_treatment','observations'])draft[name]=F.text(values[name]);
   draft.justified=values.justified==='true';
  }
  function syncField(target){
   if(!draft||!target.name)return;
   draft[target.name]=target.name==='justified'?target.value==='true':target.value;
  }
  async function save(form){
   if(!draft||!canEdit())return;
   collect(form);
   if(!draft.report_date||!draft.customer_code||!draft.branch){form.querySelector('[data-fdr-error]').textContent='Informe a data, o código do cliente e a revenda.';return;}
   const token=generation,unit=ctx().unit,id=draft.id||crypto.randomUUID(),revision=draft.revision||0;
   busy=true;form.querySelector('[type=submit]').disabled=true;
   try{
    const payload={};for(const name of ['report_date','customer_code','map_number','branch','city','customer_name','driver','seller','driver_treatment','justified','observations'])payload[name]=draft[name];
    const {data,error:rpcError}=await ctx().client.rpc('fdr_save',{p_id:id,p_unit:unit,p_revision:revision,p_data:payload});
    if(rpcError)throw rpcError;
    if(token!==generation||unit!==ctx().unit)return;
    draft=null;matches=[];lookupKey='';adapter.toast('Apontamento FDR salvo.','success');await load();
   }catch(e){
    if(token===generation&&unit===ctx().unit){const text=message(e);form.querySelector('[data-fdr-error]').textContent=text;adapter.toast(text,'error');if(/FDR_VERSION_CONFLICT/.test(String(e?.message||e))){draft.lookupMessage='';await load();}}
   }finally{if(token===generation){busy=false;render();}}
  }
  function bind(){
   const box=root();if(!box||box.dataset.fdrBound)return;box.dataset.fdrBound='true';
   box.addEventListener('click',event=>{
    const action=event.target.closest('[data-fdr-action]')?.dataset.fdrAction;if(!action)return;
    if(action==='new'&&canEdit()){draft=newDraft();matches=[];lookupKey='';render();root()?.querySelector('[name=customer_code]')?.focus();}
    else if(action==='edit'&&canEdit()){const row=rows.find(item=>item.id===event.target.closest('[data-id]')?.dataset.id);if(row){draft=newDraft(row);matches=[];lookupKey=row.customer_code+'|'+row.report_date;render();}}
    else if(action==='cancel'){draft=null;matches=[];lookupKey='';render();}
    else if(action==='refresh')void load();
    else if(action==='clear-filters'){filters={from:'',to:'',city:'',driver:'',branch:'',justified:''};root()?.querySelector('[data-fdr-filter-form]')?.remove();render();}
   });
   box.addEventListener('submit',event=>{
    if(event.target.matches('[data-fdr-filter-form]')){event.preventDefault();filters=Object.fromEntries(new FormData(event.target));render();}
    if(event.target.matches('[data-fdr-entry-form]')){event.preventDefault();void save(event.target);}
   });
   box.addEventListener('input',event=>{
    if(!draft||!event.target.closest('[data-fdr-entry-form]'))return;
    syncField(event.target);
    if(['customer_code','report_date'].includes(event.target.name)){draft[event.target.name]=event.target.value;lookupKey='';scheduleLookup();}
   });
   box.addEventListener('change',event=>{
    if(!draft||!event.target.closest('[data-fdr-entry-form]'))return;
    syncField(event.target);
    if(event.target.matches('[data-fdr-map]')){const selected=matches[Number(event.target.value)];if(selected){applyMatch(selected);render();}}
   });
   box.addEventListener('focusout',event=>{
    if(draft&&['customer_code','report_date'].includes(event.target.name))void lookup();
   });
  }
  async function enter(nextView){
   if(!F.VIEWS[nextView])return;
   view=nextView;
   const next=key();if(identity!==next){stop();identity=next;filters={from:'',to:'',city:'',driver:'',branch:'',justified:''};}
   if(!clock)clock=setInterval(()=>{if(root()?.classList.contains('active')&&!busy&&!draft)void load();},30000);
   bind();draft=null;matches=[];lookupKey='';render();await load();
  }
  return {enter,stop,canLeave,canChangeUnit:canLeave};
 }
 window.DISB_FDR_UI={create};
})();
