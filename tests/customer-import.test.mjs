import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url),C=require('../customer-import.js');
const row=(extra={})=>({'Filial':'0001','Cód PDV':'00042','Nome Fantasia':'Loja exemplo','Razão Social':'Empresa exemplo','Cidade':'CAICÓ','Data de Cadastro':'18/09/2026',Documento:'não importar',...extra});
test('PY050094 reconhece filiais 1 e 6, preserva PDV por filial e ignora outros dados',()=>{
 const p=C.plan([row(),row({Filial:'0006'}),row({Filial:'0002'})]);assert.equal(p.errors.length,0);assert.equal(p.rows.length,2);assert.equal(p.rows[0].branch,'Caicó');assert.equal(p.rows[1].branch,'Pau dos Ferros');assert.equal(p.rows[0].code,'42');assert.equal(p.rows[0].registration_date,'2026-09-18');assert.deepEqual(Object.keys(p.rows[0]).sort(),['branch','city','code','name','registration_date']);assert.equal(p.stats.skippedBranches['2'],1);
});
test('nome fantasia inválido ou vazio usa razão social válida, sem adivinhar caracteres',()=>{
 const p=C.plan([row({'Nome Fantasia':'ARMAZ\u0090M'}),row({'Cód PDV':'43','Nome Fantasia':''})]);assert.equal(p.errors.length,0);assert.equal(p.stats.nameFallbacks,2);assert.equal(p.rows[0].name,'Empresa exemplo');assert.match(C.summary(p),/Razão Social/);
});
test('cabeçalhos antigos continuam aceitos e cadastro ausente não é inventado',()=>{
 const p=C.plan([{Código:'43',Nome:'Cliente',Cidade:'São João',Filial:'Matriz Caicó'}]);assert.equal(p.errors.length,0);assert.equal(p.rows[0].branch,'Caicó');assert.ok(!Object.hasOwn(p.rows[0],'registration_date'));
});
test('campos essenciais, datas e duplicidades divergentes são recusados antes de gravar',()=>{
 assert.ok(C.plan([row({'Data de Cadastro':'31/02/2026'})]).errors.length);assert.ok(C.plan([row(),row({'Nome Fantasia':'Outra loja'})]).errors.length);assert.ok(C.plan([row({'Cód PDV':'1e3'})]).errors.length);const p=C.plan([row(),row()]);assert.equal(p.rows.length,1);assert.equal(p.stats.duplicates,1);assert.equal(C.date('02/05/1950'),'1950-05-02');assert.equal(C.date('29/02/2024'),'2024-02-29');assert.equal(C.date('29/02/2026'),undefined);
});
test('leitor utilizado pela tela mantém acentos, aspas e ponto e vírgula em CSV Windows-1252',async()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8'),start=source.indexOf('async function readCsvFileText('),end=source.indexOf('function downloadCsv(',start),api=vm.runInNewContext(source.slice(start,end)+';({readCsvFileText,parseCsvObjects})',{TextDecoder});
 const bytes=Buffer.from('Filial;Cód PDV;Nome Fantasia;Cidade;Data de Cadastro\r\n0006;0012;"Bar; do ""João""";Pau dos Ferros;01/11/2026\r\n','latin1'),file={arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
 const p=C.plan(api.parseCsvObjects(await api.readCsvFileText(file)));assert.equal(p.errors.length,0);assert.equal(p.rows[0].name,'Bar; do "João"');assert.equal(p.rows[0].code,'12');
});
function uploader(csv,rpc=async()=>({data:{inserted:1,updated:0,unchanged:0},error:null})){
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8'),bytes=Buffer.from(csv,'utf8'),file={size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)},nodes={importFile:{files:[file]},importTipo:{value:'customers'},importResult:{textContent:''},btnImportarBase:{}},calls=[],removed=[];
 const a=source.indexOf('let baseImportBusy='),b=source.indexOf('function importConflict(',a),c=source.indexOf('async function readCsvFileText('),d=source.indexOf('function downloadCsv(',c),ctx=vm.createContext({window:{DISB_CUSTOMER_IMPORT:C},TextDecoder,$:id=>nodes[id],hasPerm:()=>true,sb:{rpc:async(name,args)=>{calls.push({name,args});return rpc(name,args);},from:()=>{throw Error('Não deve usar gravação em lotes para clientes.');}},toast:()=>{},humanError:e=>e.message,localStorage:{removeItem:k=>removed.push(k)},REF_CACHE_KEY:'reference-cache',loadReferences:async()=>{}});vm.runInContext(source.slice(a,b)+source.slice(c,d)+';globalThis.run=importBaseCsv;',ctx);return {run:()=>ctx.run(),nodes,calls,removed};
}
test('upload da tela envia apenas o catálogo validado em uma única atualização e preserva filas locais',async()=>{
 const h=uploader('Filial;Cód PDV;Nome Fantasia;Cidade;Data de Cadastro;Documento\n1;42;Loja;Caicó;01/11/2026;Não enviar\n2;43;Outra;Cidade;01/11/2026;Não enviar');await h.run();assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'import_customer_catalog');assert.equal(h.calls[0].args.p_rows.length,1);assert.ok(!Object.hasOwn(h.calls[0].args.p_rows[0],'Documento'));assert.deepEqual(h.removed,['reference-cache','ops_ref_cache']);assert.match(h.nodes.importResult.textContent,/Concluído/);assert.match(h.nodes.importResult.textContent,/Filial 2/);assert.equal(h.nodes.btnImportarBase.disabled,false);
});
test('upload com data inválida não chama o banco e libera os controles para correção',async()=>{
 const h=uploader('Filial;Cód PDV;Nome Fantasia;Cidade;Data de Cadastro\n1;42;Loja;Caicó;31/02/2026');await h.run();assert.equal(h.calls.length,0);assert.match(h.nodes.importResult.textContent,/Data de Cadastro inválida/);assert.equal(h.nodes.importFile.disabled,false);
});
test('migração da chave preserva IDs e vínculos quando o código se repete entre filiais',async()=>{
 const db=new PGlite();try{await db.exec("create table customers(code text primary key,branch text not null,id uuid not null unique default gen_random_uuid(),name text);create table contacts(id int primary key,customer_id uuid references customers(id));insert into customers(code,branch,name) values('42','Caicó','Original');insert into contacts select 1,id from customers;");const source=readFileSync(new URL('../supabase/migrations/20261117203259_customer_catalog_csv.sql',import.meta.url),'utf8'),ddl=source.slice(0,source.indexOf('create or replace function public.import_customer_catalog'));await db.exec(ddl+'commit;');await db.exec("insert into customers(code,branch,name) values('42','Pau dos Ferros','Filial');");assert.equal((await db.query("select count(*)::int n from customers where code='42'")).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from contacts c join customers x on x.id=c.customer_id')).rows[0].n,1);}finally{await db.close();}
});
