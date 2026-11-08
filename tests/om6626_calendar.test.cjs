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

test("Traditional interface labels persist and round-trip without converting user content",()=>{
  const {I,saved}=load();I.setLanguage("zh-Hant");
  assert.equal(I.locale,"zh-TW");assert.equal(I.t("Connect display"),"連接屏幕");assert.equal(I.label("国庆节"),"國慶節");
  assert.equal(saved.get("elink42-ui-language"),"zh-Hant");assert.equal(load("zh-Hant").I.language,"zh-Hant");
  const title="用户自己的简体标题";assert.equal(I.t(title),title);assert.equal(I.msg(["目标：",""],title),"目標："+title);
  I.setLanguage("en");assert.equal(I.t("連接屏幕"),"Connect display");
  I.setLanguage("zh");assert.equal(I.t("連接屏幕"),"连接屏幕");
  assert.throws(()=>I.setLanguage("invalid"),/Unsupported/);
});
test("CN SG TW keep protocol ids 0 2 3 and all calendars start on Sunday",()=>{
  const {C}=load();assert.deepEqual(Array.from(C.regions,r=>[r.code,r.id]),[["CN",0],["SG",2],["TW",3]]);
  assert.equal(C.byId(2).code,"SG");assert.equal(C.byId(1),undefined);
  for(const r of C.regions){const cells=C.month(r.code,2026,4);assert.equal(cells[0].date.getDay(),0);assert.equal(cells.filter(c=>c.current).length,31);assert.equal(cells[35].date.getDate(),31);}
  assert.throws(()=>C.month("XX",2026,0),/country/);assert.throws(()=>C.month("DE",2026,0),/country/);assert.throws(()=>C.month("CN",2026,12),/month/);
});
test("national holidays, observed days, make-up workdays and unsupported years stay distinct",()=>{
  const {C}=load();
  for(const [code,date,name] of [["CN","2026-10-01","National Day"],["SG","2026-11-09","Deepavali"],["TW","2027-02-04","Lunar New Year Eve Eve"]]){
    const info=C.day(code,new Date(date+"T12:00:00"));assert.ok(info.holiday);assert.equal(info.names[0],name);
  }
  const work=C.day("CN",new Date(2026,9,10));assert.equal(work.work,true);assert.equal(work.holiday,false);
  assert.equal(C.day("CN",new Date(2027,0,1)).known,false);assert.equal(C.day("SG",new Date(2028,0,1)).known,false);
  assert.equal(C.day("TW",new Date(2026,10,1)).holiday,undefined);
});
test("country time sync uses the retained Asian timezones",()=>{
  const {C,P}=load();assert.equal(C.zone("CN"),8);assert.equal(C.zone("SG"),8);assert.equal(C.zone("TW"),8);
  const d=C.localDate("TW",new Date("2026-11-04T16:00:00Z"));assert.equal(d.getDate(),5);
  assert.equal(P.time(new Date("2026-11-04T00:00:00Z"),1,C.zone("SG"))[5],8);
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
  assert.equal(store.data.settings.calendarLanguage,"zh");assert.equal(load().I.language,"en");
  const migrated=F.validate({...F.defaults(),settings:{...F.defaults().settings,calendarCountry:1,calendarLanguage:"en"}});
  assert.equal(migrated.settings.calendarCountry,0);assert.equal(migrated.settings.calendarLanguage,"zh");
  assert.throws(()=>F.validate({...F.defaults(),settings:null}),/appearance/i);
});

test("restored almanac, week numbers and next holiday period handle boundaries",()=>{
 const {C}=load();const a=C.almanac(new Date(2026,10,4));assert.equal(a.lunarMonth,9);assert.equal(a.lunarDay,26);assert.equal(a.solar[1],"立冬");assert.equal(a.distance,3);assert.equal(C.week(new Date(2026,10,4)),45);
 assert.equal(C.almanac(new Date(2026,10,7)).distance,0);assert.equal(C.almanac(new Date(2051,0,1)),null);
 assert.equal(C.nextHoliday("SG",new Date(2026,10,4)).days,4);assert.equal(C.nextHoliday("SG",new Date(2026,11,25)).date,"2027-01-01");assert.equal(C.nextHoliday("CN",new Date(2026,9,1)),null);
 assert.equal(C.nextHoliday("SG",new Date(2026,11,31)).days,1);assert.equal(C.nextHoliday("CN",new Date(2027,0,1)),null);
 assert.equal(C.week(new Date(2027,0,1)),53);assert.equal(C.week(new Date(2023,0,1)),52);assert.equal(C.week(new Date(2024,11,30)),1);
});

test("Chinese weekdays and the almanac policy cover CN SG TW",()=>{
 const {C}=load();
 for(const code of ['CN','SG','TW'])assert.deepEqual(Array.from(C.weekdays(code,'zh')),['日','一','二','三','四','五','六']);
 for(const code of ['CN','SG','TW'])assert.equal(C.hasAlmanac(code),['CN','TW'].includes(code));
});

test("photo hero uses red LCD rectangles and a selected holiday never paints over its date",()=>{
 const {R}=load(),events=[];
 const ctx={fillRect(...r){events.push(['fill',this.fillStyle,...r]);},strokeRect(){},measureText:s=>({width:[...s].length*6}),fillText(s,x,y){events.push(['text',s,this.fillStyle,this.font,x,y]);}};
 const canvas={getContext:()=>ctx};
 R.calendar(canvas,{code:'CN',date:new Date(2026,10,4),photo:true});
 assert.ok(events.some(e=>e[0]==='fill'&&e[1]==='#b81928'&&e[2]===309&&e[3]===58&&e[4]===4&&e[5]===24));
 assert.ok(!events.some(e=>e[0]==='text'&&e[1]==='4'&&e[5]===104));
 events.length=0;R.calendar(canvas,{code:'TW',date:new Date(2027,1,4),photo:true});
 assert.ok(events.some(e=>e[0]==='text'&&e[1]==='今天是'));
 assert.ok(events.some(e=>e[0]==='text'&&e[1]==='立春'));
 assert.ok(!events.some(e=>e[0]==='text'&&e[1]==='24天后下个假期'));
 events.length=0;R.calendar(canvas,{code:'SG',date:new Date(2026,10,7)});
 assert.ok(!events.some(e=>e[0]==='text' && (/^L\d/.test(e[1]) || e[1].includes('立冬'))));
 events.length=0;R.calendar(canvas,{code:'SG',date:new Date(2026,11,25)});
 assert.equal(events.filter(e=>e[0]==='fill'&&e[1]==='#ffd200').length,1);
});

test("all full calendars omit cryptic numeric lunar L labels",()=>{
 const {R}=load(),labels=[];
 const ctx={fillRect(){},strokeRect(){},measureText:s=>({width:[...s].length*6}),fillText:s=>labels.push(s)};
 for(const code of ['CN','SG','TW'])for(const language of ['zh']){
  labels.length=0;R.calendar({getContext:()=>ctx},{code,language,date:new Date(2026,10,5)});
  assert.ok(!labels.some(s=>/^L\d/.test(s)),`${code}/${language}`);
 }
});

test("calendar holiday labels wrap at spaces and fit both footer lines",()=>{
 const {R}=load(),rows=[];const ctx={measureText:s=>({width:[...s].length*6}),fillText:(s,x,y)=>rows.push([s,x,y])};
 R.textBlock(ctx,"Lunar New Year Eve Eve",266,230,124,28,12,14);
 assert.deepEqual(rows,[["Lunar New Year Eve",266,230],["Eve",266,244]]);
});

test('China photo follows lunar-year zodiac and strictly future solar terms',()=>{
 const {C}=load();
 for(const [date,year,animal] of [[new Date(2026,1,16),2025,'Snake'],[new Date(2026,1,17),2026,'Horse'],[new Date(2027,0,1),2026,'Horse']]){
  assert.equal(C.almanac(date).lunarYear,year);assert.equal(C.almanac(date).zodiac[0],animal);
 }
 assert.equal(C.nextSolar(new Date(2026,10,5)).days,2);assert.equal(C.nextSolar(new Date(2026,10,5)).names[1],'立冬');
 assert.equal(C.nextSolar(new Date(2026,10,7)).names[1],'小雪');assert.equal(C.nextSolar(new Date(2026,10,7)).days,15);
 assert.equal(C.nextSolar(new Date(2026,11,31)).days,5);assert.equal(C.nextSolar(new Date(2050,11,31)),null);
});

test('solar term today overrides future countdown in both layouts and resumes tomorrow',()=>{
 const {R}=load(),labels=[],ctx={fillRect(){},strokeRect(){},measureText:s=>({width:[...s].length*6}),fillText:(s,x,y)=>labels.push([s,x,y])};
 for(const code of ['CN','TW'])for(const photo of [false,true]){
  labels.length=0;R.calendar({getContext:()=>ctx},{code,photo,date:new Date(2026,10,7)});
  const footer=labels.filter(row=>row[2]>=250).map(row=>row[0]).join('');
  assert.match(footer,/今天是.*立冬/);assert.doesNotMatch(footer,/小雪|\+0|下个节气/);
 }
 for(const [date,label] of [[new Date(2026,10,6),'下个节气还有1天'],[new Date(2026,10,8),'下个节气还有14天'],[new Date(2026,11,31),'下个节气还有5天']]){
  labels.length=0;R.calendar({getContext:()=>ctx},{code:'CN',photo:true,date});
  assert.ok(labels.some(row=>row[0]===label));assert.ok(!labels.some(row=>row[0]==='今天是'));
 }
});

test('all photo layouts share anchors and have exactly two footer rows with complete names',()=>{
 const {R}=load();
 for(const code of ['CN','SG','TW'])for(const language of ['zh']){
  const events=[],ctx={fillRect(){},strokeRect(){},measureText:s=>({width:[...s].length*6}),fillText(s,x,y,w){events.push({s,x,y,w,font:this.font});}};
  R.calendar({getContext:()=>ctx},{code,language,date:new Date(2026,4,31),photo:true});
  assert.ok(events.some(e=>e.s==='2026/05'&&e.y===29));assert.ok(events.some(e=>e.y===116));assert.ok(events.some(e=>e.y===146));
  const footer=events.filter(e=>e.y>=250);assert.equal(footer.length,2,code+language);assert.ok(footer.every(e=>e.x===328&&e.w===124));
 }
 const events=[],ctx={fillRect(){},strokeRect(){},measureText:s=>({width:[...s].length*6}),fillText(s,x,y,w){events.push({s,x,y,w});}};
 R.calendar({getContext:()=>ctx},{code:'TW',date:new Date(2027,1,3),photo:true});
 assert.ok(events.some(e=>e.s==='小年夜'&&e.w===124));assert.ok(events.some(e=>e.s==='1天后下个假期'));
});

test('full-calendar solar and lunar labels use the same measured cell center',()=>{
 const {R}=load(),events=[],ctx={fillRect(){},strokeRect(){},measureText:s=>({width:[...s].length*6}),fillText(s,x,y){events.push({s,x,y});}};
 R.calendar({getContext:()=>ctx},{code:'CN',language:'zh',date:new Date(2026,4,31)});
 for(let day=10;day<=19;day++){
  const cell=5+day-1,row=Math.floor(cell/7),col=cell%7,cx=10+col*54+27,y=61+row*34;
  const solar=events.find(e=>e.s===String(day)&&e.y===y),lunar=events.find(e=>e.y===y+23&&e.x>cx-27&&e.x<cx+27);
  assert.ok(solar&&lunar,`missing day ${day}`);assert.equal(solar.x+ctx.measureText(solar.s).width/2,cx);
  assert.equal(lunar.x+ctx.measureText(lunar.s).width/2,cx);
 }
});

test('full calendar uses a larger natural countdown instead of plus notation',()=>{
 const {R}=load(),calls=[],ctx={fillRect(){},strokeRect(){},measureText:s=>({width:[...s].length*6}),fillText(s,x,y,w){calls.push({s,x,y,w,font:this.font});}};
 R.calendar({getContext:()=>ctx},{code:'CN',date:new Date(2026,10,8)});
 assert.deepEqual(calls.find(c=>c.s==='14天后小雪'),{s:'14天后小雪',x:307,y:272,w:166,font:'24px "Microsoft YaHei", "PingFang SC", sans-serif'});
 assert.ok(!calls.some(c=>c.y>=250&&c.s.includes('+')));
});
test('native calendar-aspect image reaches all four left-panel edges',()=>{
 const {R}=load(),calls=[],ctx={fillRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},translate(){},rotate(){},drawImage(...a){calls.push(a);}};
 R.image({getContext:()=>ctx},{width:256,height:300},{target:'calendar'});assert.deepEqual(calls[0].slice(1),[-128,-150,256,300]);
});
