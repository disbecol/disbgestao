import {useCallback,useEffect,useState} from 'react';
import {tripStore} from './offline';
import type {CommandPayload} from './core';
export function useTrip(tripId:string){
  const [,render]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
  useEffect(()=>tripStore.subscribe(()=>render(value=>value+1)),[]);
  const refresh=useCallback(async()=>{if(!tripId)return null;setLoading(true);try{await tripStore.sync();const state=await tripStore.load(tripId);setError(null);return state;}catch(e){setError(e instanceof Error?e.message:'Não foi possível atualizar.');return tripStore.getSnapshot(tripId);}finally{setLoading(false);}},[tripId]);
  useEffect(()=>{void refresh();const tick=setInterval(()=>{if(navigator.onLine&&document.visibilityState!=='hidden')void refresh();},12000);
    const online=()=>{void refresh();},visible=()=>{if(document.visibilityState!=='hidden')void refresh();};window.addEventListener('online',online);document.addEventListener('visibilitychange',visible);
    return()=>{clearInterval(tick);window.removeEventListener('online',online);document.removeEventListener('visibilitychange',visible);};},[refresh]);
  const submit=useCallback(async(payload:CommandPayload)=>{try{const entry=await tripStore.enqueue(tripId,payload);setError(null);void tripStore.sync().catch(e=>setError(e instanceof Error?e.message:'Sincronização pendente.'));return entry;}catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar no aparelho.');throw e;}},[tripId]);
  return {state:tripStore.getSnapshot(tripId),pending:tripStore.pending(tripId),loading,error,refresh,submit,sync:()=>tripStore.sync()};
}
