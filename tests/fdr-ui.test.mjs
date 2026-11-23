import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
const require=createRequire(import.meta.url),F=require('../src/fdr/fdr.js'),code=readFileSync(new URL('../src/fdr/fdr-ui.js',import.meta.url),'utf8');
const row={id:'r1',report_date:'2026-11-20',customer_code:'42',customer_name:'Loja <script>',map_number:'9',city:'Caicó',driver:'Ana',seller:'João',branch:'MATRIZ',justified:false,revision:1};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({query,rpc,permissions=['FDR_VIEW','FDR_EDIT']}={}){
 const {document,window}=parseHTML('<html><body><section id="view-fdr-reports" class="active"></section><section id="view-fdr-dashboard" class="active"></section></body></html>'),timers=new Map(),calls=[],toasts=[];let unit='Matriz Caicó',data=[row],failed=false;
 class FormData{constructor(form){this.items=[...form.querySelectorAll('input,select,textarea')].filter(e=>e.name&&!e.disabled).map(e=>[e.name,e.value||'']);}[Symbol.iterator](){return this.items[Symbol.iterator]();}}
 const client={from(table){const args={table};return {select(){return this;},eq(k,v){args[k]=v;return this;},order(){return this;},range(from,to){calls.push({...args,from,to});return query?query(args):Promise.resolve({data:failed?null:data,error:failed?{message:'Failed to fetch'}:null});}};},rpc:async(name,args)=>{calls.push({name,args});return rpc?rpc(name,args):{data:[{...row,city:'Cidade automática'}],error:null};}};
 window.DISB_FDR=F;
 vm.runInNewContext(code,{window,document,Intl,Date,FormData,crypto:{randomUUID:()=> 'new-id'},confirm:()=>true,setTimeout,clearTimeout,setInterval:fn=>{const id=timers.size+1;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id)});
 const module=window.DISB_FDR_UI.create({context:()=>({client,user:{id:'user'},unit}),hasPermission:p=>permissions.includes(p),toast:(...args)=>toasts.push(args)});
 return {module,document,window,timers,calls,toasts,setUnit:value=>unit=value,setData:value=>data=value,fail:()=>failed=true,async click(selector){document.querySelector(selector).click();await tick();},async submit(selector){document.querySelector(selector).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await tick();}};
}
test('dashboard usa filtros em todos os indicadores, escapa dados e mostra vazio sem percentual inventado',async()=>{
 const h=harness({permissions:['FDR_VIEW']});h.setData([row,{...row,id:'r2',customer_code:'43',city:'Natal',driver:'Bia',justified:true}]);await h.module.enter('fdr-dashboard');const root=h.document.querySelector('#view-fdr-dashboard');assert.match(root.textContent,/Top 10 motoristas/);assert.match(root.textContent,/50%/);assert.equal(root.querySelectorAll('script').length,0);assert.equal(root.querySelectorAll('[data-fdr-action=new]').length,0);
 const city=root.querySelector('[name=city]');for(const option of city.options)option.selected=false;city.querySelector('[value="Caicó"]').selected=true;await h.submit('[data-fdr-filter-form]');assert.match(root.querySelector('.fdr-kpis').textContent,/0%/);assert.doesNotMatch(root.querySelector('.fdr-bars').textContent,/Bia/);
 h.setData([]);await h.click('[data-fdr-action=refresh]');assert.match(root.querySelector('.fdr-kpis').textContent,/Sem base/);assert.match(root.textContent,/Nenhum apontamento/);
});
test('falha de rede oculta indicadores antigos e interromper a sessão encerra o relógio e limpa dados',async()=>{
 const h=harness();await h.module.enter('fdr-dashboard');assert.equal(h.timers.size,1);h.fail();await h.click('[data-fdr-action=refresh]');assert.ok(!h.document.querySelector('.fdr-kpis'));assert.match(h.document.querySelector('[role=alert]').textContent,/não foram calculados/);h.module.stop();assert.equal(h.timers.size,0);assert.equal(h.document.querySelector('#view-fdr-dashboard').textContent,'');
});
test('resposta de outra unidade é descartada e não reaparece no dashboard',async()=>{
 let release;const h=harness({query:args=>args.unit==='Matriz Caicó'?new Promise(resolve=>release=resolve):Promise.resolve({data:[],error:null})});const old=h.module.enter('fdr-dashboard');await tick();h.setUnit('Filial Pau dos Ferros');await h.module.enter('fdr-dashboard');release({data:[row],error:null});await old;assert.doesNotMatch(h.document.querySelector('#view-fdr-dashboard').textContent,/\bAna\b/);assert.equal(h.calls.at(-1).unit,'Filial Pau dos Ferros');h.module.stop();
});
test('formulário de apontamento continua editável, preserva rascunho e salva com revisão',async()=>{
 const h=harness({rpc:async(name,args)=>name==='fdr_save'?{data:{revision:2},error:null}:{data:[row],error:null}});await h.module.enter('fdr-reports');await h.click('[data-fdr-action=edit]');const root=h.document.querySelector('#view-fdr-reports'),form=root.querySelector('[data-fdr-entry-form]');const obs=form.querySelector('[name=observations]');obs.value='Revisar apontamento';obs.dispatchEvent(new h.window.Event('input',{bubbles:true}));await h.click('[data-fdr-action=refresh]');assert.equal(root.querySelector('[name=observations]').value,'Revisar apontamento');await h.submit('[data-fdr-entry-form]');const saved=h.calls.find(c=>c.name==='fdr_save');assert.equal(saved.args.p_revision,1);assert.equal(saved.args.p_unit,'Matriz Caicó');assert.equal(saved.args.p_data.observations,'Revisar apontamento');assert.ok(!root.querySelector('[data-fdr-entry-form]'));h.module.stop();
});
