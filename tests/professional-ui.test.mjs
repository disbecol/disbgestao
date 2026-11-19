import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const css=postcss.parse(read('src/shared/professional-ui.css'));
const tokens={};css.walkRules(':root',rule=>rule.walkDecls(declaration=>{tokens[declaration.prop]=declaration.value;}));
function luminance(hex){
  const channels=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
}
function contrast(a,b){const [low,high]=[luminance(a),luminance(b)].sort((a,b)=>a-b);return (high+.05)/(low+.05);}

test('core text and primary actions retain at least 4.5:1 contrast',()=>{
  for(const [name,a,b] of [['body',tokens['--text'],'#ffffff'],['secondary',tokens['--muted'],'#ffffff'],['primary action','#ffffff',tokens['--blue']],['selected menu','#244f7c','#eaf0f6'],['success','#246b4d','#edf6f1'],['error','#a8353d','#fcf0f1'],['pending','#825d16','#fbf5e9']]){
    assert.ok(contrast(a,b)>=4.5,`${name}: ${contrast(a,b).toFixed(2)}:1`);
  }
});

test('every application stylesheet remains available in the offline precache',()=>{
  const html=read('index.html'),worker=read('sw.js');
  const sheets=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(match=>match[1]);
  assert.ok(sheets.length>10);
  for(const href of sheets){assert.ok(worker.includes(`'${href}'`),`missing precache: ${href}`);assert.ok(fs.existsSync(new URL('../'+href.split('?')[0],import.meta.url)));}
  assert.ok(sheets.at(-2).startsWith('src/shared/professional-ui.css'));
  assert.ok(sheets.at(-1).startsWith('src/shared/appearance.css'));
  assert.ok(read('scripts/copy-web.mjs').includes("for(const dir of ['src'])"),'APK must include the src module directories');
});

test('navigation and synchronization controls remain keyboard accessible',()=>{
  const html=read('index.html');
  assert.match(html,/<button\b[^>]*type="button"[^>]*id="syncPill"/);
  assert.match(html,/id="menuBtn"[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"/);
  assert.match(html,/class="skip-link" href="#mainContent"/);
  assert.match(html,/<main[^>]*id="mainContent"[^>]*tabindex="-1"/);
});
