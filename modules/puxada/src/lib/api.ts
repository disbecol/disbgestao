export class ApiError extends Error {
  constructor(public code:string, public detail:string, public state?:unknown, public status=0) { super(detail||code); this.name='ApiError'; }
}
export interface RequestOptions extends Omit<RequestInit,'body'|'credentials'> { body?:unknown; timeoutMs?:number }
export interface SharedBridge { request(path:string,options:RequestOptions):Promise<unknown>; download(path:string,filename?:string):Promise<void>; openAdministration():void;captureLocation?(options:{timeoutMs?:number;signal?:AbortSignal}):Promise<{location:import('./core').Location|null;locationStatus:import('./core').LocationStatus}> }
declare global { interface Window { DISB_PULL_APP?:SharedBridge } }
const endpoint=(path:string)=>path.startsWith('/api/')||path==='/api'?path:'/api/'+path.replace(/^\//,'');

async function request<T>(path:string, options:RequestOptions={}):Promise<T> {
  const {timeoutMs=12000,signal:upstream,body,...rest}=options;
  const controller=new AbortController();let timedOut=false;let rejectStop!:(error:ApiError)=>void;
  const stopped=new Promise<never>((_,reject)=>{rejectStop=reject;});
  const abort=()=>{controller.abort();rejectStop(new ApiError('CANCELLED','Solicitação cancelada.'));};
  if(upstream?.aborted)abort();else upstream?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();rejectStop(new ApiError('TIMEOUT','O servidor demorou para responder. O registro salvo será tentado novamente.'));},timeoutMs);
  try {
    const bridge=typeof window==='undefined'?undefined:window.parent?.DISB_PULL_APP;
    if(bridge){
      try{return await Promise.race([bridge.request(path,{...rest,body,signal:controller.signal}) as Promise<T>,stopped]);}
      catch(error){if(error instanceof ApiError)throw error;const e=error as any;throw new ApiError(e?.code||'NETWORK',e?.detail||e?.message||'Não foi possível consultar a Puxada.',e?.state,e?.status||0);}
    }
    if(import.meta.env.PROD)throw new ApiError('SHARED_SESSION_REQUIRED','Abra a Puxada pelo Disb Gestão.',undefined,401);
    const headers=new Headers(rest.headers);let payload:BodyInit|undefined;
    if(!['GET','HEAD','OPTIONS'].includes(String(rest.method||'GET').toUpperCase()))headers.set('X-Puxada-Request','1');
    if(body!==undefined) {
      if(typeof body==='string'||body instanceof Blob||body instanceof FormData||body instanceof URLSearchParams)payload=body;
      else {headers.set('Content-Type','application/json');payload=JSON.stringify(body);}
    }
    return await Promise.race([(async()=>{
      const response=await fetch(endpoint(path),{...rest,headers,body:payload,credentials:'include',signal:controller.signal,cache:'no-store'});
      const text=await response.text();let data:any;
      if(text){try{data=JSON.parse(text);}catch{if(response.ok)throw new ApiError('INVALID_RESPONSE','O servidor retornou uma resposta inválida.',undefined,response.status);}}
      if(response.status===401 && !['/auth/login','/auth/session'].includes(path) && typeof window!=='undefined')window.dispatchEvent(new Event('puxada:session-expired'));
      if(!response.ok)throw new ApiError(data?.code||'HTTP_'+response.status,data?.detail||'Não foi possível concluir a solicitação.',data?.state,response.status);
      return data as T;
    })(),stopped]);
  } catch(error) {
    if(error instanceof ApiError)throw error;
    if(controller.signal.aborted)throw new ApiError(timedOut?'TIMEOUT':'CANCELLED',timedOut?'O servidor demorou para responder. O registro salvo será tentado novamente.':'Solicitação cancelada.');
    throw new ApiError('NETWORK','Não foi possível acessar o servidor. Os registros salvos permanecem no aparelho.');
  } finally {clearTimeout(timer);upstream?.removeEventListener('abort',abort);}
}
export const api={request,
  download:async(path:string,filename?:string)=>{const bridge=typeof window==='undefined'?undefined:window.parent?.DISB_PULL_APP;if(bridge)return bridge.download(path,filename);throw new ApiError('SHARED_SESSION_REQUIRED','Abra a Puxada pelo Disb Gestão.',undefined,401);},
  get:<T>(path:string,options:RequestOptions={})=>request<T>(path,{...options,method:'GET'}),
  post:<T>(path:string,body?:unknown,options:RequestOptions={})=>request<T>(path,{...options,method:'POST',body}),
  put:<T>(path:string,body?:unknown,options:RequestOptions={})=>request<T>(path,{...options,method:'PUT',body}),
  delete:<T>(path:string,options:RequestOptions={})=>request<T>(path,{...options,method:'DELETE'})};
