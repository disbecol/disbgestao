const CACHE='disb-gestao-v1.7.26-pull-offline';
const IMAGE_CACHE=`${CACHE}-images`;
const IMAGE_CACHE_LIMIT=200;
const STATIC=['./','index.html','styles.css?v=1.7.26-pull-offline','visual-refresh.css?v=1.7.1-visual','pull-dashboard.css?v=1.7.1-pull-dashboard','damage-geofence.css?v=2','refugo.css?v=1.7.16','share-reports.js?v=1.7.22','pull-report.js?v=2','invoice-note.js?v=1.7.26','vendor/supabase.js','vendor/leaflet.js','vendor/leaflet.css','vendor/images/layers.png','vendor/images/layers-2x.png','vendor/images/marker-icon.png','vendor/images/marker-icon-2x.png','vendor/images/marker-shadow.png','vendor/pdf-lib.min.js','vendor/pdfjs.min.js','vendor/pdfjs.worker.min.js','app.js?v=1.7.26-pull-offline','config.js?v=1.7.0','manifest.webmanifest','assets/icon-192.png','assets/icon-512.png'];
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
            const cacheKey=isNavigation?new Request(new URL('./',self.registration.scope)):e.request;
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
