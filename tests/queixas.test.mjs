import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import complaints from '../src/queixas/queixas.js';

const header='DATA DA QUEIXA\tDATA DA TRATATIVA\tDIAS PARA RESPONDER\tCód\tUnidade\tCidade\tFANTASIA\tVENDEDOR\tCANAL\tTIPO\tQUEIXA\tTRATATIVA\tSTATUS';

test('importa células copiadas sem alterar conteúdo, inclusive campos vazios e quebras de linha',()=>{
  const text=`${header}\n01/02/2026\t03/02/2026\t2\t001\tMatriz\tCaicó\tLoja\tAna\t\tEntrega\t"Atraso\nna entrega"\t"Contato ""realizado"""\tResolvida\n\t\t\t\t\t\t\t\t\t\t\t\t\n`;
  const [row]=complaints.parseClipboard(text);
  assert.equal(row.code,'001');
  assert.equal(row.complaint,'Atraso\nna entrega');
  assert.equal(row.treatment,'Contato "realizado"');
  assert.equal(row.channel,'');
  assert.equal(complaints.parseClipboard(text).length,1);
  assert.throws(()=>complaints.parseClipboard(header+'\n01/02/2026\tincompleta'),/13 colunas/);
  assert.throws(()=>complaints.parseClipboard(header.replace('QUEIXA\tTRATATIVA','MOTIVO\tTRATATIVA')),/cabeçalhos/);
  assert.throws(()=>complaints.parseClipboard(header+'\n"aberta'),/incompleta/);
});

test('analisa apenas queixas válidas, mantém status desconhecido e calcula média e mediana',()=>{
  const row=(date,complaint,status,days,treatment_date,city,seller,type)=>({
    source:{date,complaint,days,treatment_date,city,seller,type},treatment_date,status
  });
  const data=[
    row('01/01/2026','Atraso','Resolvida','1','','Caicó','Ana','Entrega'),
    row('02/01/2026','Atraso','Em tratamento','3','','CAICÓ','Ana','Entrega'),
    row('01/02/2026','Dano','Sem resposta','','05/02/2026','Natal','Bia','Produto'),
    row('02/02/2026','Dano','','inválido','','','',''),
    row('31/02/2026','Inválida','Resolvida','100','','','',''),
    row('03/02/2026','','Resolvida','100','','','','')
  ];
  const a=complaints.analyze(data);
  assert.equal(a.total,4);assert.equal(a.excluded,2);
  assert.deepEqual(a.monthly,[{label:'2026-01',count:2},{label:'2026-02',count:2}]);
  assert.deepEqual(a.statuses,{resolvida:1,'em tratamento':1,'sem resposta':1,unknown:1});
  assert.deepEqual(a.durations,[1,3,4]);assert.equal(a.mean,8/3);assert.equal(a.median,3);
  assert.deepEqual(a.distribution.map(x=>x.count),[1,1,1,0]);
  assert.deepEqual(a.cities.map(x=>x.count),[2,1]);
  assert.equal(a.sellers.length,2);assert.equal(a.motives[0].count,2);
  assert.equal(complaints.analyze([]).mean,null);
});

test('recalcula tempo quando a data da tratativa muda e não usa datas inválidas ou negativas',()=>{
  const row={source:{date:'01/03/2026',treatment_date:'02/03/2026',days:'1'},treatment_date:'05/03/2026'};
  assert.equal(complaints.responseDays(row),4);
  row.treatment_date='28/02/2026';assert.equal(complaints.responseDays(row),null);
  row.treatment_date='';assert.equal(complaints.responseDays(row),null);
  assert.equal(complaints.parseDate('29/02/2026'),'');
  assert.equal(complaints.parseDate('29/02/2024'),'2024-02-29');
});

test('interpreta status históricos e ignora marcadores de dados ausentes nos rankings',()=>{
  const rows=[
    {source:{date:'01/02/2026',complaint:'Atraso',city:'-',seller:'#N/D'},status:'RESOLVIDO'},
    {source:{date:'02/02/2026',complaint:'Atraso',city:'Caicó',seller:'Ana'},status:'TRATANDO'},
    {source:{date:'03/02/2026',complaint:'Atraso',city:'#N/D',seller:'-'},status:''}
  ];
  const a=complaints.analyze(rows);
  assert.deepEqual(a.statuses,{resolvida:1,'em tratamento':1,'sem resposta':0,unknown:1});
  assert.deepEqual(a.cities,[{label:'Caicó',count:1}]);
  assert.deepEqual(a.sellers,[{label:'Ana',count:1}]);
  assert.equal(rows[0].status,'RESOLVIDO');
});

test('queixas fica em Devoluções acessível a todos os usuários autenticados',()=>{
  const {document}=parseHTML(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
  const item=document.querySelector('[data-view="queixas"]');
  const module=item.closest('[data-module="devolucoes"]');
  const area=module.closest('[data-area="entrega"]');
  assert.ok(module);assert.ok(area);
  for(const element of [item,module,area]) {
    assert.equal(element.hasAttribute('data-permission'),false);
    assert.equal(element.hasAttribute('data-permission-any'),false);
  }
  assert.equal(document.querySelectorAll('[data-view="queixas"]').length,1);
});

test('importa pelo painel, confirma duplicatas e permite atualizar tratativa sem alterar original',async()=>{
  const {document,window}=parseHTML(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
  const get=id=>document.getElementById(id);
  const store=[], calls=[];
  const client={
    from:()=>({select:()=>({order:()=>({range:async()=>({data:store.map(row=>({...row})),error:null})})})}),
    rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==='complaints_import') for(const source of args.p_rows)store.push({id:`id${store.length}`,source,revision:1,treatment_date:source.treatment_date,treatment:source.treatment,status:source.status});
      if(name==='complaints_update_treatment'){
        const row=store.find(item=>item.id===args.p_id);
        Object.assign(row,{treatment_date:args.p_date,treatment:args.p_treatment,status:args.p_status,revision:row.revision+1});
      }
      return {error:null};
    }
  };
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=complaints.create({getElement:get,context:()=>({client}),escapeHtml});
  api.bind();await api.enter();
  const form=get('complaintForm');
  form.elements=Object.fromEntries([...form.querySelectorAll('[name]')].map(element=>[element.name,element]));
  form.reset=()=>{};
  get('complaintDate').value='2026-03-04';
  get('complaintDescription').value='Produto danificado';
  form.dispatchEvent(new window.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(store[0].source.complaint,'Produto danificado');
  assert.equal(store[0].source.date,'2026-03-04');
  const paste=`${header}\n01/02/2026\t\t\t1\tMatriz\tCaicó\tLoja\tAna\t\tEntrega\tAtraso\t\tSem resposta`;
  get('complaintPaste').value=paste;
  get('complaintPreview').dispatchEvent(new window.Event('click'));
  assert.match(get('complaintImportInfo').textContent,/1 linha/);
  get('complaintImport').dispatchEvent(new window.Event('click'));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(store.length,2);
  assert.match(get('complaintDashboard').textContent,/Sem resposta/);
  const original=JSON.stringify(store[1].source);
  get('complaintRows').querySelector('[data-complaint-edit="id1"]').dispatchEvent(new window.Event('click',{bubbles:true}));
  get('complaintEditDate').value='03/02/2026';get('complaintEditStatus').value='Resolvida';get('complaintEditText').value='Retorno';
  get('complaintEditForm').dispatchEvent(new window.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(JSON.stringify(store[1].source),original);
  assert.equal(store[1].status,'Resolvida');
  assert.match(get('complaintDashboard').textContent,/2 dias/);
  get('complaintPaste').value=paste;
  get('complaintPreview').dispatchEvent(new window.Event('click'));
  assert.match(get('complaintImportInfo').textContent,/1 linha\(s\) idênticas/);
  get('complaintImport').dispatchEvent(new window.Event('click'));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls.filter(call=>call.name==='complaints_import').length,2);
});
