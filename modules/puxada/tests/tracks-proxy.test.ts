import { afterEach, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
// @ts-ignore Pages Functions run in the Cloudflare runtime; tested with web-standard Request/Response.
import { onRequest } from '../functions/api/[[path]].js';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('positions survive module reload and retry with the same IDs after lost response', async () => {
  const connectivity = { onLine: false }; vi.stubGlobal('navigator', connectivity);
  let { trackQueue } = await import('../src/lib/tracks'); const owner = crypto.randomUUID(); trackQueue.configure(owner);
  await trackQueue.add(owner,'one',{latitude:-6,longitude:-37,accuracy:30,capturedAt:new Date().toISOString(),source:'GPS'});
  vi.resetModules(); ({ trackQueue } = await import('../src/lib/tracks')); trackQueue.configure(owner); connectivity.onLine=true;
  const calls: any[]=[];let lose=true;vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{calls.push(JSON.parse(options.body));if(lose){lose=false;throw Error('lost response');}return Response.json({accepted:1});}));
  await trackQueue.sync(owner);await trackQueue.sync(owner);await trackQueue.sync(owner);
  expect(calls).toHaveLength(2);expect(calls[1].points[0].id).toBe(calls[0].points[0].id);expect(calls[0].points[0].capturedAt).toBeTruthy();expect(calls[0].points[0].tripId).toBeUndefined();
});
it('new account cannot send a different account’s stored positions', async () => {
  const connectivity={onLine:false};vi.stubGlobal('navigator',connectivity);const {trackQueue}=await import('../src/lib/tracks');
  const old=crypto.randomUUID(),next=crypto.randomUUID();trackQueue.configure(old);await trackQueue.add(old,'old-trip',{latitude:-6,longitude:-37,capturedAt:new Date().toISOString(),source:'GPS'});
  trackQueue.configure(next);connectivity.onLine=true;const fetcher=vi.fn(async()=>Response.json({accepted:1}));vi.stubGlobal('fetch',fetcher);await trackQueue.sync(old);await trackQueue.sync(next);expect(fetcher).not.toHaveBeenCalled();
});
it('Pages proxy preserves private cookies and prevents API caching', async () => {
  const fetcher=vi.fn(async()=>new Response('{"ok":true}',{headers:{'Set-Cookie':'puxada.session=example; Domain=api.example.com; Path=/; Secure; HttpOnly; SameSite=Lax','Cache-Control':'public, max-age=100'}}));vi.stubGlobal('fetch',fetcher);
  const response=await onRequest({request:new Request('https://puxada.pages.dev/api/auth/session',{headers:{Cookie:'puxada.session=example','X-Forwarded-For':'spoof'}}),env:{API_ORIGIN:'https://api.example.com'}});
  expect(response.headers.get('Cache-Control')).toContain('no-store');const cookie=response.headers.get('Set-Cookie')!;expect(cookie).not.toContain('Domain=');expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');
  const [target,options]=fetcher.mock.calls[0] as any;expect(String(target)).toBe('https://api.example.com/api/auth/session');expect(options.headers.get('Cookie')).toContain('example');expect(options.headers.get('x-forwarded-for')).toBeNull();
});
it('invalid or unavailable backend fails visibly without pretending a stage was saved remotely', async () => {
  const notConfigured=await onRequest({request:new Request('https://puxada.pages.dev/api/trips'),env:{API_ORIGIN:'http://insecure.example.com'}});expect(notConfigured.status).toBe(503);
  vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('offline');}));const down=await onRequest({request:new Request('https://puxada.pages.dev/api/trips'),env:{API_ORIGIN:'https://api.example.com'}});expect(down.status).toBe(503);expect((await down.json()).code).toBe('API_UNAVAILABLE');
});
