"use strict";
const OMScreen = (() => {
  const $=id=>document.getElementById(id), types=["calendar","photo","day","week","reminder","stock"];
  let hooks=null,context="calendar",tableDirty=false,last=null,pendingDay=null;
  const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
  function normalise(value={}) {
    if(!value || typeof value!=="object" || Array.isArray(value))throw Error("屏幕方案格式无效");
    const p={version:1,content:value.content??"calendar",update:value.update??"auto",country:value.country??0,
      language:value.language??"zh",style:value.style??0,date:value.date??"",page:value.page??0,source:value.source??0,
      slot:value.slot??255,fit:value.fit??"contain",frequency:value.frequency??0,reminderTitle:value.reminderTitle??"日程提醒",reminderId:value.reminderId??"",background:value.background??null,confirmed:value.confirmed??null};
    if(typeof p.reminderTitle!=="string" || !p.reminderTitle.trim() || p.reminderTitle.length>24)throw Error("提醒日历标题无效");
    if(typeof p.reminderId!=="string" || p.reminderId.length>80)throw Error("提醒选择无效");
    if(value.version!==undefined && value.version!==1 || !types.includes(p.content) || !["auto","snapshot"].includes(p.update) ||
       ![0,2,3].includes(p.country) || !["zh","en"].includes(p.language) || ![0,1,2,4,5].includes(p.style) ||
       !integer(p.page,0,15) || ![0,1].includes(p.source) || !(p.slot===255 || integer(p.slot,0,44)) ||
       !["prepared","contain"].includes(p.fit) || ![0,3,4,5].includes(p.frequency))throw Error("屏幕方案设置超出范围");
    if(p.date)CourseTable.dateValue(p.date);
    if(p.update==="auto")p.date="";
    if(p.content==="stock")p.update="snapshot";
    if(["day","week","reminder"].includes(p.content))p.language="zh";
    if(p.content==="calendar" && p.style && p.language!=="zh")throw Error("该日历布局使用中文，请切换中文或选择经典月历");
    if(p.background){
      const b=p.background;
      if(![2,5].includes(b.model) || typeof b.bytes!=="string" || b.bytes.length!==40000 || !/^[A-Za-z0-9+/]+$/.test(b.bytes))throw Error("方案背景图片格式无效");
      const raw=Uint8Array.from(atob(b.bytes),c=>c.charCodeAt(0));if(raw.length!==30000 || b.crc!==OMProtocol.crc16(raw))throw Error("方案背景图片校验失败");
      p.background={model:b.model,bytes:b.bytes,crc:b.crc};
    }
    if(p.confirmed && (typeof p.confirmed.at!=="string" || p.confirmed.at.length>64 || !Number.isFinite(Date.parse(p.confirmed.at)) || typeof p.confirmed.signature!=="string" || p.confirmed.signature.length>16 || typeof p.confirmed.name!=="string" || p.confirmed.name.length>80 || !integer(p.confirmed.bootId??0,0,0xFFFFFFFF)))throw Error("方案确认记录无效");
    return p;
  }
  function parse(data,current={}) {
    const result=OMFeatures.validate(data),fallback=normalise(current);
    result.screenProfile=normalise(result.screenProfile??{...fallback,country:result.settings.calendarCountry??fallback.country,language:result.settings.calendarLanguage??fallback.language});
    result.settings.calendarCountry=result.screenProfile.country;result.settings.calendarLanguage=result.screenProfile.language;
    result.screenProfile.confirmed=null;
    if(["day","week"].includes(result.screenProfile.content))CourseTable.parseWeek(result.courses);
    result.exams=CourseTable.normalizeExams(result.exams||[]);result.examDays=CourseTable.normalizeExamDays(result.examDays||{});
    return result;
  }
  function current(){const data=hooks?.read();return normalise(data?.screenProfile||{country:[0,2,3].includes(data?.settings.calendarCountry)?data.settings.calendarCountry:0,language:data?.settings.calendarLanguage});}
  function capture(){
    if(!hooks)return normalise();
    const old=current();return normalise({...old,content:$("screen-content").value,update:$("screen-update").value,
      country:Number($("calendar-layout").value),language:$("calendar-language").value,style:Number($("sdk-month-style").value)||0,
      date:$("screen-update").value==="auto"?"":$("calendar-date").value,page:Number($("school-page").value)-1,
      source:Number($("gallery-source").value),slot:$("screen-content").value==="photo"?($("photo-slot").value===""?255:Number($("photo-slot").value)):old.slot,fit:$("photo-fit").value,frequency:Number($("auto-frequency").value)||0,reminderTitle:$("todo-title").value,reminderId:$("todo-mode").value==="single"?$("todo-selected").value:""});
  }
  function signature(data,p){
    const clean={...p,confirmed:null};let h=2166136261;
    const rendering=["fontSize","urgentHours","dither","strength","brightness","contrast","gamma","redThreshold"].map(key=>data.settings[key]);
    for(const c of JSON.stringify([clean,data.courses,data.exams||[],data.examDays||{},data.todos,data.stocks,rendering]))h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;
    return h.toString(16);
  }
  function persist(){
    if(!hooks)return;const data=OMFeatures.clone(hooks.read());data.screenProfile=capture();data.settings.calendarCountry=data.screenProfile.country;data.settings.calendarLanguage=data.screenProfile.language;hooks.save(data);status();
  }
  function fields(p){
    $("screen-content").value=p.content;$("screen-update").value=p.update;$("calendar-layout").value=String(p.country);$("calendar-language").value=p.language;
    $("photo-country").value=String(p.country);$("photo-language").value=p.language;
    $("sdk-month-style").value=String(p.style);$("calendar-date").value=p.date;$("school-view").value=p.content==="day"?"day":"week";$("school-page").value=String(p.page+1);
    $("todo-title").value=p.reminderTitle;
    $("todo-mode").value=p.reminderId?"single":"list";$("todo-selected").value=p.reminderId;
    $("gallery-source").value=$("photo-source").value=String(p.source);$("photo-fit").value=p.fit;$("auto-frequency").value=String(p.frequency);
    $("calendar-date").disabled=p.update==="auto";
    if(p.slot!==255 && !Array.from($("photo-slot").options||[]).some(o=>o.value===String(p.slot))){const o=document.createElement("option");o.value=String(p.slot);o.textContent="位置 "+p.slot;$("photo-slot").append(o);}
    $("photo-slot").value=p.slot===255?"":String(p.slot);
  }
  function restore(show=true){
    if(!hooks)return;fields(current());if(show)hooks.show(current().content);status();
  }
  function status(){
    if(!hooks)return;const p=capture(),saved=p.confirmed,same=saved?.signature===signature(hooks.read(),p),state=last||{};
    $("plan-state").textContent=tableDirty?"课表有未保存修改：请先保存表格，再应用或导出。":same?"最近确认 "+new Date(saved.at).toLocaleTimeString()+" · "+saved.name:hooks.read().screenProfile?"方案已在本机保存 · 有修改待应用":"初始方案 · 调整后自动保存";
    $("screen-apply").textContent=state.runtime?.bootId && saved?.bootId && state.runtime.bootId!==saved.bootId?"恢复方案到屏幕":p.update==="snapshot"?"发送当前画面":"应用并自动更新";
    const scene=["calendar","photo-calendar","course","todo","stock"].includes(context),ready=state.ready&&!state.busy;
    $("screen-apply").hidden=!scene;$("screen-apply").disabled=!ready || !state.frame || tableDirty || (p.update==="auto" && (["day","week"].includes(p.content) && !state.school || p.content==="reminder" && !state.reminder)) || (p.content==="photo"&&!p.background);
    $("workspace-export").disabled=$("workspace-import").disabled=state.busy||tableDirty;
    $("course-frame").inert=!!state.busy;
    for(const id of ["screen-content","screen-update","calendar-layout","calendar-language","sdk-month-style","school-page","photo-country","photo-language"])$(id).disabled=!!state.busy;
    $("screen-update").disabled=!!state.busy||p.content==="stock";
    $("calendar-date").disabled=!!state.busy||p.update==="auto";
    $("screen-update-note").textContent=p.content==="stock"?"行情由网页获取并发送；自动同步需保持本页开启和目标蓝牙连接，仅在交易时段执行。":p.update==="snapshot"?"将原样发送上方400×300画面，日期不会自行变化。":p.content==="reminder"&&state.ready&&!state.reminder?"新版字体的离线提醒需要 SDK 18；升级后应用方案，即可关闭网页、断开蓝牙。": ["day","week"].includes(p.content)&&state.ready&&!state.school?"当前固件请使用“当前画面”；升级 SDK 16 后可关闭网页自动换日。":"应用后由设备时钟离线更新，可关闭网页、断开蓝牙。需持续供电；重启后重新校时启用。";
    $("screen-device-state").textContent=!state.ready?"设备未连接 · 预览是网页方案":state.runtime?.bootId&&saved?.bootId&&state.runtime.bootId!==saved.bootId?"设备已重新启动 · 网页方案保留，点击恢复":same?"设备已连接 · 最近一次应用已确认":"设备已连接 · 当前网页修改尚未发送";
  }
  function device(state){last=state;if(hooks)status();}
  function contextChanged(tab){
    context=tab;if(!hooks)return;
    const type=tab==="calendar"?"calendar":tab==="photo-calendar"?"photo":tab==="course"?$("school-view").value:tab==="todo"?"reminder":tab==="stock"?"stock":null;
    if(type && type!==$("screen-content").value){$("screen-content").value=type;if(type==="stock")$("screen-update").value="snapshot";else if(type==="reminder")$("screen-update").value="auto";persist();}
    if(tab==="course"&&!$("course-frame").getAttribute("src"))$("course-frame").src="timetable.html?embedded=1&v=0.8.10";
    status();
  }
  function openCourse(day){
    pendingDay=integer(day,0,6)?day:null;
    const frame=$("course-frame");if(!frame.getAttribute("src"))frame.src="timetable.html?embedded=1&v=0.8.10";
    sendSelection();
    frame.scrollIntoView?.({behavior:"smooth",block:"start"});
  }
  function sendSelection(){const p=capture(),date=p.date||CourseTable.formatDate(OMCalendar.localDate(OMCalendar.byId(p.country).code));$("course-frame").contentWindow?.postMessage({type:"elink-course-select",day:pendingDay,date,panel:$("preview-model").value==="2"?"three":"four"},location.origin);}
  function exportPlan(name="elink42-screen-plan.json"){
    if(tableDirty)throw Error("请先保存课表表格再导出方案");persist();hooks.download(name,OMFeatures.clone(hooks.read()));
  }
  function saveBeforeOTA(){
    if(tableDirty)throw Error('请先保存课表表格，再进行升级');
    persist();
    if(localStorage.getItem('om6626-workspace-v1')!==JSON.stringify(hooks.read()))throw Error('屏幕方案未能保存到本机，升级尚未开始。请先导出方案。');
  }
  async function importPlan(file){
    if(!file || file.size>6000000)throw Error("请选择不超过6MB的方案 JSON 文件");
    if(tableDirty)throw Error("请先保存课表表格再导入方案");
    const next=parse(JSON.parse(await file.text()),capture());exportPlan("elink42-screen-plan-before-import.json");hooks.save(next);tableDirty=false;restore();
    $("course-frame").removeAttribute("src");if(["day","week"].includes(current().content)){$("course-frame").src="timetable.html?embedded=1&v=0.8.10";pendingDay=null;}
    $("plan-state").textContent="方案已导入到网页；原方案已导出备份。确认预览后再应用到设备。";
  }
  function confirmed(runtime,name,appliedSignature){
    const data=OMFeatures.clone(hooks.read()),p=capture();
    if(signature(data,p)!==appliedSignature){status();return;}
    p.confirmed={at:new Date().toISOString(),name,bootId:runtime?.bootId||0,signature:appliedSignature};data.screenProfile=p;hooks.save(data);status();
  }
  function setBackground(frame,model,slot,source,fit){
    const bytes=OMProtocol.imageBytes(frame,model);let text="";for(const byte of bytes)text+=String.fromCharCode(byte);
    const data=OMFeatures.clone(hooks.read()),p=capture();p.content="photo";p.slot=slot;p.source=Number(source);p.fit=fit;p.background={model,bytes:btoa(text),crc:OMProtocol.crc16(bytes)};data.screenProfile=p;hooks.save(data);restore();
  }
  function background(model){
    const p=capture();if(!p.background)return null;const b=p.background,bytes=Uint8Array.from(atob(b.bytes),c=>c.charCodeAt(0));
    const stored=b.model===5?{packed:bytes}:{black:bytes.slice(0,15000),red:bytes.slice(15000)};
    return b.model===model?stored:OMProtocol.planes(OMFeatures.process(OMProtocol.rgba(stored),model,OMFeatures.defaults().settings),false,model);
  }
  function paintBackground(canvas,model){
    const image=background(model);if(!image)return false;const rgba=OMProtocol.rgba(image),ctx=canvas.getContext("2d"),dst=ctx.getImageData(0,0,400,300),contain=capture().fit==="contain";
    for(let y=0;y<300;y++)for(let x=0;x<256;x++){
      const i=(y*400+x)*4;if(contain&&(y<54||y>=246)){dst.data.set([255,255,255,255],i);continue;}
      const sx=contain?Math.floor(x*400/256):x,sy=contain?Math.floor((y-54)*300/192):y;dst.data.set(rgba.subarray((sy*400+sx)*4,(sy*400+sx)*4+4),i);
    }
    ctx.putImageData(dst,0,0);return true;
  }
  function init(callbacks){
    hooks=callbacks;
    $("todo-title").addEventListener("input",persist);
    for(const id of ["todo-mode","todo-selected"])$(id).addEventListener("change",()=>{persist();hooks.preview();});
    $("screen-content").addEventListener("change",()=>{const p=capture();fields(p);persist();hooks.show(p.content);if(["day","week"].includes(p.content))openCourse();});
    $("school-view").addEventListener("change",()=>{$("screen-content").value=$("school-view").value;persist();hooks.preview();});
    for(const id of ["screen-update","school-page","calendar-date","sdk-month-style","calendar-layout","calendar-language","photo-country","photo-language","photo-fit","photo-slot","gallery-source","auto-frequency"])
      $(id).addEventListener("change",()=>{const p=capture();fields(p);persist();hooks.preview();});
    $("screen-apply").addEventListener("click",()=>hooks.apply(capture()));
    $("course-open-editor").addEventListener("click",()=>openCourse());
    $("course-frame").addEventListener("load",sendSelection);
    $("preview").addEventListener("click",e=>{
      if(!["calendar","photo-calendar","course"].includes(context))return;
      const rect=$("preview").getBoundingClientRect(),x=(e.clientX-rect.left)*400/rect.width,y=(e.clientY-rect.top)*300/rect.height;
      if(y>274){hooks.deviceSettings?.();$("device-details").open=true;$("device-details").scrollIntoView?.({behavior:"smooth"});}
      else if(context==="course"&&y>86){const p=capture(),date=p.date?CourseTable.dateValue(p.date):OMCalendar.localDate(OMCalendar.byId(p.country).code),day=p.content==="week"&&x>=74?Math.min(5,1+Math.floor((x-74)*5/314)):date.getDay();openCourse(day);}
      else{$("screen-date-settings").open=true;$("calendar-layout").focus();$("screen-date-settings").scrollIntoView?.({behavior:"smooth",block:"start"});}
    });
    window.addEventListener("message",e=>{if(e.origin!==location.origin||e.source!==$("course-frame").contentWindow)return;if(e.data?.type==="elink-course-draft"){tableDirty=!!e.data.dirty;status();}});
    window.addEventListener("storage",e=>{if(e.key==="om6626-workspace-v1"){hooks.refresh();hooks.preview();status();}});
    restore();
  }
  return {normalise,parse,current,capture,signature,persist,restore,device,context:contextChanged,init,exportPlan,importPlan,confirmed,setBackground,background,paintBackground,openCourse,saveBeforeOTA,hasProfile:()=>!!hooks?.read().screenProfile,dirty:()=>tableDirty};
})();
