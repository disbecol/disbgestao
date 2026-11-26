import test from 'node:test';
import assert from 'node:assert/strict';
import {formsThemeHarness} from './helpers/forms-theme-harness.mjs';
import {unit} from './helpers/forms-theme-fixtures.mjs';
const person={id:'directory-person',profile_id:null,name:'Pessoa sem login',job:'Motorista',area:'Entrega',units:[unit],active:true,notes:'',revision:1,can_edit:true};
function setup(options={}){return formsThemeHarness({...options,factory:'createStaffDirectory',rpc:(name,args)=>{if(options.rpc){const result=options.rpc(name,args);if(result!==undefined)return result;}if(name==='staff_directory_state')return {data:{people:[person],units:[unit]},error:null};if(name==='staff_directory_save')return {data:{...person,...args.p_payload},error:null};}});}
async function button(h,text){const el=[...h.document.querySelectorAll('.staff-directory button')].find(b=>b.textContent===text);assert.ok(el,text);el.click();await h.settle();}
test('Cadastro de Equipes lista pessoas e áreas sem confundir com contas',async()=>{
 const h=setup();await h.enter('staff-directory');assert.match(h.get('.staff-directory').textContent,/Pessoa sem login/);assert.match(h.get('.staff-directory').textContent,/não cria usuário, login ou senha/);assert.equal(h.writes.length,0);assert.equal(h.document.querySelectorAll('.staff-directory input[type=password]').length,0);h.destroy();
});
test('cadastro e edição usam RPC próprio com unidade e revisão, sem chamar Auth',async()=>{
 const h=setup();await h.enter('staff-directory');await button(h,'Editar');await h.input('.staff-directory form label:first-child input','Nome revisado');h.get('.staff-directory form').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));await h.settle();
 const write=h.writes[0];assert.equal(write.name,'staff_directory_save');assert.equal(write.args.p_id,person.id);assert.equal(write.args.p_revision,1);assert.equal(write.args.p_payload.name,'Nome revisado');assert.deepEqual(write.args.p_payload.units,[unit]);assert.equal(write.args.p_unit,unit);h.destroy();
});
test('erro de revisão mantém a edição disponível e usuário de consulta não recebe ações',async()=>{
 const h=setup({rpc:name=>name==='staff_directory_save'?{data:null,error:{message:'STAFF_VERSION_CONFLICT'}}:undefined});await h.enter('staff-directory');await button(h,'Editar');h.get('.staff-directory form').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));await h.settle();assert.match(h.get('[role=alert]').textContent,/Outra pessoa alterou/);assert.ok(h.document.querySelector('.staff-directory form'));h.destroy();
 const ro=setup({permissions:['STAFF_DIRECTORY_VIEW']});await ro.enter('staff-directory');assert.ok(![...ro.document.querySelectorAll('.staff-directory button')].some(b=>/Cadastrar|Editar/.test(b.textContent)));ro.destroy();
});
test('relatórios usam o nome do cadastro independente e mantêm aplicadores na lista de contas',async()=>{
 const h=formsThemeHarness({rpc:name=>name==='forms_staff_people'?{data:[{id:'worker',name:'Nome do cadastro central',role:'Motorista',area:'Entrega',units:[unit],active:true}],error:null}:undefined});await h.enter('forms-report');await h.click('[data-fm-action="report-tab"][data-id="execution"]');assert.match(h.get('#view-forms-report').textContent,/Nome do cadastro central/);assert.ok(h.reads.some(r=>r.name==='forms_staff_people'));h.destroy();
});
