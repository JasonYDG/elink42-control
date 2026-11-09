"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.OM6626_WEB_ROOT||path.resolve(__dirname,'..');
const code=['i18n.js','holidays.js','calendar.js','charset.js','protocol.js','ble.js','features.js','archive.js','ota.js','firmware.js'].map(n=>fs.readFileSync(path.join(root,n),'utf8')).join('\n');
const {OTA,Client,P,A,F}=vm.runInNewContext(code+';OMI18n.setLanguage("zh");({OTA:OMOTA,Client:OMClient,P:OMProtocol,A:OMArchive,F:OMFirmware})',{
 TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Float32Array,DataView,Blob,DecompressionStream,crypto:require('node:crypto').webcrypto,
 setTimeout:(f,ms)=>setTimeout(f,ms===2000?0:ms),clearTimeout,console,navigator:{}});
const bytes=Buffer.from(F.legacy.packages[2].data,'base64'),parsed=OTA.parse(bytes);

function storedZip(files){
 const local=[],central=[];let offset=0;
 for(const [name,input] of files){
  const data=Buffer.from(input),n=Buffer.from(name),crc=A.crc32(data),h=Buffer.alloc(30),c=Buffer.alloc(46);
  h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);
  c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
  local.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length;
 }
 const end=Buffer.alloc(22),directory=Buffer.concat(central);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}

function peripheral(model,current,options={}){
 const log=[],client=new Client(()=>{},s=>log.push(s)),installed=[],received=[],commands=[],appCommands=[];
 let controlListener,versionListener,type=0,offset=0,crc=0,count=0,prn=16,command=[],image=[],pending;
 const reply=(op,payload=[])=>{const b=Uint8Array.of(0x60,op,1,...payload);control.value=new DataView(b.buffer);controlListener?.({target:control});};
 const checksum=()=>{const b=new Uint8Array(8),v=new DataView(b.buffer);v.setUint32(0,offset,true);v.setUint32(4,crc,true);return b;};
 const control={properties:{write:true,notify:true},addEventListener(k,f){controlListener=f;},removeEventListener(){controlListener=null;},async startNotifications(){},async writeValueWithResponse(b){
  commands.push([...b]);const op=b[0];
  if(op===6){type=b[1];offset=crc=count=0;const v=new Uint8Array(12);new DataView(v.buffer).setUint32(0,type===1?104:238532,true);reply(op,v);}
  else if(op===1){offset=crc=count=0;if(type===1)command=[];else image=[];reply(op);}
  else if(op===2){prn=b[1];reply(op);}
  else if(op===3)reply(op,checksum());
  else if(op===4){if(type===2){pending=new DataView(Uint8Array.from(command).buffer).getUint32(16,true);received.push({revision:pending,command:Uint8Array.from(command),image:Uint8Array.from(image)});}reply(op);}
 }};
 const data={properties:{writeWithoutResponse:true},async writeValueWithoutResponse(b){assert.equal(client.otaActive,true);assert.equal(client.busy,true);(type===1?command:image).push(...b);offset+=b.length;crc=A.crc32(b,crc);if(++count===prn){count=0;reply(3,checksum());}}};
 const version={properties:{write:true,notify:true},addEventListener(k,f){versionListener=f;},removeEventListener(){versionListener=null;},async startNotifications(){},async writeValueWithResponse(){
  const b=new Uint8Array(12),v=new DataView(b.buffer);v.setUint32(0,0x5A4B4F54,true);v.setUint32(4,model,true);v.setUint32(8,current,true);this.value=v;versionListener({target:this});
 }};
 const device={id:'bundle-target',gatt:{connected:true,disconnect(){this.connected=false;client.disconnected({target:device});},async getPrimaryService(){return {async getCharacteristic(id){return id===OTA.VERSION?version:id===OTA.CONTROL?control:data;}};}}};
 const appControl={removeEventListener(){},async writeValueWithResponse(b){
  appCommands.push([...b]);assert.equal(client.otaActive,true);assert.equal(client.busy,true);
  let reply;
  const flags=(model===2?1:0)|(current>=8?0x80:0)|(current>=9?0x20:0);
  if(b[0]===0x24 && b[1]===0x44){const mv=options.voltage??2900;reply=Uint8Array.of(0x59,b[2],model,options.adcError??0,mv&255,mv>>8,0x2b,0x97,0xc4,0xb3,0xa2,0xd1);}
  else if(b[0]===0x20){assert.deepEqual([...b.slice(1,7)],[0,0,0,0,0,0]);reply=options.pauseFailure?Uint8Array.of(0x51,0x20,b.at(-1),0xA8,2,0):Uint8Array.of(0x51,0x20,b.at(-1),flags);}
  else if(b[0]===0x24 && b[1]===0x4A)reply=Uint8Array.of(0x55,2,0x4A,0,options.badQuiet?1:0,255,0);
  else {assert.equal(b[0],0x24);reply=Uint8Array.of(0x51,0x24,b.at(-1),flags);}
  this.value=new DataView(reply.buffer);client.notify({target:this});
 }};
 Object.assign(client,{ready:true,device,control:appControl,refreshStatus:!options.noStatus,config:{model},board:{id:1,name:P.OTA_MARKER},firmwareRevision:current});
 client.openConnection=async()=>{assert.equal(client.otaActive,true);current=options.badBoot===pending?pending-1:pending;installed.push(current);device.gatt.connected=true;client.ready=true;client.refreshStatus=true;client.firmwareRevision=null;if(options.changeTarget===pending)client.device={...device,id:'different-target'};};
 return {client,device,installed,received,commands,appCommands,log};
}
const consent={deviceId:'bundle-target',eraseImages:true};

test('public v32 bundle verifies all twelve signed images and exact five-family pairings',async()=>{
 const b=await parsed;assert.equal(F.revision,33);assert.equal(F.legacy.revision,32);assert.equal(F.legacy.packages[2],F.legacy.packages[5]);assert.equal(b.bundleVersion,7);assert.equal(b.sha256,F.legacy.packages[2].sha256);
 for(const model of [2,5])for(const family of ['legacy','repaired','stable','hardened'])assert.deepEqual(Array.from(b.models[model][family],p=>[p.model,p.revision]),[[model,31],[model,32]]);
 for(const model of [2,5])assert.deepEqual(Array.from(b.models[model].boot,p=>[p.model,p.revision]),[[model,30],[model,32]]);
});
for(const model of [2,5])for(const revision of [30,32])test(`model ${model}: v${revision} selects its signed v33 image and transfers once`,async()=>{
 const embedded=F.packages[model],p=await OTA.parse(Buffer.from(embedded.data,'base64'));
 assert.equal(F.revision,33);assert.equal(p.model,model);assert.equal(p.revision,33);assert.equal(p.bundle,undefined);
 assert.equal(require('node:crypto').createHash('sha256').update(Buffer.from(embedded.data,'base64')).digest('hex'),embedded.sha256);
 assert.equal(require('node:crypto').createHash('sha256').update(p.bin).digest('hex'),p.sha256);
 const r=peripheral(model,revision);await r.client.ota(p,consent,()=>{});
 assert.deepEqual(r.installed,[33]);assert.equal(r.received.length,1);assert.deepEqual(r.received[0].image,p.bin);
 assert.equal(r.client.firmwareRevision,33);assert.equal(r.client.pending.size,0);
});
for(const model of [2,5])test(`model ${model}: the other panel's embedded v33 is rejected before writes`,async()=>{
 const r=peripheral(model,32),p=await OTA.parse(Buffer.from(F.packages[model===2?5:2].data,'base64'));
 await assert.rejects(r.client.ota(p,consent),/屏型不匹配/);assert.equal(r.commands.length,0);assert.equal(r.appCommands.length,0);
});
test('bundle rejects extra entries, incomplete stages, swapped panels and wrong receiver foundations',async()=>{
 for(const mutate of [f=>f.set('extra',Uint8Array.of(1)),f=>f.delete('model2-legacy-v31.zip'),f=>f.set('model2-legacy-v31.zip',f.get('model5-legacy-v31.zip')),f=>f.set('model2-legacy-v31.zip',f.get('model2-repaired-v31.zip')),f=>f.set('model2-stable-v31.zip',f.get('model2-repaired-v31.zip'))]){
  const files=await A.unzip(bytes);mutate(files);await assert.rejects(OTA.parse(storedZip(files)),/整合 OTA/);
 }
});
for(const model of [2,5])for(const current of [3,4,5,6,7,8,9,10,11,12,13,14,16,17,19,21,24,28])test(`model ${model}: v${current} installs matching v31 then v32 exactly twice`,async()=>{
 const b=await parsed,r=peripheral(model,current),progress=[];const out=await r.client.ota(b,consent,(p,s)=>progress.push([p,s]));
 assert.equal(out.status,'boot-verified');assert.equal(out.revision,32);assert.deepEqual(r.installed,[31,32]);
 const family=current<15?'legacy':current<18?'repaired':current<28?'stable':'hardened';
 for(const [i,p] of b.models[model][family].entries()){assert.deepEqual(r.received[i].command,p.dat);assert.deepEqual(r.received[i].image,p.bin);}
 assert.equal(r.client.otaActive,false);assert.equal(r.client.busy,false);assert.equal(r.client.firmwareRevision,32);assert.equal(r.client.pending.size,0);
 assert.equal(r.appCommands.filter(b=>b[0]===0x20).length,2);assert.ok(r.appCommands.every(b=>[0x20,0x24].includes(b[0])));
 assert.ok(progress.every(([p],i)=>i===0||p>=progress[i-1][0]));assert.equal(progress.at(-1)[0],100);
});
for(const model of [2,5])test(`model ${model}: verified quiet v31 resumes in one write`,async()=>{
 const r=peripheral(model,31);await r.client.ota(await parsed,consent);assert.deepEqual(r.installed,[32]);assert.deepEqual(r.received.map(p=>p.revision),[32]);
});
for(const model of [2,5])test(`model ${model}: v29 uses pinned v30 then v32, while v30 updates once`,async()=>{
 const bundle=await parsed;
 const pinned={2:'ca6ef84238c69dfbe2d81f006a2efede972ac8f354a9ca70e8d4a922b9426813',5:'f2db138c05622f0f50782be6e6ecd5d54445277a5ec1adbea785ed0d9fe7618d'};
 assert.equal(bundle.models[model].boot[0].sha256,pinned[model]);
 for(const current of [29,30]){const r=peripheral(model,current);await r.client.ota(bundle,consent);assert.deepEqual(r.installed,current===29?[30,32]:[32]);}
});
for(const options of [{voltage:2899},{voltage:0,adcError:4}])test(`v32 OTA precheck ${JSON.stringify(options)} preserves BLE before erasing`,async()=>{
 const r=peripheral(5,32,options),pack=(await parsed).models[5].legacy[1];
 await assert.rejects(r.client.ota(pack,consent),e=>e.code==='OTA_PRECHECK');
 assert.equal(r.commands.length,0);assert.equal(r.received.length,0);assert.equal(r.device.gatt.connected,true);
 assert.deepEqual(r.appCommands.map(b=>b.slice(0,2)),[[0x24,0x44]]);
});
test('v32 OTA at 2.90 V passes its separate gate',async()=>{
 const r=peripheral(5,32,{voltage:2900}),pack=(await parsed).models[5].legacy[1];
 await r.client.ota(pack,consent,()=>{});assert.deepEqual(r.installed,[32]);assert.ok(r.appCommands.some(b=>b[0]===0x24 && b[1]===0x44));
});
test('unverified first reboot stops without installing v32',async()=>{
 const r=peripheral(5,14,{badBoot:31});await assert.rejects(r.client.ota(await parsed,consent),/版本不匹配/);
 assert.deepEqual(r.received.map(p=>p.revision),[31]);assert.equal(r.client.pending.size,0);assert.equal(r.client.otaActive,false);
});
test('changed device after first reboot stops before the next stage',async()=>{
 const r=peripheral(5,14,{changeTarget:31});await assert.rejects(r.client.ota(await parsed,consent),/目标设备发生变化/);assert.deepEqual(r.received.map(p=>p.revision),[31]);
});
test('missing consent and already-current v32 never send DFU control/data',async()=>{
 const a=peripheral(5,14);await assert.rejects(a.client.ota(await parsed,{}),/确认目标/);assert.equal(a.commands.length,0);
 const b=peripheral(5,32);await assert.rejects(b.client.ota(await parsed,consent),e=>e.code==='OTA_PRECHECK');assert.equal(b.commands.length,0);assert.equal(b.device.gatt.connected,true);
});
for(const current of [1,2,15,18,20,23,27])test(`unsupported v${current} stops before any device command`,async()=>{
 const r=peripheral(5,current);await assert.rejects(r.client.ota(await parsed,consent),e=>e.code==='OTA_PRECHECK');assert.equal(r.commands.length,0);assert.equal(r.appCommands.length,0);assert.equal(r.device.gatt.connected,true);
});
for(const current of [14,24,28,31])test(`v${current}: non-quiet receiver prevents the next write without replay`,async()=>{
 const r=peripheral(5,current,{badQuiet:true});await assert.rejects(r.client.ota(await parsed,consent),e=>e.code==='DISPLAY_NOT_READY');assert.deepEqual(r.received.map(p=>p.revision),current===31?[]:[31]);assert.equal(r.device.gatt.connected,true);
});
test('missing pause acknowledgments fails before DFU writes',async()=>{
 const r=peripheral(5,14,{noStatus:true});await assert.rejects(r.client.ota(await parsed,consent),e=>e.code==='OTA_PRECHECK');assert.equal(r.commands.length,0);assert.equal(r.appCommands.length,0);
});
for(const current of [3,5,8,10,14,16,19,21,24,28])test(`direct v${current} to hardened v32 cannot bypass its matching v31`,async()=>{
 const r=peripheral(5,current);await assert.rejects(r.client.ota((await parsed).models[5].legacy[1],consent),e=>e.code==='OTA_PRECHECK');assert.equal(r.commands.length,0);assert.equal(r.appCommands.length,0);
});
for(const current of [3,5,8])test(`v${current} pause failure stops before any DFU control or data write`,async()=>{
 const r=peripheral(5,current,{pauseFailure:true});await assert.rejects(r.client.ota(await parsed,consent),e=>e.code==='DISPLAY_NOT_READY');assert.equal(r.commands.length,0);assert.equal(r.received.length,0);assert.equal(r.device.gatt.connected,true);
});
test('a confirmed Flash rejection keeps Bluetooth connected and never retries the rejected write',async()=>{
 const r=peripheral(5,31),service=await r.device.gatt.getPrimaryService(),control=await service.getCharacteristic(OTA.CONTROL),original=control.writeValueWithResponse;
 control.writeValueWithResponse=async b=>{if(b[0]===1){r.commands.push([...b]);const reply=Uint8Array.of(0x60,1,132);control.value=new DataView(reply.buffer);for(const waiter of [...r.client.pending])if(waiter.match(reply))waiter.resolve(reply);}else await original(b);};
 await assert.rejects(r.client.ota(await parsed,consent),e=>e.code==='OTA_PRECHECK');assert.equal(r.commands.filter(b=>b[0]===1).length,1);assert.equal(r.device.gatt.connected,true);assert.equal(r.client.pending.size,0);assert.equal(r.received.length,0);
});
