"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {webcrypto}=require("node:crypto");
const root=process.env.OM6626_WEB_ROOT||path.resolve(__dirname,"..");
const code=["i18n.js","holidays.js","calendar.js","charset.js","protocol.js","ble.js","features.js","archive.js","ota.js"].map(n=>fs.readFileSync(path.join(root,n),"utf8")).join("\n");
const {OTA,Client,P}=vm.runInNewContext(code+";OMI18n.setLanguage('zh');({OTA:OMOTA,Client:OMClient,P:OMProtocol})",{TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Float32Array,DataView,Blob,DecompressionStream,crypto:webcrypto,setTimeout,clearTimeout,console,navigator:{}});

test("explicit refresh failures retain the connection and never become completion",async()=>{
 for(const reason of [1,2,3]){
  const c=new Client();c.ready=true;c.refreshStatus=true;c.device={gatt:{connected:true}};let writes=0;
  c.write=async bytes=>{writes++;const reply=Uint8Array.of(0x51,bytes[0],bytes.at(-1),0xA8,reason,0);for(const w of [...c.pending])if(w.match(reply))w.resolve(reply);};
  await assert.rejects(c.operation(()=>c.command(Uint8Array.of(5))),e=>e.code==="DISPLAY_NOT_READY"&&/SPI|计时器|BUSY/.test(e.message));
  assert.equal(c.device.gatt.connected,true);assert.equal(c.pending.size,0);assert.equal(writes,1);
 }
});
