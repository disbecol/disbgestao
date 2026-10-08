import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(), out=path.join(root,'www');
fs.rmSync(out,{recursive:true,force:true}); fs.mkdirSync(out,{recursive:true});
for(const f of ['index.html','styles.css','visual-refresh.css','pull-dashboard.css','damage-geofence.css','refugo.css','share-reports.js','pull-report.js','invoice-note.js','pull-invoice-ui.js','app.js','config.js','manifest.webmanifest','sw.js']) fs.copyFileSync(path.join(root,f),path.join(out,f));
for(const dir of ['assets','imagens_produtos','vendor']) fs.cpSync(path.join(root,dir),path.join(out,dir),{recursive:true});
console.log('Arquivos web copiados para www/.');
