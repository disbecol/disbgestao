import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {cascade,contrast} from './helpers/css-cascade.mjs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

function controller({saved=null,dark=false,blocked=false}={}) {
  const events={},systemEvents={},documentEvents={},store=new Map(saved===null?[]:[['disb.appearance',saved]]);
  const controls=[0,1].map(()=>({value:'system',addEventListener(name,fn){this[name]=fn;}}));
  const meta={content:'',setAttribute(name,value){this[name]=value;}};
  const document={documentElement:{dataset:{}},querySelector:()=>meta,querySelectorAll:()=>controls,addEventListener(name,fn){documentEvents[name]=fn;}};
  const system={matches:dark,addEventListener(name,fn){systemEvents[name]=fn;}};
  const window={matchMedia:()=>system,localStorage:{getItem(key){if(blocked)throw Error('unavailable');return store.get(key)||null;},setItem(key,value){if(blocked)throw Error('unavailable');store.set(key,value);}},addEventListener(name,fn){events[name]=fn;}};
  vm.runInNewContext(read('appearance.js'),{document,window});
  return {document,events,system,systemEvents,controls,meta,store,ready:()=>documentEvents.DOMContentLoaded(),choose(value){controls[0].value=value;controls[0].change();}};
}

test('saved appearance applies before DOMContentLoaded and both controls stay synchronized',()=>{
  const c=controller({saved:'dark'});assert.equal(c.document.documentElement.dataset.theme,'dark');assert.equal(c.meta.content,'#111923');
  c.ready();c.choose('light');assert.equal(c.store.get('disb.appearance'),'light');assert.equal(c.document.documentElement.dataset.theme,'light');assert.equal(c.controls[1].value,'light');
});
test('automatic mode follows the device while an explicit selection stays fixed',()=>{
  const c=controller({dark:true});c.ready();assert.equal(c.document.documentElement.dataset.theme,'dark');
  c.system.matches=false;c.systemEvents.change();assert.equal(c.document.documentElement.dataset.theme,'light');
  c.choose('dark');c.systemEvents.change();assert.equal(c.document.documentElement.dataset.theme,'dark');
  c.choose('system');assert.equal(c.document.documentElement.dataset.theme,'light');
});
test('theme survives reopening and works without access to local storage',()=>{
  const first=controller();first.ready();first.choose('dark');
  assert.equal(controller({saved:first.store.get('disb.appearance')}).document.documentElement.dataset.theme,'dark');
  const blocked=controller({blocked:true});blocked.ready();assert.doesNotThrow(()=>blocked.choose('dark'));assert.equal(blocked.document.documentElement.dataset.theme,'dark');
  assert.equal(controller({saved:'invalid'}).document.documentElement.dataset.themePreference,'system');
});
test('appearance synchronizes between tabs without reacting to unrelated storage changes',()=>{
  const c=controller();c.ready();c.events.storage({key:'disb.appearance',newValue:'dark'});assert.equal(c.controls[0].value,'dark');
  c.events.storage({key:'auth',newValue:'light'});assert.equal(c.controls[0].value,'dark');
  c.events.storage({key:null,newValue:null});assert.equal(c.controls[0].value,'system');
});

for(const theme of ['light','dark'])for(const width of [390,1280])test(`sidebar labels have readable contrast (${theme}, ${width}px)`,()=>{
  const c=cascade({theme,width});
  const labels=c.document.querySelectorAll('#sidebar .module-name,#sidebar .area-name,#sidebar .app-version-badge,#sidebar .nav-item');
  assert.ok(labels.length>30);
  for(const el of labels){const ratio=contrast(c.value(el,'color'),c.background(el));assert.ok(ratio>=4.5,`${el.textContent.trim()}: ${ratio.toFixed(2)}:1`);}
});

for(const theme of ['light','dark'])test(`open, hovered and selected navigation stays readable (${theme})`,()=>{
  const c=cascade({theme,markup:`<html><body><aside id="sidebar" class="sidebar"><div class="nav-module open"><button class="nav-module-toggle test-hover"><span class="module-name">NRI</span></button><button class="nav-item active test-hover">Recebimentos pendentes</button></div></aside></body></html>`});
  for(const el of c.document.querySelectorAll('.module-name,.nav-item'))assert.ok(contrast(c.value(el,'color'),c.background(el))>=4.5,el.className);
});

test('dark forms, tables, statuses and damage details have readable text',()=>{
  const c=cascade({theme:'dark',markup:`<html><body><div id="appShell"><div class="card"><div class="field"><label>Validade</label><input id="input" value="12/12/2026"></div><button class="btn primary">Salvar</button><div class="table-wrap"><table><thead><tr><th>Produto</th></tr></thead><tbody><tr><td><strong>SKOL</strong><small>Caixa</small><span class="status pending">Pendente</span></td></tr><tr><td>Outro produto</td></tr></tbody></table></div></div></div><div id="modal"><div class="damage-review-workspace damage-review-delivery"><div class="damage-product-head damage-product-row"><div class="damage-product-name"><strong>Produto avariado</strong><small>Cód. 982</small></div></div><div class="damage-summary-grid"><div><small>Lote</small><strong>L2408</strong></div></div><button class="damage-card-action deliver">Entregar</button></div></div></body></html>`});
  for(const el of c.document.querySelectorAll('label,input,button,th,td,strong,small,.status')){
    const ratio=contrast(c.value(el,'color'),c.background(el));assert.ok(ratio>=4.5,`${el.tagName} ${el.className}: ${ratio.toFixed(2)}:1`);
  }
});
test('signature stays on white and dark screen colors do not recolor printed documents',()=>{
  const markup='<html><body><div id="appShell"><div id="view-avaria-cadastro"><div class="av-signature"><canvas></canvas></div></div><div class="card">Documento</div></div></body></html>';
  const screen=cascade({theme:'dark',markup});assert.equal(screen.background(screen.document.querySelector('canvas')),'#fff');
  const printLight=cascade({theme:'light',media:'print',markup}),printDark=cascade({theme:'dark',media:'print',markup});
  for(const prop of ['color','background-color'])assert.equal(printLight.value(printLight.document.querySelector('.card'),prop),printDark.value(printDark.document.querySelector('.card'),prop));
});
test('appearance controller loads before styles and is packaged for offline and Android',()=>{
  const html=read('index.html'),sw=read('sw.js'),copier=read('scripts/copy-web.mjs');
  assert.ok(html.indexOf('src="appearance.js?')<html.indexOf('rel="stylesheet"'));
  for(const name of ['appearance.js','appearance.css']){assert.ok(copier.includes(`'${name}'`));const url=html.match(new RegExp(`(?:src|href)="(${name.replace('.','\\.')}[^\"]+)"`))[1];assert.ok(sw.includes(`'${url}'`));}
});
