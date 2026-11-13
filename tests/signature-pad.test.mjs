import test from 'node:test';
import assert from 'node:assert/strict';
import padApi from '../signature-pad.js';

test('portrait touch coordinates map to the horizontal signature, including edges',()=>{
  const rect={left:10,top:50,width:300,height:700};
  assert.deepEqual(padApi.pointerPosition({clientX:310,clientY:50},rect,true),{x:0,y:0});
  assert.deepEqual(padApi.pointerPosition({clientX:10,clientY:750},rect,true),{x:1,y:1});
  assert.deepEqual(padApi.pointerPosition({clientX:160,clientY:400},rect,true),{x:.5,y:.5});
  assert.deepEqual(padApi.pointerPosition({clientX:-100,clientY:1000},rect,true),{x:1,y:1});
  assert.deepEqual(padApi.pointerPosition({clientX:85,clientY:225},rect,false),{x:.25,y:.25});
});

test('horizontal output is centered, padded and keeps the proportions of the handwriting',()=>{
  for(const [width,height] of [[800,180],[200,600],[1,1]]){
    const box=padApi.containRect(width,height,1000,300,24);
    assert.ok(Math.abs(box.width/box.height-width/height)<1e-9);
    assert.ok(box.x>=24&&box.y>=24);assert.ok(box.x+box.width<=976);assert.ok(box.y+box.height<=276);
  }
});

test('ink detection ignores the white background and transparent pixels',()=>{
  const image={width:8,height:4,data:new Uint8ClampedArray(8*4*4).fill(255)};
  assert.equal(padApi.inkBounds(image),null);
  const ink=(x,y,alpha=255)=>image.data.set([23,32,42,alpha],(y*8+x)*4);
  ink(0,0,0);assert.equal(padApi.inkBounds(image),null);
  ink(2,1);ink(5,2);assert.deepEqual(padApi.inkBounds(image),{x:2,y:1,width:4,height:2});
});

class Element{
  constructor(){this.listeners={};this.style={};this.dataset={};this.attrs={};this.disabled=false;this.hidden=false;this.open=false;this.focuses=0;this.classList={toggle(){}};}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  fire(name,values={}){const e={preventDefault(){this.prevented=true;},...values};for(const fn of this.listeners[name]||[])fn(e);return e;}
  setAttribute(name,value){this.attrs[name]=value;}focus(){this.focuses++;}
  showModal(){this.open=true;}close(){this.open=false;this.fire('close');}
}
class Canvas extends Element{
  constructor(document){super();this.ownerDocument=document;this.width=1000;this.height=300;this.capture=null;
    this.ctx={ink:false,draws:[],moves:[],lines:[],setTransform(){},fillRect:()=>{this.ctx.ink=false;},beginPath(){},arc(){},fill:()=>{this.ctx.ink=true;},moveTo:(x,y)=>{this.ctx.moves.push([x,y]);},lineTo:(x,y)=>{this.ctx.lines.push([x,y]);},stroke:()=>{this.ctx.ink=true;},
      drawImage:(...args)=>{this.ctx.ink=true;this.ctx.draws.push(args);},
      getImageData:()=>{const image={width:8,height:4,data:new Uint8ClampedArray(8*4*4).fill(255)};if(this.ctx.ink){image.data.set([23,32,42,255],(1*8+1)*4);image.data.set([23,32,42,255],(2*8+6)*4);}return image;}};
  }
  getContext(){return this.ctx;}getBoundingClientRect(){return this.dataset.rotated==='true'?{left:0,top:0,width:300,height:650}:{left:0,top:0,width:650,height:300};}
  setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(){this.capture=null;}
}
function harness({signed=false,portrait=true}={}){
  const controls={cancel:new Element(),clear:new Element(),save:new Element(),guide:new Element(),stage:new Element(),dialog:new Element()};
  const listeners={};let observer;
  const document={defaultView:{devicePixelRatio:2,addEventListener:(name,fn)=>{listeners[name]=fn;},removeEventListener:name=>{delete listeners[name];},ResizeObserver:class{constructor(fn){observer=this;this.fn=fn;}observe(){this.active=true;}disconnect(){this.active=false;}}},body:{append(){}},createElement(tag){return tag==='dialog'?controls.dialog:new Canvas(document);}};
  const canvas=new Canvas(document),pad=new Canvas(document),button=new Element();canvas.ctx.ink=signed;
  controls.stage.clientWidth=portrait?300:650;controls.stage.clientHeight=portrait?650:300;
  controls.stage.querySelector=selector=>selector==='canvas'?pad:controls.guide;
  controls.dialog.querySelector=selector=>({'.signature-sheet-stage':controls.stage,'[data-signature-save]':controls.save,'[data-signature-clear]':controls.clear,'[data-signature-cancel]':controls.cancel})[selector];
  let context='driver-a:request-1',allowed=true,saves=0,invalidations=0;
  const api=padApi.bind({canvas,button,isSigned:()=>signed,onSave:()=>{signed=true;saves++;},getContext:()=>context,canOpen:()=>allowed,onContextChanged:()=>{invalidations++;}});
  const draw=()=>{pad.fire('pointerdown',{pointerId:1,button:0,clientX:200,clientY:100});pad.fire('pointermove',{pointerId:1,clientX:100,clientY:400});pad.fire('pointerup',{pointerId:1});};
  return {api,canvas,pad,button,controls,draw,listeners,get observer(){return observer;},state:()=>({signed,saves,invalidations}),changeContext:()=>{context='driver-b:request-2';},disallow:()=>{allowed=false;}};
}

test('expansion is a draft: blank Save cannot write to the original signature',()=>{
  const h=harness();assert.equal(h.api.open(),true);assert.equal(h.controls.dialog.open,true);assert.equal(h.controls.save.disabled,true);
  assert.equal(h.api.save(),false);assert.equal(h.canvas.ctx.draws.length,0);assert.equal(h.state().signed,false);
  assert.equal(h.pad.dataset.rotated,'true');assert.match(h.pad.style.transform,/rotate\(90deg\)/);
});

test('save copies only the ink to the horizontal original and closes the full-screen dialog',()=>{
  const h=harness();h.api.open();h.draw();assert.equal(h.controls.save.disabled,false);assert.equal(h.canvas.ctx.draws.length,0);
  assert.equal(h.api.save(),true);assert.equal(h.controls.dialog.open,false);assert.equal(h.canvas.width,1000);assert.equal(h.canvas.height,300);
  assert.equal(h.state().saves,1);assert.equal(h.state().signed,true);assert.equal(h.canvas.ctx.draws.length,1);
  assert.equal(h.api.save(),false);assert.equal(h.state().saves,1);assert.equal(h.observer.active,false);assert.equal(h.listeners.resize,undefined);
});

test('cancel and Escape preserve an existing signature, even after clearing the enlarged draft',()=>{
  for(const cancel of [h=>h.controls.cancel.fire('click'),h=>h.controls.dialog.fire('cancel')]){
    const h=harness({signed:true});h.api.open();assert.equal(h.controls.save.disabled,false);h.controls.clear.fire('click');assert.equal(h.controls.save.disabled,true);
    h.draw();cancel(h);assert.equal(h.canvas.ctx.draws.length,0);assert.equal(h.canvas.ctx.ink,true);assert.equal(h.state().signed,true);assert.equal(h.state().saves,0);assert.equal(h.controls.dialog.open,false);
  }
});

test('reopening after cancellation never restores an unsaved draft',()=>{
  const h=harness();h.api.open();h.draw();h.api.cancel();h.api.open();
  assert.equal(h.controls.save.disabled,true);assert.equal(h.pad.ctx.ink,false);assert.equal(h.controls.guide.hidden,false);assert.equal(h.api.save(),false);
});

test('rotation redraws the existing handwriting without changing the horizontal destination',()=>{
  const h=harness();h.api.open();h.draw();h.controls.stage.clientWidth=650;h.controls.stage.clientHeight=300;h.observer.fn();
  assert.equal(h.pad.dataset.rotated,'false');assert.doesNotMatch(h.pad.style.transform,/rotate/);assert.equal(h.controls.save.disabled,false);assert.equal(h.pad.ctx.ink,true);
  h.api.save();assert.equal(h.state().saves,1);assert.equal(h.canvas.width,1000);assert.equal(h.canvas.height,300);
});

test('a second touch cannot draw or finish the active finger’s stroke',()=>{
  const h=harness();h.api.open();h.pad.fire('pointerdown',{pointerId:1,button:0,clientX:100,clientY:100});
  h.pad.fire('pointerdown',{pointerId:2,button:0,clientX:200,clientY:200});h.pad.fire('pointerup',{pointerId:2});assert.equal(h.pad.capture,1);
  h.pad.fire('pointercancel',{pointerId:1});assert.equal(h.pad.capture,null);assert.equal(h.api.save(),true);
});

test('changed customer/account context cannot save stale handwriting',()=>{
  const h=harness();h.api.open();h.draw();h.changeContext();assert.equal(h.api.save(),false);
  assert.equal(h.canvas.ctx.draws.length,0);assert.equal(h.state().saves,0);assert.equal(h.state().invalidations,1);assert.equal(h.controls.dialog.open,false);
  h.disallow();assert.equal(h.api.open(),false);
});

test('changing the screen aspect ratio preserves the handwriting proportions',()=>{
  const h=harness();h.api.open();h.draw();
  const ratio=()=>{const a=h.pad.ctx.moves.at(-1),b=h.pad.ctx.lines.at(-1);return Math.abs((b[0]-a[0])/(b[1]-a[1]));};
  const before=ratio();h.controls.stage.clientWidth=650;h.controls.stage.clientHeight=200;h.observer.fn();
  assert.ok(Math.abs(ratio()-before)<1e-9,'rotation must fit the handwriting uniformly instead of stretching it');
  const fittedRatio=parseFloat(h.pad.style.width)/parseFloat(h.pad.style.height);assert.ok(Math.abs(fittedRatio-650/300)<1e-9);
  h.controls.stage.clientWidth=300;h.controls.stage.clientHeight=650;h.observer.fn();assert.ok(Math.abs(ratio()-before)<1e-9);
  h.controls.stage.clientWidth=650;h.controls.stage.clientHeight=200;h.observer.fn();h.controls.clear.fire('click');
  assert.equal(h.pad.style.width,'650px');assert.equal(h.pad.style.height,'200px');
});

test('rotating before writing uses the entire new signing area',()=>{
  const h=harness();h.api.open();h.controls.stage.clientWidth=650;h.controls.stage.clientHeight=200;h.observer.fn();
  assert.equal(h.pad.style.width,'650px');assert.equal(h.pad.style.height,'200px');assert.equal(h.controls.save.disabled,true);
});
