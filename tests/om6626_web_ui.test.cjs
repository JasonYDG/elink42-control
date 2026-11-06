"use strict";
// Execute the real UI and transport against a DOM/peripheral model. Optical checks use Edge separately.
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=process.env.OM6626_WEB_ROOT||path.resolve(__dirname,"..");
const firmwareFixture=process.env.OM6626_OTA_PACKAGE_ROOT||path.resolve(__dirname,"../../build/elink42-calendar-0.6.5");
const firmwareMetadata=fs.existsSync(path.join(firmwareFixture,"independent-ota-manifest.json"))?JSON.parse(fs.readFileSync(path.join(firmwareFixture,"independent-ota-manifest.json"),"utf8")):null;
function firmwareZip(){const info=firmwareMetadata.variants["fourcolor-jd79668"];return fs.readFileSync(path.join(firmwareFixture,info.ota_zip||info.binary.replace(/\.bin$/,".zip")));}
function ui(model=5,ota=false,language="zh",international=true,initial={}){
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8"),elements=new Map(),packets=[],rendered=[],downloads=[],local=new Map();
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
  let notify,stored=Array(22).fill(null),chunks=[],target=0,external=false,calendarOption=initial.flags||0,calendarCountry=initial.country||0,calendarMode=initial.mode||0,photoSlot=initial.slot??255,photoSource=initial.source||0;
  const text=s=>new TextEncoder().encode(s);
  function emit(bytes){control.value=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);notify({target:control});}
  function meta(slot,ext){const b=new Uint8Array(18),v=new DataView(b.buffer);b.set([ext?0x74:0x49,slot]);
    if(stored[slot]){b.set([1,model===5?3:2,0x90,1,0x2c,1],2);v.setUint32(8,30000,true);v.setUint16(12,stored[slot],true);}return b;}
  const control={addEventListener(k,f){notify=f;},removeEventListener(){},async startNotifications(){const c=new Uint8Array(15);c[7]=model;c[11]=1;emit(c);},
    async writeValueWithResponse(bytes){packets.push(bytes.slice());const op=bytes[0];
      if(op===0x23 && bytes[1]<=1)calendarOption=bytes[1];
      if(op===0x20)calendarMode=bytes[6];
      if(op===0x56){photoSlot=bytes[1];photoSource=bytes[2];}
      if(op===0x24 && bytes[1]===0x4A && international){if(bytes.length===5 && calendarMode===0){calendarCountry=bytes[2];calendarOption=bytes[3];}emit(Uint8Array.of(0x55,calendarOption,0x4A,calendarCountry,calendarMode,photoSlot,photoSource));return;}
      if(op===0x24 && bytes.length===1){emit(Uint8Array.of(0x55,calendarOption));return;}
      if(op===0x24 && bytes.length===3 && bytes[1]===0x49 && international){emit(Uint8Array.of(0x55,calendarOption,0x49));return;}
      if(op===0)emit(Uint8Array.of(0x42,1,...text(ota?"BOARD_ELINK":"BOARD_ZKWEB")));
      if(op===1){emit(text("mtu=180"));emit(text("t=123"));}
      if([5,6,0x20,0x24,0x45,0x50].includes(op))emit(Uint8Array.of(0x51,op,bytes.at(-1),0xA0));
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
  let serial=0,clockTime=Date.now(),interval,respond,confirm=initial.confirm??true,requestOptions;
  const alerts=[],confirmations=[],idleTimers=new Map(),versionQueries=[];
  const windowListeners={};
  let versionListener;
  const version={properties:{write:true,notify:true},addEventListener(k,f){versionListener=f;},removeEventListener(){versionListener=null;},async startNotifications(){},
    async writeValueWithResponse(bytes){versionQueries.push([...bytes]);const b=new Uint8Array(12),v=new DataView(b.buffer);
      v.setUint32(0,0x5A4B4F54,true);v.setUint32(4,initial.versionModel??model,true);v.setUint32(8,initial.revision??9,true);
      this.value=new DataView(b.buffer);versionListener({target:this});}};
  device.gatt.getPrimaryService=async()=>({getCharacteristic:async id=>{
    if(id==="00000003-0000-1000-8000-00805f9b34fb"){if(initial.versionFailure)throw Error("version unavailable");return version;}
    return id.startsWith("8ec90001")?{properties:{write:true,notify:true}}:{properties:{writeWithoutResponse:true}};
  }});
  class ClockDate extends Date {constructor(...args){super(...(args.length?args:[clockTime]));}static now(){return clockTime;}}
  const sandbox={TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Float32Array,DataView,Blob,DecompressionStream,AbortSignal,console,
    fetch:()=>new Promise(resolve=>{respond=value=>resolve({ok:true,json:async()=>value});}),
    Date:ClockDate,atob,setTimeout(callback,ms){const timer=setTimeout(callback,ms);if(ms===30000)timer.unref();if(ms===180000)idleTimers.set(timer,callback);return timer;},clearTimeout(timer){idleTimers.delete(timer);clearTimeout(timer);},setInterval(callback){interval=callback;return 1;},clearInterval(){interval=null;},crypto:{randomUUID:()=>"id-"+(++serial),subtle:require("node:crypto").webcrypto.subtle},URL:{createObjectURL:()=>"blob:test",revokeObjectURL(){}},
    ImageData:class{constructor(data){this.data=data;}},createImageBitmap:async()=>({width:400,height:300,close(){}}),
    localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)},window:{isSecureContext:true,alert:text=>alerts.push(text),confirm:text=>{confirmations.push(text);return confirm;},addEventListener(k,f){windowListeners[k]=f;}},
    navigator:{bluetooth:{requestDevice:async options=>{requestOptions=options;return device;},getDevices:async()=>[device]}},
    document:{getElementById:get,querySelectorAll:()=>tabs,createElement:tag=>element(tag),documentElement:{dataset:{}}},
    OMRender:Object.fromEntries(["calendar","todos","image","template","course","weather"].map(k=>[k,(...args)=>{rendered.push({kind:k,args});}]))};
  const code=["i18n.js","holidays.js","calendar.js","charset.js","protocol.js","ble.js","features.js","archive.js","ota.js","firmware.js"].map(f=>fs.readFileSync(path.join(root,f),"utf8")).join("\n")+
    `\nOMI18n.setLanguage('${language}');OMClient.prototype.pause=async()=>{};${initial.otaBootRevision?'OMClient.prototype.ota=async()=>({status:"boot-verified"});':''}${initial.defaultFails?'OMClient.prototype.internationalCalendar=async()=>{throw Error("refresh unconfirmed");};':''}\n`+fs.readFileSync(path.join(root,"app.js"),"utf8")+";({P:OMProtocol})";
  const api=vm.runInNewContext(code,sandbox);
  return {get,packets,pixels,rendered,downloads,local,device,stored,windowListeners,alerts,confirmations,versionQueries,idleTimers,expireIdle(){const [timer,callback]=[...idleTimers].at(-1);clearTimeout(timer);idleTimers.delete(timer);callback();},confirmation(value){confirm=value;},requestOptions:()=>requestOptions,respond(value){assert.ok(respond);respond(value);},advance(ms){clockTime+=ms;},async tick(){await interval?.();},async click(id){await get(id).listeners.click();await new Promise(setImmediate);},async input(id,value,event="input"){
    get(id).value=value;await get(id).listeners[event]?.({target:get(id)});await new Promise(setImmediate);},async file(id,file){await get(id).listeners.change({target:{files:[file]}});await new Promise(setImmediate);}};
}

for(const model of [2,5])test(`UI ${model}: old firmware prompts and loads the matching bundled signed v11 without starting OTA`,async()=>{
  const u=ui(model,true,"zh",true,{revision:10});await u.click("connect");
  assert.deepEqual(u.versionQueries,[[0]]);assert.equal(u.confirmations.length,1);
  assert.match(u.confirmations[0],/v10.*v11.*清空图库/);assert.match(u.get("firmware-state").textContent,/v10/);
  assert.equal(u.get("tab-ota").getAttribute("aria-selected"),"true");
  assert.match(u.get("ota-package").textContent,new RegExp(model===5?"JD79668 四色":"SSD1619 三色"));
  assert.match(u.get("ota-package").textContent,/版本 11/);assert.match(u.get("ota-kind").textContent,/校验通过/);
  assert.equal(u.get("ota-consent").checked,false);assert.equal(u.get("ota-start").disabled,true);
  assert.ok(!u.packets.some(p=>[5,6,0x20].includes(p[0])));
});
test("declining update leaves the page and package unchanged; the bundled button remains available",async()=>{
  const u=ui(5,true,"en",true,{revision:1,confirm:false});await u.click("connect");
  assert.match(u.confirmations[0],/Current firmware v1; latest firmware v11/);
  assert.equal(u.get("tab-calendar").getAttribute("aria-selected"),"true");assert.equal(u.get("ota-bundled").disabled,false);
  await u.click("ota-bundled");assert.match(u.get("ota-package").textContent,/revision 11/);
});
for(const revision of [11,12])test(`firmware v${revision} is not prompted or offered a bundled downgrade`,async()=>{
  const u=ui(5,true,"zh",true,{revision});await u.click("connect");
  assert.equal(u.confirmations.length,0);assert.equal(u.get("ota-bundled").disabled,true);
  await u.click("ota-bundled");assert.match(u.get("result").textContent,/固件已是最新/);
});
for(const initial of [{versionFailure:true},{versionModel:2}])test(`unverified firmware cannot trigger a bundled upgrade: ${JSON.stringify(initial)}`,async()=>{
  const u=ui(5,true,"zh",true,initial);await u.click("connect");
  assert.equal(u.confirmations.length,0);assert.equal(u.get("ota-start").disabled,true);
  assert.match(u.get("result").textContent,/无法核对固件版本/);
});
test("idle timeout disconnects first, reports the reason and displays one popup; user input resets the timer",async()=>{
  const u=ui();await u.click("connect");let timer=[...u.idleTimers.keys()][0];
  for(const event of ["pointerdown","keydown","input","wheel"]){u.windowListeners[event]();const next=[...u.idleTimers.keys()][0];assert.notEqual(next,timer);timer=next;}
  u.expireIdle();assert.equal(u.device.gatt.connected,false);assert.equal(u.get("connection-state").textContent,"未连接");
  assert.equal(u.alerts.length,1);assert.match(u.alerts[0],/空闲 3 分钟.*重新连接/);
  assert.match(u.get("result").textContent,/空闲 3 分钟/);assert.equal(u.idleTimers.size,0);
});
test("manual disconnect does not display an idle popup",async()=>{
  const u=ui();await u.click("connect");await u.click("disconnect");assert.equal(u.alerts.length,0);assert.equal(u.idleTimers.size,0);
});

test("OTA tab cancels idle timers, rejects an already queued timeout and restarts a full interval on exit",async()=>{
  const u=ui();await u.click("connect");const stale=[...u.idleTimers.values()][0];assert.ok(stale);
  await u.click("tab-ota");assert.equal(u.idleTimers.size,0);
  for(const event of ["pointerdown","keydown","input","wheel"])u.windowListeners[event]();
  stale();assert.equal(u.device.gatt.connected,true);assert.equal(u.idleTimers.size,0);assert.equal(u.alerts.length,0);
  await u.click("tab-settings");assert.equal(u.idleTimers.size,1);
  u.expireIdle();assert.equal(u.device.gatt.connected,false);assert.equal(u.alerts.length,1);
});

test("connecting from OTA keeps that tab active and does not arm idle disconnect",async()=>{
  const u=ui();await u.click("tab-ota");await u.click("connect");
  assert.equal(u.get("tab-ota").getAttribute("aria-selected"),"true");assert.equal(u.idleTimers.size,0);
  await u.click("tab-calendar");assert.equal(u.idleTimers.size,1);
});
test("independent OTA UI verifies project ZIP, requires data-loss consent and cancels before commands",{skip:!firmwareMetadata},async()=>{
  const u=ui(5,true);await u.click("tab-ota");assert.equal(u.get("ota-start").disabled,true);assert.equal(u.get("preview-panel").hidden,true);
  const bytes=firmwareZip();
  await u.file("ota-file",{name:"independent.zip",size:bytes.length,arrayBuffer:async()=>bytes});
  assert.match(u.get("ota-package").textContent,/JD79668 四色/);assert.match(u.get("ota-kind").textContent,/不恢复原版激活流程/);
  await u.click("connect");assert.ok(u.requestOptions().optionalServices.includes("0000fe59-0000-1000-8000-00805f9b34fb"));
  const before=u.packets.length;await u.click("ota-inspect");assert.match(u.get("ota-service").textContent,/未进入升级/);assert.equal(u.packets.length,before);
  u.get("ota-consent").checked=true;await u.get("ota-consent").listeners.change();assert.equal(u.get("ota-start").disabled,false);
  u.confirmation(false);await u.click("ota-start");assert.equal(u.packets.length,before);
  await u.file("ota-file",{name:"wrong.hex",size:10});assert.equal(u.get("ota-start").disabled,true);
  assert.equal(u.get("ota-consent").checked,false);
});
test("verified v9 OTA applies China Chinese standard calendar and restores the controls",{skip:!firmwareMetadata||firmwareMetadata.revision<9},async()=>{
 const u=ui(5,true,"zh",true,{country:3,flags:2,mode:1,slot:1,otaBootRevision:9});
 await u.click('connect');assert.equal(u.get('calendar-layout').value,'3');
 const bytes=firmwareZip();await u.file('ota-file',{name:'v9.zip',size:bytes.length,arrayBuffer:async()=>bytes});
 u.get('ota-consent').checked=true;await u.click('ota-start');
 assert.equal(u.get('calendar-layout').value,'0');assert.equal(u.get('calendar-language').value,'zh');
 assert.equal(u.get('tab-calendar').getAttribute('aria-selected'),'true');
 assert.ok(u.packets.some(p=>p[0]===0x24&&p.length===5&&p[2]===0&&p[3]===2));
 assert.equal(u.packets.filter(p=>p[0]===0x20).at(-1)[6],1);
});
test("a failed default refresh after verified OTA never asks for another flash",{skip:!firmwareMetadata||firmwareMetadata.revision<9},async()=>{
 const u=ui(5,true,'zh',true,{otaBootRevision:9,defaultFails:true});await u.click('connect');
 const bytes=firmwareZip();await u.file('ota-file',{name:'v9.zip',size:bytes.length,arrayBuffer:async()=>bytes});
 u.get('ota-consent').checked=true;await u.click('ota-start');
 assert.match(u.get('result').textContent,/固件已升级.*默认日历刷新未确认.*不要重复刷机/);
});
test("legacy device OTA UI explains wired bootstrap and keeps start disabled",async()=>{
  const u=ui();await u.click("connect");await u.click("tab-ota");
  assert.match(u.get("ota-capability").textContent,/先有线刷入/);assert.equal(u.get("ota-inspect").disabled,true);assert.equal(u.get("ota-start").disabled,true);
});
test("English default and Chinese switching update live status without touching content",async()=>{
  const u=ui(5,false,"en");assert.equal(u.get("connection-state").textContent,"Disconnected");
  assert.match(u.get("compatibility").textContent,/Bluetooth is supported/);
  u.get("todo-item-title").value="不要翻译我的内容";await u.input("ui-language","zh","change");
  assert.equal(u.get("connection-state").textContent,"未连接");assert.match(u.get("compatibility").textContent,/浏览器支持蓝牙/);
  assert.equal(u.get("todo-item-title").value,"不要翻译我的内容");assert.equal(u.local.get("elink42-ui-language"),"zh");
});

test("Traditional Chinese changes only the interface and keeps v14 calendar bytes in Chinese",async()=>{
  const u=ui(5,false,"en",true,{country:3,flags:2});await u.click("connect");
  u.get("todo-item-title").value="用户自己的简体标题";
  await u.input("ui-language","zh-Hant","change");
  assert.equal(u.get("connection-state").textContent,"已連接");assert.match(u.get("compatibility").textContent,/瀏覽器支持藍牙/);
  assert.equal(u.local.get("elink42-ui-language"),"zh-Hant");assert.equal(u.get("todo-item-title").value,"用户自己的简体标题");
  assert.equal(u.get("calendar-language").value,"zh");assert.equal(u.get("calendar-layout").value,"3");
  const before=u.packets.length;await u.click("native-calendar");
  assert.ok(u.packets.slice(before).some(p=>p[0]===0x24&&p.length===5&&p[2]===3&&p[3]===2));
  await u.input("ui-language","en","change");assert.equal(u.get("connection-state").textContent,"Connected");
});
test("legacy calendar capability rejection sends no configuration or time mutations",async()=>{
  const u=ui(5,false,"en",false);await u.click("connect");const before=u.packets.length;await u.click("native-calendar");
  assert.match(u.get("result").textContent,/revision 6/);assert.deepEqual(u.packets.slice(before).map(p=>p[0]),[0x24]);
});
test("photo calendar shares country and language and uses the selected persistent gallery slot",async()=>{
  const u=ui(5,false,"en");await u.click("connect");await u.click("tab-image");await u.file("image-file",{type:"image/png",size:100,name:"photo.png"});
  await u.input("image-target","calendar","change");await u.click("store-frame");await u.click("photo-gallery-read");
  await u.input("photo-country","3","change");await u.input("photo-language","zh","change");
  assert.equal(u.get("calendar-layout").value,"3");assert.equal(u.get("calendar-language").value,"zh");
  const before=u.packets.length;await u.click("photo-calendar-start");const packets=u.packets.slice(before);
  assert.ok(packets.some(p=>p[0]===0x24 && p[1]===0x4A && p[2]===3 && p[3]===3));assert.ok(!packets.some(p=>p[0]===0x23));
  assert.ok(packets.some(p=>p[0]===0x56 && p[1]===0 && p[2]===0));assert.equal(packets.filter(p=>p[0]===0x20).at(-1)[6],1);
  assert.ok(!packets.some(p=>[0x40,0x41,0x42].includes(p[0]))); // Reuses gallery data without uploading again.
});
for(const model of [2,5])test(`UI ${model}: native calendar has no static image frame; clock capability is honest`,async()=>{
  const u=ui(model);assert.equal(u.get("preview-panel").hidden,false);assert.equal(u.get("publish").disabled,true);assert.equal(u.packets.length,0);
  await u.click("connect");assert.equal(u.get("preview-model").value,String(model));assert.equal(u.get("native-calendar").disabled,false);
  assert.equal(u.get("native-clock").disabled,model===5);assert.equal(u.get("led-off").disabled,model!==5);
  await u.click("native-calendar");assert.deepEqual(u.packets.map(p=>p[0]),[0,0x24,0x24,0x24,0x24,0x20,0x24,1,0x24,0x24,0x24,0x20,0x24,0]);assert.equal(u.packets.filter(p=>p[0]===0x20).at(-1)[6],1);
  assert.ok(u.rendered.every(r=>r.kind==="calendar"));assert.ok(!u.packets.some(p=>p[0]===3||p[0]===4));
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
test("weather job rechecks the target after asynchronous network work and never sends to changed identity",async()=>{
  const u=ui();await u.click("connect");u.get("job-title").value="天气";u.get("job-kind").value="weather";
  u.get("job-time").value=new Date(Date.now()+120000).toISOString();await u.click("job-add");
  u.get("weather-key").value="test-only-not-a-real-key";u.get("weather-consent").checked=true;u.advance(121000);
  const before=u.packets.length,operation=u.click("scheduler-start");await new Promise(setImmediate);
  assert.equal(u.get("reconnect").disabled,true);
  u.device.id="different-device";
  u.respond({now:{results:[{location:{name:"北京"},last_update:new Date().toISOString(),now:{text:"晴",temperature:"20",code:"0"}}]},daily:{results:[{daily:[]}]}});
  await operation;assert.equal(u.packets.length,before);
  assert.match(JSON.parse(u.local.get("om6626-workspace-v1")).jobs[0].status,/失败|不确定/);
});

test("connection restores actual photo presentation and time sync preserves its slot and fitting",async()=>{
  const u=ui(5,false,"en",true,{flags:7,country:3,mode:1,slot:2,source:0});u.stored[2]=123;await u.click("connect");
  assert.equal(u.get("photo-calendar-editor").hidden,false);assert.equal(u.get("calendar-layout").value,"3");assert.equal(u.get("photo-slot").value,"2");assert.equal(u.get("photo-fit").value,"contain");
  u.get("custom-time").value="2026-11-04T12:00";const before=u.packets.length;await u.click("set-time");
  const packets=u.packets.slice(before);assert.ok(packets.some(p=>p[0]===0x56 && p[1]===2));assert.ok(packets.some(p=>p[0]===0x24 && p.length===5 && p[2]===3 && p[3]===7));
  assert.ok(!packets.some(p=>[0x40,0x41,0x42].includes(p[0])));assert.equal(u.device.gatt.connected,true);
});
test("existing full-screen gallery images default to uncropped calendar fitting",async()=>{
  const u=ui(5,false,"en");await u.click("connect");assert.equal(u.get("photo-fit").value,"contain");u.stored[0]=123;await u.click("photo-gallery-read");const before=u.packets.length;await u.click("photo-calendar-start");
  assert.ok(u.packets.slice(before).some(p=>p[0]===0x24 && p.length===5 && p[3]===7));
});

test("country holiday summaries show local upcoming holidays and China overrides stay scoped",async()=>{
 const u=ui(5,false,"en");await u.click("connect");await u.input("calendar-date","2026-11-04");await u.input("calendar-layout","3","change");
 assert.match(u.get("holiday-summary").textContent,/Taiwan: government-office calendar/);assert.equal(u.get("holiday-read").disabled,true);assert.equal(u.get("holiday-write").disabled,true);
 await u.input("calendar-layout","2","change");assert.match(u.get("holiday-summary").textContent,/Next holiday: Deepavali/);
 await u.input("calendar-layout","0","change");assert.equal(u.get("holiday-read").disabled,false);assert.equal(u.get("holiday-write").disabled,false);
});
