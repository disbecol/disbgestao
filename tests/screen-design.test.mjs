import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {cascade,contrast,luminance} from './helpers/css-cascade.mjs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const legacy=new Set(['puxada-cadastrar','puxada-viagem','puxada-farol','puxada-historico','puxada-dashboard','puxada-metas','puxada-config']);
function scene(markup=read('index.html')){
 const {document}=parseHTML(markup),window={};
 vm.runInNewContext(read('src/shared/screen-design.js'),{window,document,setTimeout(){}});
 window.DISB_SCREEN_DESIGN.enhance();
 return {document,api:window.DISB_SCREEN_DESIGN};
}
const designed=scene().document.toString();

test('every current route receives a named workspace and area, including the six embedded Puxada pages',()=>{
 const {document,api}=scene(),views=[...document.querySelectorAll('.view[id]')].filter(v=>!legacy.has(v.id.slice(5)));
 const bridge={};vm.runInNewContext(read('src/puxada/app-bridge.js'),{window:bridge});
 const embedded=Object.keys(bridge.DISB_PULL_INTEGRATION.routes).map(page=>'puxada-app-'+page);
 assert.equal(views.length+embedded.length,74);
 assert.deepEqual(Object.keys(api.SCREENS).sort(),[...views.map(v=>v.id.slice(5)),...embedded].sort());
 for(const v of views){assert.ok(v.classList.contains('screen-workspace'),v.id);assert.ok(v.dataset.screenArea,v.id);assert.ok(v.dataset.screenLayout,v.id);}
 for(const id of embedded)assert.equal(api.SCREENS[id][0],'puxada');
 for(const id of legacy)assert.ok(!document.getElementById('view-'+id).classList.contains('screen-workspace'));
});

test('enhancement preserves form values, selections and handlers, and is idempotent after re-render',()=>{
 const {document,api}=scene('<html><body><main id="mainContent"><section id="view-nri-cadastro" class="view"><h1>Cadastro</h1><div class="field"><label>Produto</label><input id="product" value="982"></div><div class="field"><label>Automático</label><input value="Caicó" readonly></div><input type="checkbox" checked><button id="action">Adicionar</button><div class="kpi"><span>Valor</span><strong>R$ 10</strong></div><div class="table-wrap"><table><thead><tr><th>Nome</th></tr></thead><tbody><tr><td colspan="1">Nenhum registro.</td></tr></tbody></table></div></section></main></body></html>');
 let clicked=0;document.getElementById('action').addEventListener('click',()=>clicked++);
 const control=document.getElementById('product'),checkbox=document.querySelector('[type=checkbox]'),checked=checkbox.hasAttribute('checked');
 for(let i=0;i<3;i++)api.enhance();
 document.getElementById('action').click();
 assert.equal(clicked,1);assert.equal(control.value,'982');assert.equal(document.querySelector('[type=checkbox]'),checkbox);assert.equal(checkbox.hasAttribute('checked'),checked);
 assert.equal(document.querySelector('label').getAttribute('for'),'product');
 assert.ok(document.querySelector('[readonly]').closest('.screen-field-automatic'));
 assert.equal(document.querySelectorAll('.screen-metric-icon').length,1);
 assert.equal(document.querySelector('th').getAttribute('scope'),'col');
 const region=document.querySelector('.table-wrap');assert.equal(region.getAttribute('tabindex'),'0');assert.equal(region.getAttribute('role'),'region');assert.match(region.getAttribute('aria-label'),/Cadastro/);
 assert.ok(document.querySelector('td').classList.contains('screen-empty-cell'));
});

for(const theme of ['light','dark'])for(const width of [390,1440])test(`all editable and automatic static fields remain readable (${theme}, ${width}px)`,()=>{
 const c=cascade({theme,width,markup:designed});let count=0;
 for(const field of c.document.querySelectorAll('.screen-workspace input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]),.screen-workspace select,.screen-workspace textarea')){
  const fg=c.value(field,'color'),bg=c.background(field);assert.ok(contrast(fg,bg)>=4.5,`${field.id}: ${fg} on ${bg}`);
  if(theme==='dark')assert.ok(luminance(bg)<.12,field.id);count++;
 }
 assert.ok(count>140);
});

test('users list stays outside the collapsed editor and editing preserves the selected account and access editors',()=>{
 const {document}=scene(),editor=document.getElementById('userEditor');
 assert.ok(!editor.hasAttribute('open'));assert.ok(editor.contains(document.getElementById('formUsuario')));assert.ok(!editor.contains(document.getElementById('tbodyUsuarios')));
 const calls=[],user={id:'person',username:'ana',name:'Ana',role:'VENDEDOR',active:true,evaluation_area:'Vendas'};
 document.defaultView.HTMLElement.prototype.scrollIntoView=()=>{};
 const context=vm.createContext({$:id=>document.getElementById(id),users:[user],renderUserPermissionEditor:(u,restore)=>calls.push(['permissions',u,restore]),renderUserUnitEditor:u=>calls.push(['units',u])});
 const source=read('app.js'),start=source.lastIndexOf('onUserTableClick=function(e){'),end=source.indexOf('\n};',start)+3;
 vm.runInContext(source.slice(start,end),context);
 const button=document.createElement('button');button.dataset.user='ana';document.getElementById('usuarioSenha').value='stale-password';context.onUserTableClick({target:button});
 assert.equal(editor.open,true);assert.equal(document.getElementById('usuarioOriginal').value,'ana');assert.equal(document.getElementById('usuarioLogin').value,'ana');assert.equal(document.getElementById('usuarioSenha').value,'');
 assert.equal(calls.length,2);assert.equal(calls[0][1],user);assert.equal(calls[0][2],false);assert.equal(calls[1][1],user);
});

test('the font and workspace enhancement are local and available to the offline app',()=>{
 const html=read('index.html'),worker=read('sw.js'),copy=read('scripts/copy-web.mjs');
 for(const file of ['src/shared/screen-design.js','assets/fonts/inter-latin.woff2','assets/fonts/inter-latin-ext.woff2']){
  assert.ok(worker.includes(file),file);assert.ok(fs.existsSync(new URL('../'+file,import.meta.url)),file);
 }
 assert.ok(html.indexOf('src/shared/screen-design.js')<html.indexOf('src="app.js'));
 assert.ok(copy.includes("['src']"));assert.ok(copy.includes('assets'));
 for(const css of ['src/shared/screen-design.css','modules/puxada/src/screen-design.css'])assert.ok(!/https?:\/\/fonts\./.test(read(css)));
});
