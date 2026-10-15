import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function draftHarness(){
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const source=app.replace(/\}\)\(\);\s*$/,`window.nriDraftTest={
    setDraft(items){nriDraftItems=items;},
    render:renderNriDraftItems,
    click:onNriDraftListClick,
    draft(){return nriDraftItems;},
    editing(){return nriEditingId;},
    setPrint(client){
      sb=client;printOperation={records:[{id:'nri-1'}],reprint:false};
      closeDamagePhotoViewer=()=>{};cleanupPullMaps=()=>{};cleanupDamageGeoMap=()=>{};toast=()=>{};
    },
    hasPrint(){return !!printOperation;},
    close:closeModal,
    stubEditor(){
      selectOperationalProductByCode=()=>{};
      setMultiLots=()=>{};
      setNriDamageMode=()=>{};
      updateNriValidityMode=()=>{};
    }
  };})();`);
  assert.notEqual(source,app,'A API de teste precisa ser inserida no escopo da aplicação.');
  const elements=new Map();
  const document={addEventListener(){},getElementById(id){
    if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',className:'',classList:{add(){},remove(){},toggle(){}}});
    return elements.get(id);
  }};
  const window={addEventListener(){}};
  vm.runInNewContext(source,{window,document,navigator:{},setInterval(){},setTimeout(){}},{timeout:3000});
  return {api:window.nriDraftTest,elements};
}

function draftClick(api,action,id){
  let prevented=false;
  const row={dataset:{id}};
  const button={dataset:{act:action},closest(selector){return selector==='[data-id]'?row:null;}};
  api.click({target:{closest(selector){return selector==='button[data-act]'?button:null;}},preventDefault(){prevented=true;}});
  return prevented;
}

test('editar produto de Marketplace mantém o rascunho e nunca envia o formulário',()=>{
  const {api,elements}=draftHarness();
  const item={id:'item-1',product_code:'123',product_name:'Produto',validity_date:null,lot:'L1',quantity:10,pallets:2,damagePhotos:[]};
  api.setDraft([item]);api.stubEditor();api.render();
  const html=elements.get('nriItemList').innerHTML;
  assert.match(html,/<button type="button" class="mini-btn" data-act="edit">Editar<\/button>/);
  assert.match(html,/<button type="button" class="mini-btn danger" data-act="del">Excluir<\/button>/);
  assert.equal(draftClick(api,'edit',item.id),true);
  assert.equal(api.editing(),item.id);
  assert.equal(api.draft().length,1);
  assert.equal(elements.get('btnAdicionarNriItem').textContent,'Salvar alteração');
});

test('excluir item do rascunho não envia NRI nem altera o recebimento',()=>{
  const {api}=draftHarness();
  api.setDraft([{id:'item-1',product_code:'123',product_name:'Produto',quantity:10,pallets:1}]);
  assert.equal(draftClick(api,'del','item-1'),true);
  assert.equal(api.draft().length,0);
});

test('fechar confirmação pelo X libera a impressão e registra cancelamento',async()=>{
  const {api,elements}=draftHarness(),calls=[];
  api.setPrint({rpc:async(name,args)=>{calls.push([name,args]);return {error:null};}});
  elements.set('modalTitle',{textContent:'Confirmar impressão'});
  api.close();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(api.hasPrint(),false);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'confirm_nri_print');
  assert.equal(calls[0][1].p_result,'CANCELADO');
});
