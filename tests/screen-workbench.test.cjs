"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),context={TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,DataView,atob,btoa,console};
const {Screen,F,P}=vm.runInNewContext(['i18n.js','features.js','planner.js','course-table.js','protocol.js','screen-workbench.js'].map(n=>fs.readFileSync(path.join(root,n),'utf8')).join('\n')+';({Screen:OMScreen,F:OMFeatures,P:OMProtocol})',context);
test('screen plan roundtrip preserves course/exam/layout/background and clears prior confirmation',()=>{
 const bytes=new Uint8Array(30000).fill(85),data=F.defaults();data.courses[0]='09:00 周末阅读';data.courses[1]='08:00 数学';data.exams=[{date:'2026-11-13',start:'09:00',end:'10:00',subject:'数学'}];data.examDays={'2026-11-13':'morning'};
 data.screenProfile={version:1,content:'week',update:'auto',country:2,language:'zh',style:4,page:1,source:1,slot:4,fit:'contain',frequency:3,background:{model:5,bytes:Buffer.from(bytes).toString('base64'),crc:P.crc16(bytes)},confirmed:{at:'2026-11-13T01:00:00Z',name:'ELINK42-4CB32B',signature:'1234',bootId:4}};
 const restored=Screen.parse(JSON.parse(JSON.stringify(data)));
 assert.equal(restored.courses[0],data.courses[0]);assert.equal(restored.exams[0].subject,'数学');assert.equal(restored.screenProfile.content,'week');assert.equal(restored.screenProfile.page,1);assert.equal(restored.screenProfile.background.bytes,data.screenProfile.background.bytes);assert.equal(restored.screenProfile.confirmed,null);assert.equal(restored.settings.calendarCountry,2);
});
test('bad plans fail before the saved workspace can be replaced',()=>{
 for(const patch of [{content:'unknown'},{update:'device-code'},{country:9},{page:1.5},{slot:45},{date:'2026-02-30'},{frequency:1},{background:{model:5,bytes:'x',crc:0}}])assert.throws(()=>Screen.normalise(patch));
 const data=F.defaults(),before=JSON.stringify(data);assert.throws(()=>Screen.parse({...data,screenProfile:{page:16}}));assert.equal(JSON.stringify(data),before);
});
test('old workspace remains importable and a different plan cannot appear already applied',()=>{
 const data=F.defaults();data.settings.calendarCountry=3;const restored=Screen.parse(data,{content:'day',page:1});assert.equal(restored.screenProfile.country,3);assert.equal(restored.screenProfile.content,'day');
 const p=Screen.normalise(),first=Screen.signature(data,p);data.courses[1]='08:00 英语';assert.notEqual(Screen.signature(data,p),first);assert.notEqual(Screen.signature(data,{...p,content:'week'}),first);
});
test('reminder titles and render settings survive export and invalidate a prior confirmation',()=>{
 const data=F.defaults(),p=Screen.normalise({content:'reminder',reminderTitle:'放学提醒'});data.screenProfile=p;
 const restored=Screen.parse(JSON.parse(JSON.stringify(data)));assert.equal(restored.screenProfile.reminderTitle,'放学提醒');assert.equal(restored.screenProfile.update,'auto');
 const signature=Screen.signature(data,p);assert.notEqual(Screen.signature(data,{...p,reminderTitle:'周末提醒'}),signature);
 data.settings.fontSize=20;assert.notEqual(Screen.signature(data,p),signature);assert.throws(()=>Screen.normalise({reminderTitle:'x'.repeat(25)}));
});
