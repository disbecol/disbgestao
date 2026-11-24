// Resolve as cores declaradas dos elementos de teste, incluindo especificidade,
// !important, herança, variáveis e media queries. Não substitui um navegador.
import fs from 'node:fs';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {selectorSpecificity, compare} from '@csstools/selector-specificity';
import {parseHTML} from 'linkedom';

const read = file => fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
export function cascade({theme='light',width=1280,media='screen',markup,stylesheets}={}) {
  const html=read('index.html');
  const {document}=parseHTML(markup||html);
  document.documentElement.dataset.theme=theme;
  const rules=[];
  for(const sheet of stylesheets||[...html.matchAll(/rel="stylesheet"[^>]*href="([^?"]+)/g)].map(m=>m[1])) {
    postcss.parse(read(sheet)).walkRules(rule=>{
      for(let parent=rule.parent;parent;parent=parent.parent) {
        if(parent.type!=='atrule') continue;
        if(/keyframes/.test(parent.name)) return;
        if(parent.name==='media') {
          if(/\bprint\b/.test(parent.params)&&media!=='print') return;
          if(/\bscreen\b/.test(parent.params)&&media!=='screen') return;
          for(const m of parent.params.matchAll(/(min|max)-width\s*:\s*(\d+)px/g)) {
            if(m[1]==='min'&&width<+m[2]||m[1]==='max'&&width>+m[2]) return;
          }
          if(/prefers-reduced-motion/.test(parent.params)) return;
        }
      }
      for(const original of rule.selectors) {
        if(/::|:before\b|:after\b/.test(original)) continue;
        const selector=original.replace(/:hover\b/g,'.test-hover');
        const specificity=selectorSpecificity(selectorParser().astSync(selector).first);
        rules.push({selector,specificity,declarations:rule.nodes.filter(n=>n.type==='decl')});
      }
    });
  }
  const byProperty=new Map();
  for(const rule of rules){
    const groups=new Map();
    for(const declaration of rule.declarations){const property=declaration.prop==='background'?'background-color':declaration.prop;if(!groups.has(property))groups.set(property,[]);groups.get(property).push(declaration);}
    for(const [property,declarations] of groups){if(!byProperty.has(property))byProperty.set(property,[]);byProperty.get(property).push({...rule,declarations});}
  }
  const cache=new WeakMap(),matching=new WeakMap();
  function value(element,property) {
    if(!element) return property==='color'?'#000000':'';
    let memo=cache.get(element);if(!memo){memo=new Map();cache.set(element,memo);}
    if(memo.has(property)) return memo.get(property);
    let winner;
    let selectors=matching.get(element);if(!selectors){selectors=new Map();matching.set(element,selectors);}
    for(const rule of byProperty.get(property)||[]) {
      const declarations=rule.declarations;
      let matches=selectors.get(rule.selector);
      if(matches===undefined){matches=false;try{matches=element.matches(rule.selector);}catch{}selectors.set(rule.selector,matches);}
      if(!matches) continue;
      for(const declaration of declarations) {
        const candidate={value:declaration.value,important:!!declaration.important,specificity:rule.specificity};
        if(!winner||(candidate.important&&!winner.important)||(candidate.important===winner.important&&compare(candidate.specificity,winner.specificity)>=0)) winner=candidate;
      }
    }
    if(element.getAttribute('style')) {
      postcss.parse('x{'+element.getAttribute('style')+'}').first.walkDecls(declaration=>{
        if(declaration.prop!==property&&!(property==='background-color'&&declaration.prop==='background'))return;
        if(!winner?.important||declaration.important)winner={value:declaration.value,important:!!declaration.important};
      });
    }
    let result=winner?.value||'';
    if(result==='inherit'||(!result&&(property==='color'||property.startsWith('--'))))result=value(element.parentElement,property);
    result=result.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g,(_,name,fallback)=>value(element,name)||fallback||'');
    if(result==='currentColor') result=value(property==='color'?element.parentElement:element,'color');
    memo.set(property,result);return result;
  }
  function background(element) {
    for(let node=element;node;node=node.parentElement){const color=value(node,'background-color');if(color&&!/^(transparent|none)$/.test(color))return color;}
    return '#ffffff';
  }
  return {document,value,background};
}
export function luminance(hex) {
    if(/^#[0-9a-f]{3}$/i.test(hex))hex='#'+hex.slice(1).split('').map(c=>c+c).join('');
    if(!/^#[0-9a-f]{6}$/i.test(hex))throw new Error('Expected solid color: '+hex);
    const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return c[0]*.2126+c[1]*.7152+c[2]*.0722;
}
export function contrast(a,b) {
  const [low,high]=[luminance(a),luminance(b)].sort((a,b)=>a-b);return (high+.05)/(low+.05);
}
