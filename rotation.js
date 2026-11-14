"use strict";
const OMRotation=(()=>{
  const supported=client=>OMProtocol.sdkBoard(client.board) ? !!(client.sdkCapabilities&2) : client.firmwareRevision>=24 && client.board?.name===OMProtocol.OTA_MARKER;
  function requireSupport(client){if(!supported(client))throw Error(OMI18n.t("离线日、周、月换图需要 v24 固件，请先升级。"));}
  async function query(client){
    const bytes=await client.request(Uint8Array.of(0x24,0x49,0x52),b=>b[0]===0x58,OMI18n.t("读取自动换图设置"));
    if(bytes.length!==6 || bytes[1]>1 || ![0,3,4,5].includes(bytes[2]) || (bytes[3]>44 && bytes[3]!==255) || (bytes[4]>1 && (bytes[2] || !(client.sdkRevision>=15) || bytes[4]>15)) || bytes[5]>1)
      throw Error(OMI18n.t("自动换图设置回执无效"));
    return {source:bytes[1],frequency:bytes[2],slot:bytes[3],photo:!!bytes[4],active:!!bytes[5]};
  }
  async function read(client){requireSupport(client);const value=await client.operation(()=>query(client));client.offlineRotation=value;return value;}
  async function configure(client,{frequency,slot,source,photo}){
    requireSupport(client);
    if(![0,3,4,5].includes(frequency) || ![0,1].includes(source) || typeof photo!=="boolean")throw Error(OMI18n.t("自动换图参数无效"));
    const device=client.device;
    const result=await client.operation(async()=>{
      if(frequency){
        OMProtocol.integer(slot,0,44,OMI18n.t("图片位置"));
        await client.initialize();const state=await client.storageState(!!source);let count=0;
        for(let index=0;index<state.count;index++){
          const entry=await client.slotMetadata(index,!!source);
          if(entry.valid && !(entry.color&128)){client.storedFormat(entry);count++;}
          if(index===slot && !entry.valid)throw Error(OMI18n.t("所选位置没有图片"));
        }
        if(slot>=state.count || count<2)throw Error(OMI18n.t("至少保存两张图片后才能启用自动换图。"));
        if(client.device!==device || !device.gatt.connected)throw Error(OMI18n.t("目标设备已变化，自动换图未提交"));
        // 0x56 redraws an active calendar; confirm the displayed image without selecting it again.
        if(!await client.readCalendar() || client.config.photoSlot!==slot || client.config.photoSource!==source){
          const error=Error(OMI18n.t("当前图片位置与轮播目标不符，未提交自动换图。"));
          error.code="DISPLAY_NOT_READY";throw error;
        }
      }
      await client.waitForDisplay();
      await client.command(Uint8Array.of(0x26,frequency,photo?1:0));
      const value=await query(client);
      if(value.frequency!==frequency || (frequency && (value.source!==source || value.slot!==slot || value.photo!==photo || !value.active)))
        throw Error(OMI18n.t("自动换图设置读回不符"));
      await client.readCalendar();return value;
    });
    client.offlineRotation=result;return result;
  }
  function presentation(client){
    if(client.offlineRotation?.active && client.config?.mode===1)return client.offlineRotation.photo?"calendar":"full";
    if(client.config?.mode===1 && (client.config.alternate&1))return "calendar";
    return [0,3].includes(client.config?.mode)?"full":null;
  }
  return {supported,read,configure,presentation};
})();
