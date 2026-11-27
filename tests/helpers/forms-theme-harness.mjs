import fs from 'node:fs';import vm from 'node:vm';import {parseHTML} from 'linkedom';
import F from '../../src/forms/forms.js';
import {unit,person,definition,responses} from './forms-theme-fixtures.mjs';
const read=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-24T12:00:00Z']));}static now(){return new Date('2026-11-24T12:00:00Z').getTime();}}
export function formsThemeHarness(options={}){
 const {document,window}=parseHTML(read('index.html')),writes=[],reads=[],messages=[],memory=options.memory||new Map(),downloads=[],events=new Map();
 const db={form_definitions:[structuredClone(definition)],form_responses:structuredClone(responses),...(structuredClone(options.db||{}))};
 const context={user:{id:'admin'},profile:{id:'admin',name:'Aplicador de exemplo',role:'ADMIN'},unit,units:[unit],roles:{ADMIN:'Admin',COLABORADOR_ENTREGA:'Motorista'},...options.context};
 const online={onLine:true},timerJobs=new Map();let timerId=0;
 const client={from(table){
  const filters=[];let from=0,to=249,single=false,q;
  const run=()=>{let data=[...(db[table]||[])];for(const [op,key,val]of filters)data=data.filter(row=>op==='eq'?row[key]===val:op==='neq'?row[key]!==val:op==='gte'?row[key]>=val:op==='lte'?row[key]<=val:op==='lt'?row[key]<val:op==='in'?val.includes(row[key]):op==='contains'?val.every(v=>row[key]?.includes(v)):true);data=data.slice(from,to+1);return{data:single?data[0]:data,error:null};};
  q=new Proxy({}, {get(_t,key){if(key==='then')return(resolve,reject)=>Promise.resolve(run()).then(resolve,reject);return(...args)=>{if(['insert','update','upsert','delete'].includes(key))throw Error('Fixture must use the existing RPC contract.');if(['eq','neq','gte','lte','lt','in','contains'].includes(key))filters.push([key,...args]);if(key==='range')[from,to]=args;if(key==='single')single=true;return q;};}});return q;
 },async rpc(name,args){
  const readOnly=['forms_people_with_areas','forms_staff_people','staff_directory_state','my_form_evaluations','forms_evaluation_people','escala_state','escala_audit_page','escala_audit_detail'].includes(name);(readOnly?reads:writes).push({name,args:structuredClone(args)});
  if(options.rpc){const result=await options.rpc(name,args,{db,context});if(result!==undefined)return result;}
  if(name==='forms_people_with_areas'||name==='forms_staff_people'||name==='forms_evaluation_people')return{data:structuredClone(options.people||[person]),error:null};
  if(name==='my_form_evaluations')return{data:structuredClone(options.selfResults||[]),error:null};
  return{data:null,error:{message:'Read-only visual fixture.'}};
 },storage:options.storage};
 context.client=client;
 const fakeWindow={DISB_FORMS:F,document,HTMLIFrameElement:window.HTMLIFrameElement||class{},HTMLElement:window.HTMLElement,
  addEventListener(type,handler){if(!events.has(type))events.set(type,new Set());events.get(type).add(handler);},
  removeEventListener(type,handler){events.get(type)?.delete(handler);},
  get DISB_FORMS_UI(){return this._forms;},set DISB_FORMS_UI(v){this._forms=v;}};
 document.defaultView.HTMLElement.prototype.scrollIntoView=()=>{};
 const ctx=vm.createContext({window:fakeWindow,document,navigator:online,Date:FixedDate,Intl,crypto:globalThis.crypto,performance,queueMicrotask,setImmediate,console,confirm:options.confirm||(()=>true),Blob,URL,TextEncoder,Uint8Array,ArrayBuffer,DataView,structuredClone,
  setTimeout:(fn,delay)=>{timerJobs.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timerJobs.delete(id),setInterval:()=>1,clearInterval(){},
  localStorage:{getItem:key=>memory.get(key)||null,setItem:(key,v)=>memory.set(key,v),removeItem:key=>memory.delete(key)}});
 vm.runInContext(read(options.sourceFile||'src/gestao-app/forms-react.js'),ctx);
 const api=fakeWindow.DISB_FORMS_UI[options.factory||'create']({context:()=>context,hasPermission:code=>options.permissions?options.permissions.includes(code):true,toast:(...args)=>messages.push(args),openView(view){options.openView?.(view);},
  modal({html,actions}){document.getElementById('modal').classList.add('open','forms-modal');document.getElementById('modalBody').innerHTML=html;document.getElementById('modalActions').innerHTML=actions||'';},
  closeModal(){document.getElementById('modal').classList.remove('open','forms-modal');document.getElementById('modalBody').innerHTML='';document.getElementById('modalActions').innerHTML='';},
  download:(name,blob)=>downloads.push({name,blob})});
 const get=selector=>{const el=document.querySelector(selector);if(!el)throw Error('Fixture control missing: '+selector);return el;};
 const settle=async()=>{for(let i=0;i<5;i++)await flush();};
 const set=(el,value)=>{if(el.tagName==='SELECT'){const options=[...el.querySelectorAll('option')];for(const option of options)option.selected=false;const selected=options.find(option=>option.value===value);if(selected)selected.selected=true;}else if(el.type==='checkbox'){el.checked=!!value;el.toggleAttribute('checked',!!value);}else el.value=value;};
 return{document,window,context,online,events,writes,reads,messages,memory,db,downloads,api,engine:fakeWindow.DISB_FORMS_UI.engine,settle,get,html:()=>document.toString(),
  globalApi:ctx.DISB_FORMS_UI,
  release:element=>fakeWindow.DISB_FORMS_UI.release?.(element),
  appModals(){const ui=fakeWindow.DISB_FORMS_UI;fakeWindow.DISB_FORMS_UI=undefined;try{vm.runInContext(read('app.js').replace(/\}\)\(\);\s*$/,`window.__formsAppModals={open:openModal,close:closeModal};})();`),ctx);}finally{fakeWindow.DISB_FORMS_UI=ui;}return fakeWindow.__formsAppModals;},
  async enter(view){await api.enter(view);await settle();},
  async input(selector,value){const el=get(selector);set(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));await settle();},
  async change(selector,value){const el=get(selector);set(el,value);el.dispatchEvent(new window.Event('change',{bubbles:true}));await settle();},
  async click(selector){get(selector).dispatchEvent(new window.Event('click',{bubbles:true}));await settle();},
  async emit(type){for(const fn of events.get(type)||[])fn(new window.Event(type));await settle();},
  async autosave(){const jobs=[...timerJobs.values()].filter(x=>x.delay===1000);timerJobs.clear();for(const job of jobs)await job.fn();await settle();},
  destroy(){if(api.destroy)api.destroy();else api.stop?.();}
 };
}

export async function assetThemeHarness(){
 const {document,window}=parseHTML(read('index.html'));const fakeWindow={addEventListener(){}};
 document.defaultView.HTMLElement.prototype.scrollIntoView=()=>{};
 const context=vm.createContext({window:fakeWindow,document,navigator:{onLine:true},console,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}});
 const source=read('app.js').replace(/\}\)\(\);\s*$/,`window.themeAssetTest=async()=>{
  hasPerm=()=>false;openModal=(_t,_s,body)=>{$('modalBody').innerHTML=body;};
  rotatingAssetProducts=[{id:'bottle',description:'Garrafeira 600ml',sap_code:'123',asset_code:'456'}];
  rotatingAssetHistory=[{id:'count',count_code:'AG-000050',count_date:'2026-11-24',unit:'Matriz Caicó',counter_name:'Conferente de exemplo'}];
  rotatingAssetEntriesByCount=new Map([['count',[{id:'entry1',product_id:'bottle',product_description:'Garrafeira 600ml',location:'PATIO',pallet_gfa:2,layer_gfa:1,box_gfa:3,loose:4,units:5},{id:'entry2',product_id:'bottle',product_description:'Garrafeira 600ml',location:'REFUGO',pallet_gfa:0,layer_gfa:1,box_gfa:0,loose:1,units:0}]]]);
  await openRotatingAssetHistory('count');
 };})();`);
 vm.runInContext(read('src/shared/asset-conversion.js'),context);
 vm.runInContext(source,context,{timeout:3000});await fakeWindow.themeAssetTest();
 return{document,html:()=>document.toString(),click:selector=>document.querySelector(selector).dispatchEvent(new window.Event('click',{bubbles:true}))};
}
