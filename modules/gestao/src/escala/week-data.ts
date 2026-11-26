import {useEffect,useMemo,useState} from 'react';
import type {EscalaState,MonthPlan,PlanDay} from './model';
import {createEscalaService,escalaError,type EscalaAdapter} from './service';
import {readEscalaDraft} from './drafts';
import {prepareEscalaDraft} from './draft-policy';
import {comparisonPreview} from './comparison-model';
type Loaded={state:EscalaState;plan:MonthPlan|null;preview:boolean;local:boolean};
export function useWeekData(adapter:EscalaAdapter|undefined,data:EscalaState,plan:MonthPlan,dates:string[]){
 const service=useMemo(()=>adapter?createEscalaService(adapter):null,[adapter]),[views,setViews]=useState<Record<string,Loaded>>({}),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),range=dates.join('|');
 useEffect(()=>{let active=true;const months=[...new Set(dates.map(d=>d.slice(0,7)+'-01'))].filter(m=>m!==plan.month);setViews({});setError('');if(!service||!months.length){setLoading(false);return;}setLoading(true);
  async function load(month:string):Promise<[string,Loaded]>{const state=await service!.load(month);state.rotation_history=[...new Map([...(state.rotation_history||[]),...state.history,...plan.days].filter(d=>d.date<month).map(d=>[d.date,d])).values()];let next=state.plan,local=false;
   try{const saved=readEscalaDraft(JSON.parse(localStorage.getItem('disb_escala_draft_v1_'+service!.key()+'_'+month)||'null'),month,next?.revision||0);if(saved&&(!next||next.status==='DRAFT')){next=saved;local=true;}}catch{/* Keep the server calendar when a local draft is invalid. */}
   if(!next&&month>plan.month){const projected=comparisonPreview(state,plan,month);return [month,{state:projected,plan:projected.plan,preview:true,local:false}];}
   const prepared=prepareEscalaDraft(state,next);return [month,{state,plan:prepared.plan,preview:prepared.updated,local}];
  }
  void Promise.all(months.map(load)).then(results=>{if(active)setViews(Object.fromEntries(results));}).catch(e=>{if(active)setError(escalaError(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[service,data,plan,range,retry]);
 const known=new Map<string,{day:PlanDay;state:EscalaState;preview:boolean;local:boolean}>();for(const day of [...(data.rotation_history||[]),...data.history])known.set(day.date,{day,state:data,preview:false,local:false});for(const view of Object.values(views))for(const day of view.plan?.days||[])known.set(day.date,{day,state:view.state,preview:view.preview,local:view.local});for(const day of plan.days)known.set(day.date,{day,state:data,preview:false,local:false});
 return {days:dates.map(date=>({date,...known.get(date)})),loading,error,retry:()=>setRetry(n=>n+1)};
}
