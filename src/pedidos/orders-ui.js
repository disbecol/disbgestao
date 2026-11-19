/* Interface própria do módulo Pedidos, integrada ao acesso por unidade do Disb Gestão. */
(() => {
 'use strict';
 const O=window.DISB_ORDERS,E=O.esc;
 const date=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
 const stamp=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
 const pct=v=>v==null?'—':(v*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
 const btn=(a,label,extra='',primary=false)=>`<button type="button" class="btn ${primary?'primary':'secondary'}" data-od-action="${a}" ${extra}>${label}</button>`;
 const opts=(values,value,first='Todos')=>`<option value="">${E(first)}</option>`+Object.entries(values).map(([v,l])=>`<option value="${E(v)}" ${v===String(value)?'selected':''}>${E(l)}</option>`).join('');
 const field=(label,name,value='',attrs='',tag='input')=>`<label class="od-field"><span>${label}</span>${tag==='textarea'?`<textarea name="${name}" ${attrs}>${E(value)}</textarea>`:`<input name="${name}" value="${E(value)}" ${attrs}>`}</label>`;
 const empty=text=>`<div class="od-empty">${E(text)}</div>`;
 const panel=(title,body)=>`<section class="od-panel"><h2>${E(title)}</h2>${body}</section>`;
 const badge=(status)=>`<span class="od-badge od-${E(status)}">${E(O.STATUS[status]||status)}</span>`;
 function table(headers,rows){return rows.length?`<div class="od-table-wrap" tabindex="0" role="region" aria-label="Tabela de pedidos"><table><thead><tr>${headers.map(h=>`<th scope="col">${E(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:empty('Nenhum registro para os filtros aplicados.');}
 const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 4h10v3H7zM7 6H4v15h16V6h-3M8 12h8M8 16h5"/></svg>';
 const kpi=(label,value,detail='')=>`<div class="od-kpi"><i class="od-kpi-icon" aria-hidden="true">${icon}</i><div><span>${E(label)}</span><strong>${E(value)}</strong>${detail?`<small>${E(detail)}</small>`:''}</div></div>`;
 const kpis=rows=>{const s=O.stats(rows);return `<div class="od-kpis">${kpi('Solicitações',s.total)+kpi('Pendentes / em análise',s.pending+' / '+s.analyzing)+kpi('Aprovadas / reprovadas',s.approved+' / '+s.rejected)+kpi('Dentro do SLA',pct(s.rate),O.duration(s.average)+' de tempo médio')}</div>`;};
 const bars=groups=>groups.length?`<div class="od-bars">${groups.map(g=>`<div><div class="od-bar-head"><span>${E(g.label)}</span><strong>${g.total}</strong></div><div class="od-track"><i style="width:${g.total/Math.max(...groups.map(g=>g.total),1)*100}%"></i></div></div>`).join('')}</div>`:empty('Sem dados no período.');
 const errorText=e=>{
  const s=String(e?.message||e);
  if(/FORBIDDEN|42501/.test(s))return 'Você não tem permissão para esta operação ou unidade.';
  if(/ORDER_VERSION_CONFLICT|ANOTHER_ANALYST/.test(s))return 'Esta solicitação foi atualizada por outra pessoa. Confira os dados atualizados antes de tentar novamente. Seus textos foram preservados.';
  if(/OUTSIDE_REQUEST_WINDOW/.test(s))return 'O horário para enviar solicitações terminou. O preenchimento foi preservado.';
  if(/CUSTOMER_NOT_FOUND/.test(s))return 'Cliente não encontrado na unidade selecionada. Confira o código ou use Cliente novo.';
  if(/INVALID_DATE/.test(s))return 'Informe uma data desejada de hoje em diante.';
  if(/INVALID_WEEKDAYS/.test(s))return 'Selecione pelo menos um dia útil para o bipasse.';
  if(/RESPONSE_REQUIRED/.test(s))return 'Informe o motivo da reprovação.';
  if(/INVALID_ORDER_TRANSITION/.test(s))return 'Esta ação não está disponível no status atual.';
  if(/REDUCE_PERIOD/.test(s))return 'Há mais de 5.000 solicitações. Reduza o período para consultar todos os dados.';
  if(/INVALID_PERIOD/.test(s))return 'Use um período válido de até 367 dias.';
  if(/check constraint|23514|23502|22P02/.test(s))return 'Confira os campos e os horários: as janelas não podem se sobrepor.';
  if(/PGRST202|42P01|Could not find.*orders_/i.test(s))return 'O módulo está aguardando a atualização do banco.';
  if(/fetch|network/i.test(s))return 'Sem conexão com o servidor. Seus textos continuam nesta tela; tente novamente quando a conexão voltar.';
  return s;
 };
 function create(adapter){
  const ctx=()=>adapter.context(),can=code=>adapter.hasPermission(code),key=()=>`${ctx().user?.id}|${ctx().unit}`;
  let view='',identity='',epoch=0,requestSeq=0,lookupSeq=0,timer=null,channel=null,polling=false,loading=false,busy=false,dirty=false;
  let badgeTimer=null,badgeChannel=null,badgeKey='',badgeSequence=0;
  let rows=[],settings={...O.DEFAULTS},audit=[],error='',updatedAt='',page=0,queueTab='pending',dashboardTab='general',customer='',chartMode='kind',preset='month';
  let serverClock=null,serverClockMark=0,settingsReady=false,lastSettingsCheck=0;
  let filter={from:O.localDate().slice(0,7)+'-01',to:O.localDate(),status:'',kind:'',search:''};
  const blank=()=>({kind:'FORA_ROTA',customer_code:'',customer_name:'',desired_date:O.localDate(),weekdays:[],reason:'',notes:''});
  let draft=blank(),configDraft=null,responseDraft={},expanded=new Set(),pendingOperations=new Map(),foundCustomer=null,lookupError='',lookupTimer=null;
  const root=()=>document.getElementById('view-'+view),monotonic=()=>typeof performance==='object'?performance.now():Date.now();
  const now=()=>serverClock==null?Date.now():serverClock+monotonic()-serverClockMark;
  function syncClock(value){const time=Date.parse(value);if(!Number.isFinite(time))return false;serverClock=time;serverClockMark=monotonic();return true;}
  const requestAllowed=()=>settingsReady&&O.windowState(settings,now()).open;
  function paintRequestAvailability(){
   const el=root();if(!el||view!=='orders-new')return;
   const allowed=requestAllowed(),w=O.windowState(settings,now()),notice=el.querySelector('[data-od-request-window]');
   if(notice){notice.className='od-notice '+(allowed?'od-success':'od-warning');notice.textContent=(settingsReady?(allowed?'Envio disponível':'Fora do horário de envio'):'Envio bloqueado: aguardando confirmação do horário do servidor')+' · '+w.label+' · horário de Brasília.';}
   const fields=el.querySelector('[data-od-request-fields]'),submit=el.querySelector('[data-od-new] button[type=submit]');
   if(fields)fields.disabled=!allowed||busy;if(submit)submit.disabled=!allowed||busy;
  }
  const current=()=>O.filterRows(rows,filter),permission=()=>({'orders-new':'ORDERS_CREATE','orders-own':'ORDERS_OWN','orders-queue':'ORDERS_REVIEW','orders-manage':'ORDERS_VIEW_ALL','orders-dashboard':'ORDERS_DASHBOARD','orders-productivity':'ORDERS_REVIEW','orders-audit':'ORDERS_AUDIT','orders-config':'ORDERS_CONFIG'}[view]);
  const canView=()=>can(permission())||['orders-queue','orders-manage','orders-productivity'].includes(view)&&can('ORDERS_MANAGE');
  async function rpc(name,args){const {data,error}=await ctx().client.rpc(name,args);if(error)throw error;return data;}
  function operation(payload){const fingerprint=JSON.stringify(payload);if(!pendingOperations.has(fingerprint))pendingOperations.set(fingerprint,crypto.randomUUID());return pendingOperations.get(fingerprint);}
  function clearTimers(){clearInterval(timer);timer=null;clearTimeout(lookupTimer);lookupSeq++;if(channel){void ctx().client?.removeChannel(channel);channel=null;}}
  function stop(){clearTimers();epoch++;requestSeq++;identity='';view='';rows=[];audit=[];draft=blank();foundCustomer=null;configDraft=null;responseDraft={};pendingOperations.clear();expanded.clear();dirty=false;busy=false;loading=false;error='';customer='';page=0;queueTab='pending';filter={from:O.localDate().slice(0,7)+'-01',to:O.localDate(),status:'',kind:'',search:''};Object.keys(O.VIEWS).forEach(v=>{const r=document.getElementById('view-'+v);if(r)r.innerHTML='';});}
  function stopBadge(){clearInterval(badgeTimer);badgeTimer=null;badgeSequence++;badgeKey='';if(badgeChannel){void ctx().client?.removeChannel(badgeChannel);badgeChannel=null;}const badge=document.getElementById('ordersPendingBadge');if(badge){badge.textContent='';badge.hidden=true;}}
  async function refreshBadge(){
   const serial=++badgeSequence,k=key(),badge=document.getElementById('ordersPendingBadge');
   if(!badge||!ctx().client?.from)return;
   if(!can('ORDERS_REVIEW')&&!can('ORDERS_MANAGE')){badge.hidden=true;return;}
   try{const result=await ctx().client.from('order_requests').select('id',{count:'exact',head:true}).eq('unit',ctx().unit).eq('status','PENDENTE');if(serial!==badgeSequence||k!==key()||result.error)return;badge.textContent=String(result.count||0);badge.hidden=!result.count;badge.setAttribute('aria-label',(result.count||0)+' solicitações pendentes');}catch(_e){}
  }
  async function start(){
   if(!ctx().client||!ctx().user||!ctx().unit||!can('ORDERS_REVIEW')&&!can('ORDERS_MANAGE'))return;
   if(badgeKey===key())return;stopBadge();badgeKey=key();const k=badgeKey;
   await refreshBadge();if(k!==key()||badgeKey!==k)return;badgeTimer=setInterval(()=>{if(!document.hidden)void refreshBadge();},30000);
   if(ctx().client.channel)badgeChannel=ctx().client.channel('order-count-'+crypto.randomUUID()).on('postgres_changes',{event:'*',schema:'public',table:'order_requests',filter:'unit=eq.'+ctx().unit},()=>{void refreshBadge();}).subscribe();
  }
  function canLeave(){if(busy){adapter.toast('Aguarde a conclusão da operação.','error');return false;}if(dirty&&!confirm('Há alterações que ainda não foram enviadas. Deseja sair desta tela?'))return false;dirty=false;clearTimers();return true;}
  async function load(silent=false){
   if(!ctx().client||!view)return;
   const serial=++requestSeq,token=epoch,identityKey=key(),targetView=view;
   if(!silent){loading=true;render();}
   try{
    if(view==='orders-new'||view==='orders-config'){
     const s=await rpc('orders_settings',{p_unit:ctx().unit});if(token!==epoch||identityKey!==key()||serial!==requestSeq)return;settings=s;settingsReady=syncClock(s.server_now);lastSettingsCheck=monotonic();
    }else if(view==='orders-audit'){
     const a=await rpc('orders_history',{p_unit:ctx().unit,p_from:filter.from,p_to:filter.to});if(token!==epoch||identityKey!==key()||serial!==requestSeq)return;audit=a;
    }else{
     const scope=view==='orders-own'?'OWN':view==='orders-queue'?'QUEUE':view==='orders-productivity'?'PRODUCTIVITY':'ALL';
     const data=await rpc('orders_snapshot',{p_unit:ctx().unit,p_from:filter.from,p_to:filter.to,p_scope:scope});
     if(token!==epoch||identityKey!==key()||serial!==requestSeq)return;
     rows=data.requests;settings=data.settings;syncClock(data.server_now);
    }
    error='';updatedAt=stamp(new Date());
   }catch(e){if(token!==epoch||identityKey!==key()||serial!==requestSeq)return;error=errorText(e);if(view==='orders-new'){settingsReady=false;lastSettingsCheck=monotonic();}}
   if(token!==epoch||targetView!==view||serial!==requestSeq)return;loading=false;
   if(!silent||!dirty&&!root()?.contains(document.activeElement))render();else{const live=root()?.querySelector('[data-od-live]');if(live)live.textContent=error||'Há dados atualizados. Seu preenchimento foi preservado.';}
   paintRequestAvailability();
  }
  function beginPolling(){
   clearTimers();if(!view||view==='orders-config')return;
   const token=epoch;
   if(view==='orders-new'){
    timer=setInterval(async()=>{if(token!==epoch||view!=='orders-new')return;paintRequestAvailability();if(!busy&&!polling&&!document.hidden&&monotonic()-lastSettingsCheck>=30000){polling=true;try{await load(true);}finally{polling=false;}}},1000);return;
   }
   timer=setInterval(async()=>{if(polling||busy||document.hidden||token!==epoch)return;polling=true;try{await load(true);}finally{polling=false;}},15000);
   if(ctx().client.channel){channel=ctx().client.channel('orders-'+crypto.randomUUID()).on('postgres_changes',{event:'*',schema:'public',table:'order_requests',filter:'unit=eq.'+ctx().unit},()=>{if(!busy&&!polling){polling=true;void load(true).finally(()=>{polling=false;});}}).subscribe();}
  }
  async function enter(next){
   if(!O.VIEWS[next])return;if(identity&&identity!==key())stop();identity=key();view=next;epoch++;page=0;error='';configDraft=null;dirty=false;rows=[];audit=[];settingsReady=false;
   if(!canView())return render();await load();beginPolling();
  }
  function toolbar(){return `<form data-od-filter class="od-toolbar">${view==='orders-queue'?'':`<label class="od-field"><span>${view==='orders-productivity'?'Período da resolução':'Período de criação'}</span><select name="preset" data-od-preset>${opts({month:'Este mês',today:'Hoje','7d':'Últimos 7 dias',previous:'Mês passado','3m':'3 meses','6m':'6 meses',year:'Este ano',custom:'Personalizado'},preset,'Selecione')}</select></label>`}${view==='orders-queue'?'':field('De','from',filter.from,'type="date" required')+field('Até','to',filter.to,'type="date" required')}<label class="od-field od-search"><span>Pesquisar</span><input name="search" value="${E(filter.search)}" placeholder="Cliente, código, cidade ou solicitante"></label><label class="od-field"><span>Tipo</span><select name="kind">${opts(O.TYPE,filter.kind)}</select></label><label class="od-field"><span>Status</span><select name="status">${opts(O.STATUS,filter.status)}</select></label><button class="btn primary" type="submit">Aplicar filtros</button>${btn('clear-filter','Limpar')}</form>`;}
  function slaMarkup(r){const s=O.sla(r,now());return `<div class="od-sla"><span class="od-badge od-${s.tone}">${E(s.label)}</span> ${E(O.duration(s.elapsed))} / ${E(O.duration(r.sla_minutes))}${!r.resolved_at?`<div class="od-progress" style="color:var(--od-${s.tone})"><i style="width:${Math.min(100,s.ratio*100)}%"></i></div>`:''}</div>`;}
  function actions(r){
   const review=can('ORDERS_REVIEW')||can('ORDERS_MANAGE');if(!review)return '';
   if(r.status==='PENDENTE')return `<div class="od-analysis">${btn('claim','Assumir análise',busy?'disabled':'',true)}</div>`;
   if(r.status!=='EM_ANALISE'||r.analyst_id!==ctx().user.id&&!can('ORDERS_MANAGE'))return '';
   const d=responseDraft[r.id]||{};
   return `<div class="od-analysis"><div class="od-actions">${btn('return','Devolver à fila',busy?'disabled':'')}</div><div class="od-grid"><div class="od-field"><span>Observação da aprovação (opcional)</span><textarea data-od-response="approval" data-id="${E(r.id)}" maxlength="4000" rows="2">${E(d.approval||'')}</textarea>${btn('approve','Confirmar aprovação',busy?'disabled':'',true)}<small>A confirmação registra que a inclusão foi realizada no BEES.</small></div><div class="od-field"><span>Motivo da reprovação *</span><select data-od-response="rejection" data-id="${E(r.id)}">${opts(Object.fromEntries(O.REJECTIONS.map(x=>[x,x])),d.rejection,'Selecione o motivo')}</select>${d.rejection==='Outro'?`<textarea data-od-response="custom" data-id="${E(r.id)}" placeholder="Descreva o motivo" maxlength="4000">${E(d.custom||'')}</textarea>`:''}${btn('reject','Confirmar reprovação',busy?'disabled':'')}</div></div></div>`;
  }
  function requestCard(r){return `<article class="od-request" data-id="${E(r.id)}"><details ${expanded.has(r.id)?'open':''} data-od-detail="${E(r.id)}"><summary>${badge(r.status)}<span class="od-badge">${E(O.TYPE[r.kind])}</span><strong>${E(r.customer_code)} · ${E(r.customer_name)}</strong><span class="od-muted">${E(stamp(r.created_at))}</span></summary><div class="od-detail">${slaMarkup(r)}<dl><div><dt>Solicitante</dt><dd>${E(r.created_by_name)}</dd></div><div><dt>${r.kind==='BIPASSE'?'Dias do bipasse':'Data desejada'}</dt><dd>${r.kind==='BIPASSE'?E((r.weekdays||[]).map(d=>['','Seg','Ter','Qua','Qui','Sex'][d]).join(', ')):date(r.desired_date)}</dd></div><div><dt>Analista</dt><dd>${E(r.analyst_name||'Não assumida')}</dd></div><div><dt>Cidade</dt><dd>${E(r.city||'Não informada')}</dd></div><div><dt>Assumida em</dt><dd>${stamp(r.claimed_at)}</dd></div><div><dt>Resolvida em</dt><dd>${stamp(r.resolved_at)}</dd></div></dl><div><span class="od-muted">Motivo</span><p>${E(r.reason)}</p></div><div><span class="od-muted">Observações</span><p>${E(r.notes)}</p></div>${r.response?`<div class="od-notice"><span class="od-muted">Resposta da análise</span><p>${E(r.response)}</p></div>`:''}<div class="od-actions">${btn('history','Ver histórico')}</div>${actions(r)}</div></details></article>`;}
  function pagination(total){return total>30?`<div class="od-page"><span>${page*30+1}–${Math.min(page*30+30,total)} de ${total}</span>${btn('previous','Anterior',page===0?'disabled':'')}${btn('next','Próxima',(page+1)*30>=total?'disabled':'')}</div>`:'';}
  function list(listRows){if(!listRows.length)return empty('Nenhuma solicitação para esta seleção.');if(page*30>=listRows.length)page=0;return `<div class="od-requests">${listRows.slice(page*30,page*30+30).map(requestCard).join('')}</div>${pagination(listRows.length)}`;}
  function newRequest(){
   const w=O.windowState(settings,now()),allowed=requestAllowed();
   return `<div class="od-types">${Object.entries(O.TYPE).map(([k,label])=>`<button type="button" class="od-type" data-od-type="${k}" aria-pressed="${draft.kind===k}"><strong>${E(label)}</strong><small>${k==='BIPASSE'?'Liberar dias de atendimento no BEES':k==='CLIENTE_NOVO'?'Atendimento de cliente ainda não cadastrado':'Solicitar uma data fora da rota padrão'}</small><small>SLA: ${E(O.duration(k==='BIPASSE'?settings.bypass_sla:settings.route_sla))}</small></button>`).join('')}</div><div data-od-request-window class="od-notice ${allowed?'od-success':'od-warning'}">${allowed?'Envio disponível':'Fora do horário de envio'} · ${E(w.label)} · horário de Brasília.</div><form data-od-new class="od-panel"><fieldset data-od-request-fields class="od-request-fields" ${!allowed||busy?'disabled':''}><div class="od-grid">${field('Código do cliente *','customer_code',draft.customer_code,'required maxlength="40" autocomplete="off"')}${draft.kind==='CLIENTE_NOVO'?field('Nome do cliente * <small class="od-manual">Manual</small>','customer_name',draft.customer_name,'required maxlength="200"'):`<div class="od-field"><span>Cliente <small>Automático</small></span><div class="od-auto" data-od-customer role="status">${E(foundCustomer?.name||lookupError||'Informe o código para buscar na unidade atual.')}</div></div>`}${draft.kind==='BIPASSE'?`<fieldset class="od-field"><legend>Dias da semana *</legend><div class="od-days">${['Seg','Ter','Qua','Qui','Sex'].map((l,i)=>`<label><input type="checkbox" name="weekdays" value="${i+1}" ${draft.weekdays.includes(i+1)?'checked':''}>${l}</label>`).join('')}</div></fieldset>`:field('Data desejada no BEES *','desired_date',draft.desired_date,`type="date" required min="${O.localDate(now())}"`)}<label class="od-field"><span>Motivo *</span><select name="reason" required>${opts(Object.fromEntries(O.REASONS.map(x=>[x,x])),draft.reason,'Selecione o motivo')}</select></label><div class="od-field od-full">${field('Observações *','notes',draft.notes,'required maxlength="4000" rows="3"','textarea')}</div></div><div class="od-actions" style="margin-top:16px"><button class="btn primary" type="submit" ${!allowed||busy?'disabled':''}>${busy?'Enviando…':'Enviar solicitação'}</button><span class="od-muted">As aprovações são registradas no sistema; a inclusão no BEES é feita pela equipe.</span></div></fieldset></form>`;
  }
  function config(){const s=configDraft||settings;return panel('Horários e SLAs da unidade',`<form data-od-config><div class="od-grid">${field('Início da primeira janela','morning_start',O.time(s.morning_start),'type="time" required')+field('Fim da primeira janela','morning_end',O.time(s.morning_end),'type="time" required')+field('Início da segunda janela','afternoon_start',O.time(s.afternoon_start),'type="time" required')+field('Fim da segunda janela','afternoon_end',O.time(s.afternoon_end),'type="time" required')+field('SLA fora de rota e cliente novo (minutos)','route_sla',s.route_sla,'type="number" min="1" max="10080" step="1" required')+field('SLA bipasse (minutos)','bypass_sla',s.bypass_sla,'type="number" min="1" max="43200" step="1" required')}</div><p><label class="od-check"><input type="checkbox" name="restricted_hours" ${s.restricted_hours?'checked':''}>Restringir o envio às janelas acima</label></p><p class="od-muted">Horário de Brasília. O SLA é contado desde a criação, incluindo o tempo na fila. Novas regras valem apenas para novas solicitações.</p><button type="submit" class="btn primary" ${busy?'disabled':''}>Salvar regras</button></form>`)+panel('Usuários e clientes',`<p class="od-muted">Pedidos usa as contas, as permissões e os clientes já cadastrados no Disb Gestão. O acesso é limitado à unidade do usuário.</p><div class="od-actions">${can('ADMIN_USERS')?btn('users','Usuários e permissões'):''}${can('ADMIN_BASES')?btn('bases','Importar base de clientes'):''}</div>`);}
  function ranking(title,groups,client=false){return panel(title,table([client?'Cliente':'Nome','Total','Aprovadas','Reprovadas','No SLA','Tempo médio'],groups.map(g=>[client?`<button class="od-inline-link" data-od-client="${E(g.id)}">${E(g.id+' · '+g.label)}</button>`:E(g.label),g.total,g.approved,g.rejected,pct(g.rate),O.duration(g.average)])));}
  function dailyTable(listRows){return table(['Data','Fora de rota','Bipasse','Cliente novo','Total','Aprovadas','Reprovadas'],O.daily(listRows).map(g=>[date(g.id),g.rows.filter(r=>r.kind==='FORA_ROTA').length,g.rows.filter(r=>r.kind==='BIPASSE').length,g.rows.filter(r=>r.kind==='CLIENTE_NOVO').length,g.total,g.approved,g.rejected]));}
  function columns(groups,mode='kind',months=false){
   if(!groups.length)return empty('Sem dados no período.');
   const categories=mode==='kind'?Object.entries(O.TYPE):Object.entries(O.STATUS),max=Math.max(...groups.map(g=>g.total),1);
   return `<div class="od-chart" role="img" aria-label="Volume de solicitações; valores detalhados na tabela abaixo"><div class="od-columns" style="min-width:${Math.max(400,groups.length*38)}px">${groups.map(g=>`<div class="od-column"><strong>${g.total}</strong><div class="od-stack" style="height:${Math.max(2,g.total/max*140)}px">${categories.map(([k,label],i)=>{const count=g.rows.filter(r=>(mode==='kind'?r.kind:r.status)===k).length;return count?`<i class="od-series-${i}" style="flex:${count}" title="${E(label+': '+count)}"></i>`:'';}).join('')}</div><small>${E(months?g.id.split('-').reverse().join('/'):g.id.slice(8)+'/'+g.id.slice(5,7))}</small></div>`).join('')}</div></div><div class="od-legend">${categories.map(([k,label],i)=>`<span><i class="od-series-${i}"></i>${E(label)}</span>`).join('')}</div>`;
  }
  function sellerRanking(listRows){
   const ranking=O.sellers(listRows),max=Math.max(...ranking.map(r=>r.total),1);
   return panel('Ranking por vendedor (RN/GV)',ranking.length?`<ol class="od-seller-ranking">${ranking.map((r,i)=>`<li><span class="od-rank-position od-rank-${i+1}">${i+1}</span><div><strong>${E(r.label)}</strong><div class="od-track"><i style="width:${r.total/max*100}%"></i></div></div><b>${r.total}</b></li>`).join('')}</ol><p class="od-muted">Solicitações de vendedores e gerentes de vendas nos filtros aplicados. Maior quantidade primeiro.</p>`:empty('Nenhuma solicitação de vendedores nos filtros aplicados.'));
  }
  function dashboard(){
   const r=current(),s=O.stats(r),clients=O.groups(r,x=>x.customer_code,x=>x.customer_name),daily=O.daily(r);
   const tab=`<div class="od-tabs" role="tablist" aria-label="Análises do dashboard">${[['general','Visão geral'],['volume','Volume de solicitações'],['clients','Análise por cliente']].map(([k,l])=>`<button role="tab" aria-selected="${dashboardTab===k}" data-od-dashboard="${k}">${l}</button>`).join('')}</div>`;
   if(dashboardTab==='clients')return tab+ranking('Clientes por quantidade de solicitações',clients,true)+(customer?panel('Solicitações do cliente '+customer,kpis(r.filter(x=>x.customer_code===customer))+`<div class="od-actions">${btn('clear-customer','Fechar cliente')}</div>`+list(r.filter(x=>x.customer_code===customer))):empty('Clique em um cliente para ver suas solicitações no período.'));
   if(dashboardTab==='volume'){
    const days=O.weekdays(r,filter.from,filter.to,now());
    return tab+`<div class="od-tabs" role="tablist" aria-label="Agrupar volume"><button role="tab" data-od-chart="kind" aria-selected="${chartMode==='kind'}">Por tipo</button><button role="tab" data-od-chart="status" aria-selected="${chartMode==='status'}">Por status</button></div>`+panel('Quantidade por dia',columns(daily,chartMode)+table(chartMode==='kind'?['Data','Fora de rota','Bipasse','Cliente novo','Total']:['Data','Pendentes','Em análise','Aprovadas','Reprovadas','Total'],daily.map(g=>chartMode==='kind'?[date(g.id),...Object.keys(O.TYPE).map(k=>g.rows.filter(r=>r.kind===k).length),g.total]:[date(g.id),g.pending,g.analyzing,g.approved,g.rejected,g.total])))+panel('Solicitações por dia da semana',bars(days)+table(['Dia da semana','Solicitações','Dias no período','Média por dia'],days.map(g=>[E(g.label),g.total,g.days,g.average.toLocaleString('pt-BR',{maximumFractionDigits:2})])))+panel('Volume mensal por tipo',columns(O.monthly(r),'kind',true)+table(['Mês','Fora de rota','Bipasse','Cliente novo','Total'],O.monthly(r).map(g=>[g.id.split('-').reverse().join('/'),...Object.keys(O.TYPE).map(k=>g.rows.filter(r=>r.kind===k).length),g.total])));
   }
   return tab+kpis(r)+`<div class="od-grid">${panel('Aprovadas e reprovadas',bars([{label:'Aprovadas',total:s.approved},{label:'Reprovadas',total:s.rejected}]))}${panel('Cumprimento do SLA',bars([{label:'No prazo',total:s.onTime},{label:'Fora do prazo',total:s.overdue}]))}${panel('Solicitações por tipo',bars(O.groups(r,x=>O.TYPE[x.kind])))}${panel('Motivos das solicitações',bars(O.groups(r,x=>x.reason)))}</div>`+ranking('Produtividade dos analistas',O.groups(r.filter(x=>x.resolved_at),x=>x.analyst_id,x=>x.analyst_name))+sellerRanking(r)+ranking('Solicitantes',O.groups(r,x=>x.created_by,x=>x.created_by_name))+panel('Evolução diária',dailyTable(r));
  }
  function auditBody(items){return table(['Data / hora','Ação','Responsável','Solicitação','Detalhes'],items.map(a=>[stamp(a.created_at),E(O.EVENTS[a.event]||a.event),E(a.actor_name),a.request_id?E(a.request_id.slice(0,8)):'Configurações',a.event==='SETTINGS'?E('Horários e SLAs atualizados'):E([a.next?.customer_code,a.next?.customer_name,O.STATUS[a.next?.status],a.next?.response].filter(Boolean).join(' · '))]));}
  function render(){
   const el=root();if(!el)return;
   const head=O.VIEWS[view];el.innerHTML=`<div class="od-workspace"><header class="od-header"><div><span class="od-eyebrow">Pedidos / Pedidos fora de rota</span><h1>${E(head[0])}</h1><p>${E(head[1])} · ${E(ctx().unit)}</p></div><div class="od-actions">${!['orders-new','orders-config','orders-audit'].includes(view)?btn('export','Exportar CSV'):''}${btn('refresh',loading?'Atualizando…':'Atualizar',busy||loading?'disabled':'')}</div></header>${!canView()?empty('Sem permissão para esta tela.'):error?`<div role="alert" class="od-notice od-danger">${E(error)}</div>`:''}${canView()?`<p class="od-live" data-od-live aria-live="polite">${loading?'Carregando…':updatedAt?'Atualizado em '+E(updatedAt):''}${!['orders-new','orders-config'].includes(view)?' · Atualização automática a cada 15 segundos.':''}</p>${view==='orders-new'?newRequest():view==='orders-config'?config():toolbar()+body()}`:''}</div>`;
   el.onclick=onClick;el.oninput=onInput;el.onchange=onChange;el.onsubmit=onSubmit;
   paintRequestAvailability();
   if(!el._ordersToggle){el.addEventListener('toggle',e=>{const id=e.target?.dataset?.odDetail;if(id){if(e.target.open)expanded.add(id);else expanded.delete(id);}},true);el._ordersToggle=true;}
  }
  function body(){
   const r=current();if(view==='orders-audit')return panel('Alterações registradas',auditBody(audit.filter(a=>(!filter.kind||a.next?.kind===filter.kind)&&(!filter.status||a.next?.status===filter.status)&&(!filter.search||O.norm([a.actor_name,O.EVENTS[a.event],a.next?.customer_name,a.next?.customer_code].join(' ')).includes(O.norm(filter.search))))));
   if(view==='orders-dashboard')return dashboard();
   if(view==='orders-productivity'){const resolved=r.filter(x=>x.resolved_at);return kpis(resolved)+panel('Resoluções por dia',dailyTable(resolved.map(r=>({...r,created_at:r.resolved_at}))))+panel('Solicitações analisadas',list(resolved));}
   if(view==='orders-queue'){
    const listRows=O.queue(r.filter(x=>queueTab==='pending'?x.status==='PENDENTE':queueTab==='mine'?x.status==='EM_ANALISE'&&x.analyst_id===ctx().user.id:x.status==='EM_ANALISE'));
    return `<div class="od-tabs" role="tablist" aria-label="Fila de análise">${[['pending','Pendentes'],['mine','Minhas análises'],['analyzing','Todas em análise']].map(([k,l])=>`<button role="tab" aria-selected="${queueTab===k}" data-od-queue="${k}">${l}</button>`).join('')}</div>${list(listRows)}`;
   }
   return kpis(r)+list(r);
  }
  function captureNew(form){const f=new FormData(form);draft={kind:draft.kind,customer_code:String(f.get('customer_code')||'').trim(),customer_name:String(f.get('customer_name')||''),desired_date:String(f.get('desired_date')||''),weekdays:f.getAll('weekdays').map(Number),reason:String(f.get('reason')||''),notes:String(f.get('notes')||'')};}
  function captureConfig(form){const f=new FormData(form);configDraft={...settings,restricted_hours:f.has('restricted_hours')};for(const k of ['morning_start','morning_end','afternoon_start','afternoon_end'])configDraft[k]=O.timeValue(String(f.get(k)));for(const k of ['route_sla','bypass_sla'])configDraft[k]=Number(f.get(k));}
  function onInput(e){const f=e.target.closest('form');if(f?.matches('[data-od-new]')){captureNew(f);dirty=true;if(e.target.name==='customer_code'&&draft.kind!=='CLIENTE_NOVO'){foundCustomer=null;clearTimeout(lookupTimer);const seq=++lookupSeq;lookupTimer=setTimeout(()=>void lookupCustomer(seq),300);}}
   if(f?.matches('[data-od-config]')){captureConfig(f);dirty=true;}const id=e.target.dataset.id,k=e.target.dataset.odResponse;if(id&&k){responseDraft[id]={...responseDraft[id],[k]:e.target.value};dirty=true;}}
  function onChange(e){onInput(e);if(e.target.hasAttribute('data-od-preset')){preset=e.target.value;if(preset!=='custom'){const range=O.period(preset,now());const f=e.target.closest('form');f.querySelector('[name=from]').value=range.from;f.querySelector('[name=to]').value=range.to;}}if(e.target.dataset.odResponse==='rejection')render();}
  async function lookupCustomer(seq){const code=draft.customer_code,token=epoch;try{const r=await rpc('orders_customer',{p_unit:ctx().unit,p_code:code});if(seq!==lookupSeq||token!==epoch||code!==draft.customer_code)return;foundCustomer=r;lookupError=r?'':'Cliente não encontrado nesta unidade.';}catch(e){if(seq!==lookupSeq||token!==epoch)return;lookupError=errorText(e);}const box=root()?.querySelector('[data-od-customer]');if(box)box.textContent=foundCustomer?.name||lookupError;}
  async function onSubmit(e){
   const form=e.target;if(!form.matches('[data-od-new],[data-od-filter],[data-od-config]'))return;e.preventDefault();if(busy)return;
   if(form.matches('[data-od-filter]')){const f=new FormData(form);filter={...filter,from:String(f.get('from')||filter.from),to:String(f.get('to')||filter.to),search:String(f.get('search')||''),kind:String(f.get('kind')||''),status:String(f.get('status')||'')};page=0;await load();return;}
   if(form.matches('[data-od-new]')&&!requestAllowed()){paintRequestAvailability();adapter.toast('Envio bloqueado. Aguarde o horário permitido e a confirmação do servidor.','error');return;}
   const token=epoch;busy=true;error='';
   try{
    if(form.matches('[data-od-new]')){captureNew(form);const data={...draft};if(data.kind==='BIPASSE'&&!data.weekdays.length)throw Error('INVALID_WEEKDAYS');const args={p_unit:ctx().unit,p_data:data};const r=await rpc('orders_create',{...args,p_operation:operation(args)});if(token!==epoch)return;draft=blank();foundCustomer=null;dirty=false;pendingOperations.clear();adapter.toast('Solicitação registrada. Protocolo '+r.id.slice(0,8)+'.','success');}
    else {captureConfig(form);const data=Object.fromEntries(['restricted_hours','morning_start','morning_end','afternoon_start','afternoon_end','route_sla','bypass_sla'].map(k=>[k,configDraft[k]]));const args={p_unit:ctx().unit,p_revision:settings.revision,p_data:data};const s=await rpc('orders_save_settings',{...args,p_operation:operation(args)});if(token!==epoch)return;settings=s;configDraft=null;dirty=false;adapter.toast('Regras de Pedidos salvas.','success');}
   }catch(e){if(token===epoch){error=errorText(e);adapter.toast(error,'error');}}
   finally{if(token===epoch){busy=false;render();}}
  }
  async function perform(action,id){
   const r=rows.find(r=>r.id===id);if(!r||busy)return;
   const d=responseDraft[id]||{},response=action==='APPROVE'?d.approval||'':action==='REJECT'?(d.rejection==='Outro'?d.custom||'':d.rejection||''):'';
   if(action==='REJECT'&&!response.trim())return adapter.toast('Selecione ou informe o motivo da reprovação.','error');
   if(action==='RETURN'&&!confirm('Devolver esta solicitação à fila? O prazo original será mantido.'))return;
   const token=epoch,args={p_unit:ctx().unit,p_id:id,p_revision:r.revision,p_action:action,p_response:response};busy=true;render();
   try{await rpc('orders_action',{...args,p_operation:operation(args)});if(token!==epoch)return;delete responseDraft[id];dirty=Object.values(responseDraft).some(x=>Object.values(x).some(Boolean));adapter.toast('Solicitação atualizada.','success');if(action==='CLAIM')queueTab='mine';await load();}
   catch(e){if(token===epoch){error=errorText(e);adapter.toast(error,'error');if(/ORDER_VERSION_CONFLICT|ANOTHER_ANALYST/.test(String(e.message)))await load(true);}}
   finally{if(token===epoch){busy=false;render();}}
  }
  async function onClick(e){
   const type=e.target.closest('[data-od-type]');if(type){draft.kind=type.dataset.odType;draft.weekdays=[];foundCustomer=null;lookupSeq++;dirty=true;render();if(draft.customer_code&&draft.kind!=='CLIENTE_NOVO')void lookupCustomer(lookupSeq);return;}
   const qt=e.target.closest('[data-od-queue]');if(qt){queueTab=qt.dataset.odQueue;page=0;render();return;}
   const dt=e.target.closest('[data-od-dashboard]');if(dt){dashboardTab=dt.dataset.odDashboard;page=0;render();return;}
   const cm=e.target.closest('[data-od-chart]');if(cm){chartMode=cm.dataset.odChart;render();return;}
   const client=e.target.closest('[data-od-client]');if(client){customer=client.dataset.odClient;dashboardTab='clients';page=0;render();return;}
   const target=e.target.closest('[data-od-action]');if(!target)return;const action=target.dataset.odAction,id=target.closest('[data-id]')?.dataset.id;
   try{
    if(['claim','return','approve','reject'].includes(action))return await perform({claim:'CLAIM',return:'RETURN',approve:'APPROVE',reject:'REJECT'}[action],id);
    if(action==='refresh')return await load();
    if(action==='clear-filter'){filter={from:O.localDate().slice(0,7)+'-01',to:O.localDate(),status:'',kind:'',search:''};page=0;customer='';preset='month';return await load();}
    if(action==='previous'){page=Math.max(0,page-1);render();}
    if(action==='next'){page++;render();}
    if(action==='clear-customer'){customer='';page=0;render();}
    if(action==='users'||action==='bases'){adapter.openView(action==='users'?'usuarios':'bases');}
    if(action==='export'){const selected=current().filter(r=>view!=='orders-productivity'||r.resolved_at).filter(r=>view!=='orders-dashboard'||dashboardTab!=='clients'||!customer||r.customer_code===customer);await adapter.download('pedidos-'+O.localDate()+'.csv',new Blob([O.csv(selected)],{type:'text/csv;charset=utf-8'}));}
    if(action==='history'){const token=epoch;const a=await rpc('orders_history',{p_unit:ctx().unit,p_id:id});if(token!==epoch)return;adapter.modal({title:'Histórico da solicitação',subtitle:'Alterações registradas com responsável e horário',html:`<div class="od-workspace">${auditBody(a)}</div>`});}
   }catch(e){adapter.toast(errorText(e),'error');}
  }
  return {start,enter,stop:()=>{stopBadge();stop();},canLeave,canChangeUnit:canLeave};
 }
 window.DISB_ORDERS_UI={create};
})();
