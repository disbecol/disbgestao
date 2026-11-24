import {it,expect,vi,afterEach} from 'vitest';
import {captureLocation} from '../src/lib/gps';
import {api} from '../src/lib/api';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('GPS sem resposta termina em dez segundos sem bloquear a etapa e limpa o watch',async()=>{
  vi.useFakeTimers();const clear=vi.fn();let callback!:PositionCallback;
  vi.stubGlobal('navigator',{geolocation:{watchPosition:(fn:PositionCallback)=>{callback=fn;return 7;},clearWatch:clear}});
  const result=captureLocation();await vi.advanceTimersByTimeAsync(10000);expect(await result).toEqual({location:null,locationStatus:'TimedOut'});expect(clear).toHaveBeenCalledWith(7);
  callback({coords:{latitude:-6,longitude:-35,accuracy:10},timestamp:Date.now()} as GeolocationPosition);expect(await result).toEqual({location:null,locationStatus:'TimedOut'});
});
it('permissão negada é resultado técnico, sem exceção nem justificativa obrigatória',async()=>{
  vi.stubGlobal('navigator',{geolocation:{watchPosition:(_fn:unknown,error:PositionErrorCallback)=>{error({code:1} as GeolocationPositionError);return 8;},clearWatch:vi.fn()}});
  expect(await captureLocation()).toEqual({location:null,locationStatus:'Denied'});
});
it('GPS válido conclui cedo; amostras inválidas/antigas são ignoradas',async()=>{
  vi.useFakeTimers();let callback!:PositionCallback;const clear=vi.fn();vi.stubGlobal('navigator',{geolocation:{watchPosition:(fn:PositionCallback)=>{callback=fn;return 9;},clearWatch:clear}});
  const pending=captureLocation();callback({coords:{latitude:500,longitude:0,accuracy:1},timestamp:Date.now()} as GeolocationPosition);callback({coords:{latitude:-6,longitude:-35,accuracy:10},timestamp:Date.now()-60000} as GeolocationPosition);
  callback({coords:{latitude:-6,longitude:-35,accuracy:75},timestamp:Date.now()} as GeolocationPosition);expect((await pending).locationStatus).toBe('Captured');expect(clear).toHaveBeenCalledWith(9);
});
it('cancelamento libera GPS mesmo se nenhum callback do dispositivo chegar',async()=>{
  const clear=vi.fn();vi.stubGlobal('navigator',{geolocation:{watchPosition:()=>4,clearWatch:clear}});const abort=new AbortController(),pending=captureLocation({signal:abort.signal});abort.abort();expect(await pending).toEqual({location:null,locationStatus:'Unavailable'});expect(clear).toHaveBeenCalledWith(4);
});
it('API usa cookie do mesmo domínio e cabeçalho CSRF em mutações, sem forçar multipart',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true}),{status:200}));vi.stubGlobal('fetch',fetcher);
  await api.post('/trips/t/commands',{kind:'RECORD_STEP'});const [path,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(path).toBe('/api/trips/t/commands');expect(options.credentials).toBe('include');expect(new Headers(options.headers).get('X-Puxada-Request')).toBe('1');
  const form=new FormData();form.set('file',new Blob(['x']),'test.jpg');await api.post('/trips/t/attachments',form);const multipart=(fetcher.mock.calls as unknown as [string,RequestInit][])[1][1];expect(new Headers(multipart.headers).has('Content-Type')).toBe(false);
});
it('deadline inclui corpo HTTP e independe de fetch/adapter respeitar cancelamento',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,text:()=>new Promise(()=>{})})));
  const pending=api.get('/auth/session',{timeoutMs:12000});const rejection=expect(pending).rejects.toMatchObject({code:'TIMEOUT'});await vi.advanceTimersByTimeAsync(12000);await rejection;
});
