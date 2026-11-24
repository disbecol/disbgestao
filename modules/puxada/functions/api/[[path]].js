// Cloudflare Pages reverse proxy. Authentication remains in the C# backend;
// the browser uses same-origin HttpOnly cookies, including on *.pages.dev.
export async function onRequest({ request, env }) {
  let origin;
  try {
    origin = new URL(env.API_ORIGIN || '');
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error();
  } catch {
    return Response.json({code:'API_NOT_CONFIGURED',detail:'O servidor ainda não foi conectado a este endereço.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, origin.origin);
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('x-forwarded-for');
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-proto');
  headers.delete('forwarded');
  headers.set('x-puxada-public-origin', incoming.origin);
  headers.set('x-forwarded-proto', 'https');
  const options={method:request.method,headers,redirect:'manual',signal:AbortSignal.timeout(/\/(attachments|invoices)$/.test(incoming.pathname)&&request.method==='POST'?90000:20000)};
  if(request.method!=='GET'&&request.method!=='HEAD')options.body=request.body;
  try {
    const upstream=await fetch(target,options);
    const responseHeaders=new Headers(upstream.headers);
    responseHeaders.set('Cache-Control','no-store, private');
    responseHeaders.set('X-Content-Type-Options','nosniff');
    const cookies=upstream.headers.getSetCookie?.()||[];
    if(cookies.length){
      responseHeaders.delete('set-cookie');
      for(const cookie of cookies)responseHeaders.append('set-cookie',cookie.replace(/;\s*Domain=[^;]+/ig,''));
    }
    const location=responseHeaders.get('Location');
    if(location){
      const redirected=new URL(location,target);
      if(redirected.origin===origin.origin)responseHeaders.set('Location',incoming.origin+redirected.pathname+redirected.search);
    }
    return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:responseHeaders});
  } catch {
    return Response.json({code:'API_UNAVAILABLE',detail:'Não foi possível alcançar o servidor. Os registros pendentes permanecem neste aparelho.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
