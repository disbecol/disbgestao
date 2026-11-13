import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(), out=path.join(root,'www');
if(path.resolve(out)!==path.resolve(root,'www')||path.dirname(path.resolve(out))!==path.resolve(root))throw new Error('Destino web inválido.');
fs.rmSync(out,{recursive:true,force:true}); fs.mkdirSync(out,{recursive:true});
for(const f of ['index.html','styles.css','conference.css','visual-refresh.css','workspace-theme.css','workspace-theme.js','damage-review.css','pull-dashboard.css','damage-geofence.css','damage-entry.css','signature-pad.css','signature-pad.js','refugo.css','stock-validity.css','sales-pricing.css','forms.css','forms.js','forms-ui.js','share-reports.js','pull-report.js','invoice-note.js','pull-camera.js','stock-validity.js','sales-pricing.js','asset-conversion.js','conference.js','receipt-validation.js','table-scroll-dock.js','app.js','config.js','manifest.webmanifest','sw.js']) fs.copyFileSync(path.join(root,f),path.join(out,f));
for(const dir of ['assets','imagens_produtos','vendor']) fs.cpSync(path.join(root,dir),path.join(out,dir),{recursive:true});
console.log('Arquivos web copiados para www/.');
