"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=process.env.OM6626_WEB_ROOT||path.resolve(__dirname,"..");
function load(language){
  const saved=new Map(language?[["elink42-ui-language",language]]:[]),ctx={console,TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Float32Array,DataView,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)}};
  const api=vm.runInNewContext(["i18n.js","holidays.js","calendar.js","charset.js","protocol.js","features.js","render.js"].map(n=>fs.readFileSync(path.join(root,n),"utf8")).join("\n")+";({I:OMI18n,C:OMCalendar,H:OMHolidays,F:OMFeatures,R:OMRender,P:OMProtocol,D:OMTranslations})",ctx);
  return {...api,saved};
}
test("English is the persisted default; switching preserves user text and interpolation",()=>{
  const {I,saved,D}=load();assert.equal(I.language,"en");assert.equal(I.t("连接屏幕"),"Connect display");
  assert.ok(Object.entries(D).every(([k,v])=>k==="中文" || !/[\u3400-\u9fff]/u.test(v)));
  const userText="用户自己的中文标题";assert.equal(I.msg(["目标：",""],userText),"Target: "+userText);
  I.setLanguage("zh");assert.equal(I.t("Connect display"),"连接屏幕");assert.equal(saved.get("elink42-ui-language"),"zh");
  assert.equal(load("zh").I.language,"zh");assert.equal(I.t(userText),userText);
});
test("six country options are ordered CN DE SG TW JP MY and all calendars start on Sunday",()=>{
  const {C}=load();assert.deepEqual(Array.from(C.regions,r=>r.code),["CN","DE","SG","TW","JP","MY"]);
  for(const r of C.regions){const cells=C.month(r.code,2026,4);assert.equal(cells[0].date.getDay(),0);assert.equal(cells.filter(c=>c.current).length,31);assert.equal(cells[35].date.getDate(),31);}
  assert.throws(()=>C.month("XX",2026,0),/country/);assert.throws(()=>C.month("CN",2026,12),/month/);
});
test("national holidays, observed days, make-up workdays and unsupported years stay distinct",()=>{
  const {C}=load();
  for(const [code,date,name] of [["CN","2026-10-01","National Day"],["DE","2026-04-03","Good Friday"],["SG","2026-11-09","Deepavali"],["TW","2027-02-04","Lunar New Year Eve Eve"],["JP","2026-09-22","Substitute holiday"],["MY","2026-09-16","Malaysia Day"]]){
    const info=C.day(code,new Date(date+"T12:00:00"));assert.ok(info.holiday);assert.equal(info.names[0],name);
  }
  const work=C.day("CN",new Date(2026,9,10));assert.equal(work.work,true);assert.equal(work.holiday,false);
  assert.equal(C.day("CN",new Date(2027,0,1)).known,false);assert.equal(C.day("DE",new Date(2028,0,1)).known,false);
  assert.equal(C.day("DE",new Date(2026,10,1)).holiday,undefined); // All Saints is regional, not nationwide.
});
test("country time sync respects Japan midnight and German daylight-saving offsets",()=>{
  const {C,P}=load();assert.equal(C.zone("DE",new Date("2026-07-01T00:00:00Z")),2);assert.equal(C.zone("DE",new Date("2026-11-04T00:00:00Z")),1);
  assert.equal(C.zone("JP"),9);assert.equal(C.zone("SG"),8);
  const d=C.localDate("JP",new Date("2026-11-04T16:00:00Z"));assert.equal(d.getDate(),5);
  assert.equal(P.time(new Date("2026-11-04T00:00:00Z"),1,C.zone("DE",new Date("2026-11-04T00:00:00Z")))[5],1);
});
test("full-screen and photo-calendar crop use their actual target aspect ratios",()=>{
  const {R}=load(),calls=[];
  const context={fillRect(){},fillText(){},save(){},restore(){},beginPath(){},rect(...a){calls.push(["clip",...a]);},clip(){},translate(...a){calls.push(["center",...a]);},rotate(){},drawImage(...a){calls.push(["draw",...a.slice(1)]);}};
  const canvas={getContext:()=>context},image={width:1200,height:800};
  R.image(canvas,image,{fit:"cover",target:"calendar"});assert.deepEqual(calls[0],["clip",0,0,256,300]);assert.deepEqual(calls[1],["center",128,150]);assert.deepEqual(calls[2],["draw",-225,-150,450,300]);
  calls.length=0;R.image(canvas,image,{fit:"cover",target:"full"});assert.deepEqual(calls[0],["clip",0,0,400,300]);assert.deepEqual(calls[1],["center",200,150]);
});
test("old workspaces migrate optional settings without altering stored content",()=>{
  const {F}=load();let raw=JSON.stringify(F.defaults());const parsed=JSON.parse(raw);delete parsed.settings.calendarCountry;delete parsed.settings.calendarLanguage;delete parsed.settings.imageTarget;parsed.todos=[{id:"keep",title:"保留原文",description:"",due:"",done:false}];raw=JSON.stringify(parsed);const before=raw;
  const store=new F.Store({getItem:()=>raw,setItem(){throw Error("Unexpected write during load");}});
  assert.equal(raw,before);assert.equal(store.data.settings.calendarCountry,0);assert.equal(store.data.todos[0].title,"保留原文");
  assert.throws(()=>F.validate({...F.defaults(),settings:null}),/appearance/i);
});

test("restored almanac, week numbers and next holiday period handle boundaries",()=>{
 const {C}=load();const a=C.almanac(new Date(2026,10,4));assert.equal(a.lunarMonth,9);assert.equal(a.lunarDay,26);assert.equal(a.solar[1],"立冬");assert.equal(a.distance,3);assert.equal(C.week(new Date(2026,10,4)),45);
 assert.equal(C.almanac(new Date(2026,10,7)).distance,0);assert.equal(C.almanac(new Date(2051,0,1)),null);
 assert.equal(C.nextHoliday("DE",new Date(2026,10,4)).days,51);assert.equal(C.nextHoliday("DE",new Date(2026,11,25)).date,"2027-01-01");assert.equal(C.nextHoliday("CN",new Date(2026,9,1)),null);
 assert.equal(C.nextHoliday("DE",new Date(2026,11,31)).days,1);assert.equal(C.nextHoliday("CN",new Date(2027,0,1)),null);
});

test("calendar holiday labels wrap at spaces and fit both footer lines",()=>{
 const {R}=load(),rows=[];const ctx={measureText:s=>({width:[...s].length*6}),fillText:(s,x,y)=>rows.push([s,x,y])};
 R.textBlock(ctx,"Lunar New Year Eve Eve",266,230,124,28,12,14);
 assert.deepEqual(rows,[["Lunar New Year Eve",266,230],["Eve",266,244]]);
});
