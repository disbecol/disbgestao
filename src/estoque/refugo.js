(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DISB_REFUGO = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function create(adapter) {
    const context = () => adapter.context();
    const unit = () => context().unit;
    const $ = adapter.getElement;
    const esc = adapter.escapeHtml;
    const fmtDate = adapter.formatDate;
    const fmtDateTime = adapter.formatDateTime;
    const localIsoDate = adapter.localIsoDate;
    const norm = adapter.normalize;
    const humanError = adapter.humanError;
    const isNativeCapacitor = adapter.isNativeCapacitor;
    const downloadCsv = adapter.downloadCsv;
    const openModal = adapter.openModal;
    const closeModal = adapter.closeModal;
    const hasPerm = adapter.hasPermission;
    const toast = adapter.toast;
    const sb = {
      from: (...args) => context().client.from(...args),
      rpc: (...args) => context().client.rpc(...args)
    };

    let refugoCatalog = [], refugoSessions = [], refugoHistory = [], refugoCurrentSession = null, refugoItems = [];
    let refugoTimer = null, refugoBusy = false, refugoEventsBound = false;
    const REFUGO_KIND_LABEL = { TYPE: 'Tipos de vasilhame', REASON: 'Motivos de refugo' };
    const REFUGO_MAP_FIELDS = { g300: '300ml', g600_green: '600ml Verde', g600_brown: '600ml Âmbar / Marrom', g_litrao: '1L / Litrão', keg30: 'Barril 30L', keg50: 'Barril 50L' };

    function refugoError(error) {
      const message = String(error?.message || error || '');
      const known = { REFUGO_MAPA_INVALIDO: 'Informe um número de mapa válido.', REFUGO_MAPA_NAO_ENCONTRADO: 'Este mapa não está na base MAPAS importada da planilha. Confira o número ou atualize a base.', REFUGO_AJUDANTE_INVALIDO: 'Execute o SQL 49_refugo_usuario_afericao.sql no Supabase para usar o usuário do sistema.', REFUGO_TIPO_INVALIDO: 'Selecione um tipo de vasilhame ativo.', REFUGO_TIPO_SEM_VINCULO: 'Este tipo de vasilhame precisa ser associado a uma coluna da base MAPAS no cadastro do Refugo.', REFUGO_LIMITE_MAPA_ATINGIDO: 'A quantidade disponível deste tipo no mapa já foi toda aferida.', REFUGO_QUANTIDADE_EXCEDE_MAPA: 'A quantidade aferida supera o saldo deste tipo no mapa. Confira a quantidade informada.', REFUGO_MOTIVO_INVALIDO: 'Um motivo foi inativado. Atualize a tela e tente novamente.', REFUGO_MOTIVOS_INVALIDOS: 'Confira as quantidades por motivo.', REFUGO_QUANTIDADE_INVALIDA: 'Informe uma quantidade aferida maior que zero.', REFUGO_OBSERVACAO_LONGA: 'A observação deve ter até 1.000 caracteres.', REFUGO_CADASTRO_NAO_ENCONTRADO: 'Cadastro não encontrado nesta unidade.', REFUGO_ITEM_NAO_ENCONTRADO: 'Vasilhame não encontrado. Atualize a tela.', REFUGO_ITEM_EM_ANDAMENTO: 'Finalize ou cancele o vasilhame em andamento.', REFUGO_ITEM_FINALIZADO: 'Este vasilhame já foi finalizado.', REFUGO_TOTAL_SUPERA_AFERIDO: 'A quantidade refugada não pode superar a quantidade aferida.', REFUGO_MAPA_SEM_ITENS: 'Registre ao menos um vasilhame antes de finalizar o mapa.', REFUGO_MAPA_FINALIZADO: 'Este mapa já foi finalizado.', REFUGO_NOME_INVALIDO: 'Informe um nome de 1 a 100 caracteres.' };
      const key = Object.keys(known).find(x => message.includes(x));
      if (key) return known[key];
      if (error?.code === '23505') return 'Este cadastro ou mapa em andamento já existe.';
      if (/start_refugo_session_v2|start_refugo_item_v2|save_refugo_catalog_v2|column .*map_field.*does not exist/i.test(message)) return 'Execute o SQL 50_refugo_limites_mapas.sql no Supabase para ativar a validação dos mapas.';
      if (/PGRST205|PGRST202|42P01|42883|relation .*refugo_.* does not exist|function .*refugo_.* does not exist/i.test(message)) return 'O módulo Refugo ainda não está disponível no banco. Execute os SQLs 48 a 50 no Supabase.';
      return humanError(error);
    }

    function refugoDuration(start, end) {
      const seconds = Math.max(0, Math.floor((new Date(end || Date.now()) - new Date(start)) / 1000));
      return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
    }
    function refugoCatalogFor(kind, activeOnly = true) { return refugoCatalog.filter(row => row.kind === kind && (!activeOnly || row.active)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); }
    function refugoRemaining(mapField, session = refugoCurrentSession, items = refugoItems) {
      if (!session?.map_limits || !mapField) return null;
      const cap = Number(session.map_limits[mapField] || 0);
      const used = items.filter(item => item.status === 'COMPLETED' && item.map_field === mapField).reduce((sum, item) => sum + Number(item.quantity_checked || 0), 0);
      return Math.max(0, cap - used);
    }
    function refugoMapLimitSummary(session) {
      if (!session?.map_limits) return '<div class="notice warning">Este mapa em andamento não tem base MAPAS vinculada. Importe a planilha e inicie uma nova aferição.</div>';
      return `<div class="notice">Mapa validado na base MAPAS${session.map_date ? ` · ${esc(fmtDate(session.map_date))}` : ''}.</div>`;
    }
    async function refugoFetchAll(makeQuery) {
      const rows = [], size = 500;
      for (let from = 0; ; from += size) {
        const { data, error } = await makeQuery().range(from, from + size - 1);
        if (error) throw error;
        const page = data || []; rows.push(...page);
        if (page.length < size) break;
      }
      return rows;
    }
    async function loadRefugoCatalog() {
      refugoCatalog = await refugoFetchAll(() => sb.from('refugo_catalog').select('id,kind,unit,name,active,map_field').in('kind', ['TYPE', 'REASON']).order('id'));
      renderRefugoCatalog();
    }
    async function loadRefugoOpenSessions() {
      refugoSessions = await refugoFetchAll(() => sb.from('refugo_sessions').select('*').eq('unit', unit()).eq('status', 'OPEN').order('started_at', { ascending: false }).order('id', { ascending: false }));
      $('refugoOpenSessions').innerHTML = refugoSessions.length ? refugoSessions.map(s => `<div class="refugo-open-card"><div><strong>Mapa ${esc(s.map_number)}</strong><small>Aferido por ${esc(s.created_by_name)} • ${esc(fmtDateTime(s.started_at))}</small></div><div class="refugo-inline-actions"><button type="button" class="btn secondary" data-refugo-resume="${esc(s.id)}">Retomar</button></div></div>`).join('') : '<div class="refugo-empty">Nenhum mapa em andamento nesta unidade.</div>';
    }
    async function refugoItemsFor(sessionId) {
      return refugoFetchAll(() => sb.from('refugo_items').select('*,refugo_item_reasons(reason_id,reason_name,quantity)').eq('session_id', sessionId).order('started_at').order('id'));
    }
    async function refugoResume(session) {
      if (!session || session.unit !== unit()) return;
      refugoCurrentSession = session;
      refugoItems = await refugoItemsFor(session.id);
      renderRefugoCurrent();
    }
    function refugoStartHtml() {
      return `<div class="card refugo-start-card"><div class="list-head"><div><strong>Iniciar aferição do mapa</strong><small>O mapa precisa constar na base MAPAS importada da planilha.</small></div></div><div class="grid grid-3"><div class="field"><label>Unidade</label><input value="${esc(unit())}" readonly></div><div class="field"><label>Aferido por</label><input value="${esc(context().profile?.name || 'Usuário atual')}" readonly></div><div class="field"><label>Número do mapa *</label><input id="refugoMap" inputmode="numeric" pattern="[0-9]*" maxlength="30" placeholder="Ex.: 122117"></div></div><div class="actions right"><button type="button" class="btn primary" data-refugo-action="start">Iniciar aferição</button></div></div>`;
    }
    function renderRefugoCurrent() {
      clearInterval(refugoTimer); refugoTimer = null;
      const box = $('refugoCurrent'); if (!box) return;
      const session = refugoCurrentSession;
      if (!session || session.unit !== unit()) { box.innerHTML = refugoStartHtml(); return; }
      const running = refugoItems.find(x => x.status === 'RUNNING');
      const completed = refugoItems.filter(x => x.status === 'COMPLETED');
      const checked = completed.reduce((n, x) => n + Number(x.quantity_checked || 0), 0);
      const rejected = completed.reduce((n, x) => n + Number(x.quantity_rejected || 0), 0);
      const types = refugoCatalogFor('TYPE'), reasons = refugoCatalogFor('REASON');
      const availableTypes = session.map_limits ? types.filter(type => type.map_field && refugoRemaining(type.map_field) > 0) : [];
      const typeOptions = availableTypes.map(type => `<option value="${esc(type.id)}">${esc(type.name)}</option>`).join('');
      box.innerHTML = `<div class="card"><div class="refugo-session-head"><div><span class="refugo-kicker">Aferição em andamento</span><h2>Mapa ${esc(session.map_number)}</h2><p>${esc(session.unit)} • Aferido por: ${esc(session.created_by_name)} • Início: ${esc(fmtDateTime(session.started_at))}</p></div><button type="button" class="btn secondary" data-refugo-action="leave">Voltar aos mapas</button></div><div class="refugo-session-stats"><span><b>${completed.length}</b> vasilhame${completed.length === 1 ? '' : 's'}</span><span><b>${checked}</b> aferidos</span><span><b>${rejected}</b> refugados</span><span><b>${checked - rejected}</b> aproveitados</span></div>${refugoMapLimitSummary(session)}</div>
      <div class="card"><div class="list-head"><div><strong>${running ? 'Aferindo ' + esc(running.type_name) : 'Novo vasilhame'}</strong><small>${running ? 'O início já foi salvo. Você pode retomar esta etapa depois.' : 'Selecione o tipo e a quantidade em unidades para iniciar o cronômetro.'}</small></div></div>${running ? `<div class="refugo-timer"><div><small>Tempo deste vasilhame</small><strong id="refugoClock">${refugoDuration(running.started_at)}</strong><span>Iniciado em ${esc(fmtDateTime(running.started_at))}</span></div><button type="button" class="btn secondary" data-refugo-action="cancel-item">Cancelar este vasilhame</button></div><div class="grid grid-2"><div class="field"><label>Quantidade aferida *</label><input id="refugoQuantity" type="number" min="1" step="1" inputmode="numeric" value="${esc(running.planned_quantity ?? '')}" placeholder="Ex.: 10"></div><div class="field"><label>Observação</label><textarea id="refugoNote" maxlength="1000" placeholder="Opcional"></textarea></div></div><span class="refugo-kicker">Quantidade refugada por motivo</span>${reasons.length ? `<div class="refugo-reasons">${reasons.map(r => `<label class="refugo-reason"><span>${esc(r.name)}</span><input type="number" min="0" step="1" inputmode="numeric" value="0" data-refugo-reason="${esc(r.id)}"></label>`).join('')}</div>` : '<div class="notice">Nenhum motivo cadastrado. Você pode finalizar com zero refugo.</div>'}<div class="refugo-total" id="refugoLiveTotals"></div><div class="actions right"><button type="button" class="btn primary" data-refugo-action="finish-item">Finalizar este vasilhame</button></div>` : `<div class="grid grid-2"><div class="field"><label>Tipo de vasilhame *</label><select id="refugoType"><option value="">Selecione</option>${typeOptions}</select></div><div class="field"><label>Quantidade a aferir (unidades) *</label><input id="refugoStartQuantity" type="number" min="1" step="1" inputmode="numeric" placeholder="Ex.: 10"></div></div><div class="refugo-total" id="refugoStartLimit"></div>${availableTypes.length ? '' : `<div class="notice">Nenhum tipo disponível para aferição neste mapa.</div>`}<div class="actions right"><button type="button" class="btn primary" data-refugo-action="start-item" ${availableTypes.length ? '' : 'disabled'}>Iniciar este vasilhame</button></div>`}</div>
      <div class="card"><div class="list-head"><div><strong>Vasilhames registrados</strong><small>Cada passagem fica separada no histórico do mapa.</small></div><span class="counter">${completed.length} item${completed.length === 1 ? '' : 's'}</span></div><div class="refugo-item-list">${completed.length ? completed.map(x => `<div class="refugo-item-card"><div><strong>${esc(x.type_name)}</strong><small>${esc(fmtDateTime(x.started_at))} → ${esc(fmtDateTime(x.ended_at))} • ${refugoDuration(x.started_at, x.ended_at)}</small><p>${(x.refugo_item_reasons || []).map(r => `${esc(r.reason_name)}: ${Number(r.quantity)}`).join(' • ') || 'Sem refugo'}${x.note ? ` • ${esc(x.note)}` : ''}</p></div><span class="refugo-pill">${Number(x.quantity_checked)} aferidos · ${Number(x.quantity_rejected)} refugados</span></div>`).join('') : '<div class="refugo-empty">Nenhum vasilhame concluído neste mapa.</div>'}</div><div class="actions right"><button type="button" class="btn primary" data-refugo-action="complete" ${running || !completed.length ? 'disabled' : ''}>Finalizar mapa</button></div></div>`;
      box.querySelector('[data-refugo-action="complete"]')?.insertAdjacentHTML('beforebegin', `<button type="button" class="btn secondary" data-refugo-action="cancel-session" ${running ? 'disabled' : ''}>Cancelar mapa</button>`);
      if (!session.map_limits) { const finish = box.querySelector('[data-refugo-action="finish-item"]'); if (finish) finish.disabled = true; }
      if (running) {
        refugoTimer = setInterval(() => { const clock = $('refugoClock'); if (clock) clock.textContent = refugoDuration(running.started_at); else clearInterval(refugoTimer); }, 1000);
        refugoUpdateTotals();
      } else refugoUpdateStartLimit();
    }
    function refugoUpdateStartLimit() {
      const el = $('refugoStartLimit'); if (!el) return;
      const type = refugoCatalog.find(row => row.id === $('refugoType')?.value);
      const available = type ? refugoRemaining(type.map_field) : null;
      const quantity = Number($('refugoStartQuantity')?.value || 0);
      el.innerHTML = available !== null && quantity > available ? '<span class="refugo-rejected">Quantidade acima do permitido para este mapa.</span>' : '';
    }
    function refugoUpdateTotals() {
      const el = $('refugoLiveTotals'); if (!el) return;
      const checked = Number($('refugoQuantity')?.value || 0);
      const rejected = [...document.querySelectorAll('[data-refugo-reason]')].reduce((n, input) => n + Number(input.value || 0), 0);
      const running = refugoItems.find(item => item.status === 'RUNNING');
      const available = running ? refugoRemaining(running.map_field) : null;
      el.innerHTML = `<span>Aferidos: ${checked}</span><span class="refugo-rejected">Refugados: ${rejected}</span><span>Aproveitados: ${Math.max(0, checked - rejected)}</span>${checked > available && available !== null ? '<span class="refugo-rejected">Quantidade acima do permitido para este mapa.</span>' : ''}${rejected > checked ? '<span class="refugo-rejected">Refugados excedem aferidos</span>' : ''}`;
    }
    async function refugoRun(work) {
      if (refugoBusy) return;
      refugoBusy = true;
      try { await work(); } catch (error) { toast(refugoError(error), 'error'); } finally { refugoBusy = false; }
    }
    async function refugoRpc(name, args) { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data; }
    function onRefugoCurrentClick(event) {
      const button = event.target.closest('[data-refugo-action]'); if (!button) return;
      const action = button.dataset.refugoAction;
      if (action === 'leave') { refugoCurrentSession = null; refugoItems = []; renderRefugoCurrent(); return; }
      if (action === 'start') return void refugoRun(async () => {
        const map = String($('refugoMap')?.value || '').trim();
        if (!/^\d{1,30}$/.test(map)) throw new Error('Informe um número de mapa válido.');
        const session = await refugoRpc('start_refugo_session_v2', { p_unit: unit(), p_map_number: map });
        refugoCurrentSession = session; refugoItems = []; renderRefugoCurrent(); await loadRefugoOpenSessions(); toast('Aferição iniciada.', 'success');
      });
      if (!refugoCurrentSession) return;
      if (action === 'start-item') return void refugoRun(async () => {
        const type = $('refugoType')?.value; if (!type) throw new Error('Selecione o tipo de vasilhame.');
        const quantity = Number($('refugoStartQuantity')?.value);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Informe a quantidade a aferir, maior que zero.');
        const typeRow = refugoCatalog.find(row => row.id === type);
        if (!typeRow?.map_field) throw new Error('Este tipo precisa ser associado à base MAPAS no cadastro do Refugo.');
        const available = refugoRemaining(typeRow?.map_field);
        if (available !== null && quantity > available) throw new Error(`A quantidade supera o permitido no mapa para ${typeRow.name}.`);
        await refugoRpc('start_refugo_item_v2', { p_session_id: refugoCurrentSession.id, p_type_id: type, p_quantity_planned: quantity });
        refugoItems = await refugoItemsFor(refugoCurrentSession.id); renderRefugoCurrent();
      });
      if (action === 'cancel-item') return void refugoRun(async () => {
        const running = refugoItems.find(x => x.status === 'RUNNING'); if (!running || !window.confirm('Cancelar a aferição deste vasilhame?')) return;
        await refugoRpc('cancel_refugo_item', { p_item_id: running.id }); refugoItems = await refugoItemsFor(refugoCurrentSession.id); renderRefugoCurrent();
      });
      if (action === 'finish-item') return void refugoRun(async () => {
        const running = refugoItems.find(x => x.status === 'RUNNING'); if (!running) return;
        const quantity = Number($('refugoQuantity')?.value);
        const inputs = [...document.querySelectorAll('[data-refugo-reason]')];
        if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Informe a quantidade aferida, maior que zero.');
        const available = refugoRemaining(running.map_field);
        if (available !== null && quantity > available) throw new Error(`A quantidade aferida supera o permitido no mapa para ${running.type_name}.`);
        if (inputs.some(input => !Number.isSafeInteger(Number(input.value)) || Number(input.value) < 0)) throw new Error('As quantidades por motivo devem ser inteiros não negativos.');
        const reasons = inputs.map(input => ({ id: input.dataset.refugoReason, quantity: Number(input.value || 0) }));
        if (reasons.reduce((n, r) => n + r.quantity, 0) > quantity) throw new Error('O total refugado não pode ser maior que a quantidade aferida.');
        await refugoRpc('finish_refugo_item', { p_item_id: running.id, p_quantity_checked: quantity, p_note: $('refugoNote')?.value || '', p_reasons: reasons });
        refugoItems = await refugoItemsFor(refugoCurrentSession.id); renderRefugoCurrent(); toast('Vasilhame salvo.', 'success');
      });
      if (action === 'complete') return void refugoRun(async () => {
        if (!window.confirm(`Finalizar o mapa ${refugoCurrentSession.map_number}?`)) return;
        const session = await refugoRpc('complete_refugo_session', { p_session_id: refugoCurrentSession.id });
        refugoCurrentSession = null; refugoItems = []; renderRefugoCurrent(); await loadRefugoOpenSessions();
        if (hasPerm('REFUGO_HISTORICO')) { await loadRefugoHistory(); await openRefugoHistory(session); }
        toast('Mapa finalizado. O CSV está disponível no histórico.', 'success');
      });
      if (action === 'cancel-session') return void refugoRun(async () => {
        if (!window.confirm(`Cancelar o mapa ${refugoCurrentSession.map_number}? Os vasilhames já salvos permanecerão no histórico.`)) return;
        await refugoRpc('cancel_refugo_session', { p_session_id: refugoCurrentSession.id });
        refugoCurrentSession = null; refugoItems = []; renderRefugoCurrent(); await loadRefugoOpenSessions(); toast('Mapa cancelado.', 'success');
      });
    }
    async function loadRefugoView(name) {
      if (!context().client || !unit()) return;
      if (name === 'refugo-afericao') {
        await loadRefugoCatalog();
        await loadRefugoOpenSessions();
        if (refugoCurrentSession?.unit === unit()) { refugoItems = await refugoItemsFor(refugoCurrentSession.id); renderRefugoCurrent(); }
        else renderRefugoCurrent();
      }
      if (name === 'refugo-historico') await loadRefugoHistory();
      if (name === 'refugo-cadastros') { await loadRefugoCatalog(); renderRefugoCatalog(); }
    }
    async function loadRefugoHistory() {
      const day = $('refugoHistoryDate'); if (day && !day.value) day.value = localIsoDate(new Date());
      refugoHistory = await refugoFetchAll(() => sb.from('refugo_sessions').select('*').eq('unit', unit()).order('started_at', { ascending: false }).order('id', { ascending: false }));
      renderRefugoHistory();
    }
    function renderRefugoHistory() {
      const tbody = $('refugoHistoryRows'); if (!tbody) return;
      const q = norm($('refugoHistorySearch')?.value || '');
      const rows = refugoHistory.filter(s => !q || norm(`${s.map_number} ${s.created_by_name}`).includes(q));
      tbody.innerHTML = rows.length ? rows.map(s => `<tr><td><strong>${esc(s.map_number)}</strong><small>${esc(s.unit)}</small></td><td>${esc(fmtDateTime(s.started_at))}</td><td>${esc(s.created_by_name)}</td><td>${s.status === 'COMPLETED' ? 'Finalizada' : s.status === 'OPEN' ? 'Em andamento' : 'Cancelada'}</td><td><div class="refugo-inline-actions"><button type="button" class="mini-btn" data-refugo-view="${esc(s.id)}">Detalhes</button><button type="button" class="mini-btn" data-refugo-csv="${esc(s.id)}">Baixar CSV</button></div></td></tr>`).join('') : '<tr><td colspan="5">Nenhuma aferição encontrada.</td></tr>';
    }
    async function openRefugoHistory(session) {
      const items = await refugoItemsFor(session.id);
      const completed = items.filter(x => x.status === 'COMPLETED');
      const checked = completed.reduce((n, x) => n + Number(x.quantity_checked || 0), 0);
      const rejected = completed.reduce((n, x) => n + Number(x.quantity_rejected || 0), 0);
      const body = `<div class="refugo-history-detail"><div class="refugo-count-summary">${completed.length} vasilhame${completed.length === 1 ? '' : 's'} · ${checked} aferidos · ${rejected} refugados · ${checked - rejected} aproveitados</div><div class="detail-grid"><div class="detail-card"><small>Unidade</small><strong>${esc(session.unit)}</strong></div><div class="detail-card"><small>Aferido por</small><strong>${esc(session.created_by_name)}</strong></div><div class="detail-card"><small>Início</small><strong>${esc(fmtDateTime(session.started_at))}</strong></div><div class="detail-card"><small>Fim</small><strong>${session.completed_at || session.cancelled_at ? esc(fmtDateTime(session.completed_at || session.cancelled_at)) : 'Em andamento'}</strong></div></div>${completed.map(x => `<div class="refugo-item-card"><strong>${esc(x.type_name)}</strong><small>${esc(fmtDateTime(x.started_at))} → ${esc(fmtDateTime(x.ended_at))} · ${refugoDuration(x.started_at, x.ended_at)}</small><p>Aferidos: ${Number(x.quantity_checked)} · Refugados: ${Number(x.quantity_rejected)} · Aproveitados: ${Number(x.quantity_checked) - Number(x.quantity_rejected)}</p><p>${(x.refugo_item_reasons || []).map(r => `${esc(r.reason_name)}: ${Number(r.quantity)}`).join(' · ') || 'Sem refugo'}</p><p>${esc(x.note || 'Sem observação')}</p></div>`).join('') || '<div class="refugo-empty">Nenhum vasilhame concluído.</div>'}</div>`;
      openModal(`Refugo · Mapa ${session.map_number}`, `${session.unit} · ${session.created_by_name}`, body, [{ label: 'Baixar CSV', class: 'primary', onClick: () => void refugoRun(() => downloadRefugoCsv(session, completed)) }, { label: 'Fechar', class: 'secondary', onClick: closeModal }]);
    }
    function refugoCsvText(value) { const text = String(value ?? ''); return /^[\s\t\r\n]*[=+@-]/.test(text) ? `'${text}` : text; }
    async function saveCsvDocument(name, matrix, title = 'Aferição de Refugo') {
      if (!isNativeCapacitor()) { downloadCsv(name, matrix); return; }
      const cap = window.Capacitor;
      const files = cap.Plugins?.Filesystem || cap.registerPlugin?.('Filesystem');
      const share = cap.Plugins?.Share || cap.registerPlugin?.('Share');
      if (!files || !share) throw new Error('Atualize o APK para salvar ou compartilhar o CSV.');
      const csv = '\uFEFF' + matrix.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('Não foi possível preparar o CSV para salvar.'));
        reader.readAsDataURL(blob);
      });
      const saved = await files.writeFile({ path: name, data, directory: 'CACHE' });
      await share.share({ title: `${title} ${name}`, url: saved.uri, dialogTitle: 'Salvar ou compartilhar CSV' });
    }
    function refugoCsvMatrix(entries) {
      const reasons = [...new Set(entries.flatMap(({ item }) => (item.refugo_item_reasons || []).map(r => r.reason_name)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const headers = ['Unidade', 'Mapa', 'Situação', 'Aferido por', 'Início do mapa', 'Fim do mapa', 'Tipo de vasilhame', 'Início do item', 'Fim do item', 'Duração', 'Quantidade aferida', 'Quantidade refugada', 'Quantidade aproveitada', ...reasons.map(r => `Motivo: ${r}`), 'Observação'];
      const rows = entries.map(({ session, item }) => {
        const byReason = new Map((item.refugo_item_reasons || []).map(r => [r.reason_name, Number(r.quantity)]));
        return [session.unit, session.map_number, session.status, session.created_by_name, fmtDateTime(session.started_at), session.completed_at || session.cancelled_at ? fmtDateTime(session.completed_at || session.cancelled_at) : '', item.type_name, fmtDateTime(item.started_at), fmtDateTime(item.ended_at), refugoDuration(item.started_at, item.ended_at), Number(item.quantity_checked), Number(item.quantity_rejected), Number(item.quantity_checked) - Number(item.quantity_rejected), ...reasons.map(r => byReason.get(r) || 0), item.note].map(refugoCsvText);
      });
      return [headers.map(refugoCsvText), ...rows];
    }
    async function downloadRefugoCsv(session, items) {
      await saveCsvDocument(`refugo_mapa_${session.map_number}_${localIsoDate(new Date(session.started_at))}.csv`, refugoCsvMatrix(items.map(item => ({ session, item }))));
    }
    async function downloadRefugoDailyCsv(day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Selecione a data da aferição.');
      const sessions = refugoHistory.filter(session => localIsoDate(new Date(session.started_at)) === day);
      if (!sessions.length) throw new Error('Não há mapas iniciados nessa data nesta unidade.');
      const bySession = new Map(sessions.map(session => [session.id, session]));
      const entries = [];
      for (let index = 0; index < sessions.length; index += 100) {
        const ids = sessions.slice(index, index + 100).map(session => session.id);
        const items = await refugoFetchAll(() => sb.from('refugo_items').select('*,refugo_item_reasons(reason_id,reason_name,quantity)').in('session_id', ids).eq('status', 'COMPLETED').order('started_at').order('id'));
        for (const item of items) { const session = bySession.get(item.session_id); if (session) entries.push({ session, item }); }
      }
      if (!entries.length) throw new Error('Não há vasilhames concluídos nessa data nesta unidade.');
      entries.sort((a, b) => a.item.started_at.localeCompare(b.item.started_at) || String(a.item.id).localeCompare(String(b.item.id)));
      const unitName = norm(unit()).replace(/[^a-z0-9]+/g, '_');
      await saveCsvDocument(`refugo_dia_${day}_${unitName}.csv`, refugoCsvMatrix(entries));
    }
    function renderRefugoCatalog() {
      const box = $('refugoCatalogRows'); if (!box) return;
      box.innerHTML = Object.entries(REFUGO_KIND_LABEL).map(([kind, label]) => {
        const rows = refugoCatalogFor(kind, false);
        return `<div><h3 class="refugo-catalog-group">${label}</h3>${rows.length ? rows.map(row => `<div class="refugo-catalog-card"><div><strong>${esc(row.name)}</strong><small>${kind === 'TYPE' ? (row.map_field ? `Base MAPAS: ${esc(REFUGO_MAP_FIELDS[row.map_field] || row.map_field)}` : 'Associe este tipo à base MAPAS para aferir') : 'Todas as unidades'}</small></div><div class="refugo-inline-actions"><span class="refugo-pill ${row.active ? '' : 'inactive'}">${row.active ? 'Ativo' : 'Inativo'}</span><button type="button" class="mini-btn" data-refugo-edit="${esc(row.id)}">Editar</button></div></div>`).join('') : '<div class="refugo-empty">Nenhum cadastro.</div>'}</div>`;
      }).join('');
    }
    function refugoClearCatalog() {
      $('refugoCatalogId').value = ''; $('refugoCatalogName').value = ''; $('refugoCatalogActive').value = 'true'; $('refugoMapField').value = '';
      refugoToggleMapField();
    }
    function refugoToggleMapField() {
      const isType = $('refugoCatalogKind').value === 'TYPE';
      $('refugoMapFieldWrap').classList.toggle('hidden', !isType);
      $('refugoMapField').required = isType;
    }
    async function refugoSaveCatalog(event) {
      event.preventDefault();
      return refugoRun(async () => {
        const kind = $('refugoCatalogKind').value, name = $('refugoCatalogName').value.trim();
        if (!name) throw new Error('Informe o nome.');
        const field = kind === 'TYPE' ? $('refugoMapField').value : null;
        if (kind === 'TYPE' && !field) throw new Error('Associe o tipo de vasilhame a uma coluna da base MAPAS.');
        await refugoRpc('save_refugo_catalog_v2', { p_id: $('refugoCatalogId').value || null, p_kind: kind, p_name: name, p_active: $('refugoCatalogActive').value === 'true', p_map_field: field });
        refugoClearCatalog(); await loadRefugoCatalog(); toast('Cadastro salvo.', 'success');
      });
    }
    function bind() {
      if (refugoEventsBound || !$('refugoCurrent')) return;
      refugoEventsBound = true;
      $('refugoCurrent').addEventListener('click', onRefugoCurrentClick);
      $('refugoCurrent').addEventListener('input', event => { if (event.target.id === 'refugoQuantity' || event.target.hasAttribute('data-refugo-reason')) refugoUpdateTotals(); if (event.target.id === 'refugoStartQuantity') refugoUpdateStartLimit(); });
      $('refugoCurrent').addEventListener('change', event => { if (event.target.id === 'refugoType') refugoUpdateStartLimit(); });
      $('refugoOpenSessions').addEventListener('click', event => { const button = event.target.closest('[data-refugo-resume]'); if (!button) return; const session = refugoSessions.find(s => s.id === button.dataset.refugoResume); if (session) void refugoRun(() => refugoResume(session)); });
      $('refugoRefresh').addEventListener('click', () => void enter('refugo-afericao'));
      $('refugoHistoryRefresh').addEventListener('click', () => void enter('refugo-historico'));
      $('refugoHistorySearch').addEventListener('input', renderRefugoHistory);
      $('refugoDailyCsv').addEventListener('click', () => void refugoRun(() => downloadRefugoDailyCsv($('refugoHistoryDate')?.value || '')));
      $('refugoHistoryRows').addEventListener('click', event => {
        const view = event.target.closest('[data-refugo-view]'), csv = event.target.closest('[data-refugo-csv]'), id = view?.dataset.refugoView || csv?.dataset.refugoCsv;
        if (!id) return;
        const session = refugoHistory.find(s => s.id === id); if (!session) return;
        void refugoRun(async () => { if (view) await openRefugoHistory(session); else await downloadRefugoCsv(session, (await refugoItemsFor(id)).filter(x => x.status === 'COMPLETED')); });
      });
      $('refugoCatalogForm').addEventListener('submit', refugoSaveCatalog);
      $('refugoCatalogClear').addEventListener('click', refugoClearCatalog);
      $('refugoCatalogKind').addEventListener('change', refugoClearCatalog);
      refugoToggleMapField();
      $('refugoCatalogRefresh').addEventListener('click', () => void enter('refugo-cadastros'));
      $('refugoCatalogRows').addEventListener('click', event => {
        const button = event.target.closest('[data-refugo-edit]'); if (!button) return;
        const row = refugoCatalog.find(x => x.id === button.dataset.refugoEdit); if (!row) return;
        $('refugoCatalogId').value = row.id; $('refugoCatalogKind').value = row.kind; $('refugoCatalogName').value = row.name; $('refugoCatalogActive').value = String(row.active); $('refugoMapField').value = row.map_field || '';
        refugoToggleMapField(); $('refugoCatalogForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    async function enter(name) {
      try { await loadRefugoView(name); } catch (error) { toast(refugoError(error), 'error'); }
    }
    function reset() {
      refugoCurrentSession = null; refugoItems = []; refugoSessions = []; refugoHistory = [];
      clearInterval(refugoTimer); refugoTimer = null;
    }

    return { bind, enter, reset };
  }

  return { create };
});
