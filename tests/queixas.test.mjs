import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import complaints from '../src/queixas/queixas.js';

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

test('indicadores mostram meses sem registros e usam tipos padronizados em vez de motivos livres',async()=>{
  const {document}=parseHTML(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
  const rows=[
    {id:'a',source:{date:'01/01/2026',type:'Pedido',complaint:'Entrega atrasada'},status:'Resolvido'},
    {id:'b',source:{date:'01/03/2026',type:'Produto',complaint:'Produto errado'},status:'Tratando'}
  ];
  const client={from:()=>({select:()=>({order:()=>({range:async()=>({data:rows,error:null})})})})};
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=complaints.create({getElement:id=>document.getElementById(id),context:()=>({client}),escapeHtml});
  await api.enter();

  assert.deepEqual(
    [...document.querySelectorAll('.complaint-month-column')].map(column=>column.getAttribute('aria-label')),
    ['jan/26: 1 queixa','fev/26: 0 queixas','mar/26: 1 queixa']
  );
  const typeChart=[...document.querySelectorAll('.complaint-chart')].find(chart=>chart.querySelector('h3')?.textContent==='Queixas por tipo');
  assert.match(typeChart.textContent,/Pedido/);
  assert.match(typeChart.textContent,/Produto/);
  assert.equal([...document.querySelectorAll('.complaint-chart h3')].some(title=>title.textContent.includes('motivo')),false);
  assert.match(document.getElementById('complaintSummary').textContent,/Tipo mais frequente: Pedido/);
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

test('cadastro oferece apenas os canais, tipos e status definidos',()=>{
  const {document}=parseHTML(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
  const options=id=>[...document.getElementById(id).querySelectorAll('option')].filter(option=>option.getAttribute('value')!=='').map(option=>option.textContent);
  assert.deepEqual(options('complaintChannel'),['Zendesk','WhatsApp','Pessoalmente','Email','Ligação']);
  assert.deepEqual(options('complaintType'),['Pedido','Produto','Motorista','Endereço','Financeiro','Comunicação','Vendedor']);
  assert.deepEqual(options('complaintStatus'),['Tratando','Resolvido','Sem resposta']);
});

test('pesquisa e ordena todas as colunas sem alterar os indicadores ou os dados',async()=>{
  const {document,window}=parseHTML(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
  const get=id=>document.getElementById(id);
  const rows=[
    {id:'a',source:{date:'10/02/2026',treatment_date:'12/02/2026',days:'2',code:'10',city:'Caicó',name:'Loja',complaint:'Atraso'},treatment_date:'12/02/2026',treatment:'Contato',status:'Tratando'},
    {id:'b',source:{date:'01/03/2026',treatment_date:'11/03/2026',days:'10',code:'2',city:'Natal',name:'Mercado',complaint:'Produto'},treatment_date:'11/03/2026',treatment:'Retorno',status:'Resolvido'},
    {id:'c',source:{date:'inválida',days:'',code:'',city:'',complaint:'Outra'},treatment_date:'',treatment:'',status:''}
  ];
  const saved=JSON.stringify(rows);
  const client={from:()=>({select:()=>({order:()=>({range:async()=>({data:rows,error:null})})})})};
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=complaints.create({getElement:get,context:()=>({client}),escapeHtml});
  api.bind();await api.enter();
  const order=()=>[...get('complaintRows').querySelectorAll('[data-complaint-edit]')].map(button=>button.dataset.complaintEdit);
  const sort=field=>document.querySelector(`[data-complaint-sort="${field}"]`);
  assert.equal(document.querySelectorAll('[data-complaint-sort]').length,13);
  const summary=get('complaintSummary').textContent;
  sort('date').click();assert.deepEqual(order(),['a','b','c']);assert.equal(sort('date').closest('th').getAttribute('aria-sort'),'ascending');
  sort('date').click();assert.deepEqual(order(),['b','a','c']);assert.equal(sort('date').closest('th').getAttribute('aria-sort'),'descending');
  sort('days').click();assert.deepEqual(order(),['a','b','c']);
  sort('days').click();assert.deepEqual(order(),['b','a','c']);
  sort('code').click();assert.deepEqual(order(),['b','a','c']);
  get('complaintSearch').value='caico contato';get('complaintSearch').dispatchEvent(new window.Event('input'));
  assert.deepEqual(order(),['a']);assert.match(get('complaintRecordCount').textContent,/1 de 3/);
  assert.equal(get('complaintSummary').textContent,summary);
  get('complaintSearch').value='inexistente';get('complaintSearch').dispatchEvent(new window.Event('input'));
  assert.match(get('complaintRows').textContent,/Nenhum registro encontrado/);
  get('complaintClearSearch').click();assert.deepEqual(order(),['b','a','c']);
  assert.equal(JSON.stringify(rows),saved);
});

test('seções preservam rascunhos e registros existentes, incluindo ao cadastrar e atualizar tratativa',async()=>{
  const {document,window}=parseHTML(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
  const get=id=>document.getElementById(id);
  const source={date:'01/02/2026',treatment_date:'02/02/2026',days:'1',code:'1',unit:'Matriz',city:'Caicó',name:'Loja',seller:'Ana',channel:'WhatsApp',type:'Pedido',complaint:'Atraso',treatment:'Resposta original',status:'Sem resposta'};
  const store=[{id:'id0',source,revision:1,treatment_date:'02/02/2026',treatment:'Resposta original',status:'Sem resposta'}];
  const client={
    from:()=>({select:()=>({order:()=>({range:async()=>({data:store.map(row=>({...row})),error:null})})})}),
    rpc:async(name,args)=>{
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
  assert.equal(get('complaintSummaryPanel').hidden,false);
  assert.equal(get('complaintNewPanel').hidden,true);
  assert.equal(get('complaintPaste'),null);
  assert.match(get('complaintSummary').textContent,/Sem resposta/);
  const tab=name=>document.querySelector(`[data-complaint-tab="${name}"]`);
  tab('new').click();
  assert.equal(get('complaintNewPanel').hidden,false);
  assert.equal(get('complaintSummaryPanel').hidden,true);
  assert.equal(tab('new').getAttribute('aria-pressed'),'true');
  const form=get('complaintForm');
  form.elements=Object.fromEntries([...form.querySelectorAll('[name]')].map(element=>[element.name,element]));
  form.reset=()=>{};
  get('complaintDate').value='2026-03-04';
  get('complaintDescription').value='Produto danificado';
  tab('charts').click();
  assert.equal(get('complaintChartsPanel').hidden,false);
  assert.match(get('complaintDashboard').textContent,/Distribuição por status/);
  tab('new').click();
  assert.equal(get('complaintDescription').value,'Produto danificado');
  form.dispatchEvent(new window.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(store[1].source.complaint,'Produto danificado');
  assert.equal(store[1].source.date,'2026-03-04');
  assert.equal(store.length,2);
  tab('records').click();
  assert.deepEqual([...get('complaintRecordsPanel').querySelectorAll('thead th')].map(th=>th.textContent),
    ['Data da queixa','Data da tratativa','Dias para responder','Cód.','Unidade','Cidade','Fantasia','Vendedor','Canal','Tipo','Queixa','Tratativa','Status','Ação']);
  const cells=()=>[...get('complaintRows').querySelector('tr').querySelectorAll('td')].slice(0,13).map(td=>td.textContent);
  assert.deepEqual(cells(),['01/02/2026','02/02/2026','1','1','Matriz','Caicó','Loja','Ana','WhatsApp','Pedido','Atraso','Resposta original','Sem resposta']);
  const original=JSON.stringify(store[0].source);
  get('complaintRows').querySelector('[data-complaint-edit="id0"]').dispatchEvent(new window.Event('click',{bubbles:true}));
  assert.match(get('complaintEditor').querySelector('details').textContent,/Resposta original/);
  get('complaintEditDate').value='03/02/2026';
  const select=get('complaintEditStatus');
  assert.deepEqual([...select.querySelectorAll('option')].map(option=>option.value),['','Tratando','Resolvido','Sem resposta']);
  Object.defineProperty(select,'value',{value:'Resolvido',configurable:true});
  get('complaintEditText').value='Retorno';
  get('complaintEditForm').dispatchEvent(new window.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(JSON.stringify(store[0].source),original);
  assert.equal(store[0].status,'Resolvido');
  assert.deepEqual(cells().slice(0,3),['01/02/2026','03/02/2026','2']);
  assert.deepEqual(cells().slice(11),['Retorno','Resolvido']);
  assert.match(get('complaintSummary').textContent,/2 dias/);
  store[0].status='RESOLVIDO';
  await api.enter();
  get('complaintRows').querySelector('[data-complaint-edit="id0"]').dispatchEvent(new window.Event('click',{bubbles:true}));
  assert.ok(get('complaintEditStatus').querySelector('option[value="Resolvido"]').hasAttribute('selected'));
  Object.defineProperty(get('complaintEditStatus'),'value',{value:'Resolvido',configurable:true});
  get('complaintEditForm').dispatchEvent(new window.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(store[0].status,'RESOLVIDO');
  store[0].status='Status antigo';
  await api.enter();
  get('complaintRows').querySelector('[data-complaint-edit="id0"]').dispatchEvent(new window.Event('click',{bubbles:true}));
  assert.match(get('complaintEditStatus').textContent,/Status antigo/);
  Object.defineProperty(get('complaintEditStatus'),'value',{value:'',configurable:true});
  get('complaintEditForm').dispatchEvent(new window.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(store[0].status,'Status antigo');
});
