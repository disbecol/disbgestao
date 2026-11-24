import test from 'node:test';import assert from 'node:assert/strict';
import {cascade,contrast,luminance} from './helpers/css-cascade.mjs';
import {formsThemeHarness,assetThemeHarness} from './helpers/forms-theme-harness.mjs';
function readable(c,selector){const es=c.document.querySelectorAll(selector);assert.ok(es.length,'Missing real component: '+selector);for(const e of es){const fg=c.value(e,'color'),bg=c.background(e);assert.ok(contrast(fg,bg)>=4.5,`${e.tagName}.${e.className}: ${fg} on ${bg}`);}}
for(const theme of ['light','dark'])for(const width of [390,1440]){
 test(`filled evaluation matrices keep semantic cells and their children readable (${theme}, ${width})`,async()=>{
  const h=formsThemeHarness();await h.enter('forms-report');await h.click('[data-fm-action="report-tab"][data-id="execution"]');
  let c=cascade({theme,width,markup:h.html()});for(const kind of ['good','bad','warn']){readable(c,`.fm-cell-${kind},.fm-cell-${kind} button,.fm-cell-${kind} strong,.fm-cell-${kind} small`);if(theme==='dark')assert.ok(luminance(c.background(c.document.querySelector('.fm-cell-'+kind)))<.12);}
  await h.click('[data-fm-action="person-evolution"][data-id="worker"][data-month="10"]');c=cascade({theme,width,markup:h.html()});readable(c,'#formsPersonEvolution .fm-cell-bad strong,#formsPersonEvolution .fm-cell-bad small,#formsPersonEvolution .fm-cell-good strong');
  await h.click('[data-fm-action="close-evolution"]');await h.click('[data-fm-action="report-tab"][data-id="conformity"]');c=cascade({theme,width,markup:h.html()});readable(c,'.fm-matrix .fm-cell-bad');
  await h.click('[data-fm-action="report-tab"][data-id="issues"]');await h.input('[data-fm-filter="from"]','2026-07-01');await h.click('[data-fm-action="filter"]');c=cascade({theme,width,markup:h.html()});readable(c,'.fm-table .fm-badge.bad');
  await h.click('[data-fm-action="report-tab"][data-id="farol"]');await h.input('[data-fm-filter="form"]','theme-form');await h.click('[data-fm-action="filter"]');c=cascade({theme,width,markup:h.html()});for(const state of ['OK','NOK','NA'])readable(c,`.fm-farol-${state},.fm-farol-${state} strong`);assert.equal(h.writes.length,0);
 });
 test(`builder, preview and the three answer states follow the theme (${theme}, ${width})`,async()=>{
  const h=formsThemeHarness();await h.enter('forms-manage');await h.click('[data-fm-action="edit"][data-id="theme-form"]');await h.click('[role="tab"][data-fm-action="builder-tab"][data-id="questions"]');let c=cascade({theme,width,markup:h.html()});readable(c,'.fm-question-heading strong,.fm-question-heading small,.fm-question-dot');assert.equal(c.value(c.document.querySelector('.fm-question-heading>button'),'background-color'),'transparent');
  await h.click('[role="tab"][data-fm-action="builder-tab"][data-id="preview"]');c=cascade({theme,width,markup:h.html()});readable(c,'.fm-preview-input,.fm-preview-question small,.fm-answer-buttons>span');if(theme==='dark')assert.ok(luminance(c.background(c.document.querySelector('.fm-preview-input')))<.12);
  await h.enter('forms-fill');await h.click('[data-fm-action="resume"][data-id="draft"]');
  for(const value of ['YES','NO','NA']){await h.click(`[data-fm-action="answer"][data-id="q0"][data-value="${value}"]`);c=cascade({theme,width,markup:h.html()});readable(c,'.fm-answer-buttons>button');const selected=c.document.querySelector(`[data-id="q0"][data-value="${value}"]`),other=c.document.querySelector(`[data-id="q0"][data-value="${value==='NO'?'YES':'NO'}"]`);assert.equal(selected.getAttribute('aria-checked'),'true');assert.equal(selected.classList.contains('selected'),true);assert.notEqual(c.background(selected),c.background(other));}
  assert.equal(h.writes.length,0,'Selecting answers must not publish or finalize a response');
 });
 test(`Ativo de Giro totals and every view stay readable without light bands (${theme}, ${width})`,async()=>{
  const h=await assetThemeHarness();for(const tab of ['TOTAL','PATIO','REFUGO']){h.click('[data-asset-history-tab="'+tab+'"]');const c=cascade({theme,width,markup:h.html()});readable(c,'.asset-history-total-card span,.asset-history-total-card strong,.asset-history-total-card small,.asset-history-view-tab,.asset-history-view-caption strong,.asset-history-view-caption span');assert.equal(c.document.querySelector('[data-asset-history-tab="'+tab+'"]').getAttribute('aria-selected'),'true');if(theme==='dark')for(const el of c.document.querySelectorAll('.asset-history-total-card,.asset-history-view-tabs,.asset-history-view-caption'))assert.ok(luminance(c.background(el))<.12,el.className);}
 });
}
