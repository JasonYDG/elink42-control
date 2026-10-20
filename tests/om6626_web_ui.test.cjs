"use strict";
// Execute the real UI and transport against a DOM/peripheral model. Optical checks use Edge separately.
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=process.env.OM6626_WEB_ROOT||path.resolve(__dirname,"..");
function ui(model=5,ota=false){
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8"),elements=new Map(),packets=[],rendered=[],downloads=[],requests=[],local=new Map();
  const pixels=new Uint8ClampedArray(480000).fill(255);pixels.set([184,25,40,255]);
  const ctx={getImageData:()=>({data:pixels}),putImageData(){},drawImage(){}};
  function element(tag="div",id=""){
    const attrs={},classes=new Set();
    return {id,tagName:tag,children:[],value:"",checked:false,disabled:false,hidden:false,textContent:"",listeners:{},dataset:{},files:[],
      classList:{contains:c=>classes.has(c),toggle(c,on){on?classes.add(c):classes.delete(c);}},setAttribute(k,v){attrs[k]=v;},getAttribute:k=>attrs[k],
      addEventListener(k,f){this.listeners[k]=f;},append(...nodes){this.children.push(...nodes);if(tag==="select"&&!this.value&&nodes.length)this.value=nodes[0].value;},
      replaceChildren(...nodes){this.children=[];if(tag==="select")this.value="";this.append(...nodes);},getContext:()=>ctx,focus(){},
      click(){if(this.download)downloads.push({name:this.download,url:this.href});return this.listeners.click?.();},
      toBlob(callback){callback(new Blob(["PNG"]));},getBoundingClientRect:()=>({width:400}),setPointerCapture(){}};
  }
  for(const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const [whole,tag,attrs,id]=match,e=element(tag,id);e.value=(attrs.match(/\bvalue="([^"]*)"/)||[])[1]||"";e.checked=/\bchecked\b/.test(attrs);
    if(tag==="select")e.value=(html.slice(match.index+whole.length).split("</select>")[0].match(/<option value="([^"]*)"/)||[])[1]||"";
    if(tag==="textarea")e.value=html.slice(match.index+whole.length).split("</textarea>")[0];
    elements.set(id,e);
  }
  const get=id=>{assert.ok(elements.has(id),"missing DOM id "+id);return elements.get(id);};
  const tabs=[...html.matchAll(/<button\b[^>]*id="([^"]+)"[^>]*aria-controls="([^"]+)"[^>]*data-tab="([^"]+)"/g)].map(m=>{
    const b=get(m[1]);b.dataset.tab=m[3];b.setAttribute("aria-controls",m[2]);return b;
  });
  let notify,stored=Array(22).fill(null),chunks=[],target=0,external=false;
  const text=s=>new TextEncoder().encode(s);
  function emit(bytes){control.value=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);notify({target:control});}
  function meta(slot,ext){const b=new Uint8Array(18),v=new DataView(b.buffer);b.set([ext?0x74:0x49,slot]);
    if(stored[slot]){b.set([1,model===5?3:2,0x90,1,0x2c,1],2);v.setUint32(8,30000,true);v.setUint16(12,stored[slot],true);}return b;}
  const control={addEventListener(k,f){notify=f;},removeEventListener(){},async startNotifications(){const c=new Uint8Array(15);c[7]=model;c[11]=1;emit(c);},
    async writeValueWithResponse(bytes){packets.push(bytes.slice());const op=bytes[0];
      if(op===0)emit(Uint8Array.of(0x42,1,...text(ota?"BOARD_ELINK":"BOARD_ZKWEB")));
      if(op===1){emit(text("mtu=180"));emit(text("t=123"));}
      if([5,6,0x20,0x24,0x45,0x50].includes(op))emit(Uint8Array.of(0x51,op,bytes.at(-1),0));
      if(op===0x46||op===0x51){const b=new Uint8Array(36),v=new DataView(b.buffer);b[0]=op===0x46?0x53:0x73;b.set(text("EIMG"),2);
        v.setUint16(6,400,true);v.setUint16(8,300,true);b[10]=model===5?3:2;b[11]=model===5?0x30:0x20;v.setUint32(12,30000,true);v.setUint32(16,32768,true);b[20]=22;b[23]=60;b.fill(255,25,32);
        if(rotation){b[22]=rotation[1];b[23]=rotation[2];b.set(rotation.slice(3),25);}emit(b);}
      if(op===0x4B||op===0x52)emit(meta(bytes[1],op===0x52));
      if(op===0x4A||op===0x54){const b=new Uint8Array(66).fill(255);b[0]=op===0x4A?0x52:0x75;b[1]=bytes[1];emit(b);}
      if(op===0x40||op===0x4C){target=bytes[1];chunks=[];}
      if(op===0x41||op===0x4D)chunks.push(...bytes.slice(1));
      if(op===0x42||op===0x4E)stored[target]=api.P.crc16(new Uint8Array(chunks));
      if(op===0x44||op===0x55)rotation=bytes.slice();
    }};
  let rotation=null;
  const device={name:"GCLab_EPD_test",id:"test-device",addEventListener(){},gatt:{connected:false,async connect(){this.connected=true;return {getPrimaryService:async()=>({getCharacteristic:async()=>control})};},disconnect(){this.connected=false;}}};
  let serial=0,clockTime=Date.now(),interval,respond,confirm=true,requestOptions;
  const windowListeners={};
  device.gatt.getPrimaryService=async()=>({getCharacteristic:async id=>id.startsWith("8ec90001")?{properties:{write:true,notify:true}}:{properties:{writeWithoutResponse:true}}});
  class ClockDate extends Date {constructor(...args){super(...(args.length?args:[clockTime]));}static now(){return clockTime;}}
  const sandbox={TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Float32Array,DataView,Blob,DecompressionStream,AbortSignal,console,
    fetch:(url,options)=>new Promise(resolve=>{requests.push({url,options});respond=value=>resolve({ok:true,json:async()=>value});}),
    Date:ClockDate,setTimeout(callback,ms){const timer=setTimeout(callback,ms);if(ms===30000)timer.unref();return timer;},clearTimeout,setInterval(callback){interval=callback;return 1;},clearInterval(){interval=null;},crypto:{randomUUID:()=>"id-"+(++serial),subtle:require("node:crypto").webcrypto.subtle},URL:{createObjectURL:()=>"blob:test",revokeObjectURL(){}},
    ImageData:class{constructor(data){this.data=data;}},createImageBitmap:async()=>({width:400,height:300,close(){}}),
    localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)},window:{isSecureContext:true,confirm:()=>confirm,addEventListener(k,f){windowListeners[k]=f;}},
    navigator:{bluetooth:{requestDevice:async options=>{requestOptions=options;return device;},getDevices:async()=>[device]}},
    document:{getElementById:get,querySelectorAll:()=>tabs,createElement:tag=>element(tag),documentElement:{dataset:{hosting:"github-pages"}}},
    OMRender:Object.fromEntries(["todos","image","template","course","weather"].map(k=>[k,(...args)=>{rendered.push({kind:k,args});}]))};
  const code=["charset.js","protocol.js","ble.js","features.js","archive.js","ota.js"].map(f=>fs.readFileSync(path.join(root,f),"utf8")).join("\n")+
    "\nOMClient.prototype.pause=async()=>{};\n"+fs.readFileSync(path.join(root,"app.js"),"utf8")+";({P:OMProtocol})";
  const api=vm.runInNewContext(code,sandbox);
  return {get,packets,pixels,rendered,downloads,requests,local,device,stored,windowListeners,confirmation(value){confirm=value;},requestOptions:()=>requestOptions,respond(value){assert.ok(respond);respond(value);},advance(ms){clockTime+=ms;},async tick(){await interval?.();},async click(id){await get(id).listeners.click();await new Promise(setImmediate);},async input(id,value,event="input"){
    get(id).value=value;await get(id).listeners[event]?.({target:get(id)});await new Promise(setImmediate);},async file(id,file){await get(id).listeners.change({target:{files:[file]}});await new Promise(setImmediate);}};
}
test("independent OTA UI verifies project ZIP, requires data-loss consent and cancels before commands",{skip: !process.env.OM6626_OTA_PACKAGE_ROOT},async()=>{
  const u=ui(5,true);await u.click("tab-ota");assert.equal(u.get("ota-start").disabled,true);assert.equal(u.get("preview-panel").hidden,true);
  const fixture=process.env.OM6626_OTA_PACKAGE_ROOT;
  const meta=JSON.parse(fs.readFileSync(path.join(fixture,"independent-ota-manifest.json"),"utf8"));
  const info=meta.variants["fourcolor-jd79668"];
  const bytes=fs.readFileSync(path.join(fixture,info.ota_zip||info.binary.replace(/\.bin$/,".zip")));
  await u.file("ota-file",{name:"independent.zip",size:bytes.length,arrayBuffer:async()=>bytes});
  assert.match(u.get("ota-package").textContent,/JD79668 四色/);assert.match(u.get("ota-kind").textContent,/不恢复原版激活流程/);
  await u.click("connect");assert.ok(u.requestOptions().optionalServices.includes("0000fe59-0000-1000-8000-00805f9b34fb"));
  const before=u.packets.length;await u.click("ota-inspect");assert.match(u.get("ota-service").textContent,/未进入升级/);assert.equal(u.packets.length,before);
  u.get("ota-consent").checked=true;await u.get("ota-consent").listeners.change();assert.equal(u.get("ota-start").disabled,false);
  u.confirmation(false);await u.click("ota-start");assert.equal(u.packets.length,before);
  await u.file("ota-file",{name:"wrong.hex",size:10});assert.equal(u.get("ota-start").disabled,true);
  assert.equal(u.get("ota-consent").checked,false);
});
test("legacy device OTA UI explains wired bootstrap and keeps start disabled",async()=>{
  const u=ui();await u.click("connect");await u.click("tab-ota");
  assert.match(u.get("ota-capability").textContent,/先有线刷入/);assert.equal(u.get("ota-inspect").disabled,true);assert.equal(u.get("ota-start").disabled,true);
});
for(const model of [2,5])test(`UI ${model}: native calendar has no static image frame; clock capability is honest`,async()=>{
  const u=ui(model);assert.equal(u.get("preview-panel").hidden,true);assert.equal(u.get("publish").disabled,true);assert.equal(u.packets.length,0);
  await u.click("connect");assert.equal(u.get("preview-model").value,String(model));assert.equal(u.get("native-calendar").disabled,false);
  assert.equal(u.get("native-clock").disabled,model===5);assert.equal(u.get("led-off").disabled,model!==5);
  await u.click("native-calendar");assert.deepEqual(u.packets.map(p=>p[0]),[0,0x24,1,0x20,0]);assert.equal(u.packets[3][6],1);
  assert.equal(u.rendered.length,0);assert.ok(!u.packets.some(p=>p[0]===3||p[0]===4));
  if(model===5){u.get("clock-full").checked=true;await u.get("clock-full").listeners.change();assert.equal(u.get("native-clock").disabled,false);}
  await u.click("native-clock");assert.equal(u.packets.filter(p=>p[0]===0x20).at(-1)[6],2);
});
for(const model of [2,5])test(`UI ${model}: real todo edit, completion, image and immutable frame transport`,async()=>{
  const u=ui(model);await u.click("connect");await u.click("tab-todo");
  u.get("todo-item-title").value="会议";u.get("todo-description").value="项目复盘";await u.click("todo-add");
  assert.equal(JSON.parse(u.local.get("om6626-workspace-v1")).todos[0].title,"会议");assert.equal(u.rendered.at(-1).kind,"todos");
  assert.equal(u.get("publish").disabled,false);
  const operation=u.click("publish");u.pixels.set([255,210,0,255]);await u.input("rotate","");await operation;
  const start=u.packets.findIndex(p=>p[0]===3&&p[1]===(model===5?0x10:0x24));assert.ok(start>0);
  assert.equal(u.packets.slice(start+1).find(p=>p[0]===4)[1],model===5?0xD5:0xFF);
  await u.click("tab-image");assert.equal(u.get("publish").disabled,true);
  await u.file("image-file",{type:"image/png",size:123,name:"check.png"});assert.equal(u.rendered.at(-1).kind,"image");assert.equal(u.get("publish").disabled,false);
  await u.click("store-frame");assert.ok(u.packets.some(p=>p[0]===(model===5?0x40:0x40)));assert.ok(u.stored[0]);
});
test("template save and workspace export call real validation and persistence",async()=>{
  const u=ui();await u.click("tab-template");u.get("template-name").value="晨间便笺";await u.click("template-save");
  let data=JSON.parse(u.local.get("om6626-workspace-v1"));assert.equal(data.templates[0].name,"晨间便笺");
  await u.click("template-new");u.get("element-text").value="{{date}}";await u.click("element-add");await u.click("template-save");
  data=JSON.parse(u.local.get("om6626-workspace-v1"));assert.equal(data.templates.length,2);assert.equal(data.templates[1].elements[0].text,"{{date}}");
  await u.click("template-export");assert.equal(u.downloads.at(-1).name,"om6626-template.epdtpl");
  await u.click("workspace-export");assert.equal(u.downloads.at(-1).name,"om6626-workspace.json");
});
test("weekly schedule preflights all seven empty slots and then enables Sunday-first native map",async()=>{
  const u=ui();await u.click("connect");await u.click("tab-course");u.get("course-slots").value="0,1,2,3,4,5,6";
  await u.click("course-send-week");assert.ok(u.stored.slice(0,7).every(Boolean));
  assert.deepEqual([...u.packets.find(p=>p[0]===0x44)],[0x44,2,60,6,0,1,2,3,4,5]);
  assert.equal(u.packets.filter(p=>p[0]===0x20).at(-1)[6],3);
  const before=u.packets.length;await u.click("course-send-week");assert.ok(!u.packets.slice(before).some(p=>p[0]===0x40));
  assert.ok(u.get("result").textContent.includes("空槽"));
});
test("page scheduler submits a due one-shot once, disables it before BLE and never replays after completion",async()=>{
  const u=ui();await u.click("connect");u.get("job-title").value="提醒喝水";u.get("job-text").value="测试日程";
  u.get("job-time").value=new Date(Date.now()+120000).toISOString();await u.click("job-add");
  u.advance(121000);const before=u.packets.length;await u.click("scheduler-start");
  assert.ok(u.packets.slice(before).some(p=>p[0]===5));
  const job=JSON.parse(u.local.get("om6626-workspace-v1")).jobs[0];assert.equal(job.enabled,false);assert.match(job.status,/已发送/);
  const after=u.packets.length;await u.tick();assert.equal(u.packets.length,after);
});
test("page scheduler marks stale jobs missed and never overwrites screen with late content",async()=>{
  const u=ui();await u.click("connect");u.get("job-title").value="过期提醒";u.get("job-time").value=new Date(Date.now()+120000).toISOString();await u.click("job-add");
  u.advance(600000);const before=u.packets.length;await u.click("scheduler-start");assert.equal(u.packets.length,before);
  const job=JSON.parse(u.local.get("om6626-workspace-v1")).jobs[0];assert.equal(job.enabled,false);assert.match(job.status,/错过/);
});
test("hosted weather refuses before any network request and exposes a clear local-version message",async()=>{
  const u=ui();u.get("weather-key").value="test-only-not-a-real-key";u.get("weather-consent").checked=true;
  await u.click("weather-fetch");assert.match(u.get("result").textContent,/实时天气需要本地控制端/);
  assert.equal(u.requests.length,0);assert.equal(u.packets.length,0);
});
test("one-click saying uses the public CORS endpoint and never sends a weather key",async()=>{
  const u=ui();u.get("weather-key").value="test-only-not-a-real-key";
  const work=u.click("saying-fetch");u.respond({text:"ELINK browser test"});await work;
  assert.equal(u.requests.length,1);assert.equal(u.requests[0].url,"https://uapis.cn/api/v1/saying");
  assert.equal(u.requests[0].options.credentials,"omit");assert.equal(u.requests[0].options.referrerPolicy,"no-referrer");
  assert.ok(!JSON.stringify(u.requests).includes("test-only-not-a-real-key"));
  assert.equal(u.get("saying-text").textContent,"ELINK browser test");assert.equal(u.packets.length,0);
});

test("OTA rejects an invalid ZIP before any device command",async()=>{
  const u=ui();await u.click("tab-ota");
  await u.file("ota-file",{name:"invalid.zip",size:4,arrayBuffer:async()=>Uint8Array.of(0,1,2,3)});
  assert.match(u.get("ota-package").textContent,/校验未通过/);
  assert.equal(u.get("ota-start").disabled,true);assert.equal(u.packets.length,0);
});
