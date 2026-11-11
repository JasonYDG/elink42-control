"use strict";
const OMSdkOTA=(()=>{
  const MAGIC="EL42OTA2",MAX=0x3C000;
  function crcUpdate(crc,bytes){for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xEDB88320:0);}return crc>>>0;}
  const crc32=bytes=>(crcUpdate(0xFFFFFFFF,bytes)^0xFFFFFFFF)>>>0;
  function failure(message){const error=Error(OMI18n.t(message));error.code="OTA_PRECHECK";return error;}
  async function parse(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(bytes.length<268 || bytes.length>64+MAX || new TextDecoder().decode(bytes.subarray(0,8))!==MAGIC)
      throw failure("请选择独立 SDK 固件的 .e42ota 升级包。");
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),model=view.getUint32(8,true),revision=view.getUint32(12,true),size=view.getUint32(16,true);
    if(![2,5].includes(model) || revision<2 || revision>65535 || size!==bytes.length-64 ||
       view.getUint32(20,true)!==0x4000 || view.getUint32(60,true)!==crc32(bytes.subarray(0,60)))
      throw failure("升级包头或长度不正确，请重新取得完整文件。");
    const image=bytes.slice(64),crc=view.getUint32(24,true);
    const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",image));
    if(crc32(image)!==crc || digest.some((b,i)=>b!==bytes[28+i]))throw failure("升级包内容校验失败，没有向设备写入。");
    return {model,revision,size,crc,header:bytes.slice(0,64),image,sha256:Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("")};
  }
  function supported(client){return OMProtocol.sdkBoard(client.board) && !!(client.sdkCapabilities&8);}
  async function request(client,op,data=[]){
    const seq=client.nextSequence(),bytes=Uint8Array.of(op,seq,...data);
    const reply=await client.request(bytes,b=>b[0]===0x70 && b[1]===seq,OMI18n.t("读取 SDK 升级回执"),15000);
    if(reply.length!==28 || reply[2]!==1 || reply[5]!==client.config.model || reply[3]>7)throw failure("升级回执格式不正确，已停止。");
    const view=new DataView(reply.buffer,reply.byteOffset,reply.byteLength);
    const value={state:reply[3],error:reply[4],model:reply[5],millivolts:view.getUint16(6,true),revision:view.getUint32(8,true),
      received:view.getUint32(12,true),crc:view.getUint32(16,true),size:view.getUint32(20,true),runningCrc:view.getUint32(24,true)};
    if(value.state===7)throw failure(({1:"电压不足 2.90 V，升级已停止。请更换电池或稳定供电后重试。",
      2:"升级包或当前状态不匹配，已停止。",3:"暂存区或启动记录不兼容，旧数据已保留。请先备份并核对布局。",
      4:"升级数据位置不一致，已停止发送；不会自动重传。",5:"闪存写入或读回失败，升级已停止。",
      6:"设备核对镜像失败，原应用仍保留。",7:"升级提交未确认，请核对设备状态，不要重复提交。",
      8:"升级等待超时，已停止。请重新连接并核对状态。"}[value.error]||"设备升级出错，操作已停止。"));
    return value;
  }
  async function wait(client,wanted,progress){
    const deadline=Date.now()+70000;
    while(Date.now()<deadline){
      const state=await request(client,0x60);
      if(state.state===wanted)return state;
      if(![1,2,4].includes(state.state))throw failure("设备升级状态发生变化，已停止。");
      progress?.(wanted===3?1:98,OMI18n.t(wanted===3?"正在准备独立升级暂存区…":"设备正在读回核对镜像…"));
      await client.pause(50);
    }
    throw failure("设备准备或校验超时；原应用仍保留，请重新连接核对。");
  }
  async function transfer(client,pkg,progress){
    if(!supported(client) || pkg.model!==client.config?.model || pkg.revision<client.sdkRevision)
      throw failure("升级包与当前 SDK 版本或屏型不匹配，没有开始写入。");
    return client.operation(async()=>{
      client.otaActive=true;client.update();
      try{
        await client.waitForDisplay();await client.initialize();
        if(client.payload<66 || client.reportedPayload<28)throw failure("本连接传输容量不足，请使用支持 MTU 协商的浏览器重新连接。");
        const before=await request(client,0x60);
        if(before.millivolts<2900)throw failure("电压不足 2.90 V，没有开始升级。");
        if(before.state!==0 && before.state!==7)throw failure("设备有未结束的升级，请先核对状态或手动取消。");
        await request(client,0x61,pkg.header);await wait(client,3,progress);
        let crc=0xFFFFFFFF;
        for(let off=0;off<pkg.image.length;){
          const data=pkg.image.subarray(off,off+client.payload-6),offset=new Uint8Array(4);
          new DataView(offset.buffer).setUint32(0,off,true);
          const state=await request(client,0x62,[...offset,...data]);crc=crcUpdate(crc,data);off+=data.length;
          if(state.state!==3 || state.received!==off || state.crc!==((crc^0xFFFFFFFF)>>>0))throw failure("设备接收位置或 CRC 未确认，已停止，不会自动重发。");
          progress?.(Math.floor(off/pkg.size*96)+2,OMI18n.t("正在传输 SDK 固件，图库保持保留…"));
        }
        await request(client,0x63);await wait(client,5,progress);
        const committed=await request(client,0x64);
        if(committed.state!==6)throw failure("升级提交未确认，请核对设备状态，不要重复提交。");
        return {device:client.device,model:pkg.model,revision:pkg.revision,crc:pkg.crc};
      }finally{client.otaActive=false;client.update();}
    });
  }
  async function confirmBoot(client,receipt,progress){
    client.disconnect();progress?.(99,OMI18n.t("已提交，正在等待设备重启并核对版本…"));
    await new Promise(resolve=>setTimeout(resolve,2500));
    await client.connect(receipt.device);
    const state=await client.operation(async()=>{await client.initialize();return request(client,0x60);});
    if(state.model!==receipt.model || state.revision!==receipt.revision || state.runningCrc!==receipt.crc)
      throw failure("重启后的固件内容尚未确认。没有重新发送升级，请核对设备。");
    progress?.(100,OMI18n.t("升级完成，已读回版本及应用 CRC；图库仍保留。"));return state;
  }
  async function abort(client){return client.operation(async()=>{const state=await request(client,0x65);if(state.state!==0)throw failure("升级已经提交，不能取消。请等待重启并核对设备。");return state;});}
  return {parse,crc32,supported,request,transfer,confirmBoot,abort};
})();
