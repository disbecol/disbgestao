import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(), out=path.join(root,'www');
if(path.resolve(out)!==path.resolve(root,'www')||path.dirname(path.resolve(out))!==path.resolve(root))throw new Error('Destino web inválido.');
fs.rmSync(out,{recursive:true,force:true}); fs.mkdirSync(out,{recursive:true});
for(const f of ['index.html','styles.css','app.js','config.js','manifest.webmanifest','sw.js']) fs.copyFileSync(path.join(root,f),path.join(out,f));
for(const dir of ['src']) fs.cpSync(path.join(root,dir),path.join(out,dir),{recursive:true});
for(const dir of ['assets','imagens_produtos','vendor']) fs.cpSync(path.join(root,dir),path.join(out,dir),{recursive:true});
console.log('Arquivos web copiados para www/.');
