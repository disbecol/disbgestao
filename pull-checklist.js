// Checklists da Puxada: regras calculadas pelo banco e cópia local para o APK offline.
let pullChecklistQuestions=[];
let pullChecklistRequirements=[];
let pullChecklistRuns=[];
let pullChecklistStateReady=false;
const pullWeekLabels={FIRST:'Primeira viagem da semana',ROUTINE:'Viagem de rotina',LAST:'Última viagem da semana'};
const pullCheckpointLabels={
  D1_START:'Saída do Motorista 1 da revenda',
  D1_SUPPORT_OUT:'Retorno do Motorista 1 ao ponto de apoio',
  D2_SUPPORT_OUT:'Saída do Motorista 2 do ponto de apoio',
  D2_SUPPORT_RETURN:'Retorno do Motorista 2 ao ponto de apoio',
  D1_SUPPORT_RETURN:'Saída do Motorista 1 do ponto de apoio',
  D1_UNIT_LAST:'Retorno do Motorista 1 à revenda',
  SOLO_START:'Saída do motorista',SOLO_UNIT_LAST:'Retorno do motorista à revenda',
  TRANSFER_START:'Saída da transferência',TRANSFER_END:'Retorno da transferência'
};

function pullSelectedWeek(){return document.querySelector('input[name="pullPlanWeek"]:checked')?.value||'';}
function pullSetWeek(value){document.querySelectorAll('input[name="pullPlanWeek"]').forEach(input=>{input.checked=input.value===value;});}
const clearPullPlanFormBeforeChecklist=clearPullPlanForm;
clearPullPlanForm=function(){clearPullPlanFormBeforeChecklist();pullSetWeek('');};
const pullPlanCardHtmlBeforeChecklist=pullPlanCardHtml;
pullPlanCardHtml=function(plan,analyst=false){const html=pullPlanCardHtmlBeforeChecklist(plan,analyst);const label=pullWeekLabels[plan.week_trip_type]||'Regra semanal anterior';return html.replace('<div class="pull-plan-meta">',`<div class="pull-plan-meta"><span><b>${esc(label)}</b></span>`);};
const onPullPlansClickBeforeChecklist=onPullPlansClick;
onPullPlansClick=async function(event){
  const id=event.target.closest('[data-pull-plan-edit]')?.dataset.pullPlanEdit;
  await onPullPlansClickBeforeChecklist(event);
  if(id){const plan=pullPlans.find(row=>row.id===id);pullSetWeek(plan?.week_trip_type||'ROUTINE');}
};
savePullPlan=async function(event){
  event.preventDefault();if(!hasPerm('PULL_PLAN'))return;
  const week=pullSelectedWeek();if(!week)return toast('Selecione a posição da viagem na semana.','error');
  const type=$('pullPlanType').value,scheduledRaw=$('pullPlanScheduled').value;
  const scheduledAt=scheduledRaw?new Date(scheduledRaw).toISOString():null;
  if(type==='PULL'&&!scheduledAt)return toast('Informe a data e o horário de agendamento na fábrica.','error');
  const args={p_plan_id:$('pullPlanId').value||null,p_cycle_type:type,p_origin_unit:$('pullPlanOrigin').value,
    p_plate:$('pullPlanPlate').value,p_factory:$('pullPlanFactory').value,
    p_driver1:$('pullPlanDriver1').value,p_driver2:$('pullPlanDriver2').value||null,
    p_solo_trip:type==='TRANSFER'||$('pullPlanSolo').checked,p_scheduled_at:scheduledAt,p_week_trip_type:week};
  const button=$('pullPlanSave');button.disabled=true;button.textContent='Salvando…';
  try{const {error}=await sb.rpc('save_pull_trip_plan',args);if(error)throw error;
    toast('Viagem cadastrada com regra semanal e checklist.','success');clearPullPlanForm();await loadPullPlans(true);
  }catch(error){toast(humanPullPlanError(error),'error');}
  finally{button.disabled=false;button.textContent=$('pullPlanId').value?'Salvar alterações':'Cadastrar viagem';}
};

async function pullLoadChecklistState(){
  if(!pullActiveTrip?.week_trip_type){pullChecklistQuestions=[];pullChecklistRequirements=[];pullChecklistRuns=[];pullChecklistStateReady=true;renderPullDriver();return;}
  const key=`pull_checklist:${pullActiveTrip.id}`;
  if(navigator.onLine){
    try{
      const [questions,requirements,runs]=await Promise.all([
        sb.from('pull_checklist_questions').select('*').eq('active',true).order('sort_order'),
        sb.rpc('pull_checklist_requirements',{p_trip_id:pullActiveTrip.id}),
        sb.from('pull_checklist_runs').select('*').eq('trip_id',pullActiveTrip.id).order('recorded_at')
      ]);
      const error=questions.error||requirements.error||runs.error;if(error)throw error;
      pullChecklistQuestions=questions.data||[];pullChecklistRequirements=requirements.data||[];
      pullChecklistRuns=runs.data||[];
      const pending=(await offlineQueueRows()).filter(row=>row.type==='PULL_CHECKLIST'&&row.payload?.p_trip_id===pullActiveTrip.id);
      for(const row of pending){if(!pullChecklistRuns.some(run=>run.checkpoint_code===row.payload.p_checkpoint_code)){
        const req=pullChecklistRequirements.find(item=>item.checkpoint_code===row.payload.p_checkpoint_code);
        pullChecklistRuns.push({id:row.id,trip_id:pullActiveTrip.id,checkpoint_code:row.payload.p_checkpoint_code,
          checklist_type:req?.checklist_type||'DEPARTURE',driver_no:req?.driver_no||1,
          driver_id:row.user_id,recorded_at:row.payload.p_device_at,_offline:true,_sync_error:row.status==='ERROR'});
      }}
      pullChecklistStateReady=true;
      await offlineStateSet(key,{questions:pullChecklistQuestions,requirements:pullChecklistRequirements,runs:pullChecklistRuns});
    }catch(error){
      const cached=await offlineStateGet(key);
      if(!cached)throw error;
      pullChecklistQuestions=cached.questions||[];pullChecklistRequirements=cached.requirements||[];pullChecklistRuns=cached.runs||[];
      pullChecklistStateReady=true;
      console.warn('Checklist: usando cópia local',error);
    }
  }else{
    const cached=await offlineStateGet(key);
    pullChecklistQuestions=cached?.questions||[];pullChecklistRequirements=cached?.requirements||[];
    pullChecklistRuns=cached?.runs||[];
    pullChecklistStateReady=!!cached;
  }
  renderPullDriver();
}
const loadPullActiveTripBeforeChecklist=loadPullActiveTrip;
loadPullActiveTrip=async function(silent=false){
  const result=await loadPullActiveTripBeforeChecklist(silent);
  if(pullActiveTrip){try{await pullLoadChecklistState();}catch(error){if(!silent)toast(`Checklist: ${humanError(error)}`,'error');}}
  else{pullChecklistQuestions=[];pullChecklistRequirements=[];pullChecklistRuns=[];pullChecklistStateReady=false;}
  return result;
};
function pullChecklistPending(){
  if(!pullActiveTrip?.week_trip_type)return [];
  const last=pullDriverEvents.at(-1)?.action_code;
  return pullChecklistRequirements.filter(req=>req.after_action===last&&!pullChecklistRuns.some(run=>run.checkpoint_code===req.checkpoint_code&&!run._sync_error));
}
function pullChecklistGatePending(){const next=pullNextStep();return next?pullChecklistPending().find(req=>req.gate_action===next.action_code):null;}
const renderPullDriverBeforeChecklist=renderPullDriver;
renderPullDriver=function(){
  renderPullDriverBeforeChecklist();
  const card=$('pullChecklistCard');if(!card)return;
  const pending=pullChecklistPending(),next=pending[0];
  if(!pullActiveTrip?.week_trip_type){card.classList.add('hidden');card.innerHTML='';return;}
  const done=pullChecklistRuns.filter(run=>!run._sync_error).length,total=pullChecklistRequirements.length;
  card.classList.remove('hidden');
  card.innerHTML=`<div class="pull-checklist-heading"><div><small>VERIFICAÇÃO DA CARRETA</small><h2>${next?esc(pullCheckpointLabels[next.checkpoint_code]||'Checklist pendente'):'Checklists da viagem'}</h2><p>${!pullChecklistStateReady?'Conecte-se para carregar as regras do checklist.':next?`Motorista ${next.driver_no} • ${next.checklist_type==='DEPARTURE'?'saída':'retorno'} • responda antes de continuar.${['D1_UNIT_LAST','SOLO_UNIT_LAST','TRANSFER_END'].includes(next.checkpoint_code)?' Preencha somente ao chegar ao destino.':''}`:'Nenhum checklist pendente nesta etapa.'}</p></div><span class="status ${next?'pending':'approved'}">${done} / ${total}</span></div>${next?`<button type="button" class="btn primary wide" data-pull-checklist="${esc(next.checkpoint_code)}" ${((next.driver_no===1?pullActiveTrip.driver1_id:pullActiveTrip.driver2_id)!==authUser?.id||!pullChecklistQuestions.length)?'disabled':''}>${pullChecklistQuestions.length?'Preencher checklist': 'Perguntas indisponíveis neste aparelho'}</button>`:''}`;
  const blocked=pullChecklistGatePending();
  if(blocked){const button=$('btnPullNextStep');button.disabled=true;button.textContent='Preencha o checklist para continuar';}
  if(!pullChecklistStateReady){const button=$('btnPullNextStep');button.disabled=true;button.textContent='Carregue o checklist para continuar';}
};
const recordPullNextStepBeforeChecklist=recordPullNextStep;
recordPullNextStep=async function(){if(pullActiveTrip?.week_trip_type&&!pullChecklistStateReady)return toast('Conecte-se para carregar o checklist desta viagem.','error');const pending=pullChecklistGatePending();if(pending)return toast('Preencha o checklist antes da próxima etapa.','error');return recordPullNextStepBeforeChecklist();};

function pullChecklistFormHtml(req){
  return `<div class="notice compact">${esc(pullCheckpointLabels[req.checkpoint_code]||req.checkpoint_code)} • Motorista ${req.driver_no}. Responda todos os itens. Para NOK, descreva o problema.</div><form id="pullChecklistAnswerForm" class="pull-checklist-form">${pullChecklistQuestions.map((q,index)=>`<div class="pull-checklist-question" data-question-id="${q.id}"><div class="pull-checklist-question-title"><span>${index+1}. ${esc(q.question)}</span>${q.critical?'<b>Crítico</b>':''}</div><div class="pull-checklist-answer-options"><label><input type="radio" name="answer-${q.id}" value="OK"><span class="ok">OK</span></label><label><input type="radio" name="answer-${q.id}" value="NOK"><span class="nok">NOK</span></label></div><div class="field pull-checklist-note hidden"><label>Observação do problema *</label><textarea maxlength="1000" rows="2" placeholder="Descreva o problema encontrado"></textarea></div></div>`).join('')}</form>`;
}
function pullCollectAnswers(){
  return pullChecklistQuestions.map(q=>{
    const box=document.querySelector(`#pullChecklistAnswerForm [data-question-id="${q.id}"]`);
    const answer=box?.querySelector('input[type="radio"]:checked')?.value||'';
    const observation=answer==='NOK'?box.querySelector('textarea').value.trim():'';
    if(!answer)throw new Error(`Responda: ${q.question}`);
    if(answer==='NOK'&&observation.length<3)throw new Error(`Descreva o problema: ${q.question}`);
    return {question_id:q.id,answer,observation};
  });
}
async function pullChecklistGps(){try{return await captureGps({maxAccuracy:500,maxWaitMs:8000});}catch{return null;}}
async function pullSubmitChecklist(req,event){
  const button=event.currentTarget;let answers;
  try{answers=pullCollectAnswers();}catch(error){return toast(error.message,'error');}
  button.disabled=true;button.textContent='Salvando…';
  try{
    const gps=await pullChecklistGps(),deviceAt=new Date().toISOString();
    const payload={p_trip_id:pullActiveTrip.id,p_checkpoint_code:req.checkpoint_code,p_answers:answers,
      p_latitude:gps?.latitude??null,p_longitude:gps?.longitude??null,
      p_accuracy:gps?.accuracy??null,p_device_at:deviceAt};
    let op=await offlineQueueFind(row=>row.type==='PULL_CHECKLIST'&&row.payload?.p_trip_id===pullActiveTrip.id&&row.payload?.p_checkpoint_code===req.checkpoint_code);
    if(op){op.payload=payload;op.status='PENDING';op.last_error='';await offlineQueueUpdate(op);}
    else op=await offlineQueueAdd('PULL_CHECKLIST',payload);
    pullChecklistRuns=pullChecklistRuns.filter(run=>run.checkpoint_code!==req.checkpoint_code);
    pullChecklistRuns.push({id:op.id,trip_id:pullActiveTrip.id,checkpoint_code:req.checkpoint_code,
      checklist_type:req.checklist_type,driver_no:req.driver_no,driver_id:authUser.id,
      driver_name:profile.name,recorded_at:deviceAt,device_at:deviceAt,
      latitude:payload.p_latitude,longitude:payload.p_longitude,gps_accuracy:payload.p_accuracy,_offline:true});
    await offlineStateSet(`pull_checklist:${pullActiveTrip.id}`,{questions:pullChecklistQuestions,
      requirements:pullChecklistRequirements,runs:pullChecklistRuns});
    closeModal();renderPullDriver();
    if(navigator.onLine){await syncOfflineQueue({silent:true});await pullLoadChecklistState();
      const waiting=await offlineGet('queue',op.id);
      toast(waiting?'Checklist salvo no aparelho e aguardando sincronização.':'Checklist salvo no histórico.','success');
    }else toast('Checklist salvo no aparelho. Será enviado quando houver internet.','success');
  }catch(error){toast(humanError(error),'error');button.disabled=false;button.textContent='Salvar checklist';}
}
function pullOpenChecklist(code){
  const req=pullChecklistPending().find(row=>row.checkpoint_code===code);if(!req)return;
  if((req.driver_no===1?pullActiveTrip.driver1_id:pullActiveTrip.driver2_id)!==authUser?.id)return;
  if(!pullChecklistQuestions.length)return toast('Conecte-se para carregar as perguntas do checklist.','error');
  openModal('Checklist da carreta',pullCheckpointLabels[code]||code,pullChecklistFormHtml(req),[
    {label:'Salvar checklist',class:'primary',onClick:event=>pullSubmitChecklist(req,event)},
    {label:'Voltar',class:'secondary',onClick:closeModal}
  ]);
  $('pullChecklistAnswerForm').addEventListener('change',event=>{
    const question=event.target.closest('.pull-checklist-question');if(!question)return;
    const isNok=question.querySelector('input[type="radio"]:checked')?.value==='NOK';
    question.querySelector('.pull-checklist-note').classList.toggle('hidden',!isNok);
  });
}
const processOfflineRecordBeforeChecklist=processOfflineRecord;
processOfflineRecord=async function(row){
  if(row.type!=='PULL_CHECKLIST')return processOfflineRecordBeforeChecklist(row);
  const {data,error}=await sb.rpc('submit_pull_checklist',row.payload);if(error)throw error;
  if(pullActiveTrip?.id===row.payload.p_trip_id){
    const index=pullChecklistRuns.findIndex(run=>run.checkpoint_code===row.payload.p_checkpoint_code);
    if(index>=0)pullChecklistRuns[index]={...data,_offline:false};else pullChecklistRuns.push(data);
    await offlineStateSet(`pull_checklist:${pullActiveTrip.id}`,{questions:pullChecklistQuestions,
      requirements:pullChecklistRequirements,runs:pullChecklistRuns});
    renderPullDriver();
  }
  return data;
};
const syncOfflineQueueBeforeChecklist=syncOfflineQueue;
syncOfflineQueue=async function(...args){
  const hadChecklist=!!pullActiveTrip?.week_trip_type&&(await offlineQueueRows()).some(row=>row.type==='PULL_CHECKLIST'&&row.payload?.p_trip_id===pullActiveTrip.id);
  const result=await syncOfflineQueueBeforeChecklist(...args);
  if(hadChecklist&&pullActiveTrip?.week_trip_type&&navigator.onLine){
    try{await pullLoadChecklistState();}catch(error){console.warn('Checklist após sincronização',error);}
  }
  return result;
};

const humanPullErrorBeforeChecklist=humanPullError;
humanPullError=function(error){
  const message=String(error?.message||error||'');
  if(message.includes('CHECKLIST_PENDENTE'))return 'Preencha o checklist obrigatório antes desta etapa.';
  if(message.includes('CHECKLIST_'))return 'Não foi possível salvar o checklist. Confira as respostas, a etapa e a conexão.';
  return humanPullErrorBeforeChecklist(error);
};
const humanPullPlanErrorBeforeChecklist=humanPullPlanError;
humanPullPlanError=function(error){
  if(String(error?.message||error||'').includes('TIPO_SEMANA_OBRIGATORIO'))return 'Selecione a posição da viagem na semana.';
  return humanPullPlanErrorBeforeChecklist(error);
};

async function pullLoadQuestionsAdmin(){
  if(!hasPerm('PULL_CONFIG'))return;
  const {data,error}=await sb.from('pull_checklist_questions').select('*').order('sort_order');
  if(error)throw error;pullChecklistQuestionsAdmin=data||[];
  $('pullChecklistQuestionList').innerHTML=pullChecklistQuestionsAdmin.map(q=>`<div class="compact-row"><div><strong>${esc(q.question)} ${q.critical?'• Crítico':''}</strong><small>Ordem ${q.sort_order} • ${q.active?'Ativa':'Desativada'}</small></div><div class="pull-question-actions"><button type="button" class="mini-btn" data-check-question-edit="${q.id}">Editar</button><button type="button" class="mini-btn" data-check-question-toggle="${q.id}">${q.active?'Apagar':'Reativar'}</button></div></div>`).join('')||'<p class="muted-text">Nenhuma pergunta cadastrada.</p>';
  if(!$('pullChecklistQuestionId').value)$('pullChecklistQuestionOrder').value=Math.max(0,...pullChecklistQuestionsAdmin.map(q=>q.sort_order))+10;
}
let pullChecklistQuestionsAdmin=[];
const loadPullConfigBeforeChecklist=loadPullConfig;
loadPullConfig=async function(){await loadPullConfigBeforeChecklist();try{await pullLoadQuestionsAdmin();}catch(error){toast(`Perguntas do checklist: ${humanError(error)}`,'error');}};
function pullClearQuestion(){const form=$('formPullChecklistQuestion');form.reset();$('pullChecklistQuestionId').value='';$('pullChecklistQuestionOrder').value=Math.max(0,...pullChecklistQuestionsAdmin.map(q=>q.sort_order))+10;}
async function pullSaveQuestion(event){
  event.preventDefault();const id=$('pullChecklistQuestionId').value;
  const row={question:$('pullChecklistQuestionText').value.trim(),sort_order:Number($('pullChecklistQuestionOrder').value),critical:$('pullChecklistQuestionCritical').checked,active:true};
  if(row.question.length<5||row.sort_order<1)return toast('Informe uma pergunta e a ordem válida.','error');
  const result=id?await sb.from('pull_checklist_questions').update(row).eq('id',id):await sb.from('pull_checklist_questions').insert(row);
  if(result.error)return toast(humanError(result.error),'error');
  pullClearQuestion();await pullLoadQuestionsAdmin();toast('Pergunta salva.','success');
}
async function pullQuestionAction(event){
  const edit=event.target.closest('[data-check-question-edit]'),toggle=event.target.closest('[data-check-question-toggle]');
  const id=edit?.dataset.checkQuestionEdit||toggle?.dataset.checkQuestionToggle;if(!id)return;
  const question=pullChecklistQuestionsAdmin.find(row=>row.id===id);if(!question)return;
  if(edit){$('pullChecklistQuestionId').value=id;$('pullChecklistQuestionText').value=question.question;
    $('pullChecklistQuestionOrder').value=question.sort_order;$('pullChecklistQuestionCritical').checked=question.critical;
    $('formPullChecklistQuestion').scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(question.active&&pullChecklistQuestionsAdmin.filter(row=>row.active).length<=1)return toast('Mantenha pelo menos uma pergunta ativa.','error');
  if(question.active&&!confirm(`Apagar a pergunta “${question.question}” do checklist? O histórico será preservado.`))return;
  const {error}=await sb.from('pull_checklist_questions').update({active:!question.active}).eq('id',id);
  if(error)return toast(humanError(error),'error');await pullLoadQuestionsAdmin();
}

const renderPullTripDetailExtrasBeforeChecklist=renderPullTripDetailExtras;
renderPullTripDetailExtras=async function(trip){
  await renderPullTripDetailExtrasBeforeChecklist(trip);
  if(!hasPerm('PULL_HISTORY'))return;
  const body=$('modalBody');if(!body)return;
  const section=document.createElement('section');section.className='pull-checklist-history';
  section.innerHTML='<div class="section-title">Checklists de verificação</div><p class="muted-text">Carregando respostas…</p>';body.append(section);
  try{
    const {data:runs,error}=await sb.from('pull_checklist_runs').select('*').eq('trip_id',trip.id).order('recorded_at');
    if(error)throw error;let answers=[];
    if(runs.length){const result=await sb.from('pull_checklist_answers').select('*').in('run_id',runs.map(run=>run.id)).order('sort_order');if(result.error)throw result.error;answers=result.data||[];}
    section.innerHTML=`<div class="section-title">Checklists de verificação</div>${runs.length?runs.map(run=>`<details class="pull-checklist-history-run"><summary>${esc(pullCheckpointLabels[run.checkpoint_code]||run.checkpoint_code)} • ${esc(run.driver_name)} • ${fmtDateTime(run.device_at||run.recorded_at)}</summary><p class="muted-text">${run.device_at&&Math.abs(Date.parse(run.recorded_at)-Date.parse(run.device_at))>300000?`Enviado ao servidor em ${fmtDateTime(run.recorded_at)} • `:''}${run.latitude!=null&&run.longitude!=null?`GPS ${Number(run.latitude).toFixed(6)}, ${Number(run.longitude).toFixed(6)}${run.gps_accuracy!=null?` • ±${Math.round(run.gps_accuracy)} m`:''}`:'GPS não disponível'}</p>${answers.filter(answer=>answer.run_id===run.id).map(answer=>`<div class="pull-checklist-history-answer"><span>${esc(answer.question_snapshot)}${answer.critical_snapshot?' • Crítico':''}</span><b class="${answer.answer==='OK'?'ok':'nok'}">${esc(answer.answer)}</b>${answer.observation?`<small>${esc(answer.observation)}</small>`:''}</div>`).join('')}</details>`).join(''):'<p class="muted-text">Nenhum checklist registrado nesta viagem.</p>'}`;
  }catch(error){section.innerHTML='<div class="section-title">Checklists de verificação</div><p class="muted-text">Não foi possível carregar o histórico.</p>';console.warn(error);}
};

document.addEventListener('DOMContentLoaded',()=>{
  $('pullChecklistCard')?.addEventListener('click',event=>{const button=event.target.closest('[data-pull-checklist]');if(button)pullOpenChecklist(button.dataset.pullChecklist);});
  $('formPullChecklistQuestion')?.addEventListener('submit',pullSaveQuestion);
  $('pullChecklistQuestionClear')?.addEventListener('click',pullClearQuestion);
  $('pullChecklistQuestionList')?.addEventListener('click',pullQuestionAction);
});
