"use strict";
const OMRender = (() => {
  const FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
  function start(canvas) {
    const ctx = canvas.getContext("2d", {willReadFrequently: true});
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 400, 300);
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.fillStyle = "black"; ctx.strokeStyle = "black"; ctx.lineWidth = 1;
    return ctx;
  }
  function line(ctx, x, y, x2, y2) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke(); }
  function fit(ctx, text, width) {
    const letters = [...text];
    while (letters.length && ctx.measureText(letters.join("")).width > width) letters.pop();
    return letters.length < [...text].length ? letters.slice(0, -1).join("") + "…" : text;
  }
  function todo(canvas, title, text) {
    const ctx = start(canvas), rows = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (rows.length > 7) throw Error(OMI18n.t("一屏最多 7 项待办，请减少行数"));
    ctx.font = `bold 22px ${FONT}`; ctx.fillStyle = "#b81928";
    ctx.fillText(fit(ctx, title.trim() || OMI18n.t("今日待办"), 350), 20, 30);
    ctx.fillStyle = "black"; line(ctx, 20, 53, 380, 53);
    if (!rows.length) { ctx.font = `16px ${FONT}`; ctx.fillText(OMI18n.t("在左上方输入待办，每行一项"), 20, 88); }
    rows.forEach((row, i) => {
      const done = /^\[x\]\s*/i.test(row), label = row.replace(/^\[(x| )\]\s*/i, "");
      const y = 79 + i * 28;
      ctx.strokeRect(21, y - 7, 13, 13);
      if (done) { line(ctx, 23, y, 27, y + 4); line(ctx, 27, y + 4, 33, y - 5); }
      ctx.font = `16px ${FONT}`; const fitted = fit(ctx, label, 330); ctx.fillText(fitted, 44, y);
      if (done) line(ctx, 44, y, 44 + ctx.measureText(fitted).width, y);
    });
    line(ctx, 20, 275, 380, 275); ctx.font = `11px ${FONT}`;
    ctx.fillText(OMI18n.msg`${rows.filter(row => /^\[x\]/i.test(row)).length} / ${rows.length} 已完成`, 20, 288);
  }
  function image(canvas, bitmap, options = {}) {
    const ctx = start(canvas);
    if (!bitmap) { ctx.font = `16px ${FONT}`; ctx.textAlign = "center"; ctx.fillText(OMI18n.t("选择图片后在此预览"), 200, 150); return; }
    const angle = options.angle || 0, swapped = angle % 180 !== 0;
    const w = swapped ? bitmap.height : bitmap.width, h = swapped ? bitmap.width : bitmap.height;
    const width=options.target==="calendar"?256:400;
    const scale = (options.fit === "cover" ? Math.max : Math.min)(width / w, 300 / h) * (options.zoom || 1);
    ctx.save();ctx.beginPath();ctx.rect(0,0,width,300);ctx.clip();ctx.translate(width/2 + (options.x || 0), 150 + (options.y || 0)); ctx.rotate(angle * Math.PI / 180);
    ctx.drawImage(bitmap, -bitmap.width * scale / 2, -bitmap.height * scale / 2, bitmap.width * scale, bitmap.height * scale); ctx.restore();
  }
  const COLORS = {black: "#000", white: "#fff", red: "#b81928", yellow: "#ffd200"};
  function lcdDate(ctx,day){
    const rects=[[4,0,30,4],[34,4,4,24],[34,30,4,24],[4,52,30,4],[0,30,4,24],[0,4,4,24],[4,26,30,4]],bits=[63,6,91,79,102,109,125,7,127,111];
    const digits=[...String(day)].map(Number),width=d=>d===1?4:38;
    let x=328-(digits.reduce((sum,d)=>sum+width(d),0)+(digits.length-1)*8)/2;
    ctx.fillStyle=COLORS.red;
    for(const d of digits){for(let i=0;i<7;i++)if(bits[d]&(1<<i)){const [dx,dy,w,h]=rects[i];ctx.fillRect(x+dx-(d===1?34:0),54+dy,w,h);}x+=width(d)+8;}
  }
  function calendar(canvas,{code,date,language="zh",photo=false,bitmap=null,slot="",model=5}){
    const block=(...args)=>textBlock(...args,14);
    const ctx=start(canvas), C=OMCalendar, region=C.region(code), zh=language==="zh", left=photo?266:12, width=photo?124:376;
    const center=(text,cx,y,w,h,size)=>{ctx.font=`${size}px ${FONT}`;block(ctx,text,cx-ctx.measureText(text).width/2,y,w,h,size);};
    if(photo){
      if(bitmap)image(canvas,bitmap,{target:"calendar",fit:"contain"});
      else {ctx.fillStyle="#eee";ctx.fillRect(0,0,256,300);ctx.fillStyle="#000";block(ctx,OMI18n.t("Device slot")+" "+(slot===""?"—":slot),24,130,210,30,16);}
    }
    ctx.fillStyle=photo?COLORS.black:COLORS.red;
    const heading=`${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,"0")}`;
    if(photo){
      ctx.font=`500 22px "Bahnschrift Condensed", "Arial Narrow", sans-serif`;ctx.textBaseline="alphabetic";
      ctx.fillText(heading,left,29,86);
      if(code==="CN"){const a=C.almanac(date),offset=Math.min(86,ctx.measureText(heading).width)+4;if(a){ctx.font=`12px ${FONT}`;ctx.fillText(a.zodiac[zh?1:0],left+offset,28,width-offset);}}
    }else block(ctx,`${date.getFullYear()} / ${String(date.getMonth()+1).padStart(2,"0")}`,left,5,180,27,24);
    ctx.fillStyle=COLORS.black;
    // Preview has no measured battery voltage; only the native device supplies it.
    ctx.strokeRect(370,photo?38:5,18,9);ctx.fillRect(388,photo?41:8,2,3);
    if(photo)block(ctx,region[zh?"zh":"en"],left,38,88,14,11);
    else block(ctx,region[zh?"zh":"en"],290,19,100,14,11);
    block(ctx,zh?`第${C.week(date)}周`:`Week ${C.week(date)}`,photo?left:195,photo?116:18,photo?width:90,14,12);
    if(!photo && zh && C.hasAlmanac(code)){const a=C.almanac(date);if(a)block(ctx,a.lunarFull,195,1,90,12,10);}
    const weeks=C.weekdays(code,language);
    if(photo){
      lcdDate(ctx,date.getDate());
    }
    const cells=C.month(code,date.getFullYear(),date.getMonth()),first=cells.findIndex(d=>d.current),length=cells.filter(d=>d.current).length;
    const cell=photo?17:54,top=photo?146:34,startX=photo?left:10,rowH=photo?13:first+length>35?34:38;
    weeks.forEach((name,col)=>{
      if(!photo){ctx.fillStyle=col===0||col===6?COLORS.red:COLORS.black;ctx.fillRect(startX+col*cell,top,cell,23);ctx.fillStyle=COLORS.white;}
      else ctx.fillStyle=col===0||col===6?COLORS.red:COLORS.black;
      block(ctx,name,startX+col*cell+(photo?0:20),top+(photo?0:5),cell,14,photo?10:12);
    });
    cells.forEach((d,i)=>{
      if(!d.current)return;const col=i%7,row=Math.floor(i/7),x=startX+col*cell,y=(photo?162:61)+row*rowH;
      if(!photo && model===5 && d.date.getDate()===date.getDate()){ctx.fillStyle=COLORS.yellow;ctx.fillRect(x,y,52,rowH-1);}
      ctx.fillStyle=d.work?COLORS.black:d.holiday||col===0||col===6?COLORS.red:COLORS.black;
      const dayLabel=String(d.date.getDate());
      if(photo)block(ctx,dayLabel,x,y,cell-2,12,10);else center(dayLabel,x+27,y,cell-2,24,24);
      if(d.date.getDate()===date.getDate()){ctx.strokeStyle=COLORS.red;ctx.strokeRect(x-(photo?1:0),y-(photo?1:0),cell-(photo?0:2),rowH-1);}
      if(!photo){
        const a=C.hasAlmanac(code)?C.almanac(d.date):null;if(a){const sub=a.distance===0?(zh?a.solar[1]:a.solar[0].slice(0,3)+'.'+(a.solar[0].split(' ')[1]?.[0]||'')):zh?a.lunar:"";ctx.fillStyle=a.distance===0?COLORS.red:COLORS.black;center(sub,x+27,y+23,54,12,10);}
        if(d.holiday||d.work){ctx.fillStyle=d.work?COLORS.black:COLORS.red;block(ctx,d.work?"w":"*",x+44,y,10,12,10);}
      }
    });
    const info=C.day(code,date),label=info.names?info.names[zh?1:0]:!info.known?(zh?"假期数据待更新":"Update holiday data"):(zh?"暂无节日":"No public holiday today");
    const almanac=C.hasAlmanac(code)?C.almanac(date):null,solarToday=almanac?.distance===0;
    ctx.fillStyle=info.holiday?COLORS.red:COLORS.black;
    if(photo){
      const solar=code==="CN" || solarToday,next=solarToday?{names:almanac.solar,days:0}:solar?C.nextSolar(date):C.nextHoliday(code,date);
      ctx.textBaseline="top";ctx.textAlign="center";ctx.fillStyle=COLORS.black;ctx.font=`12px ${FONT}`;
      if(next)ctx.fillText(solarToday?(zh?"今天是":"Today is"):zh?(solar?`下个节气还有${next.days}天`:`${next.days}天后下个假期`):`Next ${solar?"solar term":"holiday"} in ${next.days} ${next.days===1?"day":"days"}`,328,250,width);
      const size=solar&&zh?24:14,name=next?next.names[zh?1:0]:zh?"假期数据待更新":"Update holiday data";
      ctx.fillStyle=COLORS.red;ctx.font=`${size}px ${FONT}`;
      ctx.fillText(solar&&!zh?name.toUpperCase():name,328,272+(24-size)/2,width);ctx.textAlign="left";
    }else{
      block(ctx,label,left,271,180,28,12);
      if(almanac&&almanac.distance!==null){
        const label=solarToday?(zh?`今天是${almanac.solar[1]}`:`Today: ${almanac.solar[0]}`):zh?`${almanac.distance}天后${almanac.solar[1]}`:`${almanac.solar[0]} in ${almanac.distance} days`;
        ctx.fillStyle=COLORS.red;ctx.textBaseline="top";ctx.textAlign="center";ctx.font=`24px ${FONT}`;ctx.fillText(label,307,272,166);ctx.textAlign="left";
      }
    }
  }
  function textBlock(ctx, text, x, y, width, height, size, lineHeight=size*1.35) {
    ctx.font = `${size}px ${FONT}`; ctx.textBaseline = "top";
    let row = "", top = y;
    const flush = () => { if (top + size <= y + height) ctx.fillText(row, x, top); row = ""; top += lineHeight; };
    let index=0;
    for (const char of text) {
      index+=char.length;
      if(char===" " && row && ctx.measureText(row+char+(text.slice(index).match(/^\S+/u)?.[0]||"")).width>width){flush();continue;}
      if (char === "\n") { flush(); continue; }
      if (row && ctx.measureText(row + char).width > width) flush();
      row += char;
    }
    flush();
  }
  function todos(canvas, items, title, settings, single = false) {
    const ctx = start(canvas), size = settings.fontSize, now = Date.now();
    ctx.fillStyle = COLORS.red; textBlock(ctx, title || OMI18n.t("待办清单"), 18, 15, 365, 35, 24);
    line(ctx, 18, 56, 382, 56);
    const shown = single ? items.slice(0, 1) : items;
    let y = 70;
    for (const item of shown) {
      const urgent = !item.done && item.due && Date.parse(item.due) - now <= settings.urgentHours * 3600000;
      const detail = [item.description, item.due ? OMI18n.t("截止 ") + new Date(item.due).toLocaleString(OMI18n.locale) : ""].filter(Boolean).join("\n");
      const height = single ? 185 : size * (detail ? 3.5 : 1.7);
      if (y + height > 274) throw Error(OMI18n.t("待办超出一屏，请选择单项或减少内容/字号"));
      ctx.fillStyle = urgent ? COLORS.red : COLORS.black;
      textBlock(ctx, `${item.done ? "☑" : "□"} ${item.title}`, 20, y, 360, single ? 60 : size * 1.4, single ? 26 : size);
      if (detail) textBlock(ctx, detail, 40, y + (single ? 65 : size * 1.5), 338, height - size * 1.5, Math.max(10, size - 3));
      y += height;
    }
    if (!shown.length) { ctx.fillStyle = COLORS.black; textBlock(ctx, OMI18n.t("暂无待办事项"), 20, 80, 360, 60, size); }
    ctx.fillStyle = COLORS.black; textBlock(ctx, OMI18n.msg`${items.filter(t => t.done).length} / ${items.length} 已完成`, 20, 280, 360, 20, 11);
  }
  function course(canvas, text, weekday, size = 16) {
    const ctx = start(canvas); ctx.fillStyle = COLORS.red;
    textBlock(ctx, new Date(2026,10,1+weekday).toLocaleDateString(OMI18n.locale,{weekday:"long"}) + OMI18n.t(" · 课程 / 日程"), 20, 16, 360, 40, 24);
    line(ctx, 20, 58, 380, 58); ctx.fillStyle = COLORS.black;
    const rows = text.split("\n").filter(Boolean);
    if (rows.length * size * 1.8 > 210 || rows.some(row => ctx.measureText(row).width > 1600)) throw Error(OMI18n.t("当天课表内容过多"));
    textBlock(ctx, rows.join("\n"), 20, 78, 360, 200, size);
  }
  function weatherIcon(ctx, text, x, y, w, h, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(w / 100, h / 100); ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = 4;
    if (/雨|雪|雷|rain|snow|thunder/i.test(text)) {
      ctx.beginPath(); ctx.arc(50, 32, 23, Math.PI, 0); ctx.lineTo(86, 60); ctx.lineTo(15, 60); ctx.closePath(); ctx.fill();
      for (let i = 0; i < 4; i++) line(ctx, 25 + i * 17, 72, 19 + i * 17, 88);
    } else if (/云|阴|cloud|overcast/i.test(text)) {
      ctx.beginPath(); ctx.arc(45, 42, 28, Math.PI, 0); ctx.arc(72, 53, 19, -Math.PI/2, Math.PI/2); ctx.lineTo(17, 72); ctx.arc(17, 55, 17, Math.PI/2, -Math.PI/2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(50, 50, 22, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line(ctx, 50 + Math.cos(a) * 32, 50 + Math.sin(a) * 32, 50 + Math.cos(a) * 44, 50 + Math.sin(a) * 44); }
    }
    ctx.restore();
  }
  function weather(canvas, data) {
    if (!data) throw Error(OMI18n.t("请先获取天气"));
    OMFeatures.weather(data);
    const ctx = start(canvas); ctx.fillStyle = COLORS.red;
    textBlock(ctx, data.city + OMI18n.t(" · 天气"), 20, 14, 360, 35, 24); line(ctx, 20, 55, 380, 55);
    ctx.fillStyle = COLORS.black;
    textBlock(ctx, `${data.current?.temperature ?? "—"}°`, 20, 70, 220, 65, 48);
    textBlock(ctx, data.current?.text || "", 20, 140, 240, 38, 24);
    weatherIcon(ctx, data.current?.text || "", 265, 70, 105, 105, COLORS.red);
    data.days.slice(0, 3).forEach((day, i) => textBlock(ctx, `${day.date}\n${day.text}\n${day.low}–${day.high}°`, 20 + i * 123, 194, 117, 73, 13));
    textBlock(ctx, OMI18n.t("数据更新 ") + new Date(data.updated).toLocaleString(OMI18n.locale), 20, 282, 360, 16, 10);
  }
  async function template(canvas, spec, context) {
    OMFeatures.template(spec);
    const images = new Map();
    try {
      for (const item of spec.elements.filter(e => e.type === "image")) {
        const blob = await (await fetch(item.src)).blob(), bitmap = await createImageBitmap(blob);
        if (bitmap.width * bitmap.height > 16000000) { bitmap.close(); throw Error(OMI18n.t("模板图片像素过大")); }
        images.set(item, bitmap);
      }
      const ctx = start(canvas);
      for (const e of spec.elements) {
        ctx.save(); ctx.beginPath(); ctx.rect(e.x, e.y, e.width, e.height); ctx.clip();
        ctx.fillStyle = ctx.strokeStyle = COLORS[e.color];
        if (e.type === "text") textBlock(ctx, OMFeatures.placeholders(e.text, context), e.x, e.y, e.width, e.height, e.fontSize);
        if (e.type === "rect") { if (e.outline) ctx.strokeRect(e.x, e.y, e.width, e.height); else ctx.fillRect(e.x, e.y, e.width, e.height); }
        if (e.type === "line") line(ctx, e.x, e.y, e.x + e.width, e.y + e.height);
        if (e.type === "image") ctx.drawImage(images.get(e), e.x, e.y, e.width, e.height);
        if (e.type === "weather") weatherIcon(ctx, context.weather?.current?.text || "", e.x, e.y, e.width, e.height, COLORS[e.color]);
        ctx.restore();
      }
    } finally { for (const bitmap of images.values()) bitmap.close(); }
  }
  return {todo, todos, image, calendar, course, weather, template, textBlock};
})();
