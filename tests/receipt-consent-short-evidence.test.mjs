import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('o formulário aceita RG e CNH e continua exigindo descrição e confirmações',async()=>{
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const source=app.replace(/\}\)\(\);\s*$/,`window.consentTest={
    setup(client,modal){sb=client;openModal=modal;toast=()=>{};openDeliveryDamageReceipt=async()=>{};
      authUser={id:'driver'};activeUnit='Matriz Caicó';
      getCustomerContacts=async()=>[{id:'contact',whatsapp_receipt_eligible:true,whatsapp_receipt_verified_at:'2026-11-10'}];
      sendDeliveryDamageReceipt=async()=>({accepted:true});},
    open:openDeliveryDamageReceiptOptin
  };})();`);
  assert.notEqual(source,app);
  const elements=new Map(),calls=[];let actions;
  const window={addEventListener(){}};
  vm.runInNewContext(source,{window,document:{addEventListener(){},getElementById:id=>elements.get(id)},navigator:{onLine:true},setInterval(){},setTimeout(){}},{timeout:3000});
  window.consentTest.setup({rpc:async(name,args)=>{calls.push({name,args});return {error:null};}},(_t,_s,_b,a)=>{actions=a;});
  elements.set('receiptOptinRecipient',{value:'Cliente Exemplo'});
  for(const id of ['receiptOptinConsent','receiptOptinAdult','receiptOptinBrazil'])elements.set(id,{checked:true});
  window.consentTest.open({id:'contact',phone_normalized:'5584999999999'},{request_id:'damage',customer:{id:'customer',code:'371'}});
  const save=actions.find(x=>x.label==='Aceitar termos e enviar comprovante').onClick;
  for(const value of ['RG','CNH','A']){
    elements.set('receiptOptinAgeEvidence',{value});await save();
    assert.equal(calls.at(-1).args.p_age_evidence,value);
  }
  assert.equal(calls.length,3);
  elements.set('receiptOptinAgeEvidence',{value:'   '});await save();assert.equal(calls.length,3);
  elements.set('receiptOptinAgeEvidence',{value:'RG'});
  for(const id of ['receiptOptinConsent','receiptOptinAdult','receiptOptinBrazil']){
    elements.set(id,{checked:false});await save();assert.equal(calls.length,3);elements.set(id,{checked:true});
  }
});

test('banco aceita evidência curta sem ampliar autoria, consentimento ou permissões',async()=>{
  const db=new PGlite(),owner=randomUUID(),other=randomUUID(),request=randomUUID(),contact=randomUUID(),customer=randomUUID();
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.has_permission(text) returns boolean language sql stable as $$select coalesce(current_setting('test.permission',true),'true')<>'false'$$;
      create table public.profiles(id uuid primary key,name text,active boolean);
      create table public.customers(id uuid primary key,name text);
      create table public.damage_requests(id uuid primary key,created_by uuid,customer_code text,customer_name text);
      create table public.customer_contacts(id uuid primary key,customer_id uuid,customer_code text,phone_normalized text,updated_by uuid,updated_by_name text,updated_at timestamptz);
      grant usage on schema public,auth to authenticated,anon;
      grant execute on function auth.uid() to authenticated;`);
    await db.query('insert into auth.users values ($1),($2)',[owner,other]);
    await db.query("insert into public.profiles values ($1,'Responsável',true),($2,'Outro',true)",[owner,other]);
    await db.query("insert into public.customers values ($1,'Cliente Exemplo')",[customer]);
    await db.query("insert into public.damage_requests values ($1,$2,'371','Cliente Exemplo')",[request,owner]);
    await db.query("insert into public.customer_contacts(id,customer_id,customer_code,phone_normalized) values ($1,$2,'371','5584999999999')",[contact,customer]);
    await db.exec(fs.readFileSync(new URL('../supabase/52_whatsapp_comprovante_elegibilidade.sql',import.meta.url),'utf8'));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    const call=(evidence,consent=true,adult=true,brazil=true)=>db.query('select public.capture_customer_contact_receipt_optin($1,$2,$3,$4,$5,$6,$7) ok',[request,contact,'Cliente Exemplo',evidence,consent,adult,brazil]);
    await assert.rejects(()=>call('RG'),/COMPROVANTE_DADOS_ACEITE_INVALIDOS/);
    const migration=fs.readFileSync(new URL('../supabase/85_receipt_evidence_short_description.sql',import.meta.url),'utf8');
    await db.exec(migration);
    await db.exec('set role authenticated');
    assert.equal((await call('RG')).rows[0].ok,true);
    assert.equal((await call('CNH')).rows[0].ok,true);
    await assert.rejects(()=>call('   '),/COMPROVANTE_DADOS_ACEITE_INVALIDOS/);
    for(const flags of [[false,true,true],[true,false,true],[true,true,false]])await assert.rejects(()=>call('RG',...flags),/COMPROVANTE_CONFIRMACOES_OBRIGATORIAS/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
    await assert.rejects(()=>call('RG'),/AVARIA_NAO_ENCONTRADA/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    await db.exec("select set_config('test.permission','false',false)");
    await assert.rejects(()=>call('RG'),/FORBIDDEN/);
    await db.exec("select set_config('test.permission','true',false)");
    assert.equal((await db.query('select public.set_customer_contact_receipt_eligibility($1,true,$2) ok',[contact,'RG'])).rows[0].ok,true);
    await assert.rejects(()=>db.query('select public.set_customer_contact_receipt_eligibility($1,true,$2)',[contact,' ']),/COMPROVANTE_CONSENTIMENTO_MAIORIDADE_OBRIGATORIO/);
    await db.exec('reset role;set role anon');
    await assert.rejects(()=>call('RG'),e=>e.code==='42501');
    await db.exec('reset role');
    assert.equal((await db.query('select whatsapp_receipt_evidence from public.customer_contacts where id=$1',[contact])).rows[0].whatsapp_receipt_evidence,'RG');
    await db.exec(migration);
    assert.equal((await db.query('select count(*)::int n from public.customer_contacts')).rows[0].n,1);
  }finally{await db.close();}
});

test('o modelo mantém duas variáveis e termina com aviso automático, sem telefone',()=>{
  const template=JSON.parse(fs.readFileSync(new URL('../supabase/functions/send-damage-receipt/template-pdf.json',import.meta.url),'utf8'));
  const body=template.components.find(x=>x.type==='BODY').text;
  assert.deepEqual([...body.matchAll(/\{\{(\d+)\}\}/g)].map(x=>x[1]),['1','2']);
  assert.match(body,/Em caso de dúvidas, entre em contato com nossa central de atendimento\./);
  assert.match(body,/Essa é uma mensagem automática, \*por favor não responder\.\*$/);
  assert.doesNotMatch(body,/9609|9264|\(84\)/);
});
