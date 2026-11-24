(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DISB_PULL_CYCLE_DELETE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function create(adapter) {
    const $ = adapter.getElement;
    const document = adapter.document;
    const history = () => adapter.getHistory();
    const plans = () => adapter.getPlans();
    const client = () => adapter.getClient();
    const sb = {
      from: (...args) => client().from(...args),
      rpc: (...args) => client().rpc(...args),
      storage: { from: (...args) => client().storage.from(...args) }
    };

    function wrapRenderHistory(original) {
      return function (...args) {
        const result = original.apply(this, args);
        if (!adapter.isAdmin()) return result;
        $('tbodyPullHistory')?.querySelectorAll('[data-hist-detail]').forEach(detail => {
          const trip = history().find(row => row.id === detail.dataset.histDetail);
          if (!trip || !['PULL', 'TRANSFER'].includes(trip.cycle_type)) return;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'mini-btn pull-delete-action';
          button.dataset.pullDeleteCycle = trip.id;
          button.textContent = 'Excluir ciclo';
          detail.parentElement?.appendChild(button);
        });
        return result;
      };
    }

    function wrapPlanCardHtml(original) {
      return function (plan, analyst = false) {
        const html = original.call(this, plan, analyst);
        if (!analyst || !adapter.isAdmin() || !['PULL', 'TRANSFER'].includes(plan.cycle_type)) return html;
        const action = plan.trip_id
          ? `<button type="button" class="mini-btn pull-delete-action" data-pull-delete-cycle="${adapter.escapeHtml(plan.trip_id)}">Excluir ciclo</button>`
          : `<button type="button" class="mini-btn pull-delete-action" data-pull-delete-plan="${adapter.escapeHtml(plan.id)}">Excluir viagem</button>`;
        return html.replace('</div></article>', `${action}</div></article>`);
      };
    }

    function wrapRenderFarol(original) {
      return function (...args) {
        const result = original.apply(this, args);
        if (!adapter.isAdmin()) return result;
        $('pullFarolCards')?.querySelectorAll('[data-pull-detail]').forEach(detail => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn secondary wide pull-delete-action';
          button.dataset.pullDeleteCycle = detail.dataset.pullDetail;
          button.textContent = 'Excluir ciclo';
          detail.parentElement?.appendChild(button);
        });
        return result;
      };
    }

    function wrapFarolClick(original) {
      return function (event) {
        const button = event.target.closest('[data-pull-delete-cycle]');
        if (button) return void openPullDeleteCycle(button.dataset.pullDeleteCycle);
        return original.call(this, event);
      };
    }

    function wrapHistoryClick(original) {
      return function (event) {
        const button = event.target.closest('[data-pull-delete-cycle]');
        if (button) return void openPullDeleteCycle(button.dataset.pullDeleteCycle);
        return original.call(this, event);
      };
    }

    function wrapPlansClick(original) {
      return function (event) {
        const cycle = event.target.closest('[data-pull-delete-cycle]');
        if (cycle) return void openPullDeleteCycle(cycle.dataset.pullDeleteCycle);
        const plan = event.target.closest('[data-pull-delete-plan]');
        if (plan) return void openPullDeletePlan(plan.dataset.pullDeletePlan);
        return original.call(this, event);
      };
    }

    function wrapLoadHistory(original) {
      return async function (silent = false) {
        const result = await original.call(this, silent);
        if (adapter.isAdmin()) void refreshPullDeletedFilesButton();
        return result;
      };
    }

    async function refreshPullDeletedFilesButton() {
      const button = $('btnPullDeletedFiles');
      if (!button || !adapter.isAdmin()) return;
      const { data, error } = await sb.from('pull_deleted_storage_files').select('id').limit(1000);
      if (error) {
        button.classList.add('hidden');
        console.warn('Arquivos pendentes da Puxada', error);
        return;
      }
      const total = (data || []).length;
      button.classList.toggle('hidden', total === 0);
      button.textContent = `Limpar ${total}${total === 1000 ? '+' : ''} arquivo${total === 1 ? '' : 's'} pendente${total === 1 ? '' : 's'}`;
    }

    async function removePullDeletedFiles(files) {
      let failed = 0;
      for (const file of files) {
        if (!['puxada-anexos', 'puxada-notas'].includes(file.bucket) || !file.path) { failed++; continue; }
        try {
          const removed = await sb.storage.from(file.bucket).remove([file.path]);
          const acknowledged = await sb.rpc('ack_pull_deleted_file', { p_bucket: file.bucket, p_path: file.path });
          if (acknowledged.error) throw removed.error || acknowledged.error;
        } catch (error) {
          failed++;
          console.warn('Arquivo privado pendente de remoção', file, error);
        }
      }
      await refreshPullDeletedFilesButton();
      return failed;
    }

    async function retryPullDeletedFiles() {
      if (!adapter.isAdmin() || !adapter.isOnline()) return adapter.toast('Conecte-se para limpar os arquivos pendentes.', 'error');
      const button = $('btnPullDeletedFiles');
      button.disabled = true;
      button.textContent = 'Limpando arquivos…';
      try {
        const { data, error } = await sb.from('pull_deleted_storage_files').select('bucket_id,object_name').order('queued_at').limit(1000);
        if (error) throw error;
        const files = (data || []).map(row => ({ bucket: row.bucket_id, path: row.object_name }));
        const failed = await removePullDeletedFiles(files);
        adapter.toast(failed ? `${failed} arquivo(s) ainda pendentes. Tente novamente.` : `${files.length} arquivo(s) removidos.`, failed ? 'error' : 'success');
      } catch (error) {
        adapter.toast(adapter.humanError(error), 'error');
      } finally {
        button.disabled = false;
        await refreshPullDeletedFilesButton();
      }
    }

    async function openPullDeleteCycle(tripId) {
      if (!adapter.isAdmin() || !adapter.isOnline()) return adapter.toast('A exclusão do ciclo exige acesso de administrador e internet.', 'error');
      try {
        const { data: preview, error } = await sb.rpc('preview_pull_cycle_deletion', { p_trip_id: tripId });
        if (error) throw error;
        if (!preview) throw new Error('Ciclo não encontrado.');
        const code = String(preview.trip_code || '');
        const type = preview.cycle_type === 'TRANSFER' ? 'transferência' : 'puxada';
        const body = `<div class="notice"><strong>${adapter.escapeHtml(code)} • ${adapter.escapeHtml(preview.plate)}</strong><br>${adapter.escapeHtml(preview.origin_unit)} • ${adapter.escapeHtml(preview.status)}<br>${adapter.escapeHtml(preview.driver1_name)} / ${adapter.escapeHtml(preview.driver2_name || '—')}</div><p>Serão removidos ${Number(preview.events) || 0} etapas, ${Number(preview.checklists) || 0} checklists, o trajeto, ocorrências, notas e ${Number(preview.files) || 0} arquivo(s) privado(s) deste ciclo. <strong>${Number(preview.nris_preserved) || 0} solicitação(ões) de NRI permanecerão no histórico, desvinculadas do ciclo.</strong></p><div class="field"><label for="pullDeleteConfirmCode">Digite ${adapter.escapeHtml(code)} para confirmar *</label><input id="pullDeleteConfirmCode" autocomplete="off" placeholder="${adapter.escapeHtml(code)}"></div>`;
        adapter.openModal(`Excluir ciclo de ${type}`, `${code} • exclusão permanente`, body, [
          { label: 'Voltar', class: 'secondary', onClick: adapter.closeModal },
          { label: 'Excluir ciclo', class: 'danger', onClick: async event => {
            if ($('pullDeleteConfirmCode')?.value.trim().toUpperCase() !== code.toUpperCase()) return adapter.toast('Digite o código exato do ciclo.', 'error');
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = 'Excluindo ciclo…';
            try {
              const { data, error } = await sb.rpc('delete_pull_cycle', { p_trip_id: tripId, p_trip_code: code });
              if (error) throw error;
              adapter.closeModal();
              const failed = await removePullDeletedFiles(data?.files || []);
              await Promise.all([adapter.loadHistory(true), adapter.loadPlans(true), adapter.loadFarol(true)]);
              adapter.toast(failed ? `Ciclo ${code} excluído. ${failed} arquivo(s) aguardam nova tentativa.` : `Ciclo ${code} e arquivos excluídos.`, failed ? 'error' : 'success');
            } catch (error) {
              button.disabled = false;
              button.textContent = 'Excluir ciclo';
              adapter.toast(adapter.humanError(error), 'error');
            }
          } }
        ]);
      } catch (error) {
        adapter.toast(adapter.humanError(error), 'error');
      }
    }

    async function openPullDeletePlan(planId) {
      if (!adapter.isAdmin() || !adapter.isOnline()) return adapter.toast('A exclusão da viagem exige acesso de administrador e internet.', 'error');
      const plan = plans().find(row => row.id === planId);
      if (!plan || plan.trip_id || !['PULL', 'TRANSFER'].includes(plan.cycle_type)) return adapter.toast('Esta viagem já iniciou. Exclua o ciclo no histórico ou no Farol.', 'error');
      const body = `<div class="notice"><strong>${adapter.escapeHtml(plan.plate)} → ${adapter.escapeHtml(plan.factory)}</strong><br>${adapter.escapeHtml(plan.origin_unit)} • ${adapter.escapeHtml(plan.driver1_name)} / ${adapter.escapeHtml(plan.driver2_name || '—')}</div><p>A viagem planejada e as notas anexadas serão excluídas permanentemente.</p><div class="field"><label for="pullDeleteConfirmPlate">Digite a placa ${adapter.escapeHtml(plan.plate)} para confirmar *</label><input id="pullDeleteConfirmPlate" autocomplete="off" placeholder="${adapter.escapeHtml(plan.plate)}"></div>`;
      adapter.openModal('Excluir viagem planejada', plan.plate, body, [
        { label: 'Voltar', class: 'secondary', onClick: adapter.closeModal },
        { label: 'Excluir viagem', class: 'danger', onClick: async event => {
          if ($('pullDeleteConfirmPlate')?.value.trim().toUpperCase() !== plan.plate.toUpperCase()) return adapter.toast('Digite a placa exata da viagem.', 'error');
          const button = event.currentTarget;
          button.disabled = true;
          button.textContent = 'Excluindo viagem…';
          try {
            const { data, error } = await sb.rpc('delete_pull_plan', { p_plan_id: plan.id, p_plate: plan.plate });
            if (error) throw error;
            adapter.closeModal();
            const failed = await removePullDeletedFiles(data?.files || []);
            await adapter.loadPlans(true);
            adapter.toast(failed ? `Viagem excluída. ${failed} arquivo(s) aguardam nova tentativa.` : 'Viagem planejada e arquivos excluídos.', failed ? 'error' : 'success');
          } catch (error) {
            button.disabled = false;
            button.textContent = 'Excluir viagem';
            adapter.toast(adapter.humanError(error), 'error');
          }
        } }
      ]);
    }

    function bind() {
      document.addEventListener('DOMContentLoaded', () => {
        $('btnPullDeletedFiles')?.addEventListener('click', retryPullDeletedFiles);
      });
    }

    return {
      wrapRenderHistory, wrapPlanCardHtml, wrapRenderFarol, wrapFarolClick,
      wrapHistoryClick, wrapPlansClick, wrapLoadHistory, openPullDeleteCycle, bind
    };
  }

  return { create };
});
