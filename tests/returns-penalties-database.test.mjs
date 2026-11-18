import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),A='Matriz Caicó',B='Filial Pau dos Ferros',editor=randomUUID(),viewer=randomUUID();
const q=async(s,a=[])=>(await db.query(s,a)).rows;
const rpc=async(n,a)=>(await q(`select public.${n}(${a.map((_,i)=>'$'+(i+1)).join(',')}) v`,a))[0].v;
async function as(id=editor){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
let today;
const shift=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
const baseRules={'2':7,'3':10,'4':20,'5':30,'6':35,'7':40};
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table profiles(id uuid primary key,name text,role text,active boolean default true);
 create table units(name text primary key,active boolean default true);create table user_units(user_id uuid,unit_name text);
 create table permissions(code text primary key,module text,name text,description text,sort_order int,active boolean);
 create table role_permissions(role text,permission_code text,primary key(role,permission_code));
 create table user_permissions(user_id uuid,permission_code text,allowed boolean);
 create table module_settings(module_name text primary key,active boolean default true);
 create table customers(id uuid primary key default gen_random_uuid(),code text,name text,city text,branch text);
 create table maps(id uuid primary key default gen_random_uuid(),map_number text,map_date date,driver text,helper1 text,helper2 text);
 create table drivers(name text primary key,active boolean default true);
 create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select false$$;`);
 for(const [file,fn] of [['18_v1_4_0_permissoes_avarias_vendas.sql','has_permission'],['26_v1_6_0_unidades_por_usuario.sql','user_has_unit']]){
  const s=await readFile(new URL('../supabase/'+file,import.meta.url),'utf8');await db.exec(s.match(new RegExp('create or replace function public\\.'+fn+'\\([\\s\\S]*?\\$\\$;'))[0]);
 }
 await q('insert into units(name) values($1),($2)',[A,B]);
 for(const [id,name] of [[editor,'Analista'],[viewer,'Consulta']]){await q("insert into profiles(id,name,role) values($1,$2,'CONFERENTE')",[id,name]);await q('insert into user_units values($1,$2)',[id,A]);}
 await db.exec(await readFile(new URL('../supabase/87_delivery_returns.sql',import.meta.url),'utf8'));
 for(const p of ['RETURNS_VIEW','RETURNS_EDIT'])await q('insert into user_permissions values($1,$2,true)',[editor,p]);
 await q("insert into user_permissions values($1,'RETURNS_VIEW',true)",[viewer]);
 await db.exec(await readFile(new URL('../supabase/migrations/20261118115342_returns_recurrence_penalties.sql',import.meta.url),'utf8'));
 today=(await q("select (now() at time zone 'America/Sao_Paulo')::date::text d"))[0].d;
});
after(()=>db.close());
async function seed(code,occurrences,{notes=1,start=today,unit=A}={}){
 await db.exec('reset role');const id=randomUUID();
 await q("insert into delivery_return_imports(id,unit,kind,filename,file_hash,expected_rows,status,created_by) values($1,$2,'REPORT','fixture.csv',$3,$4,'COMPLETED',$5)",[id,unit,'a'.repeat(64),occurrences*notes,editor]);
 for(let i=0;i<occurrences;i++)for(let j=0;j<notes;j++){
  const data={operation_date:shift(start,-i),customer_code:code,customer_name:'Cliente '+code,map_number:'map-'+i,invoice_number:'nf-'+i+'-'+j,amount_cents:100,volume_hl:.1,reason:'Cliente cancelou'};
  await q("insert into delivery_return_records(unit,kind,row_key,operation_date,data,import_id) values($1,'REPORT',$2,$3,$4,$5)",[unit,randomUUID(),data.operation_date,JSON.stringify(data),id]);
 }
 await as();
}
const snapshot=()=>rpc('returns_penalty_snapshot',[A]);
const row=async code=>(await snapshot()).penalties.find(r=>r.customer_code===code);
const set=(r,status,op=randomUUID())=>rpc('returns_set_penalty_status',[A,r.id,r.revision,op,status]);
test('dez notas no mesmo mapa e dia contam como uma ocorrência; outras rotas contam separadamente',async()=>{
 await seed('10-notas',1,{notes:10});assert.equal(await row('10-notas'),undefined);
 await seed('duas',2,{notes:10});const r=await row('duas');assert.equal(r.occurrence_count,2);assert.equal(r.penalty_days,7);assert.equal(r.status,'BLOQUEAR');assert.equal(r.basis.length,20);
 await db.exec('reset role');await q("update delivery_return_records set operation_date=$1::text::date,data=jsonb_set(data,'{operation_date}',to_jsonb($1::text)) where data->>'customer_code'='duas'",[today]);await as();assert.equal((await row('duas')).occurrence_count,2);
});
test('a janela inclui ocorrências de até 60 dias atrás e a tabela de penalidade limita em 40 a partir de sete',async()=>{
 await seed('fora-60',2,{start:shift(today,-60)});assert.equal(await row('fora-60'),undefined);
 for(const [count,days] of [[3,10],[4,20],[5,30],[6,35],[7,40],[9,40]]){const code='faixa-'+count;await seed(code,count);assert.equal((await row(code)).penalty_days,days);}
});
test('o limite de 60 dias da planilha inclui o dia do limite e descarta o dia anterior',async()=>{
 await seed('limite-60',2);await db.exec('reset role');await q("update delivery_return_records set operation_date=$1::text::date,data=jsonb_set(data,'{operation_date}',to_jsonb($1::text)) where data->>'customer_code'='limite-60' and data->>'map_number'='map-1'",[shift(today,-60)]);await as();assert.equal((await row('limite-60')).occurrence_count,2);
 await db.exec('reset role');await q("update delivery_return_records set operation_date=$1::text::date,data=jsonb_set(data,'{operation_date}',to_jsonb($1::text)) where data->>'customer_code'='limite-60' and data->>'map_number'='map-1'",[shift(today,-61)]);await as();assert.equal(await row('limite-60'),undefined);
});
test('o prazo começa na confirmação, não permite liberar antes e retry é idempotente',async()=>{
 let r=await row('duas');const op=randomUUID(),before=Date.now();r=await set(r,'BLOQUEADO',op);assert.equal(r.status,'BLOQUEADO');assert.ok(Math.abs(Date.parse(r.blocked_at)-before)<15000);assert.equal(Date.parse(r.release_at)-Date.parse(r.blocked_at),7*864e5);
 const retry=await rpc('returns_set_penalty_status',[A,r.id,r.revision-1,op,'BLOQUEADO']);assert.equal(retry.revision,r.revision);
 await assert.rejects(()=>set(r,'LIBERADO'),/INVALID_PENALTY_TRANSITION/);
 await assert.rejects(()=>rpc('returns_set_penalty_status',[A,r.id,r.revision,op,'LIBERADO']),/OPERATION_CONFLICT/);
 await assert.rejects(()=>rpc('returns_set_penalty_status',[A,r.id,r.revision-1,randomUUID(),'BLOQUEADO']),/PENALTY_VERSION_CONFLICT/);
});
test('o servidor muda para Liberar ao vencer o prazo e preserva o histórico até a confirmação final',async()=>{
 await db.exec('reset role');await q("update delivery_return_penalties set blocked_at=now()-interval '8 days',release_at=now()-interval '1 day' where customer_code='duas'");await as();
 let r=await row('duas');assert.equal(r.status,'LIBERAR');const count=(await q('select count(*)::int n from delivery_return_penalty_audit where penalty_id=$1',[r.id]))[0].n;
 await snapshot();assert.equal((await q('select count(*)::int n from delivery_return_penalty_audit where penalty_id=$1',[r.id]))[0].n,count);
 r=await set(r,'LIBERADO');assert.equal(r.status,'LIBERADO');assert.ok(r.released_at);
 assert.equal((await row('duas')).status,'LIBERADO');
 const history=await q('select event,actor_name from delivery_return_penalty_audit where penalty_id=$1 order by id',[r.id]);assert.deepEqual(history.map(x=>x.event),['BLOQUEAR','BLOQUEADO','LIBERAR','LIBERADO']);assert.equal(history[2].actor_name,'Sistema');
});
test('editar as regras altera apenas os próximos bloqueios e protege contra edição concorrente',async()=>{
 let active=await row('faixa-3');active=await set(active,'BLOQUEADO');const deadline=active.release_at;
 let rules=await rpc('returns_penalty_rules',[A]);assert.deepEqual(rules.rules,baseRules);assert.equal(rules.revision,0);
 const changed={...baseRules,'2':9,'3':12,'7':42};rules=await rpc('returns_save_penalty_rules',[A,0,JSON.stringify(changed)]);assert.equal(rules.revision,1);
 assert.equal((await row('faixa-3')).release_at,deadline);assert.equal((await row('faixa-3')).penalty_days,10);assert.equal((await row('faixa-9')).penalty_days,42);
 await assert.rejects(()=>rpc('returns_save_penalty_rules',[A,0,JSON.stringify(changed)]),/PENALTY_VERSION_CONFLICT/);
 for(const invalid of [{...baseRules,'2':0},{...baseRules,'7':3651},{...baseRules,'3':2.5},{'2':7}, {...baseRules,'9':12}])await assert.rejects(()=>rpc('returns_save_penalty_rules',[A,1,JSON.stringify(invalid)]),/INVALID_PENALTY_RULES/);
});
test('uma regra da outra unidade não vaza e consulta não altera status nem tabelas diretamente',async()=>{
 await seed('unidade-b',3,{unit:B});await assert.rejects(()=>rpc('returns_penalty_snapshot',[B]),/FORBIDDEN/);await assert.rejects(()=>rpc('returns_penalty_rules',[B]),/FORBIDDEN/);
 await as(viewer);const r=await row('faixa-4');await assert.rejects(()=>set(r,'BLOQUEADO'),/FORBIDDEN/);await assert.rejects(()=>rpc('returns_save_penalty_rules',[A,1,JSON.stringify(baseRules)]),/FORBIDDEN/);
 await assert.rejects(()=>q("update delivery_return_penalties set status='LIBERADO'"),/permission denied/);await assert.rejects(()=>q('select disb_private.refresh_return_penalties()'),/permission denied/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>rpc('returns_penalty_snapshot',[A]),/permission denied/);
 await as();await db.exec('reset role');await q('update profiles set active=false where id=$1',[editor]);await as();await assert.rejects(()=>snapshot(),/FORBIDDEN/);await db.exec('reset role');await q('update profiles set active=true where id=$1',[editor]);await as();
});
test('motorista em coluna de ajudante só é recuperado com nome conhecido e sem ambiguidade',async()=>{
 await seed('crew-helper',2);await db.exec('reset role');await q("insert into drivers(name) values('Condutor conhecido'),('Segundo condutor')");
 const data={operation_date:today,customer_code:'crew-helper',map_number:'map-0'};
 let crew=(await q('select disb_private.resolve_return_crew($1,$2,$3) v',[A,JSON.stringify(data),JSON.stringify({driver:'0',helper1:'Condutor conhecido',helper2:'Auxiliar'})]))[0].v;assert.equal(crew.driver,'Condutor conhecido');assert.equal(crew.helper1,'Auxiliar');assert.equal(crew.helper2,'');
 crew=(await q('select disb_private.resolve_return_crew($1,$2,$3) v',[A,JSON.stringify(data),JSON.stringify({driver:'',helper1:'Condutor conhecido',helper2:'Segundo condutor'})]))[0].v;assert.equal(crew.driver,'');assert.equal(crew.helper1,'Condutor conhecido');
 crew=(await q('select disb_private.resolve_return_crew($1,$2,$3) v',[A,JSON.stringify(data),JSON.stringify({driver:'',helper1:'Auxiliar desconhecido'})]))[0].v;assert.equal(crew.driver,'');await as();
});
test('referência completa do mesmo mapa/data supre jornada parcial e não cruza unidades ou datas',async()=>{
 await seed('crew-map',2);await db.exec('reset role');await q("update delivery_return_records set data=jsonb_set(data,'{map_number}','\"crew-ref-0\"') where data->>'customer_code'='crew-map'");await q('insert into maps(map_number,map_date,driver,helper1,helper2) values($1,$2,$3,$4,$5)',['crew-ref-0',today,'Motorista da referência','Auxiliar um','Auxiliar dois']);
 const data={operation_date:today,customer_code:'crew-map',map_number:'crew-ref-0'},partial={driver:'',helper1:'Auxiliar um'};
 let crew=(await q('select disb_private.resolve_return_crew($1,$2,$3) v',[A,JSON.stringify(data),JSON.stringify(partial)]))[0].v;assert.equal(crew.driver,'Motorista da referência');assert.equal(crew.helper2,'Auxiliar dois');
 crew=(await q('select disb_private.resolve_return_crew($1,$2,$3) v',[A,JSON.stringify({...data,operation_date:shift(today,-1)}),JSON.stringify(partial)]))[0].v;assert.equal(crew.driver,'');
 await seed('collision',1,{unit:B});await db.exec('reset role');await q("update delivery_return_records set data=jsonb_set(data,'{map_number}','\"crew-ref-0\"') where data->>'customer_code'='collision'");crew=(await q('select disb_private.resolve_return_crew($1,$2,$3) v',[A,JSON.stringify(data),JSON.stringify(partial)]))[0].v;assert.equal(crew.driver,'');await as();
});
