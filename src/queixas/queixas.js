(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DISB_COMPLAINTS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const fields = ['date','treatment_date','days','code','unit','city','name','seller','channel','type','complaint','treatment','status'];
  const headers = ['data da queixa','data da tratativa','dias para responder','cod','unidade','cidade','fantasia','vendedor','canal','tipo','queixa','tratativa','status'];
  const clean = value => String(value ?? '').trim();
  const key = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');

  function parseDate(value) {
    const text = clean(value);
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const parts = br ? [br[3],br[2].padStart(2,'0'),br[1].padStart(2,'0')] : iso?.slice(1);
    if (!parts) return '';
    const date = parts.join('-'), parsed = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === date ? date : '';
  }

  function parseClipboard(text) {
    const rows = [], row = [];
    let cell = '', quoted = false, closed = false, start = true;
    const finishCell = () => { row.push(cell); cell = ''; closed = false; start = true; };
    const finishRow = () => { finishCell(); rows.push(row.splice(0)); };
    for (let i=0; i<text.length; i++) {
      const ch=text[i];
      if (quoted) {
        if (ch === '"' && text[i+1] === '"') { cell += '"'; i++; }
        else if (ch === '"') { quoted=false; closed=true; }
        else cell += ch;
      } else if (ch === '"' && start) { quoted=true; start=false; }
      else if (ch === '\t') finishCell();
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i+1] === '\n') i++; finishRow(); }
      else if (closed) throw new Error('Conteúdo inesperado após aspas. Copie novamente as células da planilha.');
      else { cell += ch; start=false; }
    }
    if (quoted) throw new Error('Há uma célula entre aspas incompleta. Copie novamente as células.');
    if (cell || row.length || closed) finishRow();
    if (!rows.length) throw new Error('Cole os dados com os cabeçalhos.');
    const actual=rows.shift().map(value=>key(value).replace(/\.$/,''));
    if (actual.length !== headers.length || headers.some((name,i)=>actual[i] !== name)) {
      throw new Error('Confira os 13 cabeçalhos e a ordem das colunas indicados na página.');
    }
    return rows.flatMap((cells,index)=>{
      if (cells.every(value=>!clean(value))) return [];
      if (cells.length !== fields.length) throw new Error(`Linha ${index+2}: são esperadas 13 colunas; copie todas as células da linha.`);
      return [Object.fromEntries(fields.map((field,i)=>[field,cells[i]]))];
    });
  }

  function responseDays(row) {
    const source=row.source || {};
    const original=clean(source.days);
    if (clean(row.treatment_date) === clean(source.treatment_date) && original) {
      if (!/^\d+(?:[.,]\d+)?$/.test(original)) return null;
      return Number(original.replace(',','.'));
    }
    const start=parseDate(source.date), end=parseDate(row.treatment_date);
    if (!start || !end || end < start) return null;
    return (Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000;
  }

  function counts(rows, field) {
    const map=new Map();
    for (const row of rows) {
      const label=clean(row.source?.[field]), normalized=key(label);
      if (!normalized) continue;
      const item=map.get(normalized) || {label,count:0};
      item.count++; map.set(normalized,item);
    }
    return [...map.values()].sort((a,b)=>b.count-a.count || a.label.localeCompare(b.label,'pt-BR'));
  }

  function analyze(rows) {
    const valid=rows.filter(row=>parseDate(row.source?.date) && clean(row.source?.complaint));
    const months=new Map();
    for (const row of valid) {
      const month=parseDate(row.source.date).slice(0,7);
      months.set(month,(months.get(month)||0)+1);
    }
    const monthly=[...months].sort(([a],[b])=>a.localeCompare(b)).map(([label,count])=>({label,count}));
    const statuses={resolvida:0,'em tratamento':0,'sem resposta':0,unknown:0};
    for (const row of valid) {
      const status=key(row.status);
      if (Object.hasOwn(statuses,status) && status !== 'unknown') statuses[status]++;
      else statuses.unknown++;
    }
    const durations=valid.map(responseDays).filter(value=>value !== null && Number.isFinite(value)).sort((a,b)=>a-b);
    const mean=durations.length ? durations.reduce((a,b)=>a+b,0)/durations.length : null;
    const middle=Math.floor(durations.length/2);
    const median=durations.length ? (durations.length%2 ? durations[middle] : (durations[middle-1]+durations[middle])/2) : null;
    const distribution=[
      {label:'Até 1 dia',count:durations.filter(n=>n<=1).length},
      {label:'Mais de 1 a 3 dias',count:durations.filter(n=>n>1 && n<=3).length},
      {label:'Mais de 3 a 7 dias',count:durations.filter(n=>n>3 && n<=7).length},
      {label:'Mais de 7 dias',count:durations.filter(n=>n>7).length}
    ];
    return {total:valid.length,excluded:rows.length-valid.length,monthly,statuses,durations,mean,median,distribution,
      types:counts(valid,'type'),motives:counts(valid,'complaint'),cities:counts(valid,'city'),sellers:counts(valid,'seller')};
  }

  function create(adapter) {
    const $=adapter.getElement, esc=adapter.escapeHtml;
    let rows=[], preview=null, generation=0, busy=false, loaded=false;
    const percent=(n,total)=>total ? `${(n*100/total).toLocaleString('pt-BR',{maximumFractionDigits:1})}%` : '—';
    const number=n=>n === null ? '—' : `${n.toLocaleString('pt-BR',{maximumFractionDigits:1})} dias`;
    const message=text=>{ $('complaintMessage').textContent=text; };
    const fingerprint=source=>JSON.stringify(fields.map(field=>String(source?.[field] ?? '')));
    const empty='Nenhum dado informado.';

    function bars(title,items,total) {
      const max=Math.max(1,...items.map(x=>x.count));
      return `<section class="complaint-chart"><h3>${esc(title)}</h3>${items.length ? items.map(item=>`<div class="complaint-bar"><span>${esc(item.label)}</span><div class="complaint-track"><i style="width:${item.count/max*100}%"></i></div><strong>${item.count} <small>(${percent(item.count,total)})</small></strong></div>`).join('') : `<p>${empty}</p>`}</section>`;
    }
    function line(items) {
      if (!items.length) return `<p>${empty}</p>`;
      const max=Math.max(1,...items.map(x=>x.count));
      const monthIndex=label=>Number(label.slice(0,4))*12+Number(label.slice(5,7));
      const first=monthIndex(items[0].label), span=monthIndex(items.at(-1).label)-first;
      const points=items.map(item=>`${span ? 5+(monthIndex(item.label)-first)*90/span : 50},${95-item.count/max*85}`);
      const segments=points.slice(1).map((point,i)=>monthIndex(items[i+1].label)-monthIndex(items[i].label)===1 ? `<polyline points="${points[i]} ${point}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` : '').join('');
      return `<svg class="complaint-line" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Evolução mensal dos meses com registros">${segments}${points.map(point=>{const [x,y]=point.split(',');return `<circle cx="${x}" cy="${y}" r="1.5" fill="currentColor"/>`;}).join('')}</svg><div class="complaint-months">${items.map(item=>`<span>${esc(item.label)}: <b>${item.count}</b></span>`).join('')}</div><small>A linha mostra apenas meses com registros; intervalos sem registros não são interpolados como contagens.</small>`;
    }
    function renderDashboard() {
      const a=analyze(rows), colors=['#198754','#e5a11a','#d94b4b','#8794a5'];
      const labels=['Resolvida','Em tratamento','Sem resposta','Não informado ou outro'];
      const values=[a.statuses.resolvida,a.statuses['em tratamento'],a.statuses['sem resposta'],a.statuses.unknown];
      let start=0;
      const stops=values.map((n,i)=>{const end=start+(a.total?n/a.total*100:0);const s=`${colors[i]} ${start}% ${end}%`;start=end;return s;}).join(',');
      const top=a.motives[0], last=a.monthly.at(-1), previous=a.monthly.at(-2);
      const insights=[];
      if (top) insights.push(`Motivo mais frequente: ${esc(top.label)} (${top.count}).`);
      if (a.statuses['sem resposta']) insights.push(`${a.statuses['sem resposta']} queixa(s) sem resposta (${percent(a.statuses['sem resposta'],a.total)}).`);
      if (last && previous) insights.push(`Último mês com registros (${last.label}): ${last.count}; mês anterior com registros (${previous.label}): ${previous.count}.`);
      if (a.statuses.unknown) insights.push(`${a.statuses.unknown} registro(s) com status não informado ou não reconhecido.`);
      $('complaintDashboard').innerHTML=`
        <div class="complaint-kpis"><div><span>Queixas válidas</span><strong>${a.total}</strong><small>${a.excluded} fora da análise</small></div>
        <div class="good"><span>Resolvidas</span><strong>${percent(values[0],a.total)}</strong><small>${values[0]} queixas</small></div>
        <div class="warning"><span>Em tratamento</span><strong>${percent(values[1],a.total)}</strong><small>${values[1]} queixas</small></div>
        <div class="danger"><span>Sem resposta</span><strong>${percent(values[2],a.total)}</strong><small>${values[2]} queixas</small></div>
        <div><span>Tempo médio</span><strong>${number(a.mean)}</strong><small>${a.durations.length} com tempo válido</small></div>
        <div><span>Tempo mediano</span><strong>${number(a.median)}</strong><small>${a.durations.length} com tempo válido</small></div></div>
        <div class="complaint-insights"><strong>Problemas, tendências e atenção</strong><ul>${insights.length ? insights.map(item=>`<li>${item}</li>`).join('') : '<li>Ainda não há dados suficientes para destacar problemas.</li>'}</ul></div>
        <div class="complaint-charts">${bars('Quantidade de queixas por mês',a.monthly,a.total)}
        <section class="complaint-chart"><h3>Evolução mensal</h3>${line(a.monthly)}</section>
        ${bars('Queixas por tipo',a.types,a.total)}${bars('Queixas por motivo',a.motives,a.total)}
        ${bars('Ranking de cidades',a.cities,a.total)}${bars('Ranking de vendedores',a.sellers,a.total)}
        ${bars('Distribuição do tempo de resposta',a.distribution,a.durations.length)}
        <section class="complaint-chart"><h3>Distribuição por status</h3><div class="complaint-pie-layout"><div class="complaint-pie" role="img" aria-label="Distribuição por status" style="background:${a.total ? `conic-gradient(${stops})` : '#e5e7eb'}"></div><ul>${labels.map((label,i)=>`<li><i style="background:${colors[i]}"></i>${label}: ${values[i]} (${percent(values[i],a.total)})</li>`).join('')}</ul></div></section></div>
        <p class="complaint-note">Percentuais de status usam todas as queixas válidas. Tempo: dias originais quando informados e válidos; quando ausentes ou após mudança da data de tratativa, usa-se a diferença entre datas válidas. Dias originais inválidos não são estimados.</p>`;
    }
    function render() {
      $('complaintRows').innerHTML=rows.length ? rows.map(row=>{
        const s=row.source || {};
        const values=[s.date,s.code,s.unit,s.city,s.name,s.seller,s.channel,s.type,s.complaint,s.treatment_date,s.days,s.treatment,s.status,row.treatment_date,row.treatment,row.status];
        return `<tr>${values.map(value=>`<td>${esc(clean(value)||'—')}</td>`).join('')}<td><button type="button" class="mini-btn" data-complaint-edit="${esc(row.id)}">Atualizar tratativa</button></td></tr>`;
      }).join('') : '<tr><td colspan="17">Nenhum registro salvo.</td></tr>';
      renderDashboard();
    }
    async function enter() {
      const id=++generation;
      loaded=false;preview=null;$('complaintImport').disabled=true;message('Carregando queixas…');
      try {
        const results=[];
        for (let offset=0;;offset+=1000) {
          const {data,error}=await adapter.context().client.from('complaints').select('*').order('id').range(offset,offset+999);
          if (error) throw error;
          if (!Array.isArray(data)) throw new Error('Resposta inválida ao consultar queixas.');
          results.push(...data);
          if (data.length<1000) break;
        }
        if (id!==generation) return;
        rows=results;loaded=true;render();message(`${rows.length} registro(s) salvos.`);
        return true;
      } catch (error) {
        if (id!==generation) return;
        rows=[];render();message(`Não foi possível carregar as queixas: ${error.message || error}`);
        return false;
      }
    }
    function reset() { generation++;rows=[];preview=null;busy=false;loaded=false;$('complaintEditor').innerHTML='';$('complaintImport').disabled=true;$('complaintPaste').value='';$('complaintImportInfo').textContent='';$('complaintForm').reset();render(); }
    async function saveSources(sources) {
      if (busy) return false;
      busy=true;
      try {
        const {error}=await adapter.context().client.rpc('complaints_import',{p_rows:sources});
        if (error) throw error;
        const refreshed=await enter();
        if (!refreshed) message(`Salvo, mas não foi possível atualizar a lista. Recarregue antes de importar novamente. ${$('complaintMessage').textContent}`);
        return {refreshed};
      } catch (error) { message(`Não foi possível salvar: ${error.message || error}`);return false; }
      finally { busy=false; }
    }
    function bind() {
      $('complaintRefresh').addEventListener('click',()=>void enter());
      $('complaintForm').addEventListener('submit',async event=>{
        event.preventDefault();
        const form=event.currentTarget, source=Object.fromEntries(fields.map(field=>[field,form.elements[field]?.value || '']));
        if (!parseDate(source.date) || !clean(source.complaint)) { message('Informe uma data válida e a queixa.');return; }
        if (source.treatment_date && (!parseDate(source.treatment_date) || source.treatment_date<source.date)) { message('A data da tratativa não pode ser anterior à queixa.');return; }
        const result=await saveSources([source]);
        if (result) { form.reset();if(result.refreshed)message('Queixa salva.'); }
      });
      $('complaintPaste').addEventListener('input',()=>{preview=null;$('complaintImport').disabled=true;$('complaintImportInfo').textContent='';});
      $('complaintPreview').addEventListener('click',()=>{
        preview=null;$('complaintImport').disabled=true;
        try {
          if (!loaded) throw new Error('Atualize os registros antes de conferir a importação.');
          const sources=parseClipboard($('complaintPaste').value);
          if (!sources.length) throw new Error('Nenhuma linha preenchida encontrada.');
          const seen=new Set(rows.map(row=>fingerprint(row.source)));
          let duplicates=0;
          for (const source of sources) { const fp=fingerprint(source);if(seen.has(fp))duplicates++;seen.add(fp); }
          preview=sources;
          const invalid=sources.filter(source=>!parseDate(source.date)||!clean(source.complaint)).length;
          $('complaintImportInfo').innerHTML=`<p>${sources.length} linha(s) para importar; ${invalid} sem data válida ou queixa e fora das análises. ${duplicates} linha(s) idênticas a outra cópia ou ao banco.</p><p>Confira a amostra: ${sources.slice(0,5).map(s=>esc(`${s.date || 'sem data'} — ${s.name || s.code || 'sem cliente'} — ${s.complaint || 'sem queixa'}`)).join('<br>')}</p>${duplicates ? '<label><input id="complaintAllowDuplicates" type="checkbox"> Entendo que as linhas idênticas também serão importadas.</label>' : ''}`;
          $('complaintImport').disabled=false;
        } catch (error) { $('complaintImportInfo').textContent=error.message; }
      });
      $('complaintImport').addEventListener('click',async()=>{
        if (!preview) return;
        const checkbox=$('complaintAllowDuplicates');
        if (checkbox && !checkbox.checked) { message('Confirme a importação das linhas idênticas.');return; }
        $('complaintImport').disabled=true;
        if (await saveSources(preview)) { preview=null;$('complaintPaste').value='';$('complaintImportInfo').textContent='Importação concluída; a planilha original não foi modificada.'; }
        else $('complaintImport').disabled=false;
      });
      $('complaintRows').addEventListener('click',event=>{
        const button=event.target.closest('[data-complaint-edit]');
        if (!button) return;
        const row=rows.find(item=>item.id===button.dataset.complaintEdit);
        if (!row) return;
        $('complaintEditor').innerHTML=`<form id="complaintEditForm" class="complaint-editor"><h3>Atualizar tratativa</h3><div class="grid grid-3">
          <div class="field"><label for="complaintEditDate">Data da tratativa</label><input id="complaintEditDate" value="${esc(row.treatment_date)}" placeholder="dd/mm/aaaa"></div>
          <div class="field"><label for="complaintEditStatus">Status</label><input id="complaintEditStatus" value="${esc(row.status)}" list="complaintStatusOptions"><datalist id="complaintStatusOptions"><option value="Resolvida"><option value="Em tratamento"><option value="Sem resposta"></datalist></div>
          <div class="field"><label for="complaintEditText">Tratativa</label><textarea id="complaintEditText">${esc(row.treatment)}</textarea></div></div>
          <div class="actions"><button type="submit" class="btn primary">Salvar atualização</button><button type="button" class="btn secondary" id="complaintEditCancel">Cancelar</button></div></form>`;
        $('complaintEditCancel').addEventListener('click',()=>{ $('complaintEditor').innerHTML=''; });
        $('complaintEditForm').addEventListener('submit',async event=>{
          event.preventDefault();
          if (busy) return;
          const date=$('complaintEditDate').value, parsed=parseDate(date), start=parseDate(row.source?.date);
          if (date && (!parsed || (start && parsed<start))) { message('Informe uma data válida de tratativa, não anterior à queixa.');return; }
          busy=true;
          try {
            const {error}=await adapter.context().client.rpc('complaints_update_treatment',{p_id:row.id,p_revision:row.revision,p_date:date,p_treatment:$('complaintEditText').value,p_status:$('complaintEditStatus').value});
            if (error) throw error;
            $('complaintEditor').innerHTML='';if(await enter())message('Tratativa atualizada; dados originais preservados.');
          } catch(error) { message(`Não foi possível atualizar a tratativa: ${error.message || error}`); }
          finally { busy=false; }
        });
      });
    }
    return {bind,enter,reset};
  }
  return {create,parseClipboard,parseDate,responseDays,analyze};
});
