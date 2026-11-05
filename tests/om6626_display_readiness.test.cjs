"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.OM6626_WEB_ROOT||path.resolve(__dirname,'..');
function device(states){
 let now=Date.now();class ClockDate extends Date{static now(){return now;}}
 const context={Date:ClockDate,TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,DataView,console,setTimeout,clearTimeout,navigator:{}};
 const Client=vm.runInNewContext(['i18n.js','charset.js','protocol.js','ble.js'].map(n=>fs.readFileSync(path.join(root,n),'utf8')).join('\n')+';OMI18n.setLanguage("zh");OMClient',context);
 const client=new Client(),sent=[];let polls=0,init=0;
 client.ready=client.refreshStatus=true;client.lifecycleSupported=true;client.pause=async()=>{now+=250;};
 client.device={gatt:{connected:true,disconnect(){this.connected=false;}}};
 const emit=b=>{client.control.value=new DataView(b.buffer);client.notify({target:client.control});};
 client.control={removeEventListener(){},async writeValueWithResponse(b){
  sent.push([...b]);
  if(b[0]===0x24){const flags=states[Math.min(polls++,states.length-1)];emit(Uint8Array.of(0x51,0x24,b.at(-1),flags));}
  else if(b[0]===1){init++;emit(new TextEncoder().encode('mtu=180'));emit(new TextEncoder().encode('t=0'));}
 }};
 return {client,sent,init:()=>init};
}

test('initialization waits for native activity, wakes sleeping panel once, then waits for real readiness',async()=>{
 const r=device([0xA3,0xA1,0xA1,0xA0]);
 await r.client.initialize();
 assert.deepEqual(r.sent.map(b=>b[0]),[0x24,0x24,1,0x24,0x24]);
 assert.equal(r.init(),1);assert.equal(r.client.device.gatt.connected,true);
});
test('legacy lifecycle prevents unsafe initialization while leaving the OTA connection available',async()=>{
 const r=device([1]);
 await assert.rejects(r.client.operation(()=>r.client.initialize()),/v9/);
 assert.equal(r.init(),0);assert.equal(r.client.device.gatt.connected,true);
});

test('legacy photo publishing stops before pausing the calendar or sending image data',async()=>{
 const r=device([0]);r.client.config={model:5};
 await assert.rejects(r.client.publish({packed:new Uint8Array(30000)},()=>{}),/v9/);
 assert.deepEqual(r.sent.map(b=>b[0]),[0x24]);assert.equal(r.client.device.gatt.connected,true);
});
test('a confirmed BUSY result preserves Bluetooth and never retries the refresh',async()=>{
 const r=device([0xA0]);
 r.client.control.writeValueWithResponse=async b=>{r.sent.push([...b]);const raw=Uint8Array.of(0x51,b[0],b.at(-1),0xA1);r.client.control.value=new DataView(raw.buffer);r.client.notify({target:r.client.control});};
 await assert.rejects(r.client.operation(()=>r.client.command(Uint8Array.of(5))),/BUSY|仍忙/);
 assert.equal(r.client.device.gatt.connected,true);assert.equal(r.sent.length,1);
});

test('permanent panel BUSY times out without retrying initialization or dropping Bluetooth',async()=>{
 const r=device([0xA0,0xA1]);
 await assert.rejects(r.client.operation(()=>r.client.initialize()),/仍未就绪/);
 assert.equal(r.init(),1);assert.equal(r.client.device.gatt.connected,true);assert.equal(r.client.pending.size,0);
 assert.ok(r.sent.length<270);assert.ok(r.sent.every(b=>[1,0x24].includes(b[0])));
});

test('permanent native activity never sends initialization or a display mutation',async()=>{
 const r=device([0xA3]);
 await assert.rejects(r.client.operation(()=>r.client.initialize()),/仍未就绪/);
 assert.equal(r.init(),0);assert.ok(r.sent.every(b=>b[0]===0x24));assert.equal(r.client.device.gatt.connected,true);
});

test('unknown readiness flags fail closed before initialization',async()=>{
 const r=device([0x84]);await assert.rejects(r.client.operation(()=>r.client.initialize()),/回执无效/);
 assert.equal(r.init(),0);assert.equal(r.sent.length,1);assert.equal(r.client.device.gatt.connected,false);
});

test("v8 readiness without timing recovery cannot initialize or refresh",async()=>{const r=device([0x80]);await assert.rejects(r.client.operation(()=>r.client.initialize()),/v9/);assert.deepEqual(r.sent.map(b=>b[0]),[0x24]);assert.equal(r.init(),0);assert.equal(r.client.device.gatt.connected,true);});
