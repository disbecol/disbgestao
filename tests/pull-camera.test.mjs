import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {capture,cancelled}=require('../pull-camera.js');

test('captura foto do ciclo pela câmera nativa, sem consultar a galeria',async()=>{
  const calls=[];
  const cap={Plugins:{
    Camera:{takePhoto:async options=>{calls.push(['camera',options]);return {uri:'file:///foto.jpg'};},chooseFromGallery:()=>{throw new Error('Galeria não deve abrir');}},
    Filesystem:{readFile:async options=>{calls.push(['read',options]);return {data:Buffer.from([255,216,255,217]).toString('base64')};}}
  }};
  const file=await capture(cap);
  assert.deepEqual(calls.map(x=>x[0]),['camera','read']);
  assert.equal(calls[0][1].saveToGallery,false);
  assert.deepEqual(calls[1][1],{path:'file:///foto.jpg'});
  assert.equal(file.type,'image/jpeg');
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())],[255,216,255,217]);
});

test('cancelamento da câmera não é tratado como erro de envio',()=>{
  assert.equal(cancelled({code:'OS-PLUG-CAMR-0006'}),true);
  assert.equal(cancelled(new Error('Camera cancelled')),true);
  assert.equal(cancelled(new Error('Sem câmera')),false);
});
