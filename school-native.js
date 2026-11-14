"use strict";
const OMSchool = (() => {
  const script = typeof document === "undefined" ? null : new URL(document.currentScript.src);
  const faces = [[32,1],[16,1],[13,1],[12,1],[11,1],[10,1],[20],[18],[16],[14],[12],[11],[10],[20,0,600],[13,0,600]];
  let enginePromise, cache;
  const none = 65535, encoder = new TextEncoder();
  const minute = value => value ? Number(value.slice(0,2))*60+Number(value.slice(3)) : none;
  const ordinal = value => {const d=CourseTable.dateValue(value);return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000;};
  async function engine() {
    if (!enginePromise) enginePromise=(async()=>{
      const url=new URL("sdk-preview.wasm",script);url.search=script.search;
      const response=await fetch(url);if(!response.ok)throw Error("无法加载固件课表绘图模块");
      return (await WebAssembly.instantiate(await response.arrayBuffer(),{})).instance.exports;
    })().catch(error=>{enginePromise=null;throw error;});
    return enginePromise;
  }
  function font(face) {const [size,numeric,weight]=faces[face];return `${weight||400} ${size}px ${numeric?'"Bahnschrift"':'"Microsoft YaHei"'}, sans-serif`;}
  function raster(ctx,code,face,style=font(face)) {
    const value=String.fromCodePoint(code);ctx.fillStyle="#fff";ctx.fillRect(0,0,96,96);
    ctx.font=style;ctx.textAlign="left";ctx.textBaseline="middle";ctx.fillStyle="#000";ctx.fillText(value,32,48);
    const advance=Math.round(ctx.measureText(value).width*64),rgba=ctx.getImageData(0,0,96,96).data;
    let x0=96,y0=96,x1=-1,y1=-1;
    for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(rgba[(y*96+x)*4]<160){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    const w=x1<0?0:x1-x0+1,h=y1<0?0:y1-y0+1,pitch=Math.ceil(w/8),bits=new Uint8Array(h*pitch);
    if(!advance || advance>4096 || w>40 || h>40 || (code!==32 && !w) || (w && (x0-32 < -16 || x0-32>16 || Math.abs(y0-48)>40)))throw Error("字体无法在设备上显示："+value);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(rgba[((y+y0)*96+x+x0)*4]<160)bits[y*pitch+(x>>3)]|=128>>(x&7);
    return {code,face,w,h,pitch,x:w?x0-32:0,y:h?y0-48:0,advance,bits};
  }
  async function pack({courses,exams=[],examDays={},deviceName=""}) {
    deviceName=CourseTable.deviceInfo({deviceName}).deviceName;
    const week=CourseTable.parseWeek(courses),entries=CourseTable.normalizeExams(exams),policies=CourseTable.normalizeExamDays(examDays);
    const key=JSON.stringify([courses,entries,policies,deviceName]);if(cache?.key===key)return cache.bytes.slice();
    await Promise.all(faces.map((_,i)=>document.fonts.load(font(i))));await document.fonts.ready;
    const strings=[""], names=new Set(week.flat().map(r=>r.subject).concat(entries.map(r=>r.subject))),sets=faces.map(()=>new Set());
    const add=(face,value)=>{for(const char of value)sets[face].add(char.codePointAt(0));};
    for(const name of names){strings.push(name);for(let face=6;face<=11;face++)add(face,name);}
    for(let face=0;face<6;face++)add(face,"0123456789:./–- V—");
    add(8,"周日一二三四五六");add(10,"考试日 · 场今日课程节时间周一二三四五0123456789");
    add(11,"设备未读取…时间科目课程考试全天按安排上午下午停保留当天明日后 · 年月日一二三四五六0123456789"+deviceName);
    for(let code=32;code<127;code++)sets[11].add(code);
    add(13,"一周课表");add(14,"上午下午 / 晚间0123456789–");
    const canvas=document.createElement("canvas");canvas.width=96;canvas.height=96;const ctx=canvas.getContext("2d",{willReadFrequently:true});
    const glyphs=[];sets.forEach((codes,face)=>[...codes].sort((a,b)=>a-b).forEach(code=>glyphs.push(raster(ctx,code,face))));
    const nc=week.flat().length,ne=entries.length,cb=64,eb=cb+nc*8,gb=eb+ne*12,sb=gb+glyphs.length*16;
    let cursor=sb;const offsets=new Map(),encoded=[];
    for(const name of strings){const bytes=encoder.encode(name+"\0");offsets.set(name,cursor);encoded.push([cursor,bytes]);cursor+=bytes.length;}
    const se=cursor;for(const glyph of glyphs){glyph.offset=cursor;cursor+=glyph.bits.length;}
    if(cursor>30000 || glyphs.length>2048)throw Error(`课表字形和内容需要${cursor.toLocaleString()}字节，超过设备单条30,000字节容量；请减少不同科目名称后再同步。原数据未改动。`);
    const bytes=new Uint8Array(30000),v=new DataView(bytes.buffer);bytes.set(encoder.encode("ELSCH02\0"));
    v.setUint16(8,cursor,true);bytes[10]=nc;bytes[11]=ne;v.setUint16(12,glyphs.length,true);
    [cb,eb,gb,sb,se].forEach((n,i)=>v.setUint16(16+i*2,n,true));bytes[26]=1;
    let index=0;week.forEach((rows,day)=>rows.forEach(row=>{const off=cb+index++*8;v.setUint16(off,minute(row.start),true);v.setUint16(off+2,minute(row.end),true);v.setUint16(off+4,offsets.get(row.subject),true);bytes[off+6]=day;}));
    entries.forEach((entry,i)=>{const off=eb+i*12;v.setUint16(off,ordinal(entry.date),true);v.setUint16(off+2,minute(entry.start),true);v.setUint16(off+4,minute(entry.end),true);v.setUint16(off+6,offsets.get(entry.subject),true);bytes[off+8]=["all","morning","afternoon","none"].indexOf(policies[entry.date]||"all");});
    glyphs.forEach((g,i)=>{const off=gb+i*16;v.setUint32(off,g.code,true);bytes.set([g.face,g.w,g.h,g.pitch,g.x&255,g.y&255],off+4);v.setUint16(off+10,g.advance,true);v.setUint16(off+12,g.offset,true);bytes.set(g.bits,g.offset);});
    encoded.forEach(([off,data])=>bytes.set(data,off));cache={key,bytes};return bytes.slice();
  }
  async function frame(options,prepared) {
    const bytes=prepared||await pack(options),e=await engine(),date=options.date;
    if(!(date instanceof Date) || !Number.isFinite(+date) || !["day","week"].includes(options.view||"day") || !["four","three"].includes(options.panel||"four"))throw Error("课表日期、视图或屏型无效");
    if(!Number.isInteger(options.page??0) || (options.page??0)<0 || (options.page??0)>15)throw Error("课表页码需要1至16的整数");
    new Uint8Array(e.memory.buffer,e.preview_school_data(),30000).set(bytes);
    const device=CourseTable.deviceInfo(options),mv=device.millivolts||0;
    const name=new Uint8Array(e.memory.buffer,e.preview_school_name(),256);name.fill(0);encoder.encodeInto(device.deviceName,name.subarray(0,255));
    const address=e.preview_school(date.getFullYear(),date.getMonth()+1,date.getDate(),options.view==="week"?1:0,Math.max(0,Math.min(15,options.page||0)),options.panel==="three"?2:5,mv);
    if(!address)throw Error("固件拒绝此课表，可能缺少字形或文字越界；未发送到设备。");
    const [classCount,examCount,count,pages,page,rows,content]=new Uint32Array(e.memory.buffer,e.preview_school_stats(),7);
    const reference=options.view==="week"?CourseTable.weekModel(options.courses,date,options.exams,options.examDays):CourseTable.dayModel(options.courses,date,options.exams,options.examDays);
    if(count!==reference.count || pages!==reference.pages || classCount!==reference.classCount || examCount!==reference.examCount)throw Error("网页与固件课表解析不一致，已停止同步");
    let hash=2166136261;const mix=b=>{hash=Math.imul(hash^b,16777619)>>>0},item=row=>{const a=minute(row.start),b=minute(row.end);[row.kind==='exam'?1:0,a&255,a>>8,b&255,b>>8,...encoder.encode(row.subject),0].forEach(mix);};
    if(options.view==='week'){
      for(const row of reference.rows)row.items.forEach((entry,col)=>{if(entry){mix(col);item(entry)}});
      reference.examColumns.forEach((entries,col)=>{for(const subject of new Set(entries.map(e=>e.subject))){mix(col);item({kind:'exam',subject,start:'',end:''});}});
    }else [...reference.morning,...reference.afternoon].forEach(item);
    if(hash!==content)throw Error("网页与固件的科目、时间或考试排列不一致，已停止同步");
    return {bytes:new Uint8Array(e.memory.buffer,address,30000).slice(),proof:{...reference,classCount,examCount,count,pages,page,displayRows:rows,device}};
  }
  async function render(canvas,options) {
    const result=await frame(options),{proof}=result;
    const planes=options.panel==="three"?{black:result.bytes.subarray(0,15000),red:result.bytes.subarray(15000)}:{packed:result.bytes};
    canvas.width=400;canvas.height=300;canvas.getContext("2d").putImageData(new ImageData(OMProtocol.rgba(planes),400,300),0,0);
    const visible=[];
    if(options.view==="week"){
      const model=proof;visible.push(...model.rows.slice(proof.page*10,(proof.page+1)*10).flatMap(row=>row.items.filter(Boolean)));
      model.examColumns.forEach(exams=>{const names=[...new Set(exams.map(e=>e.subject))],local=Math.min(proof.page,Math.max(0,Math.ceil(names.length/4)-1)),selected=names.slice(local*4,local*4+4);visible.push(...exams.filter(e=>selected.includes(e.subject)).map(e=>({...e,kind:"exam"})));});
    } else for(const list of [proof.morning,proof.afternoon]){const local=Math.min(proof.page,Math.max(0,Math.ceil(list.length/6)-1));visible.push(...list.slice(local*6,local*6+6));}
    const notice=options.view!=="week" && proof.upcoming?{...proof.upcoming,days:CourseTable.daysBetween(CourseTable.dateValue(proof.upcoming.date),options.date)}:null;
    return {...proof,rows:proof.displayRows,visible,notice,used:new DataView((await pack(options)).buffer).getUint16(8,true)};
  }
  function supported(client){return client.sdkRevision>=16 && !!(client.sdkCapabilities&32);}
  async function state(client,reference=null){
    if(!supported(client) && !(client.sdkRevision>=17 && (client.sdkCapabilities&128)))throw Error("原生应用记录需要 SDK 16/17；旧固件可发送当前画面。");
    if(reference && (client.sdkRevision<17 || ![0,1].includes(reference.source) || !Number.isInteger(reference.slot) || reference.slot<0 || reference.slot>44))throw Error("应用记录查询参数无效");
    const seq=client.nextSequence(),r=await client.request(reference?Uint8Array.of(0x24,0x50,reference.source,reference.slot,seq):client.sdkRevision>=17?Uint8Array.of(0x24,0x50,seq,1):Uint8Array.of(0x24,0x50,seq),b=>b[0]===0x5C&&b[1]===seq,"核对设备应用记录");
    if(r.length!==(client.sdkRevision>=17?15:11) || ![0,2,...(client.sdkRevision>=17?[3]:[]),...(client.sdkRevision>=18?[4]:[])].includes(r[2]) || r[4]>1 || r[5]>15 && r[2]!==0)throw Error("设备应用记录读回无效");
    if(reference && (r[3]!==reference.slot || r[4]!==reference.source))throw Error("应用记录查询位置读回不符");
    return {format:r[2],slot:r[3],source:r[4],page:r[5],flags:r[6],mode:r[7],crc:r[8]|r[9]<<8,valid:!!r[10],dataCrc:r.length===15?new DataView(r.buffer,r.byteOffset,r.byteLength).getUint32(11,true):null};
  }
  async function apply(client,options,external,progress=()=>{},record=null) {
    if(record?!record.supported(client):!supported(client))throw Error(record?"新版字体的离线提醒需要 SDK 18，请先升级。":"课表自动更新需要 SDK 16，请先升级；SDK 15 可使用发送当前画面。");
    const oldCountry=client.config.layout,country=options.country??oldCountry,region=OMCalendar.byId(country)?.code||"CN";
    const prepared=record?record.bytes:await pack(options);if(!record)await frame({...options,date:OMCalendar.localDate(region,options.date)},prepared);
    const format=record?record.format:2,dataCrc=OMArchive.crc32(prepared);
    const old=await client.operation(()=>state(client)),identity=client.device?.id;
    const rotation=await OMRotation.read(client);
    const reuse=old.format===format && old.valid && old.source===Number(external) && old.crc===OMProtocol.crc16(prepared) && (old.dataCrc===null || old.dataCrc===dataCrc);
    const gallery=reuse?null:await client.gallery(external);let cached=null;
    if(!reuse && client.sdkRevision>=17)for(const row of gallery.slots.filter(row=>row.valid && (row.color&128) && row.crc===OMProtocol.crc16(prepared))){
      const checked=await client.operation(()=>state(client,{source:Number(external),slot:row.slot}));
      if(checked.valid && checked.format===format && checked.dataCrc===dataCrc){cached=checked;break;}
    }
    const slot=reuse?old.slot:cached?cached.slot:gallery.slots.find(row=>!row.valid)?.slot;
    if(slot===undefined)throw Error("所选图库没有空槽。请先备份并手动清理一个槽位；旧方案和图片未覆盖。");
    const saved=reuse?{crc:old.crc}:cached?{crc:cached.crc}:await client.store(record?{reminder:prepared}:{school:prepared},slot,external,progress);
    if(client.device?.id!==identity)throw Error("连接设备已改变，新方案未启用");
    const style=record?8:options.view==="week"?7:6,flags=2|(style<<3),page=record?0:Math.min(15,Math.max(0,options.page||0));
    try {
      await client.operation(async()=>{
        client.requireRefreshStatus();await client.waitForDisplay();await client.command(OMProtocol.time(options.date,0,OMCalendar.zone(OMCalendar.byId(country)?.code||"CN",options.date)));
        await client.write(Uint8Array.of(0x57,slot,Number(external),page));
        const selected=await state(client);if(selected.format!==format || selected.slot!==slot || selected.source!==Number(external) || selected.page!==page || selected.crc!==saved.crc || selected.dataCrc!==null && selected.dataCrc!==dataCrc)throw Error("应用记录选择或完整内容校验不符");
      });
      await client.internationalCalendar(country,"zh",false,255,false,progress,options.date,"prepared",style);
      const active=await client.operation(()=>state(client));if(active.format!==format || active.flags!==flags || active.mode!==1 || active.slot!==slot || active.source!==Number(external) || active.crc!==saved.crc || active.dataCrc!==null && active.dataCrc!==dataCrc)throw Error("应用记录启用读回不符");
    } catch(error) {
      let restored=false;
      if(client.device?.id===identity && client.device?.gatt.connected){
        try{await client.operation(async()=>{
          await client.waitForDisplay();await client.command(OMProtocol.time(options.date,0,OMCalendar.zone(OMCalendar.byId(country)?.code||"CN",options.date)));
          await client.write([2,3,4].includes(old.format)?Uint8Array.of(0x57,old.slot,old.source,old.page):Uint8Array.of(0x56,old.slot,old.source));
          const seq=client.nextSequence();const r=await client.request(Uint8Array.of(0x24,0x4A,oldCountry,old.flags,seq),b=>b.length===7&&b[0]===0x55&&b[2]===0x4A,"恢复原显示设置");
          if(r[1]!==old.flags || r[5]!==old.slot || r[6]!==old.source)throw Error("原设置读回不符");
          if(rotation.frequency)await client.command(Uint8Array.of(0x26,rotation.frequency,rotation.photo?1:0));
          await client.command(OMProtocol.time(options.date,old.mode,OMCalendar.zone(OMCalendar.byId(country)?.code||"CN",options.date)),progress);await client.readCalendar();
          restored=client.config.alternate===old.flags&&client.config.photoSlot===old.slot&&client.config.mode===old.mode;
        });}catch(rollback){client.log("恢复原显示未确认："+rollback.message);}
      }
      error.message+=(restored?"；已恢复原显示设置":"；旧记录保留，恢复原显示未确认，请重新连接后核对")+"。新记录槽 "+slot;throw error;
    }
    if([2,3,4].includes(old.format) && old.valid && (old.slot!==slot || old.source!==Number(external))){
      try{await client.slotAction("delete",old.slot,!!old.source,progress);}catch(error){client.log("新方案已启用，旧记录未清理："+error.message);}
    }
    return {slot,source:Number(external),crc:saved.crc,page};
  }
  return {pack,frame,render,supported,state,apply,engine,raster};
})();
