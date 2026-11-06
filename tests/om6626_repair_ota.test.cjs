"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {webcrypto}=require("node:crypto");
const root=process.env.OM6626_WEB_ROOT||path.resolve(__dirname,"..");
const build=process.env.OM6626_REPAIR_ROOT;
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

test("signed repair package is accepted but v14 is stopped before any DFU control or data write",{skip:!build},async()=>{
 const meta=JSON.parse(fs.readFileSync(path.join(build,"independent-ota-manifest.json"),"utf8"));
 const info=meta.variants["fourcolor-jd79668"],pack=await OTA.parse(fs.readFileSync(path.join(build,info.binary.replace(/\.bin$/,".zip"))));
 assert.equal(pack.revision,16);assert.equal(pack.repaired,true);
 let revision=14,notify,writes=0,reached=false,lookups=0;
 const version={properties:{write:true,notify:true},addEventListener(k,f){notify=f;},removeEventListener(){},async startNotifications(){},async writeValueWithResponse(){
  const b=new Uint8Array(12),v=new DataView(b.buffer);v.setUint32(0,0x5A4B4F54,true);v.setUint32(4,5,true);v.setUint32(8,revision,true);this.value=v;notify({target:this});
 }};
 const control={properties:{write:true,notify:true},addEventListener(){},removeEventListener(){},async startNotifications(){reached=true;throw Error("reached DFU only after revision preflight");},async writeValueWithResponse(){writes++;}};
 const data={properties:{writeWithoutResponse:true},async writeValueWithoutResponse(){writes++;}};
 const client=new Client();client.ready=true;client.config={model:5};client.board={id:1,name:P.OTA_MARKER};
 client.device={id:"972b",gatt:{connected:true,async getPrimaryService(){lookups++;return {async getCharacteristic(id){return id===OTA.VERSION?version:id===OTA.CONTROL?control:data;}};}}};
 const consent={deviceId:"972b",eraseImages:true};
 client.firmwareRevision=14;
 await assert.rejects(client.ota(pack,consent),e=>e.code==="OTA_PRECHECK"&&/v15.*v16/.test(e.message));
 assert.equal(lookups,0);assert.equal(client.device.gatt.connected,true);assert.equal(client.pending.size,0);
 client.firmwareRevision=null;
 await assert.rejects(OTA.transfer(client,pack,consent),/v15.*v16/);assert.equal(writes,0);assert.equal(reached,false);
 client.firmwareRevision=null;
 revision=15;await assert.rejects(OTA.transfer(client,pack,consent),/reached DFU/);assert.equal(reached,true);assert.equal(writes,0);
});

test("native Bluetooth errors keep their identity and record the failed operation",async()=>{
 const logs=[],c=new Client(()=>{},s=>logs.push(s)),failure=Error("灾难性故障");failure.name="UnknownError";
 await assert.rejects(c.bounded(Promise.reject(failure),"只读查询固件版本"),e=>e===failure);
 assert.match(logs[0],/只读查询固件版本.*UnknownError.*灾难性故障/);
});

test("low supply voltage is displayed in volts with exactly two decimal places",async()=>{
 const c=new Client();c.ready=true;c.refreshStatus=true;c.device={gatt:{connected:true}};
 c.write=async b=>{const reply=Uint8Array.of(0x51,b[0],b.at(-1),0xA4,0xF0,0x0A);for(const w of [...c.pending])if(w.match(reply))w.resolve(reply);};
 await assert.rejects(c.operation(()=>c.command(Uint8Array.of(5))),e=>e.code==='DISPLAY_NOT_READY'&&/2\.80 V/.test(e.message));
 assert.equal(c.device.gatt.connected,true);
});
