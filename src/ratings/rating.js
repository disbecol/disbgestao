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
  const SHEET_IDS = { 'Matriz Caicó': 1949652663, 'Filial Pau dos Ferros': 1042578215 };
  const HEADERS = {
    date: ['data da avaliacao', 'data avaliacao'],
    code: ['codigo do pdv', 'cod pdv'],
    name: ['nome pdv'], city: ['cidade'], driver: ['motorista'],
    motive: ['motivo'], sourceComment: ['comentario']
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

  function parseSheet(values) {
    const normalize = value => searchKey(value).replace(/[^a-z0-9]+/g, ' ').trim();
    const headers = (values[0] || []).map(normalize);
    const columns = {};
    for (const [field, names] of Object.entries(HEADERS)) {
      const matches = headers.flatMap((header, index) => names.includes(header) ? [index] : []);
      if (matches.length !== 1) throw new Error('Confira os cabeçalhos da primeira linha da aba de Rating.');
      columns[field] = matches[0];
    }
    const result = values.slice(1).flatMap((cells, index) => {
      const value = field => clean(cells[columns[field]]);
      const rawDate = cells[columns.date];
      const date = typeof rawDate === 'number' && Number.isFinite(rawDate)
        ? new Date(Date.UTC(1899, 11, 30) + Math.floor(rawDate) * 86400000).toISOString().slice(0, 10)
        : value('date');
      const code = value('code');
      const name = value('name');
      if (!date && !code && !name) return [];
      return [{ rowNumber: index + 2, date, code, name, city: value('city'), driver: value('driver'),
        motive: value('motive'), sourceComment: value('sourceComment'),
        rowKey: date && code ? JSON.stringify([String(rawDate), code]) : '', comment: '', revision: 0 }];
    });
    const counts = new Map();
    for (const row of result) if (row.rowKey) counts.set(row.rowKey, (counts.get(row.rowKey) || 0) + 1);
    for (const row of result) row.ambiguous = !row.rowKey || counts.get(row.rowKey) > 1;
    return result;
  }

  function filterDate(value) {
    const text = clean(value);
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D.*)?$/.exec(text);
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:\D.*)?$/.exec(text);
    const parts = br ? [br[3], br[2].padStart(2, '0'), br[1].padStart(2, '0')] : iso?.slice(1);
    if (!parts) return '';
    const result = parts.join('-');
    const parsed = new Date(`${result}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : '';
  }

  function filterRows(rows, query, filters = {}) {
    const term = searchKey(query);
    const words = term ? term.split(' ') : [];
    return rows.filter(row => {
      const date = filterDate(row.date);
      return (!(filters.from || filters.to) || !!date)
        && (!filters.from || date >= filters.from)
        && (!filters.to || date <= filters.to)
        && ['city', 'driver', 'motive'].every(field => !filters[field] || searchKey(row[field]) === filters[field])
        && words.every(word => searchKey([
          row.date, row.code, row.name, row.city, row.driver, row.motive, row.sourceComment, row.comment
        ].join(' ')).includes(word));
    });
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
    const filters = { from: '', to: '', city: '', driver: '', motive: '' };
    const filterControls = { from: 'ratingFrom', to: 'ratingTo', city: 'ratingCity', driver: 'ratingDriver', motive: 'ratingMotive' };

    function renderFilters() {
      for (const [field, id] of Object.entries(filterControls)) {
        const control = $(id);
        if (!control) continue;
        control.disabled = editingRow !== null;
        if (['city', 'driver', 'motive'].includes(field)) {
          const options = new Map();
          for (const row of rows) {
            const label = clean(row[field]), key = searchKey(label);
            if (key && !options.has(key)) options.set(key, label);
          }
          if (filters[field] && !options.has(filters[field])) filters[field] = '';
          control.innerHTML = `<option value="" ${filters[field] ? '' : 'selected'}>Todos</option>` + [...options]
            .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
            .map(([value, label]) => `<option value="${adapter.escapeHtml(value)}" ${value === filters[field] ? 'selected' : ''}>${adapter.escapeHtml(label)}</option>`).join('');
        } else {
          control.value = filters[field];
        }
      }
      if ($('ratingSearch')) $('ratingSearch').disabled = editingRow !== null;
      if ($('ratingClearFilters')) $('ratingClearFilters').disabled = editingRow !== null;
      if ($('ratingFilterError')) $('ratingFilterError').textContent =
        filters.from && filters.to && filters.from > filters.to ? 'A data inicial deve ser anterior ou igual à data final.' : '';
    }

    function availableUnits() {
      return UNITS.filter(name => context().units?.includes(name));
    }

    function render() {
      const tabs = $('ratingUnitTabs');
      const body = $('ratingRows');
      const status = $('ratingStatus');
      const search = $('ratingSearch')?.value || '';
      if (!tabs || !body || !status) return;

      renderFilters();
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
      $('btnRatingRefresh').disabled = loading || editingRow !== null;
      $('btnRatingRefresh').textContent = loading ? 'Atualizando…' : 'Atualizar';

      if (!units.length) {
        status.textContent = '';
        body.innerHTML = '<tr><td colspan="8">Seu usuário não tem unidade Matriz ou Filial vinculada.</td></tr>';
        return;
      }
      if (loading && !rows.length) {
        status.textContent = 'Carregando avaliações…';
        body.innerHTML = '<tr><td colspan="8">Consultando a planilha…</td></tr>';
        return;
      }
      const filtered = filters.from && filters.to && filters.from > filters.to ? [] : filterRows(rows, search, filters);
      status.textContent = `${filtered.length} de ${rows.length} ${rows.length === 1 ? 'avaliação' : 'avaliações'}`;
      if (error && !rows.length) {
        body.innerHTML = '<tr><td colspan="8">Não foi possível carregar as avaliações.</td></tr>';
        return;
      }
      if (!filtered.length) {
        body.innerHTML = `<tr><td colspan="8">${rows.length ? 'Nenhum resultado para os filtros.' : 'Nenhuma avaliação encontrada nesta planilha.'}</td></tr>`;
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
          <td><div class="rating-comment">${adapter.escapeHtml(row.sourceComment || '—')}</div></td>
          <td><div class="rating-comment">${row.ambiguous ? '<span class="rating-empty">Data e código ausentes ou duplicados na planilha. Corrija a base para registrar a tratativa.</span>' : comment || '<span class="rating-empty">Sem tratativa</span>'}</div>
            ${canEdit && !row.ambiguous ? `<button type="button" class="mini-btn rating-edit" data-rating-edit="${key}" ${editingRow !== null && editingRow !== key ? 'disabled' : ''}>Editar</button>
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

    async function loadComments(selectedUnit) {
      const client = context().client;
      if (!client?.from) throw new Error('A conexão com o sistema não está disponível.');
      const result = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.from('rating_comments').select('row_key,comment,revision')
          .eq('unit', selectedUnit).order('row_key').range(offset, offset + 999);
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error('A consulta de tratativas retornou dados inválidos.');
        result.push(...data);
        if (data.length < 1000) return result;
      }
    }

    async function loadSheet(selectedUnit) {
      const google = globalThis.DISB_RETURNS_GOOGLE;
      if (!google?.readResponse || !google.SPREADSHEET) throw new Error('A integração de leitura do Google não está disponível.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await (adapter.fetch || globalThis.fetch)(`https://docs.google.com/spreadsheets/d/${google.SPREADSHEET}/gviz/tq?tqx=out:json&gid=${SHEET_IDS[selectedUnit]}&headers=1`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`Não foi possível ler a planilha de Rating (${response.status}).`);
        const text = await response.text();
        if (text.length > 40 * 1024 * 1024) throw new Error('A planilha de Rating ultrapassa 40 MB.');
        return parseSheet(google.readResponse(text));
      } catch (e) {
        if (e?.name === 'AbortError') throw new Error('A leitura da planilha demorou mais de 20 segundos.');
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }

    function errorMessage(e) {
      const message = String(e?.message || e);
      if (/RATING_VERSION_CONFLICT/.test(message)) return 'Outra pessoa alterou esta tratativa. Copie seu texto, cancele a edição e atualize antes de salvar.';
      if (/PGRST205|PGRST202|42P01|42883|rating_comments|rating_save_comment/i.test(message)) return 'As tratativas de Rating aguardam a aplicação da migração do banco de dados.';
      if (/FORBIDDEN|42501/.test(message)) return 'Seu usuário não tem permissão para esta operação ou unidade.';
      if (/Failed to fetch|NetworkError/i.test(message)) return 'Não foi possível conectar ao Google ou ao sistema. Verifique a conexão e tente novamente.';
      return message;
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
        filters.city = filters.driver = filters.motive = '';
        editingRow = null;
        savingRow = null;
        drafts.clear();
      }
      unit = selectedUnit;
      loading = true;
      error = '';
      render();
      try {
        const [sheetRows, comments] = await Promise.all([loadSheet(selectedUnit), loadComments(selectedUnit)]);
        if (requestId !== loadId) return;
        const byKey = new Map(comments.map(item => [item.row_key, item]));
        rows = sheetRows.map(row => {
          const saved = !row.ambiguous && byKey.get(row.rowKey);
          return saved ? { ...row, comment: saved.comment, revision: saved.revision } : row;
        });
      } catch (e) {
        if (requestId === loadId) {
          error = errorMessage(e);
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
      if (!row || row.ambiguous || !textarea || savingRow !== null) return;
      const comment = textarea.value.trim();
      const requestId = loadId;
      const selectedUnit = unit;
      drafts.set(rowNumber, comment);
      savingRow = rowNumber;
      error = '';
      render();
      try {
        const { data: result, error: saveError } = await context().client.rpc('rating_save_comment', {
          p_unit: selectedUnit, p_row_key: row.rowKey, p_revision: row.revision, p_comment: comment
        });
        if (saveError) throw saveError;
        if (requestId !== loadId) return;
        if (!result || typeof result.comment !== 'string' || !Number.isInteger(result.revision)) throw new Error('O sistema não confirmou a gravação da tratativa.');
        row.comment = result.comment;
        row.revision = result.revision;
        drafts.delete(rowNumber);
        editingRow = null;
        savingRow = null;
        adapter.toast('Tratativa salva no sistema.', 'success');
      } catch (e) {
        if (requestId !== loadId) return;
        savingRow = null;
        error = errorMessage(e);
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
      for (const [field, id] of Object.entries(filterControls)) {
        $(id)?.addEventListener('change', event => {
          filters[field] = event.target.value;
          render();
        });
      }
      $('ratingClearFilters')?.addEventListener('click', () => {
        for (const field of Object.keys(filters)) filters[field] = '';
        if ($('ratingSearch')) $('ratingSearch').value = '';
        render();
      });
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
      for (const field of Object.keys(filters)) filters[field] = '';
      if ($('ratingSearch')) $('ratingSearch').value = '';
      render();
    }

    return { bind, enter, load, render, reset };
  }

  return { UNITS, clean, formatDate, filterRows, parseSheet, create };
});
