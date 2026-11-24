import fs from 'node:fs';import vm from 'node:vm';import {parseHTML} from 'linkedom';
import F from '../../src/forms/forms.js';
import {unit,person,definition,responses} from './forms-theme-fixtures.mjs';
const read=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-24T12:00:00Z']));}static now(){return new Date('2026-11-24T12:00:00Z').getTime();}}
export function formsThemeHarness(){
 const {document,window}=parseHTML(read('index.html')),writes=[],messages=[],memory=new Map();
 const db={form_definitions:[structuredClone(definition)],form_responses:structuredClone(responses)};
 const client={from(table){const filters=[];let from=0,to=249,q;const run=()=>{let data=[...(db[table]||[])];for(const [op,key,val]of filters)data=data.filter(row=>op==='eq'?row[key]===val:op==='neq'?row[key]!==val:op==='gte'?row[key]>=val:op==='lte'?row[key]<=val:true);return{data:data.slice(from,to+1),error:null};};q=new Proxy({}, {get(_t,key){if(key==='then')return(resolve,reject)=>Promise.resolve(run()).then(resolve,reject);return(...args)=>{if(['insert','update','upsert','delete'].includes(key))throw Error('Read-only visual fixture.');if(['eq','neq','gte','lte'].includes(key))filters.push([key,...args]);if(key==='range')[from,to]=args;return q;};}});return q;},async rpc(name,args){if(name==='forms_people_with_areas')return{data:[structuredClone(person)],error:null};if(name==='my_form_evaluations')return{data:[],error:null};writes.push({name,args});return{data:null,error:{message:'Read-only visual fixture.'}};}};
 const fakeWindow={DISB_FORMS:F,addEventListener(){},get DISB_FORMS_UI(){return this._forms;},set DISB_FORMS_UI(v){this._forms=v;}};
 document.defaultView.HTMLElement.prototype.scrollIntoView=()=>{};
 const ctx=vm.createContext({window:fakeWindow,document,navigator:{onLine:true},Date:FixedDate,Intl,crypto:globalThis.crypto,console,confirm:()=>true,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},localStorage:{getItem:key=>memory.get(key)||null,setItem:(key,v)=>memory.set(key,v),removeItem:key=>memory.delete(key)}});
 vm.runInContext(read('src/forms/forms-ui.js'),ctx);
 const api=fakeWindow.DISB_FORMS_UI.create({context:()=>({client,user:{id:'admin'},profile:{id:'admin',name:'Aplicador de exemplo',role:'ADMIN'},unit,units:[unit],roles:{ADMIN:'Admin',COLABORADOR_ENTREGA:'Motorista'}}),hasPermission:()=>true,toast:(...args)=>messages.push(args),openView(){},modal({html,actions}){document.getElementById('modalBody').innerHTML=html;document.getElementById('modalActions').innerHTML=actions||'';},closeModal(){}});
 return{document,writes,messages,html:()=>document.toString(),async enter(view){await api.enter(view);await flush();},async input(selector,value){const el=document.querySelector(selector);if(!el)throw Error('Fixture control missing: '+selector);if(el.tagName==='SELECT')for(const option of el.querySelectorAll('option'))option.selected=option.value===value;else el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));await flush();},async click(selector){const el=document.querySelector(selector);if(!el)throw Error('Fixture control missing: '+selector);el.dispatchEvent(new window.Event('click',{bubbles:true}));await flush();await flush();}};
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
