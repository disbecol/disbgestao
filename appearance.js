/* Preferência visual local. Não acessa a sessão, o banco nem a fila offline. */
(() => {
  'use strict';
  const key = 'disb.appearance';
  const choices = ['light', 'dark', 'system'];
  const root = document.documentElement;
  let preference = 'system';
  let system;
  try { system = window.matchMedia('(prefers-color-scheme: dark)'); } catch {}
  try {
    const saved = window.localStorage.getItem(key);
    if (choices.includes(saved)) preference = saved;
  } catch {}

  function apply() {
    const dark = preference === 'dark' || (preference === 'system' && !!system?.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.themePreference = preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111923' : '#f4f5f7');
    document.querySelectorAll('[data-theme-preference]').forEach(control => { control.value = preference; });
  }

  // Executado no <head>, antes dos estilos, para evitar um clarão ao reabrir.
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('[data-theme-preference]').forEach(control => {
      control.addEventListener('change', () => {
        if (!choices.includes(control.value)) return;
        preference = control.value;
        try { window.localStorage.setItem(key, preference); } catch {}
        apply();
      });
    });
  }, { once: true });
  const systemChanged = () => { if (preference === 'system') apply(); };
  if (system?.addEventListener) system.addEventListener('change', systemChanged);
  else system?.addListener?.(systemChanged);
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = choices.includes(event.newValue) ? event.newValue : 'system';
    apply();
  });
})();
