import type {Location,LocationStatus} from './core';
export interface LocationResult {location:Location|null;locationStatus:LocationStatus}
/** A positioning failure is metadata, never a reason to prevent a trip command. */
export function captureLocation({timeoutMs=10000,signal}:{timeoutMs?:number;signal?:AbortSignal}={}):Promise<LocationResult>{
  if(typeof window!=='undefined'&&window.parent?.DISB_PULL_APP?.captureLocation)return window.parent.DISB_PULL_APP.captureLocation({timeoutMs,signal});
  return new Promise(resolve=>{
    let settled=false,watch:number|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
    const geo=typeof navigator==='undefined'?undefined:navigator.geolocation;
    const cleanup=()=>{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(watch!==undefined){try{geo?.clearWatch(watch);}catch{ /* native cleanup must not retain the UI */ }}};
    const finish=(location:Location|null,locationStatus:LocationStatus)=>{if(settled)return;settled=true;cleanup();resolve({location,locationStatus});};
    const cancel=()=>finish(null,'Unavailable');
    if(signal?.aborted||!geo){finish(null,'Unavailable');return;}
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>finish(null,'TimedOut'),Math.min(10000,Math.max(0,timeoutMs)));
    try{
      watch=geo.watchPosition(position=>{
        if(settled)return;const {latitude,longitude,accuracy}=position.coords;
        const stamp=position.timestamp,age=Date.now()-stamp;
        if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||!Number.isFinite(accuracy)||accuracy<0||!Number.isFinite(age)||age< -5000||age>30000)return;
        finish({latitude,longitude,accuracy,capturedAt:new Date(stamp).toISOString(),source:'GPS'},'Captured');
      },error=>finish(null,error.code===1?'Denied':'Unavailable'),{enableHighAccuracy:true,timeout:Math.min(10000,Math.max(1,timeoutMs)),maximumAge:0});
      // Some adapters invoke the callback synchronously before returning the id.
      if(settled)cleanup();
    }catch{finish(null,'Unavailable');}
  });
}
