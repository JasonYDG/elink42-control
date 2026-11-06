"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.OM6626_WEB_ROOT||path.resolve(__dirname,'..');
const code=['i18n.js','holidays.js','calendar.js','charset.js','protocol.js','ble.js','features.js','archive.js','ota.js','firmware.js'].map(n=>fs.readFileSync(path.join(root,n),'utf8')).join('\n');
const {OTA,Client,P,A,F}=vm.runInNewContext(code+';OMI18n.setLanguage("zh");({OTA:OMOTA,Client:OMClient,P:OMProtocol,A:OMArchive,F:OMFirmware})',{
 TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Float32Array,DataView,Blob,DecompressionStream,crypto:require('node:crypto').webcrypto,
 setTimeout:(f,ms)=>setTimeout(f,ms===2000?0:ms),clearTimeout,console,navigator:{}});
const bytes=Buffer.from(F.packages[2].data,'base64'),parsed=OTA.parse(bytes);

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
 const log=[],client=new Client(()=>{},s=>log.push(s)),installed=[],received=[],commands=[];
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
 Object.assign(client,{ready:true,device,config:{model},board:{id:1,name:P.OTA_MARKER},firmwareRevision:current});
 client.openConnection=async()=>{assert.equal(client.otaActive,true);current=options.badBoot===pending?pending-1:pending;installed.push(current);device.gatt.connected=true;client.ready=true;client.firmwareRevision=null;if(options.changeTarget===pending)client.device={...device,id:'different-target'};};
 return {client,device,installed,received,commands,log};
}
const consent={deviceId:'bundle-target',eraseImages:true};

test('public embedded bundle verifies all six signed images and exact transition pairings',async()=>{
 const b=await parsed;assert.equal(F.revision,17);assert.equal(F.packages[2],F.packages[5]);assert.equal(b.bundle,true);assert.equal(b.sha256,F.packages[2].sha256);
 for(const model of [2,5])assert.deepEqual(Array.from(b.models[model],p=>[p.model,p.revision]),[[model,15],[model,16],[model,17]]);
});
test('bundle rejects extra entries, incomplete stages and swapped signed panel images',async()=>{
 for(const mutate of [files=>files.set('extra',Uint8Array.of(1)),files=>files.delete('model2-v15.zip'),files=>files.set('model2-v15.zip',files.get('model5-v15.zip'))]){
  const files=await A.unzip(bytes);mutate(files);await assert.rejects(OTA.parse(storedZip(files)),/整合 OTA/);
 }
});
for(const model of [2,5])test(`model ${model}: v14 installs v15/v16/v17 once, reads each boot and retains one operation lock`,async()=>{
 const b=await parsed,r=peripheral(model,14),progress=[];const out=await r.client.ota(b,consent,(p,s)=>progress.push([p,s]));
 assert.equal(out.status,'boot-verified');assert.equal(out.revision,17);assert.deepEqual(r.installed,[15,16,17]);
 for(const [i,p] of b.models[model].entries()){assert.deepEqual(r.received[i].command,p.dat);assert.deepEqual(r.received[i].image,p.bin);}
 assert.equal(r.client.otaActive,false);assert.equal(r.client.busy,false);assert.equal(r.client.firmwareRevision,17);assert.equal(r.client.pending.size,0);
 assert.ok(progress.every(([p],i)=>i===0||p>=progress[i-1][0]));assert.equal(progress.at(-1)[0],100);
});
for(const [current,want] of [[15,[16,17]],[16,[17]]])test(`v${current} skips completed stages`,async()=>{
 const r=peripheral(5,current);await r.client.ota(await parsed,consent);assert.deepEqual(r.installed,want);assert.deepEqual(r.received.map(p=>p.revision),want);
});
test('unverified first reboot stops the entire chain without installing v16 or v17',async()=>{
 const r=peripheral(5,14,{badBoot:15});await assert.rejects(r.client.ota(await parsed,consent),/版本不匹配/);
 assert.deepEqual(r.received.map(p=>p.revision),[15]);assert.equal(r.client.pending.size,0);assert.equal(r.client.otaActive,false);
});
test('changed device after first reboot stops before the next stage',async()=>{
 const r=peripheral(5,14,{changeTarget:15});await assert.rejects(r.client.ota(await parsed,consent),/目标设备发生变化/);
 assert.deepEqual(r.received.map(p=>p.revision),[15]);
});
test('missing consent and already-current v17 never send DFU control/data',async()=>{
 const a=peripheral(5,14);await assert.rejects(a.client.ota(await parsed,{}),/确认目标/);assert.equal(a.commands.length,0);
 const b=peripheral(5,17);await assert.rejects(b.client.ota(await parsed,consent),e=>e.code==='OTA_PRECHECK');assert.equal(b.commands.length,0);assert.equal(b.device.gatt.connected,true);
});
