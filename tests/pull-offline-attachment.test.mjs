import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function attachmentHarness(){
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const source=app.replace(/\}\)\(\);\s*$/,`window.pullAttachmentTest={
    setup(file,queue){
      pullActiveTrip={id:'trip-1'};authUser={id:'driver-1'};
      pullAttachmentNativeFile=file;pullTripAttachments=[];
      compressImage=async()=>file;
      offlineQueueAdd=async(type,payload)=>{queue.push({type,payload});return {id:'op-1'};};
      loadPullTripAttachments=async()=>{};
      updatePullAttachmentCaptureUi=()=>{};
      toast=()=>{};
    },
    setSupabase(client){sb=client;},
    submit:submitPullAttachment,
    process:processOfflineRecord
  };})();`);
  const elements=new Map();
  const document={addEventListener(){},getElementById(id){
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',reset(){},classList:{add(){},remove(){},toggle(){}}});
    return elements.get(id);
  }};
  const window={addEventListener(){}};
  vm.runInNewContext(source,{window,document,navigator:{onLine:false},setInterval(){},setTimeout(){}},{timeout:3000});
  return window.pullAttachmentTest;
}

test('foto tirada sem internet fica na fila local sem tentativa de envio imediato',async()=>{
  const api=attachmentHarness(),queue=[],file={type:'image/jpeg'};
  api.setup(file,queue);
  await api.submit({preventDefault(){}});
  assert.equal(queue.length,1);
  assert.equal(queue[0].type,'PULL_ATTACHMENT');
  assert.equal(queue[0].payload.trip_id,'trip-1');
  assert.equal(queue[0].payload.blob,file);
});

test('sincronização de foto reaproveita o mesmo caminho após upload já realizado',async()=>{
  const api=attachmentHarness(),calls=[];
  api.setSupabase({storage:{from(bucket){assert.equal(bucket,'puxada-anexos');return {upload:async(path)=>{calls.push(['upload',path]);return {error:{message:'The resource already exists'}};}};}},
    rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:{id:'photo-1'},error:null};}});
  const result=await api.process({type:'PULL_ATTACHMENT',id:'op-1',user_id:'driver-1',payload:{trip_id:'trip-1',blob:{}}});
  assert.equal(result.id,'photo-1');
  assert.equal(calls[0][1],'trip-1/driver-1/op-1.jpg');
  assert.equal(calls[1][1],'register_pull_trip_attachment');
  assert.equal(calls[1][2].p_photo_path,calls[0][1]);
});
