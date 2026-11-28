"use strict";
const OMReminder = (() => {
  const encoder=new TextEncoder(),none=65535,daySeconds=86400,heading="日程提醒",maxDays=9999;
  const fixed="日程提醒项待办月日周一二三四五六还有天今天逾期待安排尚未设置日期其他提醒没有其他待办暂无今天，轻松一点设备未连接电量未读取…";
  const baselines=[6,7,5,-1]; // BDF baseline relative to each firmware text anchor.
  let cache;
  const supported=client=>client.sdkRevision>=18 && !!(client.sdkCapabilities&256);
  function title(value,max=100){
    if(typeof value!=="string" || !value.trim() || value.length>max || /[\u0000-\u001f\u007f]/.test(value))throw Error("提醒标题为空、过长或包含控制字符");
    if(/\p{Extended_Pictographic}/u.test(value))throw Error("离线提醒暂不支持表情符号，请使用文字标题");
    return value.trim();
  }
  const reminderZone=(country,date)=>OMCalendar.zone(OMCalendar.byId(country??0)?.code||"CN",date);
  const calendarDay=(epoch,zone)=>Math.floor((epoch+zone*3600)/daySeconds);
  function deadline(due,today,zone){
    const at=typeof due==="string"?Math.floor(Date.parse(due)/1000):NaN;
    if(!Number.isFinite(at))throw Error("提醒日期无效");
    const local=new Date((at+zone*3600)*1000);
    if(at<0 || at>0xFFFFFFFF || local.getUTCFullYear()<1970 || local.getUTCFullYear()>2105)throw Error("离线提醒日期需要在1970至2105年内");
    const day=calendarDay(at,zone);
    if(day-today>maxDays)throw Error(`截止日期距今天最多 ${maxDays} 天`);
    return {at,local,day};
  }
  function validateDeadline(due,country,date=new Date()){
    if(!due)return;
    const zone=reminderZone(country,date);
    deadline(due,calendarDay(Math.floor(+date/1000),zone),zone);
  }
  function entries(options){
    if(!Array.isArray(options.todos))throw Error("提醒数据需要待办列表");
    const date=options.date||new Date(),now=Math.floor(+date/1000);
    if(!Number.isFinite(now))throw Error("提醒预览时间无效");
    const zone=reminderZone(options.country,date),today=calendarDay(now,zone);
    const rows=options.todos.filter(item=>{if(!item || typeof item.done!=="boolean")throw Error("提醒完成状态无效");return !item.done;}).map(item=>{
      const name=title(item.title);
      if(!item.due)return {id:item.id,title:name,day:none,minute:none,second:0,at:0xFFFFFFFF};
      const {at,local,day}=deadline(item.due,today,zone);
      return {id:item.id,title:name,day,minute:local.getUTCHours()*60+local.getUTCMinutes(),second:local.getUTCSeconds(),at};
    });
    if(rows.length>64)throw Error("离线提醒最多64条未完成事项；请完成或精简后再同步，设备旧数据未改动。");
    return {rows,zone,heading,now,today};
  }
  function model(options){
    const {now,today,...data}=entries(options);
    const order=data.rows.map((_,i)=>i).sort((a,b)=>data.rows[a].at-data.rows[b].at);
    const reached=order.filter(i=>data.rows[i].day===today && data.rows[i].at<=now).at(-1);
    if(reached!==undefined){order.splice(order.indexOf(reached),1);order.unshift(reached);}
    const focus=order[0],item=data.rows[focus],kind=!item?0:item.day===none?1:item.day===today?3:item.day<today?4:2;
    let content=2166136261;const mix=b=>{content=Math.imul(content^b,16777619)>>>0;};
    for(const row of data.rows){for(const n of [row.day,row.minute,row.second]){mix(n&255);mix(n>>8);}encoder.encode(row.title+"\0").forEach(mix);}
    encoder.encode(data.heading+"\0").forEach(mix);
    const future=data.rows.filter(row=>row.at!==0xFFFFFFFF && row.at>now).map(row=>row.at);
    return {...data,count:data.rows.length,kind,days:item&&item.day!==none?Math.abs(item.day-today):0,focus:focus??0xFFFFFFFF,next:future.length?Math.min(...future):0,content,order};
  }
  function lineBreak(value,measure,width=152){
    if(measure(value)<=width)return 0;
    const boundaries=[],natural=[];let index=0;
    for(const char of value){index+=char.length;if(index<value.length)boundaries.push(index);}
    if(typeof Intl.Segmenter==="function")for(const segment of new Intl.Segmenter("zh-CN",{granularity:"word"}).segment(value))if(segment.index)natural.push(segment.index);
    let candidates=(natural.length?natural:boundaries).filter(i=>measure(value.slice(0,i))<=width);
    if(!candidates.length || candidates.every(i=>[...value.slice(0,i).trim()].length<2))candidates=boundaries.filter(i=>measure(value.slice(0,i))<=width);
    const both=candidates.filter(i=>measure(value.slice(i))<=width),pool=both.length?both:candidates;
    if(!pool.length)throw Error("提醒标题单个字符超出可用宽度");
    let best=pool[0],cost=Infinity;
    for(const cut of pool){
      const a=value.slice(0,cut),b=value.slice(cut),orphan=[...a.trim()].length<2 || [...b.trim()].length<2;
      const score=(both.length?Math.abs(measure(a)-measure(b)):-measure(a))+(orphan&&[...value].length>3?1000:0);
      if(score<cost){best=cut;cost=score;}
    }
    return encoder.encode(value.slice(0,best)).length;
  }
  async function pack(options){
    const data=entries(options),device=CourseTable.deviceInfo(options).deviceName||"设备未连接";
    const key=JSON.stringify([data.rows,data.heading,device]);if(cache?.key===key)return cache.bytes.slice();
    const [hanSmall,hanMain,latinSmall,latinMain]=await Promise.all([
      "wenquanyi_9pt.bdf.gz","wenquanyi_12pt.bdf.gz","ter-u14b.bdf.gz","ter-u24b.bdf.gz"
    ].map(OMCalendarFont.nativeStrike));
    const sets=[new Set(fixed+device),new Set(" 日程提醒还有天今天逾期待安排月日周一二三四五六0123456789…"),new Set("0123456789月暂无待办…"),new Set("…")];
    for(let code=32;code<127;code++)sets[0].add(String.fromCodePoint(code));
    for(const row of data.rows)for(const char of row.title)for(const face of [0,2,3])sets[face].add(char);
    const glyphs=[],advances=sets.map(()=>new Map());
    sets.forEach((chars,face)=>{
      const han=face?hanMain:hanSmall, latin=face?latinMain:latinSmall;
      for(const code of [...chars].map(char=>char.codePointAt(0)).sort((a,b)=>a-b)){
        const strike=latin.has(code)?latin:han;
        const g=OMCalendarFont.nativeGlyph(strike,code,face,baselines[face]);
        glyphs.push(g);
        advances[face].set(String.fromCodePoint(code),g.advance/64);
      }
    });
    const measure=face=>value=>[...value].reduce((width,char)=>width+advances[face].get(char),0);
    const breaks=data.rows.map(row=>[lineBreak(row.title,measure(2)),lineBreak(row.title,measure(3)),lineBreak(row.title,measure(2))]);
    const cb=64,eb=64,gb=eb+data.rows.length*12,sb=gb+glyphs.length*16,strings=["",...new Set([data.heading,...data.rows.map(row=>row.title)])],offsets=new Map(),encoded=[];
    let cursor=sb;for(const value of strings){const bytes=encoder.encode(value+"\0");offsets.set(value,cursor);encoded.push([cursor,bytes]);cursor+=bytes.length;}
    const se=cursor;for(const glyph of glyphs){glyph.offset=cursor;cursor+=glyph.bits.length;}
    if(cursor>30000 || glyphs.length>2048)throw Error(`提醒与日历字形需要${cursor}字节，超过30,000字节单条容量；请减少不同标题文字，设备旧数据未改动。`);
    const bytes=new Uint8Array(30000),v=new DataView(bytes.buffer);bytes.set(encoder.encode("ELREM02\0"));v.setUint16(8,cursor,true);bytes[11]=data.rows.length;v.setUint16(12,glyphs.length,true);v.setUint16(14,offsets.get(data.heading),true);
    [cb,eb,gb,sb,se].forEach((n,i)=>v.setUint16(16+i*2,n,true));bytes[26]=1;
    data.rows.forEach((row,i)=>{const off=eb+i*12;[row.day,row.minute,row.second,offsets.get(row.title)].forEach((n,j)=>v.setUint16(off+j*2,n,true));bytes.set(breaks[i],off+8);});
    glyphs.forEach((g,i)=>{const off=gb+i*16;v.setUint32(off,g.code,true);bytes.set([g.face,g.w,g.h,g.pitch,g.x&255,g.y&255],off+4);v.setUint16(off+10,g.advance,true);v.setUint16(off+12,g.offset,true);bytes.set(g.bits,g.offset);});
    encoded.forEach(([off,value])=>bytes.set(value,off));cache={key,bytes};return bytes.slice();
  }
  async function frame(options,prepared){
    const expected=model(options);
    const bytes=prepared||await pack(options),e=await OMSchool.engine();
    if(typeof e.preview_reminder!=="function")throw Error("提醒绘图模块版本不匹配，请刷新网页");
    new Uint8Array(e.memory.buffer,e.preview_school_data(),30000).set(bytes);
    const device=CourseTable.deviceInfo(options),name=new Uint8Array(e.memory.buffer,e.preview_school_name(),256);name.fill(0);encoder.encodeInto(device.deviceName||"设备未连接",name.subarray(0,255));
    const address=e.preview_reminder(Math.floor(+(options.date||new Date())/1000),expected.zone,options.model||5,device.millivolts||0);
    if(!address)throw Error("固件拒绝提醒数据或字形，未发送设备");
    const fields=["count","kind","days","focus","next","content"],proof=new Uint32Array(e.memory.buffer,e.preview_reminder_stats(),6);
    fields.forEach((field,i)=>{if(proof[i]!==expected[field])throw Error("网页与固件提醒的"+field+"不一致，已停止同步");});
    return {bytes:new Uint8Array(e.memory.buffer,address,30000).slice(),proof:expected};
  }
  async function render(canvas,options){
    const result=await frame(options),planes=options.model===2?{black:result.bytes.subarray(0,15000),red:result.bytes.subarray(15000)}:{packed:result.bytes};
    canvas.width=400;canvas.height=300;canvas.getContext("2d").putImageData(new ImageData(OMProtocol.rgba(planes),400,300),0,0);return result.proof;
  }
  async function apply(client,options,external,progress=()=>{}){
    if(!supported(client))throw Error("新版字体的离线提醒需要 SDK 18；当前固件可发送当前画面。");
    const bytes=await pack(options);await frame(options,bytes);
    return OMSchool.apply(client,options,external,progress,{bytes,supported,format:4});
  }
  return {supported,model,pack,frame,render,apply,lineBreak,validateDeadline};
})();
