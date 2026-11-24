import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';

const source=readFileSync(new URL('../../src/estoque/refugo.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const html=`<html><body>
  <div id="refugoCurrent"></div><div id="refugoOpenSessions"></div>
  <button id="refugoRefresh"></button><button id="refugoHistoryRefresh"></button>
  <input id="refugoHistoryDate"><button id="refugoDailyCsv"></button>
  <input id="refugoHistorySearch"><table><tbody id="refugoHistoryRows"></tbody></table>
  <form id="refugoCatalogForm"><input id="refugoCatalogId"><input id="refugoCatalogName">
    <select id="refugoCatalogKind"><option value="TYPE">Tipo</option><option value="REASON">Motivo</option></select>
    <select id="refugoCatalogActive"><option value="true">Ativo</option><option value="false">Inativo</option></select>
    <div id="refugoMapFieldWrap"><select id="refugoMapField"></select></div>
  </form>
  <button id="refugoCatalogClear"></button><button id="refugoCatalogRefresh"></button>
  <div id="refugoCatalogRows"></div>
</body></html>`;

export function createRefugoHarness({catalog=[],openSessions=[],history=[],items=[],native=false}={}) {
  const {document,window}=parseHTML(html);
  const calls=[],toasts=[];
  let exported;
  const downloads={};
  const client={
    from(table) {
      const filters={};
      const query={
        select(){return this;},
        eq(field,value){filters[field]=value;return this;},
        in(field,value){filters[field]=value;return this;},
        order(){return this;},
        range(from,to) {
          calls.push({type:'select',table,filters:{...filters}});
          let rows=table==='refugo_catalog'?catalog:table==='refugo_sessions'?(filters.status==='OPEN'?openSessions:history):table==='refugo_items'?items:[];
          rows=rows.filter(row=>Object.entries(filters).every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value));
          return Promise.resolve({data:rows.slice(from,to+1),error:null});
        }
      };
      return query;
    },
    async rpc(name,args) {
      calls.push({type:'rpc',name,args});
      return {data:null,error:null};
    }
  };
  class TestFileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes=>{
        this.result=`data:text/csv;base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      },error=>{this.error=error;this.onerror();});
    }
  }
  const context=vm.createContext({
    document,console,Intl,Date,Blob,FileReader:TestFileReader,
    setInterval:()=>1,clearInterval:()=>{}
  });
  context.window=context;
  context.confirm=()=>true;
  if(native){
    context.Capacitor={Plugins:{
      Filesystem:{writeFile:async options=>{downloads.written=options;return {uri:'file:///cache/refugo.csv'};}},
      Share:{share:async options=>{downloads.shared=options;}}
    }};
  }
  vm.runInContext(source,context);
  const refugo=context.DISB_REFUGO.create({
    context:()=>({client,unit:'Matriz Caicó',profile:{name:'Pessoa'}}),
    getElement:id=>document.getElementById(id),
    escapeHtml:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
    formatDate:value=>String(value||''),
    formatDateTime:value=>String(value||''),
    localIsoDate:value=>new Date(value).toISOString().slice(0,10),
    normalize:value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(),
    humanError:error=>String(error?.message||error),
    isNativeCapacitor:()=>native,
    downloadCsv:(name,matrix)=>{exported={name,matrix};},
    openModal:()=>{},closeModal:()=>{},hasPermission:()=>false,
    toast:(...args)=>toasts.push(args)
  });
  const click=async element=>{
    element.dispatchEvent(new window.Event('click',{bubbles:true}));
    await flush();
    await flush();
  };
  return {
    refugo,document,window,calls,toasts,downloads,client,click,
    get exported(){return exported;},
    async enter(view){await refugo.enter(view);await flush();}
  };
}
