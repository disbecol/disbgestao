import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('uma nova compilação React muda a URL no HTML e no cache sem mudar a versão do produto',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'disb-frontend-assets-'));
 t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('disb-frontend-assets-'));fs.rmSync(root,{recursive:true,force:true});});
 fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'src/gestao-app'),{recursive:true});
 fs.copyFileSync('scripts/sync-frontend-assets.mjs',path.join(root,'scripts/sync-frontend-assets.mjs'));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'1.8.1'}));
 fs.writeFileSync(path.join(root,'index.html'),'<script src="src/gestao-app/forms-react.js?v=1.8.1"></script><script src="app.js?v=1.8.1"></script>');
 fs.writeFileSync(path.join(root,'sw.js'),"const STATIC=['index.html'];\nconst STATIC_URLS=new Set(STATIC);\n");
 const source=path.join(root,'src/gestao-app/forms-react.js');fs.writeFileSync(source,'window.release="anterior";');
 const sync=()=>execFileSync(process.execPath,[path.join(root,'scripts/sync-frontend-assets.mjs')],{cwd:root,stdio:'pipe'});
 const html=()=>fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=()=>fs.readFileSync(path.join(root,'sw.js'),'utf8'),url=()=>html().match(/src="(src\/gestao-app\/forms-react.js[^\"]*)"/)[1];
 sync();const first=url();assert.match(first,/\?v=1\.8\.1-[a-f0-9]{12}$/);assert.ok(sw().includes(first));const unchanged=sw();sync();assert.equal(url(),first);assert.equal(sw(),unchanged);
 fs.writeFileSync(source,'window.release="corrigida";');sync();assert.notEqual(url(),first);assert.ok(sw().includes(url()));assert.ok(!sw().includes(first));assert.equal((sw().match(/BEGIN GENERATED FRONTEND ASSETS/g)||[]).length,1);assert.ok(html().includes('<script src="app.js?v=1.8.1"></script>'));assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'1.8.1');
});
