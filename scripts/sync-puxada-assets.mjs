import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'src','puxada-app');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
if(!fs.existsSync(path.join(output,'index.html')))throw new Error('Compile a Puxada antes de preparar o cache.');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):[path.relative(root,path.join(dir,entry.name)).split(path.sep).join('/')]);}
const assets=[...files(output).sort(),...['app-analytics.js','app-bridge.js','app-bridge.css'].map(name=>`src/puxada/${name}?v=${version}`)];
const start='// BEGIN GENERATED PUXADA ASSETS',end='// END GENERATED PUXADA ASSETS';
const block=`${start}\nSTATIC.push(...${JSON.stringify(assets,null,2)});\n${end}\n`;
const target=path.join(root,'sw.js');
let sw=fs.readFileSync(target,'utf8');
if(sw.includes(start))sw=sw.replace(new RegExp(`${start}[\\s\\S]*?${end}\\r?\\n`),block);
else sw=sw.replace('const STATIC_URLS=',block+'const STATIC_URLS=');
fs.writeFileSync(target,sw);
console.log(`Cache da Puxada preparado: ${assets.length} arquivos.`);
