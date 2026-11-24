/* A Puxada usa a sessão, as permissões e as unidades do Disb Gestão. */
(() => {
 'use strict';
 const routes={operations:{label:'Operação',permission:'PULL_TRIP'},plans:{label:'Planejamento',permission:'PULL_PLAN'},control:{label:'Farol de viagens',permission:'PULL_FAROL'},history:{label:'Histórico',permissions:'PULL_HISTORY,PULL_TRIP,PULL_TMA_ADJUST'},dashboard:{label:'Indicadores',permission:'PULL_DASHBOARD'},settings:{label:'Configurações',permissions:'PULL_CONFIG,PULL_GOALS'}};
 const redirects={'puxada-viagem':'operations','puxada-cadastrar':'plans','puxada-farol':'control','puxada-historico':'history','puxada-dashboard':'dashboard','puxada-metas':'settings','puxada-config':'settings'};
 let options=null,frame=null,generation=0,frameOwner='',frameUnit='';
 const failure=(code,detail,status=0)=>Object.assign(new Error(detail),{code,detail,status});
 function context(){const c=options?.context();if(!c?.user?.id||!c.profile?.active)throw failure('UNAUTHORIZED','Entre novamente no Disb Gestão.',401);return {...c,user:{...c.user},profile:{...c.profile},units:[...c.units]};}
 const permitted=(c,route)=>route.permission?c.hasPerm(route.permission):route.permissions.split(',').some(c.hasPerm);
 function session(c){return {user:{id:c.user.id,username:c.profile.username,name:c.profile.name,role:c.profile.role==='ADMIN'?'ADMIN':c.profile.role==='MOTORISTA_PUXADOR'?'DRIVER':'ANALYST',active:true,unitIds:[...c.units],allowedPages:Object.keys(routes).filter(k=>permitted(c,routes[k])),canEditGoals:c.hasPerm('PULL_GOALS'),canConfigure:c.hasPerm('PULL_CONFIG'),canAdjustTma:c.hasPerm('PULL_TMA_ADJUST'),canPlan:c.hasPerm('PULL_PLAN'),canCorrectLocation:c.hasPerm('PULL_FAROL')}};}
 function assertCurrent(c,epoch){const now=options?.context();if(epoch!==generation||now?.user?.id!==c.user.id||now?.unit!==c.unit)throw failure('CANCELLED','A sessão ou a unidade mudou. Os registros já salvos continuam no aparelho.');}
 function decodeError(error){
  if(error?.message==='PULL_APP_ERROR'){try{const e=JSON.parse(error.details||error.detail||'{}');return failure(e.code||'SERVER_ERROR',e.detail||'Não foi possível concluir.',e.status||422);}catch{}}
  const text=String(error?.message||error||'');
  if(/UNIDADE_SEM_ACESSO|FORBIDDEN|permission denied|row-level security/.test(text))return failure('FORBIDDEN','Seu usuário não tem permissão para esta ação ou unidade.',403);
  if(/UNAUTHORIZED|JWT|refresh token|session/i.test(text))return failure('UNAUTHORIZED','Sua sessão expirou. Entre novamente no Disb Gestão.',401);
  if(/Failed to fetch|Network|AbortError/i.test(text))return failure('NETWORK','Não foi possível acessar o servidor. Os registros salvos permanecem neste aparelho.');
  const known={TIPO_SEMANA_OBRIGATORIO:'Selecione a posição da viagem na semana.',AGENDAMENTO_OBRIGATORIO:'Informe o agendamento.',MOTORISTA_1_SEM_ACESSO_UNIDADE:'O motorista de saída não possui acesso à unidade.',MOTORISTA_2_SEM_ACESSO_UNIDADE:'O motorista de apoio não possui acesso à unidade.',PLACA_INVALIDA:'Selecione uma placa ativa.',FABRICA_INVALIDA:'Selecione uma fábrica ativa.'};
  return failure(error?.code||'SERVER_ERROR',known[text]||'Não foi possível concluir a operação. '+text.slice(0,180),422);
 }
 async function rpc(c,path,method,query,body,signal){let req=c.sb.rpc('pull_app_request',{p_method:method,p_path:path,p_query:query,p_body:body??{}});if(signal&&req.abortSignal)req=req.abortSignal(signal);const {data,error}=await req;if(error)throw decodeError(error);return data;}
 async function signed(c,value){
  if(Array.isArray(value))return Promise.all(value.map(v=>signed(c,v)));
  if(!value||typeof value!=='object')return value;
  if(value.state)value.state=await signed(c,value.state);
  for(const [key,bucket]of [['attachments','puxada-anexos'],['invoices','puxada-notas']])if(Array.isArray(value[key]))value[key]=await Promise.all(value[key].map(async file=>{
   if(!file.path)return file;const {data,error}=await c.sb.storage.from(bucket).createSignedUrl(file.path,3600);
   return {...file,url:error?'':data?.signedUrl||''};
  }));return value;
 }
 const hash=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
 async function captureLocation({timeoutMs=10000,signal}={}){
  const c=context(),epoch=generation;let timer,abort;const stopped=new Promise(resolve=>{timer=setTimeout(()=>resolve({location:null,locationStatus:'TimedOut'}),Math.min(10000,Math.max(1,timeoutMs)));abort=()=>resolve({location:null,locationStatus:'Unavailable'});if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});
  try{const result=await Promise.race([options.captureLocation(Math.min(10000,Math.max(1,timeoutMs))).catch(error=>({location:null,locationStatus:/denied|permiss|negad/i.test(error?.message||'')?'Denied':'Unavailable'})),stopped]);assertCurrent(c,epoch);return result;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async function upload(c,url,form,signal){
  const segments=url.pathname.split('/').filter(Boolean),tripId=segments[1],kind=segments[2],file=form.get('file'),clientId=String(form.get('clientId')||'');
  if(!/^[0-9a-f-]{36}$/i.test(clientId)||!file?.arrayBuffer||!['attachments','invoices'].includes(kind))throw failure('INVALID_MEDIA','Selecione um arquivo válido.',422);
  if(!file.size||file.size>(kind==='invoices'?20000000:10000000))throw failure('INVALID_MEDIA','Fotos: até 10 MB. PDFs: até 20 MB.',422);
  // Confere a assinatura do arquivo, sem confiar na extensão fornecida pelo aparelho.
  const bytes=new Uint8Array(await file.arrayBuffer()),head=Array.from(bytes.slice(0,12)),pdf=head.slice(0,5).map(v=>String.fromCharCode(v)).join('')==='%PDF-';
  const jpeg=head[0]===255&&head[1]===216&&head[2]===255,png=head.slice(0,8).join(',')==='137,80,78,71,13,10,26,10',webp=head.slice(0,4).map(v=>String.fromCharCode(v)).join('')==='RIFF'&&head.slice(8,12).map(v=>String.fromCharCode(v)).join('')==='WEBP';
  if(kind==='invoices'?!pdf:!jpeg&&!png&&!webp)throw failure('INVALID_MEDIA',kind==='invoices'?'Escolha um PDF válido.':'Escolha uma foto JPEG, PNG ou WebP.',422);
  const extension=pdf?'pdf':png?'png':webp?'webp':'jpg',bucket=pdf?'puxada-notas':'puxada-anexos',mime=pdf?'application/pdf':png?'image/png':webp?'image/webp':'image/jpeg';
  const path=`${tripId}/${c.user.id}/${clientId}.${extension}`,sha256=await hash(file);
  // A leitura valida viagem, unidade e sessão antes de enviar bytes ao armazenamento.
  await rpc(c,`/trips/${tripId}`,'GET',{}, {},signal);
  const storage=c.sb.storage.from(bucket),{error}=await storage.upload(path,bytes,{contentType:mime,upsert:false});
  if(error){
   if(!/already exists|duplicate|409/i.test(String(error.message)+' '+error.statusCode))throw decodeError(error);
   const previous=await storage.download(path);if(previous.error||!previous.data||await hash(previous.data)!==sha256)throw failure('MEDIA_ID_REUSED','O arquivo existente não corresponde ao que está salvo neste aparelho.',409);
  }
  return rpc(c,url.pathname,'POST',{}, {clientId,path,sha256,size:file.size,number:String(form.get('number')||'')},signal);
 }
 async function request(path,init={}){
  const c=context(),epoch=generation;const url=new URL(path.startsWith('/api/')?path.slice(4):path,'https://puxada.local');
  if(url.origin!=='https://puxada.local')throw failure('INVALID_ENDPOINT','Destino de solicitação inválido.',400);
  const method=String(init.method||'GET').toUpperCase(),query=Object.fromEntries(url.searchParams);query.resourceId=decodeURIComponent(url.pathname.split('/').at(-1)||'');
  if(url.pathname==='/auth/session'&&method==='GET')return session(c);
  if(url.pathname.startsWith('/auth/'))throw failure('SHARED_SESSION_REQUIRED','Use a conta e o botão Sair do Disb Gestão.',403);
  if(!c.sb)throw failure('NETWORK','Conecte-se para consultar os dados. Os registros salvos permanecem no aparelho.');
  let result;
  if(url.pathname==='/dashboard'&&method==='GET'){
   const rows=await rpc(c,'/_analytics','GET',{}, {},init.signal),goal=await rpc(c,`/goals/${query.year||new Date().getFullYear()}`,'GET',{}, {},init.signal);
   result=window.DISB_PULL_ANALYTICS.build(rows,goal,query);
  }else if(Object.prototype.toString.call(init.body)==='[object FormData]'||init.body?.get&&init.body?.append){result=await upload(c,url,init.body,init.signal);}
  else result=await rpc(c,url.pathname,method,query,init.body,init.signal);
  assertCurrent(c,epoch);
  if(/^\/trips\/[^/]+\/route$/.test(url.pathname)&&result){
   const archived=(result.archivedPoints||[]).map(point=>Array.isArray(point)?{latitude:point[0],longitude:point[1],capturedAt:new Date(Number(point[2])*1000).toISOString(),source:'GPS'}:point);
   result.points=[...archived,...(result.points||[])].sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt));result.total=result.points.length;result.sampled=false;delete result.archivedPoints;
  }
  result=await signed(c,result);assertCurrent(c,epoch);return result;
 }
 async function download(path,filename){
  const url=new URL(path.startsWith('/api/')?path.slice(4):path,'https://puxada.local'),query=Object.fromEntries(url.searchParams),a=window.DISB_PULL_ANALYTICS;let content;
  if(url.pathname==='/reports/dashboard.csv'||url.pathname==='/reports/arrivals.csv'){
   const report=await request('/dashboard'+url.search);content=url.pathname.includes('arrivals')?a.arrivalsCsv(report,query.kind||'factory'):a.dashboardCsv(report);
  }else if(url.pathname==='/reports/trips.csv'){
   const rows=await request('/trips?'+new URLSearchParams({...query,scope:'history'}));
   content=a.csv([['Código','Tipo','Unidade','Placa','Destino','Motorista 1','Motorista 2','Início','Chegada','TMV ida (min)','Fábrica (min)','TMV volta (min)','Revenda (min)','Ciclo (min)'],...rows.map(t=>{const m=a.metrics(t);return [t.code,t.type,t.unitName,t.plate,t.destination,t.driver1Name,t.driver2Name,t.startedAt,t.endedAt,m.tmvOut,m.factory,m.tmvReturn,m.unit,m.cycle];})]);
  }else if(/^\/trips\/[0-9a-f-]+\/checklists\.csv$/i.test(url.pathname)){
   const t=await request(url.pathname.replace('/checklists.csv',''));content=a.csv([['Viagem','Checklist','Motorista','Horário','KM','Pergunta','Resposta','Observação'],...t.checklists.flatMap(run=>run.answers.map(answer=>[t.code,run.checkpoint,run.userName,run.occurredAt,run.odometerKm,answer.question,answer.answer,answer.observation]))]);
  }else throw failure('NOT_FOUND','Relatório não disponível.',404);
  const objectUrl=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),anchor=document.createElement('a');anchor.href=objectUrl;anchor.download=filename||url.pathname.split('/').at(-1)||'puxada.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
 }
 function suspend(){generation++;frame?.remove();frame=null;frameOwner='';frameUnit='';}
 function enter(view){
  const page=view.replace('puxada-app-',''),route=routes[page],c=context();if(!route||!permitted(c,route))throw failure('FORBIDDEN','Seu usuário não tem acesso a esta tela.',403);
  const host=document.getElementById('view-'+view);if(!host)return;
  if(frame&&(frameOwner!==c.user.id||frameUnit!==c.unit||frame.dataset.view!==view))suspend();
  if(!frame){frame=document.createElement('iframe');frame.className='puxada-embedded-frame';frame.dataset.view=view;frame.title='Puxada Disbecol';frame.allow='geolocation';frame.src=`src/puxada-app/index.html#${page}`;frameOwner=c.user.id;frameUnit=c.unit;}
  if(frame.parentNode!==host)host.append(frame);else frame.contentWindow?.postMessage({type:'disb:puxada-navigate',page},location.origin);
 }
 function configure(config){if(options)return;options=config;window.DISB_PULL_APP=Object.freeze({request,download,captureLocation,openAdministration:()=>{const c=context();if(c.hasPerm('ADMIN_USERS'))options.openView('usuarios');}});
  new MutationObserver(()=>{if(document.getElementById('appShell')?.classList.contains('hidden'))suspend();}).observe(document.getElementById('appShell'),{attributes:true,attributeFilter:['class']});
  new MutationObserver(()=>frame?.contentWindow?.postMessage({type:'disb:puxada-theme',theme:document.documentElement.dataset.theme},location.origin)).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 }
 window.DISB_PULL_INTEGRATION=Object.freeze({configure,enter,suspend,routes,redirect:view=>view.startsWith('puxada-app-')?view:redirects[view]?'puxada-app-'+redirects[view]:view});
})();
