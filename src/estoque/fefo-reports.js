(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DISB_FEFO_REPORTS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function create(adapter) {
    const $ = adapter.getElement;
    const reports = () => adapter.getReports();
    const itemsByCount = () => adapter.getItemsByCount();

    async function load(silent = false) {
      if (!adapter.hasPermission('FEFO_REPORT') || !adapter.getClient()) return;
      try {
        const rows = await adapter.fetchCounts('COMPLETED');
        adapter.setReports(rows);
        const items = await adapter.fetchItemsForCounts(rows.map(x => x.id));
        adapter.rememberItems(items, rows.map(x => x.id));
        render();
      } catch (error) {
        if (!silent) adapter.toast(adapter.humanError(error), 'error');
      }
    }

    function filtered() {
      const q = String($('fefoReportSearch')?.value || '').trim().toLowerCase();
      const unit = $('fefoReportUnit')?.value || '', from = $('fefoReportFrom')?.value || '', to = $('fefoReportTo')?.value || '';
      return reports().filter(c => {
        const at = String(c.completed_at || c.started_at || '').slice(0, 10), items = itemsByCount().get(c.id) || [];
        if (unit && c.unit !== unit) return false;
        if (from && at < from) return false;
        if (to && at > to) return false;
        if (q) {
          const hay = [c.count_code, c.unit, c.counter_name, c.counter_username, ...items.flatMap(i => [i.product_code, i.product_name, i.lot, i.street, adapter.formatDate(i.validity_date)])].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    }

    function render() {
      if (!$('tbodyFefoReports')) return;
      const rows = filtered();
      $('tbodyFefoReports').innerHTML = rows.length ? rows.map(c => {
        const items = itemsByCount().get(c.id) || [], earliest = items.map(x => x.validity_date).filter(Boolean).sort()[0];
        return `<tr><td><strong>${adapter.escapeHtml(c.count_code)}</strong></td><td>${adapter.escapeHtml(c.unit)}</td><td>${adapter.escapeHtml(c.counter_name)}</td><td>${adapter.formatDateTime(c.started_at)}</td><td>${adapter.formatDateTime(c.completed_at)}</td><td>${items.length}</td><td>${earliest ? adapter.formatDate(earliest) : '—'}</td><td><div class="mini-actions"><button class="mini-btn" data-fefo-report="${c.id}">Visualizar</button><button class="mini-btn" data-fefo-csv="${c.id}">CSV</button></div></td></tr>`;
      }).join('') : '<tr><td colspan="8">Nenhum relatório encontrado.</td></tr>';
    }

    function onClick(event) {
      const detail = event.target.closest('[data-fefo-report]');
      if (detail) return open(detail.dataset.fefoReport);
      const csv = event.target.closest('[data-fefo-csv]');
      if (csv) {
        const count = reports().find(x => x.id === csv.dataset.fefoCsv);
        if (count) downloadCsv(count, itemsByCount().get(count.id) || []);
      }
    }

    function open(id) {
      const c = reports().find(x => x.id === id) || adapter.getActiveCounts().find(x => x.id === id);
      if (!c) return;
      const items = [...(itemsByCount().get(c.id) || [])].sort(adapter.sortItems), earliest = items.map(x => x.validity_date).filter(Boolean).sort()[0];
      const esc = adapter.escapeHtml, fmtDate = adapter.formatDate, fmtDateTime = adapter.formatDateTime;
      const body = `<div class="detail-grid"><div class="detail-card"><small>Unidade</small><strong>${esc(c.unit)}</strong></div><div class="detail-card"><small>Responsável</small><strong>${esc(c.counter_name)}</strong></div><div class="detail-card"><small>Início</small><strong>${fmtDateTime(c.started_at)}</strong></div><div class="detail-card"><small>Finalização</small><strong>${fmtDateTime(c.completed_at)}</strong></div><div class="detail-card"><small>Itens</small><strong>${items.length}</strong></div><div class="detail-card"><small>Menor validade</small><strong>${earliest ? fmtDate(earliest) : '—'}</strong></div></div><div class="table-wrap"><table class="fefo-table"><thead><tr><th>Código</th><th>Produto</th><th>Validade</th><th>Rua</th><th>Palete</th><th>Lastro</th><th>Caixa</th><th>Unidade</th></tr></thead><tbody>${items.map(x => { const v = adapter.validityInfo(x.validity_date); return `<tr><td><strong>${esc(x.product_code)}</strong></td><td>${esc(x.product_name)}</td><td><span class="fefo-validity ${v.className}">${fmtDate(x.validity_date)}</span><small>${esc(v.label)}</small></td><td>${esc(x.street || '—')}</td><td>${Number(x.pallet || 0)}</td><td>${Number(x.layer || 0)}</td><td>${Number(x.box || 0)}</td><td>${Number(x.loose_unit || 0)}</td></tr>`; }).join('') || '<tr><td colspan="8">Nenhum item.</td></tr>'}</tbody></table></div>`;
      adapter.openModal(`FEFO • ${c.count_code}`, c.status === 'COMPLETED' ? 'Contagem finalizada' : 'Contagem em andamento', body, [
        { label: 'Baixar CSV', class: 'primary', onClick: () => downloadCsv(c, items) },
        { label: 'Fechar', class: 'secondary', onClick: () => adapter.closeModal() }
      ]);
      adapter.onReportOpened(id);
    }

    function csvCell(value) {
      const text = String(value ?? '');
      return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }
    function csvText(items) {
      const rows = [['codigo', 'nome', 'validade', 'rua', 'palete', 'lastro', 'caixa', 'unidade'], ...[...(items || [])].sort(adapter.sortItems).map(x => [x.product_code, x.product_name, adapter.formatDate(x.validity_date), x.street || '', Number(x.pallet || 0), Number(x.layer || 0), Number(x.box || 0), Number(x.loose_unit || 0)])];
      return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
    }
    function fileStamp(value) {
      const date = new Date(value || Date.now());
      try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: adapter.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
        return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}`;
      } catch {
        return adapter.localIsoDate(date).replace(/-/g, '');
      }
    }
    function downloadCsv(count, items) {
      const blob = new Blob([csvText(items)], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), a = adapter.document.createElement('a');
      a.href = url;
      a.download = `contagem_${fileStamp(count?.completed_at || count?.started_at)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return { load, render, onClick, open, downloadCsv };
  }

  return { create };
});
