(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DISB_RATING = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const UNITS = ['Matriz Caicó', 'Filial Pau dos Ferros'];
  const SHEET_URLS = {
    'Matriz Caicó': 'https://docs.google.com/spreadsheets/d/1hYle_7TyEitARZOYgYPoO5hUcxHsj0xxhTP7YCccGTM/edit?gid=1949652663#gid=1949652663',
    'Filial Pau dos Ferros': 'https://docs.google.com/spreadsheets/d/1hYle_7TyEitARZOYgYPoO5hUcxHsj0xxhTP7YCccGTM/edit?gid=1042578215#gid=1042578215'
  };
  const clean = value => String(value ?? '').trim();
  const searchKey = value => clean(value).normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');

  function formatDate(value) {
    const text = clean(value);
    if (!text) return '—';
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
    if (br) return `${br[1].padStart(2, '0')}/${br[2].padStart(2, '0')}/${br[3]}`;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    return text;
  }

  function filterRows(rows, query) {
    const term = searchKey(query);
    if (!term) return rows;
    const words = term.split(' ');
    return rows.filter(row => words.every(word => searchKey([
      row.date, row.code, row.name, row.city, row.driver, row.motive, row.comment
    ].join(' ')).includes(word)));
  }

  function create(adapter) {
    const $ = adapter.getElement;
    const context = () => adapter.context();
    let rows = [];
    let unit = '';
    let loading = false;
    let editingRow = null;
    let savingRow = null;
    const drafts = new Map();
    let error = '';
    let loadId = 0;

    function availableUnits() {
      return UNITS.filter(name => context().units?.includes(name));
    }

    function render() {
      const tabs = $('ratingUnitTabs');
      const body = $('ratingRows');
      const status = $('ratingStatus');
      const search = $('ratingSearch')?.value || '';
      if (!tabs || !body || !status) return;

      const units = availableUnits();
      tabs.innerHTML = units.map(name => `<button type="button" class="rating-unit-tab ${name === unit ? 'active' : ''}" data-rating-unit="${adapter.escapeHtml(name)}" aria-pressed="${name === unit}" ${editingRow !== null ? 'disabled' : ''}>${adapter.escapeHtml(name)}</button>`).join('');
      $('ratingUnitLabel').textContent = unit || '—';
      const sheetLink = $('ratingSheetLink');
      if (sheetLink) {
        sheetLink.hidden = !SHEET_URLS[unit];
        if (SHEET_URLS[unit]) sheetLink.href = SHEET_URLS[unit];
        else sheetLink.removeAttribute('href');
      }
      $('ratingAlert')?.classList.toggle('hidden', !error);
      if ($('ratingAlert')) $('ratingAlert').textContent = error;
      $('btnRatingRefresh').disabled = loading;
      $('btnRatingRefresh').textContent = loading ? 'Atualizando…' : 'Atualizar';

      if (!units.length) {
        status.textContent = '';
        body.innerHTML = '<tr><td colspan="7">Seu usuário não tem unidade Matriz ou Filial vinculada.</td></tr>';
        return;
      }
      if (loading && !rows.length) {
        status.textContent = 'Carregando avaliações…';
        body.innerHTML = '<tr><td colspan="7">Consultando a planilha…</td></tr>';
        return;
      }
      const filtered = filterRows(rows, search);
      status.textContent = `${filtered.length} de ${rows.length} ${rows.length === 1 ? 'avaliação' : 'avaliações'}`;
      if (error && !rows.length) {
        body.innerHTML = '<tr><td colspan="7">Não foi possível carregar as avaliações.</td></tr>';
        return;
      }
      if (!filtered.length) {
        body.innerHTML = `<tr><td colspan="7">${rows.length ? 'Nenhum resultado para a busca.' : 'Nenhuma avaliação encontrada nesta planilha.'}</td></tr>`;
        return;
      }
      const canEdit = context().hasPermission('RATING_EDIT');
      body.innerHTML = filtered.map(row => {
        const key = Number(row.rowNumber);
        const editorHidden = editingRow !== key ? 'hidden' : '';
        const comment = adapter.escapeHtml(drafts.has(key) ? drafts.get(key) : row.comment || '');
        return `<tr>
          <td>${adapter.escapeHtml(formatDate(row.date))}</td>
          <td>${adapter.escapeHtml(row.code || '—')}</td>
          <td>${adapter.escapeHtml(row.name || '—')}</td>
          <td>${adapter.escapeHtml(row.city || '—')}</td>
          <td>${adapter.escapeHtml(row.driver || '—')}</td>
          <td>${adapter.escapeHtml(row.motive || '—')}</td>
          <td><div class="rating-comment">${comment || '<span class="rating-empty">Sem comentário</span>'}</div>
            ${canEdit ? `<button type="button" class="mini-btn rating-edit" data-rating-edit="${key}">Editar</button>
              <div class="rating-editor ${editorHidden}" data-rating-editor="${key}">
                <textarea maxlength="5000" aria-label="Tratativa ou comentário para ${adapter.escapeHtml(row.name || row.code || 'cliente')}" ${savingRow === key ? 'disabled' : ''}>${comment}</textarea>
                <div class="rating-editor-actions">
                  <button type="button" class="mini-btn primary" data-rating-save="${key}" ${savingRow === key ? 'disabled' : ''}>${savingRow === key ? 'Salvando…' : 'Salvar'}</button>
                  <button type="button" class="mini-btn" data-rating-cancel="${key}" ${savingRow === key ? 'disabled' : ''}>Cancelar</button>
                </div>
              </div>` : ''}
          </td>
        </tr>`;
      }).join('');
    }

    async function request(action, payload) {
      const client = context().client;
      if (!client?.functions?.invoke) throw new Error('A conexão com o sistema não está disponível.');
      const { data, error: invokeError } = await client.functions.invoke('rating-google', {
        body: { action, ...payload }
      });
      const errorCode = data?.error || (invokeError?.context?.clone ? (await invokeError.context.clone().json().catch(() => ({})))?.error : '');
      const messages = {
        FORBIDDEN: 'Seu usuário não tem permissão para esta operação.',
        UNIT_FORBIDDEN: 'Seu usuário não tem acesso a esta unidade.',
        ROW_CHANGED: 'A linha da planilha mudou desde a consulta. Atualize a tela e tente novamente.',
        RATING_BRIDGE_NOT_CONFIGURED: 'A integração da planilha ainda precisa ser configurada pelo administrador.',
        RATING_SHEET_TIMEOUT: 'A planilha demorou mais que o esperado. Tente novamente.',
        RATING_SHEET_UNAVAILABLE: 'Não foi possível acessar a planilha. Tente novamente.',
        INVALID_HEADERS: 'Confira os cabeçalhos da primeira linha das abas de Rating.',
        SHEET_NOT_FOUND: 'Não foi encontrada a aba de Rating configurada na planilha.'
      };
      if (invokeError || !data || data.ok !== true) {
        if (!errorCode && (invokeError?.name === 'FunctionsFetchError' || invokeError?.context?.status === 404)) {
          throw new Error('Não foi possível conectar à integração de Rating. Verifique a conexão ou peça ao administrador para implantar a função rating-google.');
        }
        throw new Error(messages[errorCode] || errorCode || invokeError?.message || 'Não foi possível concluir a operação.');
      }
      return data;
    }

    async function load(selectedUnit = unit) {
      if (!availableUnits().includes(selectedUnit)) {
        unit = availableUnits()[0] || '';
        rows = [];
        render();
        return;
      }
      const requestId = ++loadId;
      if (unit !== selectedUnit) {
        rows = [];
        editingRow = null;
        savingRow = null;
        drafts.clear();
      }
      unit = selectedUnit;
      loading = true;
      error = '';
      render();
      try {
        const result = await request('list', { unit });
        if (requestId !== loadId) return;
        if (!Array.isArray(result.rows)) throw new Error('A integração retornou uma lista inválida.');
        rows = result.rows;
      } catch (e) {
        if (requestId === loadId) {
          error = String(e?.message || e);
          adapter.toast(error, 'error');
        }
      } finally {
        if (requestId === loadId) {
          loading = false;
          render();
        }
      }
    }

    async function save(rowNumber) {
      const row = rows.find(item => Number(item.rowNumber) === rowNumber);
      const editor = adapter.document.querySelector(`[data-rating-editor="${rowNumber}"]`);
      const textarea = editor?.querySelector('textarea');
      if (!row || !textarea || savingRow !== null) return;
      const comment = textarea.value.trim();
      drafts.set(rowNumber, comment);
      savingRow = rowNumber;
      error = '';
      render();
      try {
        const result = await request('save', {
          unit,
          rowNumber,
          expected: { fingerprint: row.fingerprint },
          comment
        });
        if (!/^[0-9a-f]{64}$/.test(result.fingerprint || '')) throw new Error('A integração não confirmou a atualização da linha.');
        row.comment = result.comment;
        row.fingerprint = result.fingerprint;
        drafts.delete(rowNumber);
        editingRow = null;
        savingRow = null;
        adapter.toast('Tratativa/comentário salvo na planilha.', 'success');
      } catch (e) {
        savingRow = null;
        error = String(e?.message || e);
        adapter.toast(error, 'error');
      }
      render();
    }

    function bind() {
      $('ratingUnitTabs')?.addEventListener('click', event => {
        const button = event.target.closest('[data-rating-unit]');
        if (button && availableUnits().includes(button.dataset.ratingUnit)) void load(button.dataset.ratingUnit);
      });
      $('ratingSearch')?.addEventListener('input', render);
      $('btnRatingRefresh')?.addEventListener('click', () => void load(unit));
      $('ratingRows')?.addEventListener('input', event => {
        const editor = event.target.closest('[data-rating-editor]');
        if (editor && event.target.matches('textarea')) drafts.set(Number(editor.dataset.ratingEditor), event.target.value);
      });
      $('ratingRows')?.addEventListener('click', event => {
        const edit = event.target.closest('[data-rating-edit]');
        const cancel = event.target.closest('[data-rating-cancel]');
        const saveButton = event.target.closest('[data-rating-save]');
        if (edit) {
          editingRow = Number(edit.dataset.ratingEdit);
          if (!drafts.has(editingRow)) drafts.set(editingRow, rows.find(item => Number(item.rowNumber) === editingRow)?.comment || '');
          render();
          $('ratingRows')?.querySelector(`[data-rating-editor="${editingRow}"] textarea`)?.focus();
        } else if (cancel) {
          drafts.delete(Number(cancel.dataset.ratingCancel));
          editingRow = null;
          savingRow = null;
          render();
        } else if (saveButton) {
          void save(Number(saveButton.dataset.ratingSave));
        }
      });
    }

    function enter() {
      const units = availableUnits();
      if (!units.length) {
        render();
        return;
      }
      const selected = units.includes(context().activeUnit) ? context().activeUnit : units[0];
      void load(selected);
    }

    function reset() {
      loadId++;
      rows = [];
      unit = '';
      loading = false;
      editingRow = null;
      savingRow = null;
      drafts.clear();
      error = '';
      render();
    }

    return { bind, enter, load, render, reset };
  }

  return { UNITS, clean, formatDate, filterRows, create };
});
