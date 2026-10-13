/* Captura nativa das fotos do ciclo de Puxada, sem abrir a galeria. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.DISB_PULL_CAMERA=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function cancelled(error){
    return error?.code==='OS-PLUG-CAMR-0006'||/cancelad[ao]|cancelled|canceled/i.test(String(error?.message||''));
  }
  async function capture(cap){
    const camera=cap?.Plugins?.Camera||cap?.registerPlugin?.('Camera');
    const filesystem=cap?.Plugins?.Filesystem||cap?.registerPlugin?.('Filesystem');
    if(typeof camera?.takePhoto!=='function'||typeof filesystem?.readFile!=='function'){
      throw new Error('Câmera nativa indisponível. Instale a versão mais recente do APK.');
    }
    const photo=await camera.takePhoto({quality:85,targetWidth:1600,targetHeight:1600,saveToGallery:false});
    if(!photo?.uri)throw new Error('A câmera não retornou a foto. Tente novamente.');
    const result=await filesystem.readFile({path:photo.uri});
    if(typeof result?.data!=='string'||!result.data)throw new Error('Não foi possível ler a foto capturada.');
    const base64=result.data.replace(/^data:[^,]*;base64,/i,'');
    const binary=atob(base64),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new File([bytes],`puxada-${Date.now()}.jpg`,{type:'image/jpeg'});
  }
  return {capture,cancelled};
});
