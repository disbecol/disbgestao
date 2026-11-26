// Áreas dinâmicas e resultados privados por colaborador.
const CACHE='disb-gestao-v1.8.1-rating-unit';
const IMAGE_CACHE=`${CACHE}-images`;
const IMAGE_CACHE_LIMIT=200;
const STATIC=['src/estoque/refugo.js?v=1.8.1-refugo-module','src/estoque/fefo-completed-edits.js?v=1.7.110-fefo-edits','src/puxada/pull-cycle-delete.js?v=1.7.110-pull-cycle-delete','./','index.html','styles.css?v=1.8.1-invoice-lots','src/conferencia/conference.css?v=1.7.60','src/shared/visual-refresh.css?v=1.7.1-visual','src/puxada/pull-dashboard.css?v=1.7.1-pull-dashboard','src/avarias/damage-geofence.css?v=2','src/estoque/refugo.css?v=1.7.16','src/vendas/sales-pricing.css?v=1.7.52','src/vendas/sales-pricing.js?v=1.7.52','src/ratings/rating.css?v=1.8.1-rating','src/ratings/rating.js?v=1.8.1-rating-db','src/shared/share-reports.js?v=1.7.60','src/puxada/pull-report.js?v=2','src/puxada/invoice-note.js?v=1.7.31-keg-liters','src/puxada/pull-camera.js?v=1.7.32-pull-camera','src/shared/asset-conversion.js?v=1.7.49','src/conferencia/conference.js?v=1.7.60','vendor/supabase.js','vendor/leaflet.js','vendor/leaflet.css','vendor/images/layers.png','vendor/images/layers-2x.png','vendor/images/marker-icon.png','vendor/images/marker-icon-2x.png','vendor/images/marker-shadow.png','vendor/pdf-lib.min.js','vendor/pdfjs.min.js','vendor/pdfjs.worker.min.js','src/shared/receipt-validation.js?v=1.8.1','src/shared/table-scroll-dock.js?v=1.8.1','app.js?v=1.8.1-rating','config.js?v=1.7.0','manifest.webmanifest','assets/icon-192.png','assets/icon-512.png'];
STATIC.push('src/shared/design-system.css?v=1.8.1','src/avarias/damage-workspace.css?v=1.8.1','src/avarias/damage-workspace.js?v=1.8.1');
STATIC.push('src/avarias/damage-entry.css?v=1.8.1');
STATIC.push('src/shared/professional-ui.css?v=1.8.1');
STATIC.push('src/shared/appearance.css?v=1.8.1','src/shared/appearance.js?v=1.8.1');
STATIC.push('src/shared/signature-pad.css?v=1.8.1','src/shared/signature-pad.js?v=1.8.1');
STATIC.push('src/estoque/stock-validity.css?v=1.7.41','src/estoque/stock-validity.js?v=1.7.41','vendor/read-excel-file.min.js');
STATIC.push('src/escala/escala.css?v=1.8.1');
STATIC.push('src/forms/forms.css?v=1.8.1','src/forms/forms.js?v=1.8.1');
STATIC.push('src/shared/workspace-theme.css?v=1.8.1','src/avarias/damage-review.css?v=1.8.1','src/shared/workspace-theme.js?v=1.8.1','assets/fonts/dm-sans-latin.woff2','assets/fonts/dm-sans-latin-ext.woff2','assets/fonts/manrope-latin.woff2','assets/fonts/manrope-latin-ext.woff2');
STATIC.push('src/devolucoes/returns.js?v=1.8.1','src/devolucoes/returns-google.js?v=1.8.1','src/devolucoes/returns-file.js?v=1.8.1','src/devolucoes/returns-ui.js?v=1.8.1-rating-unit','src/devolucoes/returns.css?v=1.8.1','vendor/fflate.min.js');
STATIC.push('src/shared/customer-import.js?v=1.8.1');
STATIC.push('src/fdr/fdr.js?v=1.8.1','src/fdr/fdr-ui.js?v=1.8.1','src/fdr/fdr.css?v=1.8.1');
STATIC.push('assets/disbecol-logo-blue.png','assets/disbecol-logo-white.png');
STATIC.push('src/pedidos/orders.js?v=1.8.1','src/pedidos/orders-ui.js?v=1.8.1','src/pedidos/orders.css?v=1.8.1');
STATIC.push('src/avarias/damage-dashboard.js?v=1.8.1','src/avarias/damage-dashboard-ui.js?v=1.8.1','src/avarias/damage-dashboard.css?v=1.8.1');
// BEGIN GENERATED PUXADA ASSETS
STATIC.push(...[
  "src/puxada-app/assets/index-BHCwuekX.js",
  "src/puxada-app/assets/index-BfGCoj0w.css",
  "src/puxada-app/fonts/Inter-OFL.txt",
  "src/puxada-app/fonts/dm-sans-latin.woff2",
  "src/puxada-app/fonts/inter-latin-ext.woff2",
  "src/puxada-app/fonts/inter-latin.woff2",
  "src/puxada-app/fonts/manrope-latin.woff2",
  "src/puxada-app/icon.svg",
  "src/puxada-app/index.html",
  "src/puxada/app-analytics.js?v=1.8.1",
  "src/puxada/app-bridge.js?v=1.8.1",
  "src/puxada/app-bridge.css?v=1.8.1"
]);
// END GENERATED PUXADA ASSETS
STATIC.push('src/shared/screen-design.js?v=1.8.1','src/shared/screen-design.css?v=1.8.1','src/shared/screen-warehouse.css?v=1.8.1','src/shared/screen-delivery.css?v=1.8.1','src/shared/screen-office.css?v=1.8.1','assets/fonts/inter-latin.woff2','assets/fonts/inter-latin-ext.woff2');
STATIC.push('src/estoque/fefo-reports.js?v=1.8.1-fefo-reports');
// BEGIN GENERATED FRONTEND ASSETS
STATIC.push(...[
  "src/gestao-app/forms-react.js?v=1.8.1"
]);
// END GENERATED FRONTEND ASSETS
const STATIC_URLS=new Set(STATIC.map(path=>new URL(path,self.registration.scope).href));
const EXTERNAL_STATIC_URLS=new Set();
const IMAGE_PATHS=['assets/','imagens_produtos/'].map(path=>new URL(path,self.registration.scope).pathname);

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('disb-gestao-')&&k!==CACHE&&k!==IMAGE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin&&!EXTERNAL_STATIC_URLS.has(u.href))return;
  const isNavigation=e.request.mode==='navigate';
  const isStatic=STATIC_URLS.has(u.href)||EXTERNAL_STATIC_URLS.has(u.href);
  const isImage=e.request.destination==='image'&&IMAGE_PATHS.some(path=>u.pathname.startsWith(path));
  if(!isNavigation&&!isStatic&&!isImage)return;
  e.respondWith(
    fetch(e.request,{cache:'no-store'})
      .then(r=>{
        if(r.ok||r.type==='opaque'){
          const copy=r.clone();
          e.waitUntil(caches.open(isImage&&!isStatic?IMAGE_CACHE:CACHE).then(async c=>{
            const cacheKey=isNavigation&&!isStatic?new Request(new URL('./',self.registration.scope)):e.request;
            await c.put(cacheKey,copy);
            if(isImage&&!isStatic){
              const keys=await c.keys();
              await Promise.all(keys.slice(0,Math.max(0,keys.length-IMAGE_CACHE_LIMIT)).map(key=>c.delete(key)));
            }
          }));
        }
        return r;
      })
      .catch(async()=>{
        const cached=await caches.match(e.request);
        if(cached)return cached;
        if(isNavigation)return await caches.match('./')||Response.error();
        return Response.error();
      })
  );
});

// Web Push real: funciona mesmo com a PWA fechada, desde que o navegador/SO
// mantenha as notificacoes permitidas para este site.
self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?.json?.()||{};}catch(_e){try{payload={body:event.data?.text?.()||''};}catch(_e2){payload={};}}
  const title=String(payload.title||'Disb Gestão');
  const data=payload.data||{};
  const options={
    body:String(payload.body||'Nova atualização no Disb Gestão.'),
    icon:payload.icon||'assets/icon-192.png',
    badge:payload.badge||'assets/icon-192.png',
    tag:payload.tag||`disb-push-${data.request_id||Date.now()}`,
    renotify:true,
    requireInteraction:true,
    data
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const view=String(event.notification?.data?.view||'');
  const url=`./${view?`?notificationView=${encodeURIComponent(view)}`:''}`;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async list=>{
    const client=list[0];
    if(client){
      await client.focus();
      client.postMessage({type:'DISB_OPEN_PUSH_NOTIFICATION',view});
      return;
    }
    if(self.clients.openWindow)return self.clients.openWindow(url);
  }));
});
