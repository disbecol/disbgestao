import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
const require=createRequire(import.meta.url),R=require('../src/devolucoes/returns.js'),G=require('../src/devolucoes/returns-google.js');
const A='Matriz Caicó',B='Filial Pau dos Ferros';
const reportHeaders=['Mapa','Data','Unb Nota','Nota','Serie','Unb Cliente','Cod. Cliente','Nome Cliente','Telefone','Area','Setor','Placa','Valor','Volume','Data Devol.','Cod. Motivo','MOTIVO','Orig. Pedido','Usuario','Hora'];
const inputs={
 REPORT:[reportHeaders,['1','2026-11-17','','10','1','','42','Loja exemplo','','','','','100,00','0,5','2026-11-17','','Recusa','','','10:00']],
 ORDERS:[['Mapa','Cliente','Nome','Emissao','Nota','Serie','Status','Total','Cidade','Vendedor'],['1','42','Loja exemplo','2026-11-17','10','1','A','100,00','Caicó','Vendedor A']],
 JOURNEYS:[['DATA','MAPA','MOTORISTA','AJUDANTE 1','AJUDANTE 2','ROTA'],['2026-11-17','1','Motorista','Ajudante A','Ajudante B','Caicó']],
 ROUTES:[['DATA','PDVS EM ROTA','HL EM ROTA'],['2026-11-17','100','200']]
};
function harness({empty=false,invalid=false,permission=true,rpc:custom,fetch:customFetch}={}){
 const calls=[],urls=[],status=[];let unit=A,imports=[],clock=1000;const defs=[...G.sources(A),...G.sources(B)];
 const client={rpc:async(name,args)=>{calls.push({name,args});if(custom)return custom(name,args);if(name==='returns_google_sync')return {data:{acquired:true,last_synced_at:args.p_action==='COMMIT'?'2026-11-17T12:00:00Z':null,sources:args.p_result?.sources||{}},error:null};return {data:1,error:null};}};
 const sync=G.create({context:()=>({client,user:{id:'user-a'},unit}),canSync:()=>permission,imports:()=>imports,crypto:webcrypto,now:()=>clock,onStatus:s=>status.push(s),fetch:async(url,opts)=>{urls.push(url);if(customFetch)return customFetch(url,opts);const source=defs.find(d=>String(d.gid)===new URL(url).searchParams.get('gid'));return {ok:true,text:async()=>invalid&&source.kind==='REPORT'?'Cabeçalho incorreto':'google.visualization.Query.setResponse('+JSON.stringify({status:'ok',table:{cols:inputs[source.kind][0].map(label=>({label})),rows:(empty?[]:inputs[source.kind].slice(1)).map(row=>({c:row.map(v=>({v}))}))}})+');'};}});
 return {sync,calls,urls,status,setUnit:u=>unit=u,setImports:v=>imports=v,advance:n=>clock+=n};
}
test('origens fixas usam oito abas por unidade e nunca a aba MAPAS',()=>{
 const a=G.sources(A),b=G.sources(B);assert.equal(a.length,4);assert.equal(b.length,4);assert.equal(new Set([...a,...b].map(s=>s.gid)).size,8);assert.ok(a.every(s=>s.title.endsWith('MATRIZ')));assert.ok(b.every(s=>s.title.endsWith('FILIAL')));assert.ok([...a,...b].every(s=>s.gid!==0));assert.deepEqual(G.sources('Unidade desconhecida'),[]);
});
test('quatro bases e dados de cliente são publicados juntos após a validação',async()=>{
 const h=harness();const result=await h.sync.sync();assert.equal(result.changed,true);assert.equal(h.urls.length,4);const begins=h.calls.filter(c=>c.name==='returns_begin_import');assert.equal(begins.length,5);assert.equal(h.calls.filter(c=>c.name==='returns_finish_import').length,0);const commit=h.calls.find(c=>c.name==='returns_google_sync'&&c.args.p_action==='COMMIT');assert.equal(commit.args.p_import_ids.length,5);assert.ok(h.calls.filter(c=>c.name==='returns_stage_import').length>=5);
 const directory=h.calls.find(c=>c.name==='returns_stage_import'&&c.args.p_rows[0]?.seller==='Vendedor A'&&c.args.p_rows[0]?.branch===A);assert.equal(directory.args.p_rows[0].city,'Caicó');
});
test('bases vazias não apagam dados nem iniciam importações',async()=>{
 const h=harness({empty:true});const result=await h.sync.sync();assert.equal(result.changed,false);assert.ok(!h.calls.some(c=>c.name==='returns_begin_import'));const commit=h.calls.find(c=>c.args.p_action==='COMMIT');assert.ok(Object.values(commit.args.p_result.sources).every(s=>s.state==='EMPTY'));
});
test('erro em uma aba cancela o grupo inteiro e indica a origem',async()=>{
 const h=harness({invalid:true});await assert.rejects(()=>h.sync.sync(),/03\.02\.24 - MATRIZ/);assert.ok(!h.calls.some(c=>c.name==='returns_begin_import'));assert.ok(h.calls.some(c=>c.args.p_action==='FAIL'));assert.ok(!h.calls.some(c=>c.args.p_action==='COMMIT'));
});
test('usa apenas a versão mais recente do hash, inclusive quando uma edição é desfeita',async()=>{
 const h=harness();await h.sync.sync();const latest=h.calls.filter(c=>c.name==='returns_begin_import').map(c=>({kind:c.args.p_kind,filename:c.args.p_filename,file_hash:c.args.p_hash}));h.setImports(latest);h.calls.length=0;await h.sync.sync({force:true});assert.ok(!h.calls.some(c=>c.name==='returns_begin_import'));
 h.setImports([{...latest[0],file_hash:'b'.repeat(64)},...latest]);h.calls.length=0;await h.sync.sync({force:true});assert.equal(h.calls.filter(c=>c.name==='returns_begin_import').length,1);
});
test('intervalo evita leituras repetidas; perfil sem permissão não grava',async()=>{
 const h=harness();await h.sync.sync();const n=h.urls.length;assert.equal((await h.sync.sync()).skipped,true);assert.equal(h.urls.length,n);h.advance(G.INTERVAL);await h.sync.sync();assert.equal(h.urls.length,n+4);
 const viewer=harness({permission:false});assert.equal((await viewer.sync.sync()).skipped,true);assert.equal(viewer.calls.length,0);
});
test('troca de unidade aborta a leitura antiga sem publicar dados na nova unidade',async()=>{
 const h=harness({fetch:async(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});})});
 const running=h.sync.sync();await new Promise(resolve=>setImmediate(resolve));h.sync.stop();h.setUnit(B);await running;
 assert.ok(!h.calls.some(c=>c.args.p_action==='COMMIT'));assert.ok(h.calls.some(c=>c.args.p_action==='FAIL'&&c.args.p_unit===A));
});
test('falha de transporte libera a atualização e preserva a última versão',async()=>{
 const h=harness({fetch:async()=>{throw Error('Conexão interrompida');}});await assert.rejects(()=>h.sync.sync(),/Conexão interrompida/);assert.equal(h.sync.pending(),false);assert.ok(h.calls.some(c=>c.args.p_action==='FAIL'));assert.ok(!h.calls.some(c=>c.name==='returns_begin_import'));
});
test('17.03 original usa referência explícita da própria aba, sem presumir mês atual',()=>{
 const rows=[['MES_REFERENCIA','01/10/2026'],['Filial','Cod. ID','Dia 01'],[1,697,100],[1,563,200]];assert.equal(G.parse('ROUTES',rows,A).rows[0].operation_date,'2026-10-01');assert.throws(()=>G.parse('ROUTES',rows.slice(1),A),/MES_REFERENCIA/);
});
test('leitura usa valores brutos e preserva datas e números apesar do formato visual da célula',()=>{
 const raw='/*O_o*/ google.visualization.Query.setResponse('+JSON.stringify({status:'ok',table:{cols:[{label:'DATA'},{label:'TOTAL'},{label:'FILIAL'}],rows:[{c:[{v:'Date(2026,10,17)',f:'17/11/2026'},{v:1234.56,f:'R$ 1.234,56'},{v:'Date(1899,11,31)',f:'31/12/1899'}]}]}})+');';
 const rows=G.readResponse(raw);assert.equal(R.day(rows[1][0]),'2026-11-17');assert.equal(rows[1][1],1234.56);assert.equal(rows[1][2],1);
 assert.throws(()=>G.readResponse('<html>Login</html>'));assert.throws(()=>G.readResponse('{"status":"error"}'));
});
