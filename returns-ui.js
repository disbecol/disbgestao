/* Interface de Devoluções; o banco autoriza cada consulta e alteração. */
(() => {
 'use strict';
 const R=window.DISB_RETURNS,E=R.esc,$=id=>document.getElementById(id);
 const money=v=>v==null?'Não informado':(Number(v)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:4});
 const pct=v=>v==null?'Sem base':(v*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
 const date=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Fortaleza'}).format(new Date());
 const button=(a,label,extra='',primary=false)=>`<button type="button" class="btn ${primary?'primary':'secondary'}" data-rt-action="${a}" ${extra}>${label}</button>`;
 const options=(items,value,placeholder='Todos')=>`<option value="">${E(placeholder)}</option>`+items.map(x=>`<option value="${E(x.value??x)}" ${String(value)===String(x.value??x)?'selected':''}>${E(x.label??x)}</option>`).join('');
 const field=(label,name,value='',attrs='',type='input')=>`<label class="rt-field"><span>${label}</span>${type==='textarea'?`<textarea name="${name}" rows="3" maxlength="2000" ${attrs}>${E(value)}</textarea>`:`<input name="${name}" value="${E(value)}" ${attrs}>`}</label>`;
 const empty=message=>`<div class="rt-empty">${E(message)}</div>`;
 const panel=(title,body,detail='')=>`<section class="rt-panel"><header><h2>${E(title)}</h2>${detail?`<p>${E(detail)}</p>`:''}</header>${body}</section>`;
 const card=(label,value,detail='')=>`<div class="rt-kpi"><span>${E(label)}</span><strong>${E(value)}</strong>${detail?`<small>${E(detail)}</small>`:''}</div>`;
 const status=s=>`<span class="rt-status rt-${E(s)}">${E(R.STATUS[s]||s)}</span>`;
 function table(headers,rows,{page=0,size=100,paginate=false}={}){
  if(!rows.length)return empty('Nenhum registro para este filtro.');
  const start=paginate?page*size:0,selected=rows.slice(start,start+size);
  return `<div class="rt-table-wrap" tabindex="0" role="region" aria-label="Tabela de devoluções"><table><thead><tr>${headers.map(h=>`<th scope="col">${E(h)}</th>`).join('')}</tr></thead><tbody>${selected.map(row=>`<tr>${row.map(c=>`<td>${c??'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length>size?`<div class="rt-pagination"><span>${start+1}–${Math.min(start+size,rows.length)} de ${num(rows.length)}</span>${paginate?button('previous','Anterior',page===0?'disabled':'')+button('next','Próxima',start+size>=rows.length?'disabled':''):'<span>As primeiras 100 linhas são exibidas. Use os filtros ou exporte os dados completos.</span>'}</div>`:''}`;
 }
 function bars(rows,metric='amount_cents'){
  if(!rows.length)return empty('Sem dados no período.');const top=[...rows].sort((a,b)=>b[metric]-a[metric]).slice(0,5),max=Math.max(...top.map(r=>r[metric]),1);
  return `<div class="rt-bars">${top.map(r=>`<div><span>${E(r.label)}</span><strong>${E(metric==='amount_cents'?money(r[metric]):num(r[metric])+' HL')}</strong><div class="rt-track"><i style="width:${Math.max(0,r[metric]/max*100)}%"></i></div></div>`).join('')}</div>`;
 }
 const ranking=rows=>table(['Nome','PDVs','Valor devolvido','Volume (HL)','Participação nos PDVs'],rows.map(r=>[E(r.label),num(r.outlets),money(r.amount_cents),num(r.volume_hl),pct(r.share)]));
 const trend=(rows,metric)=>{
  if(!rows.length)return empty('Sem dados no período.');const max=Math.max(...rows.map(r=>r[metric]),1);
  return `<div class="rt-trend" role="img" aria-label="Evolução diária; valores detalhados na tabela abaixo">${rows.map(r=>`<div title="${E(date(r.date)+': '+(metric==='amount_cents'?money(r[metric]):num(r[metric])+' HL'))}"><i style="height:${Math.max(1,r[metric]/max*100)}%"></i><small>${E(r.date.slice(8))}</small></div>`).join('')}</div><p class="rt-note">${date(rows[0].date)} a ${date(rows.at(-1).date)} · passe o cursor nas barras para ver o valor.</p>`;
 };
 const detailRows=rows=>rows.map(r=>[date(r.operation_date),E(r.map_number),E(r.customer_code),E(r.customer_name),E(r.city||'Não informada'),money(r.amount_cents),num(r.volume_hl),E(r.reason),E(r.seller||'Não informado'),E(r.driver_treatment||'—')]);
 const detailHeaders=['Data','Mapa','PDV','Cliente','Cidade','Valor','HL','Motivo','Vendedor','Tratativa'];
 const messages=e=>{
  const s=String(e?.message||e||'Falha na operação.');
  if(/RETURN_VERSION_CONFLICT/.test(s))return 'Outra pessoa alterou esta devolução. Seus textos foram preservados. Abra o histórico e recarregue o registro antes de salvar.';
  if(/FORBIDDEN|42501/.test(s))return 'Você não tem acesso a esta operação ou unidade. Confira as permissões de Devoluções.';
  if(/23505|duplicate key/.test(s))return 'Já existe uma devolução auditada para este cliente, data e mapa. Edite o registro existente.';
  if(/PGRST202|42P01|Could not find.*returns_/i.test(s))return 'O módulo aguarda a atualização do banco (migração 87).';
  if(/REDUCE_PERIOD/.test(s))return 'Há muitos registros neste período. Reduza as datas para consultar todos os dados.';
  if(/Failed to fetch|NetworkError|fetch/i.test(s))return 'Não foi possível conectar ao servidor. As alterações desta tela continuam disponíveis; tente novamente.';
  return s;
 };
 function create(adapter){
  const ctx=()=>adapter.context(),can=p=>adapter.hasPermission(p),key=()=>`${ctx().user?.id}|${ctx().unit}`;
  let identity='',generation=0,sequence=0,clock=null,channel=null,view='',snapshot=null,error='',loading=false,busy=false,dirty=false,editor=null,matches=[],preview=null,importKind='REPORT',month=today().slice(0,7),page=0,updated=false;
  let filter={from:today().slice(0,7)+'-01',to:today(),city:'',driver:'',reason:'',search:'',status:''};
  const root=()=>$(`view-${view}`),notify=(m,t='success')=>adapter.toast(m,t);
  async function rpc(name,args){const {data,error}=await ctx().client.rpc(name,args);if(error)throw error;return data;}
  const args=()=>({p_unit:ctx().unit});
  function stop(){generation++;sequence++;clearInterval(clock);clock=null;if(channel){void ctx().client?.removeChannel(channel);channel=null;}identity='';snapshot=null;editor=null;preview=null;dirty=false;busy=false;loading=false;error='';updated=false;for(const v of Object.keys(R.VIEWS)){const r=$('view-'+v);if(r)r.innerHTML='';}}
  function canLeave(){if(busy){notify('Aguarde a conclusão da operação.','error');return false;}if(dirty&&!confirm('Há alterações que ainda não foram salvas. Deseja sair desta tela?'))return false;dirty=false;editor=null;return true;}
  function canChangeUnit(){return canLeave();}
  async function load(silent=false){
   if(!ctx().client||!ctx().user||!can('RETURNS_VIEW'))return;
   const request=++sequence,token=generation,unitKey=key();loading=true;if(!silent)render();
   try{const data=await rpc('returns_snapshot',{...args(),p_from:filter.from,p_to:filter.to});if(request!==sequence||token!==generation||unitKey!==key())return;snapshot=data;error='';updated=!!editor;}
   catch(e){if(request===sequence&&token===generation){error=messages(e);}}
   finally{if(request===sequence&&token===generation){loading=false;if(!editor&&!busy)render();else paintLive();}}
  }
  function paintLive(){const el=root()?.querySelector('[data-rt-live]');if(el){el.textContent=error|| (updated?'Atualização recebida. O formulário aberto foi preservado.':`Atualizado às ${snapshot?.at?new Date(snapshot.at).toLocaleTimeString('pt-BR'): '—'}`);el.classList.toggle('rt-error',!!error);}}
  async function enter(next){
   if(identity!==key()){stop();identity=key();clock=setInterval(()=>{if(root()?.classList.contains('active')&&!busy)void load(true);},30000);
    if(ctx().client?.channel){channel=ctx().client.channel('returns-'+ctx().user.id+'-'+ctx().unit).on('postgres_changes',{event:'*',schema:'public',table:'delivery_return_cases',filter:'unit=eq.'+ctx().unit},()=>{if(!busy)void load(true);}).subscribe();}
   }
   if(view!==next){editor=null;matches=[];dirty=false;page=0;}view=next;render();await load();
  }
  function filters(){const reports=snapshot?.reports||[],unique=prop=>[...new Set(reports.map(r=>r[prop]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
   return `<form class="rt-filters" data-rt-filter-form>${field('De','from',filter.from,'type="date" required')}${field('Até','to',filter.to,'type="date" required')}<label class="rt-field"><span>Cidade</span><select name="city">${options(unique('city'),filter.city)}</select></label><label class="rt-field"><span>Motorista</span><select name="driver">${options(unique('driver'),filter.driver)}</select></label><label class="rt-field"><span>Motivo</span><select name="reason">${options(unique('reason'),filter.reason)}</select></label>${field('Pesquisar','search',filter.search,'placeholder="PDV, mapa ou nome"')}${view==='returns-audited'?`<label class="rt-field"><span>Status</span><select name="status">${options(Object.entries(R.STATUS).map(([value,label])=>({value,label})),filter.status)}</select></label>`:''}<button class="btn primary" type="submit" ${busy?'disabled':''}>Aplicar</button>${button('clear-filter','Limpar')}</form>`;
  }
  function render(){const box=root();if(!box||!R.VIEWS[view])return;box.classList.add('rt-workspace');const meta=R.VIEWS[view];
   box.innerHTML=`<div class="page-head"><div><div class="breadcrumb">Entrega / Devoluções</div><h1>${E(meta[0])}</h1><p>${E(meta[1])}</p></div><div class="rt-actions">${view==='returns-audited'&&can('RETURNS_EDIT')?button('new','＋ Cadastrar devolução','',true):''}${view!=='returns-import'?button('export','Exportar CSV'):''}${button('refresh','Atualizar',loading?'disabled':'')}</div></div><div class="rt-live" role="status" data-rt-live></div>${view==='returns-import'?importView():(editor?'':filters())+`<div data-rt-content>${!snapshot?(loading?empty('Carregando dados da unidade…'):empty(error||'Não foi possível consultar os dados.')):content()}</div>`}`;
   paintLive();
  }
  function content(){
   const a=R.analytics(snapshot,filter),t=a.totals,kpis=`<div class="rt-kpis">${card('PDVs com devolução',num(t.outlets),'Cliente + data + mapa')}${card('Valor devolvido',money(t.amount_cents))}${card('Volume devolvido',num(t.volume_hl)+' HL')}${card('Ticket médio',money(t.outlets?t.amount_cents/t.outlets:null))}</div>`;
   const details=()=>panel('Devoluções do período',table(detailHeaders,detailRows(a.rows),{page,paginate:true}));
   if(view==='returns-audited')return auditView(a);
   if(view==='returns-panel')return kpis+details();
   if(view==='returns-city')return kpis+`<div class="rt-columns">${panel('Top 5 cidades por valor',bars(a.cities))}${panel('Top 5 cidades por volume',bars(a.cities,'volume_hl'))}</div>`+panel('Participação por cidade',ranking(a.cities),'Participação nos PDVs devolvidos do período; não é a taxa de devolução sobre as entregas da cidade.')+details();
   if(view==='returns-team')return kpis+panel('Motoristas',ranking(a.drivers))+panel('Ajudantes',ranking(a.helpers),'Cada ajudante é contado uma vez por ocorrência. Não some os totais de ajudantes para obter o total da operação.')+panel('DROP — motoristas',ranking(a.drop),`${num(a.dropUnknown)} nota(s) sem classificação DROP. A classificação deve constar da jornada importada.`)+details();
   if(view==='returns-recurrence')return panel('Clientes recorrentes em 30 dias',table(['PDV','Cliente','Cidade','Dias com devolução','Valor','HL'],a.recurrence.map(r=>[E(r.customer_code),E(r.customer_name),E(r.city),num(r.days),money(r.amount_cents),num(r.volume_hl)])),`Janela de ${date(R.dateShift(filter.to,-29))} a ${date(filter.to)}. Considera dias distintos, sem duplicar clientes por nota.`)+panel('Ocorrências dos clientes recorrentes',table([...detailHeaders,'Dia da semana','Nota'],a.recurrence.flatMap(r=>r.rows.map(v=>[...detailRows([v])[0],E(new Date(v.operation_date+'T12:00:00Z').toLocaleDateString('pt-BR',{weekday:'long'})),E(v.invoice_number)])),{page,paginate:true}));
   if(view==='returns-reasons')return kpis+`<div class="rt-columns">${panel('Top 5 motivos por valor',bars(a.reasons))}${panel('Top 5 motivos por volume',bars(a.reasons,'volume_hl'))}</div>`+panel('Motivos do relatório',ranking(a.reasons))+panel('Motorista × cliente',table(['Motivo do motorista','Motivo do cliente','Casos'],a.reasonMatrix.map(r=>[E(r.driver),E(r.client),num(r.count)])),'Comparação dos registros auditados; justificativas não preenchidas aparecem como pendentes.')+`<div class="rt-columns">${panel('Motivos dos motoristas',ranking(a.driverReasons))}${panel('Motivos dos clientes',ranking(a.clientReasons))}</div>`+details();
   const goal=(snapshot.goals||[]).find(g=>g.month.slice(0,7)===filter.from.slice(0,7)),sameMonth=filter.from.slice(0,7)===filter.to.slice(0,7);
   return kpis+`<div class="rt-kpis">${card('PDVs em rota',num(a.route.planned_outlets),'Base 17.03')}${card('HL em rota',num(a.route.planned_hl),'Base 17.03')}${card('Devolução por PDV',pct(a.route.outlet_rate))}${card('Devolução por HL',pct(a.route.hl_rate))}</div>`+
    (a.route.scoped?'<p class="rt-note">Os percentuais sobre a rota aparecem somente sem filtros de cidade, motorista, motivo ou pesquisa, pois a base 17.03 contém o total da unidade.</p>':a.route.missingDates.length||!a.route.days?'<p class="rt-note">Importe a base 17.03 para calcular percentuais. Dias de devolução sem total em rota: '+E(a.route.missingDates.map(date).join(', ')||'base ainda não importada')+'.</p>':'')+
    panel('Metas do mês',`<div class="rt-actions"><span>PDV: <strong>${sameMonth?pct(goal?.outlet_rate):'Selecione um mês'}</strong></span><span>HL: <strong>${sameMonth?pct(goal?.hl_rate):'Selecione um mês'}</strong></span>${can('RETURNS_EDIT')&&sameMonth?button('goal','Editar metas'):''}</div>`,'Defina metas por unidade e mês. As taxas do período usam a soma dos totais diários.')+
    auditKpis(a)+`<div class="rt-columns">${panel('Evolução do valor devolvido',trend(a.daily,'amount_cents'))}${panel('Evolução do volume devolvido',trend(a.daily,'volume_hl'))}</div>`+panel('Evolução diária',table(['Data','PDVs em rota','PDVs devolvidos','HL em rota','HL devolvidos','% PDV','% HL','Valor'],a.daily.map(r=>[date(r.date),num(r.planned_outlets),num(r.outlets),num(r.planned_hl),num(r.volume_hl),pct(r.outlet_rate),pct(r.hl_rate),money(r.amount_cents)])))+
    `<div class="rt-columns">${panel('Vendedores',ranking(a.sellers))}${panel('Dias da semana',ranking(a.weekdays))}</div>`+panel('Maiores devoluções',table(detailHeaders,detailRows(a.largest)));
  }
  const auditKpis=a=>`<div class="rt-kpis">${card('Aguardando repasse',num(a.counts.AGUARDANDO_REPASSE))}${card('Devolvido',num(a.counts.DEVOLVIDO))}${card('Revertido',num(a.counts.REVERTIDO))}${card('Reversão dos encerrados',pct(a.reversal_rate),`Sobre todos os casos: ${pct(a.reversal_all)}`)}</div>`;
  function auditView(a){return auditKpis(a)+(editor?editorView():'')+panel('Monitoramento em tempo real',table(['Data','PDV / cliente','Mapa / revenda','Cidade','Pedido','Vendedor','Motorista / ajudantes','Motivo do motorista','Tratativa do motorista','Auditoria do cliente','Status','Atualizado por','Ações'],a.audits.map(r=>[date(r.operation_date),`<strong>${E(r.customer_code)} · ${E(r.customer_name)}</strong>`,`${E(r.map_number||'Pendente')}<small>${E(r.branch||ctx().unit)}</small>`,E(r.city),money(r.order_amount_cents),E(r.seller),`${E(r.driver)}<small>${E([r.helper1,r.helper2].filter(Boolean).join(' / '))}</small>`,E(r.driver_reason),E(r.driver_treatment),`${E(r.client_reason)}<small>${E(r.client_statement)}</small>`,status(r.status),`${E(r.updated_by_name)}<small>${E(new Date(r.updated_at).toLocaleString('pt-BR'))}</small>`,`${can('RETURNS_EDIT')?button('edit','Editar',`data-id="${E(r.id)}"`):''}${button('history','Histórico',`data-id="${E(r.id)}"`)}`]),{page,paginate:true}));
  }
  function editorView(){const r=editor;
   return `<section class="rt-panel rt-editor"><header><h2>${r.revision?'Editar devolução':'Cadastrar devolução'}</h2><p>Informe cliente e data para buscar o pedido e a equipe. As tratativas continuam editáveis depois de salvar.</p></header><form data-rt-case-form><div class="rt-grid">${field('Código do cliente *','customer_code',r.customer_code,'required maxlength="40" inputmode="numeric"')}${field('Data da entrega *','operation_date',r.operation_date,'type="date" required')}<div class="rt-field"><span>Dados do pedido</span>${button('lookup','Buscar informações')}</div></div>${matches.length>1?`<label class="rt-field"><span>Selecione o mapa deste cliente/data *</span><select data-rt-match><option value="">Escolha o mapa</option>${matches.map((m,i)=>`<option value="${i}">${E(m.map_number)} · ${money(m.order_amount_cents)}</option>`).join('')}</select></label>`:''}${r.lookupNote?`<p class="rt-note">${E(r.lookupNote)}</p>`:''}<div class="rt-grid">${field('Mapa','map_number',r.map_number,'maxlength="40"')}${field('Revenda','branch',r.branch,'maxlength="200"')}${field('Cidade','city',r.city,'maxlength="200"')}${field('Nome fantasia','customer_name',r.customer_name,'maxlength="200"')}${field('Valor total do pedido','order_amount',r.order_amount_cents==null?'':(r.order_amount_cents/100).toFixed(2).replace('.',','),'inputmode="decimal" placeholder="Não informado"')}${field('Vendedor','seller',r.seller,'maxlength="200"')}${field('Motorista','driver',r.driver,'maxlength="200"')}${field('Ajudante 1','helper1',r.helper1,'maxlength="200"')}${field('Ajudante 2','helper2',r.helper2,'maxlength="200"')}</div><div class="rt-grid rt-two">${field('Motivo informado pelo motorista *','driver_reason',r.driver_reason,'required maxlength="200"')}${field('Motivo confirmado pelo cliente','client_reason',r.client_reason,'maxlength="200" placeholder="Ex.: preço, prazo ou pedido incorreto"')}${field('Tratativa do motorista','driver_treatment',r.driver_treatment,'','textarea')}${field('Auditoria / justificativa do cliente','client_statement',r.client_statement,'','textarea')}<label class="rt-field"><span>Reversão / status *</span><select name="status" required>${Object.entries(R.STATUS).map(([v,l])=>`<option value="${v}" ${r.status===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="rt-field"><span>Entrega DROP</span><select name="is_drop">${options([{value:'true',label:'Sim'},{value:'false',label:'Não'}],r.is_drop==null?'':String(r.is_drop),'Não classificada')}</select></label></div><p class="rt-error" data-rt-case-error role="alert"></p><div class="rt-actions">${button('cancel','Cancelar')}<button class="btn primary" type="submit" ${busy?'disabled':''}>${busy?'Salvando…':'Salvar devolução'}</button></div></form></section>`;
  }
  function collect(form){const values=Object.fromEntries(new FormData(form));for(const name of ['customer_code','operation_date','map_number','branch','city','customer_name','seller','driver','helper1','helper2','driver_reason','driver_treatment','client_reason','client_statement','status'])editor[name]=R.text(values[name]);editor.order_amount_cents=values.order_amount===''?null:R.cents(values.order_amount);editor.is_drop=values.is_drop===''?null:values.is_drop==='true';return values;}
  function applyMatch(m){const preserve={driver_reason:editor.driver_reason,client_reason:editor.client_reason,driver_treatment:editor.driver_treatment,client_statement:editor.client_statement,status:editor.status};Object.assign(editor,m,preserve);editor.lookupKey=editor.customer_code+'|'+editor.operation_date;editor.lookupNote=m.order_amount_cents==null?'Nenhum pedido importado para este cliente/data. Confira e complete os dados disponíveis. Valores desconhecidos podem ficar em branco.':'';editor.operation=null;dirty=true;render();}
  async function lookup(){const form=root()?.querySelector('[data-rt-case-form]');collect(form);if(!editor.customer_code||!R.day(editor.operation_date))throw Error('Informe código do cliente e data válida.');const token=generation,owner=editor,idKey=key();busy=true;
   try{const data=await rpc('returns_lookup',{...args(),p_customer:editor.customer_code,p_date:editor.operation_date});if(token!==generation||owner!==editor||idKey!==key())return;matches=data||[];if(matches.length===1)applyMatch(matches[0]);else{editor.lookupNote='Há mais de um mapa. Escolha o mapa antes de salvar.';editor.lookupKey='';render();}}finally{busy=false;if(token===generation)render();}
  }
  async function saveCase(form){collect(form);const r=editor;if(r.lookupKey!==r.customer_code+'|'+r.operation_date)throw Error('Clique em Buscar informações para conferir o cliente e a data antes de salvar.');if(matches.length>1&&!r.lookupKey)throw Error('Selecione o mapa.');const amount=form.querySelector('[name="order_amount"]').value;if(amount!==''&&r.order_amount_cents===null)throw Error('Informe um valor válido para o pedido.');
   const payload={};for(const n of ['operation_date','customer_code','map_number','customer_name','city','branch','seller','driver','helper1','helper2','order_amount_cents','driver_reason','driver_treatment','client_reason','client_statement','status','is_drop'])payload[n]=r[n]??null;
   const fingerprint=JSON.stringify(payload);if(r.operationPayload!==fingerprint){r.operation=crypto.randomUUID();r.operationPayload=fingerprint;}const unitKey=key(),token=generation;busy=true;render();
   try{await rpc('returns_save_case',{...args(),p_id:r.id,p_revision:r.revision||0,p_operation:r.operation,p_data:payload});if(token!==generation||unitKey!==key())return;editor=null;dirty=false;matches=[];updated=false;notify('Devolução salva.');await load();}
   catch(e){if(token===generation){error=messages(e);throw e;}}
   finally{if(token===generation){busy=false;render();}}
  }
  async function history(id){const token=generation,unitKey=key();const {data,error}=await ctx().client.from('delivery_return_audit').select('*').eq('case_id',id).eq('unit',ctx().unit).order('created_at',{ascending:false}).limit(100);if(error)throw error;if(token!==generation||unitKey!==key())return;
   const keys={status:'Status',operation_date:'Data',customer_code:'PDV',map_number:'Mapa',customer_name:'Cliente',city:'Cidade',branch:'Revenda',seller:'Vendedor',driver:'Motorista',helper1:'Ajudante 1',helper2:'Ajudante 2',order_amount_cents:'Valor do pedido',driver_reason:'Motivo do motorista',driver_treatment:'Tratativa do motorista',client_reason:'Motivo do cliente',client_statement:'Justificativa do cliente',is_drop:'DROP'};
   const body=(data||[]).map(a=>{const old={...(a.previous?.data||{}),...a.previous},next={...(a.next?.data||{}),...a.next};return `<article class="rt-history"><strong>${E(a.actor_name)} · ${E(new Date(a.created_at).toLocaleString('pt-BR'))}</strong>${table(['Campo','Antes','Depois'],Object.entries(keys).filter(([k])=>old[k]!==next[k]).map(([k,l])=>[E(l),E(k==='status'?R.STATUS[old[k]]||'—':old[k]??'—'),E(k==='status'?R.STATUS[next[k]]:next[k]??'—')]))}</article>`;}).join('');
   adapter.modal({title:'Histórico da devolução',subtitle:'Alterações registradas pelo servidor',html:`<div class="rt-workspace">${body||empty('Nenhuma alteração disponível.')}</div>`});
  }
  function importView(){return panel('Importar dados da unidade',`<div class="rt-grid"><label class="rt-field"><span>Tipo de base</span><select data-rt-kind>${options([{value:'REPORT',label:'Devoluções · relatório 03.02.24 (F:Y)'},{value:'ORDERS',label:'Pedidos · 030237-MAP CLI MOT'},{value:'JOURNEYS',label:'Equipe · BASE JORNADA LIQ'},{value:'ROUTES',label:'Totais em rota · 17.03'}],importKind,'Selecione')}</select></label>${field('Mês do relatório 17.03','route-month',month,'type="month" data-rt-month')}<label class="rt-field"><span>Arquivo XLSX ou CSV</span><input data-rt-file type="file" accept=".xlsx,.csv" ${can('RETURNS_IMPORT')&&!busy?'':'disabled'}></label></div><p class="rt-note">Prévia antes de importar. A publicação atualiza as mesmas chaves, sem duplicar notas e sem apagar registros ausentes no arquivo. Não altera justificativas da auditoria nem a base MAPAS.</p><div class="rt-actions">${can('RETURNS_IMPORT')?button('google','Ler aba 17.03 do Google',busy?'disabled':''):''}<a class="btn secondary" href="https://docs.google.com/spreadsheets/d/1hYle_7TyEitARZOYgYPoO5hUcxHsj0xxhTP7YCccGTM/edit#gid=1816877762" target="_blank" rel="noopener">Abrir aba 17.03</a></div><p class="rt-note">17.03: cole o relatório original (indicadores 697 e 563, colunas Dia 01…31) ou use DATA, PDVS EM ROTA, HL EM ROTA e UNIDADE. Informe o mês correto. A aba MAPAS é consultada somente para associar equipes.</p>`)+
    (preview?panel('Prévia da importação',`<p><strong>${E(preview.filename)}</strong> · ${E(ctx().unit)}</p><div class="rt-kpis">${card('Registros válidos',num(preview.rows.length))}${card('Linhas com erro',num(preview.errors.length))}${card('Repetições ignoradas',num(preview.duplicates))}${card('Valor / volume',importKind==='REPORT'?money(R.totals(preview.rows).amount_cents)+' / '+num(R.totals(preview.rows).volume_hl)+' HL':'Conforme a base selecionada')}</div>${preview.errors.length?table(['Linha','Problema'],preview.errors.slice(0,100).map(e=>[num(e.row),E(e.message)])):''}${table(['Data','Mapa / PDV','Nome / base','Valor / PDVs','HL'],preview.rows.slice(0,10).map(r=>[date(r.operation_date),E(r.map_number||r.customer_code||''),E(r.customer_name||r.driver||'Totais diários'),r.amount_cents!=null?money(r.amount_cents):r.order_amount_cents!=null?money(r.order_amount_cents):num(r.planned_outlets),num(r.volume_hl??r.planned_hl)]))}<p class="rt-error" data-rt-import-error role="alert"></p><div class="rt-actions">${button('cancel-import','Descartar prévia')}${can('RETURNS_IMPORT')?button('commit-import',busy?'Importando…':'Confirmar importação',busy||preview.errors.length||!preview.rows.length?'disabled':'',true):''}</div>`):'')+
    panel('Últimas importações concluídas',table(['Quando','Arquivo','Base','Registros'],(snapshot?.imports||[]).map(r=>[E(new Date(r.completed_at).toLocaleString('pt-BR')),E(r.filename),E({REPORT:'Devoluções',ORDERS:'Pedidos',CUSTOMERS:'Clientes',JOURNEYS:'Equipe',ROUTES:'17.03'}[r.kind]),num(r.expected_rows)])));
  }
  async function prepareFile(file){if(!can('RETURNS_IMPORT'))return;if(file.size>40*1024*1024)throw Error('Arquivo maior que 40 MB.');const token=generation,unitKey=key(),kind=importKind;busy=true;preview=null;render();
   try{const bytes=new Uint8Array(await file.arrayBuffer());let rows,extra=[];
    if(/\.csv$/i.test(file.name))rows=R.csv(new TextDecoder().decode(bytes));else if(/\.xlsx$/i.test(file.name)){
     if(!window.fflate)await adapter.loadScript('vendor/fflate.min.js');const book=window.DISB_RETURNS_FILE.open(bytes);
     let sheet=kind==='REPORT'?'03.02.24':kind==='JOURNEYS'?'BASE JORNADA LIQ':kind==='ROUTES'?'17.03':(R.norm(ctx().unit).includes('caico')?'030237-MAP CLI MOT - MAT':'030237-MAP CLI MOT - FIL');
     if(!book.sheets.includes(sheet)){if(book.sheets.length===1)sheet=book.sheets[0];else throw Error('Aba esperada não encontrada: '+sheet);}
     rows=book.read(sheet,60);
     if(kind==='ORDERS'&&book.sheets.includes('RESUMO'))extra=R.customers(book.read('RESUMO',12),ctx().unit).rows;
    }else throw Error('Selecione XLSX ou CSV.');
    const parsed=kind==='REPORT'?R.report(rows):kind==='ORDERS'?R.orders(rows,ctx().unit):kind==='JOURNEYS'?R.journeys(rows):parseRoutes(rows);
    if(token!==generation||unitKey!==key())return;
    const codes=new Set(parsed.rows.map(r=>r.customer_code));extra=extra.filter(r=>codes.has(r.customer_code));
    preview={...parsed,extra,filename:file.name,hash:await hash(bytes),id:crypto.randomUUID(),unit:ctx().unit};
   }finally{if(token===generation){busy=false;render();}}
  }
  function parseRoutes(rows){const first=rows.slice(0,30).flat().map(R.norm);return first.includes('cod id')||first.includes('codigo id')?R.routeReport(rows,month,ctx().unit):R.routeTotals(rows,ctx().unit);}
  const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  async function google(){const token=generation,unitKey=key();busy=true;preview=null;importKind='ROUTES';render();try{
   const url='https://docs.google.com/spreadsheets/d/1hYle_7TyEitARZOYgYPoO5hUcxHsj0xxhTP7YCccGTM/gviz/tq?tqx=out:csv&gid=1816877762&headers=1';const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('Não foi possível ler a aba 17.03. Use a importação XLSX/CSV.');const raw=await response.text();
   if(!raw.trim())throw Error('A aba 17.03 está vazia. Cole o relatório antes de atualizar.');const parsed=parseRoutes(R.csv(raw));if(token!==generation||unitKey!==key())return;preview={...parsed,extra:[],filename:'Google · 17.03 · '+month,hash:await hash(new TextEncoder().encode(raw)),id:crypto.randomUUID(),unit:ctx().unit};
  }finally{if(token===generation){busy=false;render();}}}
  async function commitImport(){const p=preview;if(!p||p.errors.length||!p.rows.length||!can('RETURNS_IMPORT')||p.unit!==ctx().unit)return;const token=generation;busy=true;render();
   async function send(id,kind,rows){await rpc('returns_begin_import',{p_id:id,p_unit:p.unit,p_kind:kind,p_filename:p.filename,p_hash:p.hash,p_count:rows.length});for(let i=0;i<rows.length;i+=250){if(token!==generation)throw Error('Unidade alterada.');await rpc('returns_stage_import',{p_id:id,p_rows:rows.slice(i,i+250)});}return rpc('returns_finish_import',{p_id:id});}
   try{await send(p.id,p.kind,p.rows);if(p.extra?.length){p.extraId ||=crypto.randomUUID();await send(p.extraId,'CUSTOMERS',p.extra);}preview=null;notify('Importação concluída.');await load();}
   finally{if(token===generation){busy=false;render();}}
  }
  function exportCSV(){if(!snapshot)return;const a=R.analytics(snapshot,filter),audited=view==='returns-audited';const headers=audited?['Data','PDV','Cliente','Mapa','Revenda','Cidade','Pedido (R$)','Vendedor','Motorista','Ajudante 1','Ajudante 2','Motivo motorista','Tratativa motorista','Motivo cliente','Justificativa cliente','Status']:detailHeaders;
   const rows=audited?a.audits.map(r=>[date(r.operation_date),r.customer_code,r.customer_name,r.map_number,r.branch,r.city,r.order_amount_cents==null?'':r.order_amount_cents/100,r.seller,r.driver,r.helper1,r.helper2,r.driver_reason,r.driver_treatment,r.client_reason,r.client_statement,R.STATUS[r.status]]):a.rows.map(r=>[date(r.operation_date),r.map_number,r.customer_code,r.customer_name,r.city,r.amount_cents/100,r.volume_hl,r.reason,r.seller,r.driver_treatment]);
   return adapter.download(`Devolucoes-${audited?'auditadas-':''}${filter.from}-${filter.to}.csv`,new Blob([R.toCSV(headers,rows)],{type:'text/csv;charset=utf-8'}));
  }
  async function goal(){const old=(snapshot.goals||[]).find(g=>g.month.slice(0,7)===filter.from.slice(0,7));adapter.modal({title:'Metas de devolução',subtitle:ctx().unit+' · '+filter.from.slice(0,7),html:`<form data-rt-goal-form class="rt-workspace"><div class="rt-grid">${field('Meta de PDV (%)','outlet',old?.outlet_rate==null?'':num(old.outlet_rate*100),'inputmode="decimal"')}${field('Meta de HL (%)','hl',old?.hl_rate==null?'':num(old.hl_rate*100),'inputmode="decimal"')}</div><p>Deixe vazio se não houver meta definida.</p><button type="submit" class="btn primary">Salvar metas</button><p data-rt-goal-error class="rt-error" role="alert"></p></form>`});}
  document.addEventListener('click',async e=>{const b=e.target.closest('[data-rt-action]');if(!b||!b.closest('.rt-workspace')||busy||b.disabled)return;try{
   const action=b.dataset.rtAction;
   if(action==='refresh'){await load();return;}
   if(action==='clear-filter'){filter={from:today().slice(0,7)+'-01',to:today(),city:'',driver:'',reason:'',status:'',search:''};page=0;await load();return;}
   if(action==='new'||action==='edit'){if(!can('RETURNS_EDIT')||!canLeave())return;editor=action==='edit'?structuredClone(snapshot.cases.find(r=>r.id===b.dataset.id)):{id:crypto.randomUUID(),revision:0,operation_date:today(),customer_code:'',status:'AGUARDANDO_REPASSE',branch:ctx().unit};editor.lookupKey=editor.revision?editor.customer_code+'|'+editor.operation_date:'';matches=[];dirty=false;error='';render();root().querySelector('[data-rt-case-form] input')?.focus();return;}
   if(action==='cancel'){if(!canLeave())return;editor=null;dirty=false;updated=false;render();return;}
   if(action==='lookup'){await lookup();return;}
   if(action==='history'){await history(b.dataset.id);return;}
   if(action==='export'){await exportCSV();return;}
   if(action==='previous'||action==='next'){page=Math.max(0,page+(action==='next'?1:-1));render();return;}
   if(action==='google'){await google();return;}
   if(action==='commit-import'){await commitImport();return;}
   if(action==='cancel-import'){preview=null;render();return;}
   if(action==='goal')await goal();
  }catch(e){const message=messages(e);notify(message,'error');const el=root()?.querySelector('[data-rt-case-error],[data-rt-import-error]');if(el)el.textContent=message;}});
  document.addEventListener('input',e=>{if(e.target.closest('[data-rt-case-form]')&&editor){collect(e.target.closest("form"));dirty=true;}});
  document.addEventListener('change',async e=>{try{if(e.target.matches('[data-rt-kind]')){importKind=e.target.value;preview=null;render();}if(e.target.matches('[data-rt-month]')){month=e.target.value;preview=null;}if(e.target.matches('[data-rt-file]')&&e.target.files[0])await prepareFile(e.target.files[0]);if(e.target.matches('[data-rt-match]')&&e.target.value!==''){const selected=matches[Number(e.target.value)];matches=[];applyMatch(selected);}}catch(error){notify(messages(error),'error');}});
  document.addEventListener('submit',async e=>{
   const form=e.target;if(!form.matches('[data-rt-filter-form],[data-rt-case-form],[data-rt-goal-form]'))return;e.preventDefault();if(busy)return;try{
    if(form.matches('[data-rt-filter-form]')){const f=Object.fromEntries(new FormData(form));if(!R.day(f.from)||!R.day(f.to)||f.to<f.from)throw Error('Confira as datas do período.');filter={...filter,...f};page=0;await load();}
    else if(form.matches('[data-rt-case-form]'))await saveCase(form);
    else{const values=Object.fromEntries(new FormData(form)),parse=v=>v===''?null:R.number(v);const outlet=parse(values.outlet),hl=parse(values.hl);if([outlet,hl].some(n=>n!=null&&(n<0||n>100))||values.outlet!==''&&outlet===null||values.hl!==''&&hl===null)throw Error('As metas devem estar entre 0 e 100%.');await rpc('returns_save_goal',{...args(),p_month:filter.from.slice(0,7)+'-01',p_outlet:outlet==null?null:outlet/100,p_hl:hl==null?null:hl/100});adapter.closeModal();notify('Metas atualizadas.');await load();}
   }catch(e){const message=messages(e),el=document.querySelector('[data-rt-case-error],[data-rt-goal-error]');if(el)el.textContent=message;notify(message,'error');}
  });
  window.addEventListener('focus',()=>{if(root()?.classList.contains('active')&&!busy)void load(true);});
  window.addEventListener('online',()=>{if(root()?.classList.contains('active')&&!busy)void load(true);});
  window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
  return {enter,stop,canChangeUnit,canLeave};
 }
 window.DISB_RETURNS_UI={create};
})();
