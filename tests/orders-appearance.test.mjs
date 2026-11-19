import test from 'node:test';
import assert from 'node:assert/strict';
import {cascade,contrast} from './helpers/css-cascade.mjs';
for(const theme of ['light','dark'])for(const width of [390,1280])test(`Pedidos mantém contraste de campos, cards, tabelas e status (${theme}, ${width}px)`,()=>{
 const c=cascade({theme,width,markup:`<html><body><div id="appShell"><section class="od-workspace"><div class="od-panel"><h2>Nova solicitação</h2><label class="od-field"><span>Cliente</span><input value="123"></label><div class="od-auto">Cliente automático</div><p class="od-muted">Observação auxiliar</p><textarea>Observação manual</textarea><select><option>Pendente</option></select></div><div class="od-kpi"><span>Dentro do SLA</span><strong>95%</strong></div><span class="od-badge od-success">Aprovado</span><span class="od-badge od-danger">Reprovado</span><span class="od-badge od-warning">Pendente</span><div class="od-table-wrap"><table><thead><tr><th>Cliente</th></tr></thead><tbody><tr><td>Cliente exemplo</td></tr></tbody></table></div></section></div></body></html>`});
 for(const el of c.document.querySelectorAll('h2,.od-field>span,input,textarea,select,.od-auto,.od-muted,.od-kpi>span,.od-kpi>strong,.od-badge,th,td')){
  const ratio=contrast(c.value(el,'color'),c.background(el));assert.ok(ratio>=4.5,`${el.tagName} ${el.className}: ${ratio.toFixed(2)}:1`);
 }
});
