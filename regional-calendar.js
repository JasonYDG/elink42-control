"use strict";
const OMRegional = (() => {
  const format = "elink42-region-v1", annualFormat = "elink42-region-year-v1";
  // Germany follows the nationwide dates in source/calendar/holidays.json.
  const OMGermanRegion = {"years":[2026,2027],"days":[["2026-01-01","newyear",0],["2026-04-03","good",0],["2026-04-06","easter",0],["2026-05-01","labour",0],["2026-05-14","ascension",0],["2026-05-25","whit",0],["2026-10-03","unity",0],["2026-12-25","christmas",0],["2026-12-26","boxing",0],["2027-01-01","newyear",0],["2027-03-26","good",0],["2027-03-29","easter",0],["2027-05-01","labour",0],["2027-05-06","ascension",0],["2027-05-17","whit",0],["2027-10-03","unity",0],["2027-12-25","christmas",0],["2027-12-26","boxing",0]]};
  const OMGermanNames = {"newyear": "Neujahr", "good": "Karfreitag", "easter": "Ostermontag", "labour": "Tag der Arbeit", "ascension": "Christi Himmelfahrt", "whit": "Pfingstmontag", "unity": "Tag der Deutschen Einheit", "christmas": "Erster Weihnachtstag", "boxing": "Zweiter Weihnachtstag"};
  const catalog = new Map();
  const nativeCodes = ["CN", "", "SG", "TW"];
  const iso = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
  function validCode(s) {return typeof s==="string" && /^[A-Z][A-Z0-9]{1,7}(?:-[A-Z0-9]{1,8}){0,2}$/.test(s);}
  function label(s,max) {if(typeof s!=="string" || !s.trim() || s.length>max || /[\u0000-\u001f]/.test(s))throw Error("地区方案文字无效"); return s.trim();}
  function annual(year,entries) {
    if (!Number.isInteger(year)||year<1970||year>2105||!Array.isArray(entries)||entries.length>366)throw Error("年度休假表格式无效");
    const seen=new Set();
    return entries.map(row=>{
      const {month,day,off}=row||{};
      const date=new Date(year,month-1,day);
      if(!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||date.getMonth()!==month-1||typeof off!=="boolean"||seen.has(month*32+day))throw Error("休假日期无效或重复");
      seen.add(month*32+day);
      return {month,day,off,name:row.name ? label(row.name,80) : ""};
    }).sort((a,b)=>a.month-b.month || a.day-b.day);
  }
  function validate(p) {
    if(!p || p.format!==format || !validCode(p.code))throw Error("地区配置格式或代码无效");
    const name=label(p.name,48),locale=label(p.locale,40),timeZone=label(p.timeZone,64);
    if(!Intl.DateTimeFormat.supportedLocalesOf([locale]).length)throw Error("浏览器不支持此日历语言");
    new Intl.DateTimeFormat(locale,{timeZone});
    if(!Number.isInteger(p.weekStart)||p.weekStart<0||p.weekStart>6||!Array.isArray(p.weekend)||p.weekend.length>7||
       p.weekend.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(p.weekend).size!==p.weekend.length)throw Error("每周起始日或休息日无效");
    if(!p.years||typeof p.years!=="object"||Array.isArray(p.years))throw Error("年度休假表格式无效");
    const years={};
    for(const [year,rows] of Object.entries(p.years)){if(!/^\d{4}$/.test(year))throw Error("休假年份无效");years[year]=annual(Number(year),rows);}
    return {format,code:p.code,name,locale,timeZone,weekStart:p.weekStart,weekend:[...p.weekend].sort(),years};
  }
  function preset(code) {
    if(catalog.has(code))return catalog.get(code);
    const de=code==="DE",region=de?OMGermanRegion:OMHolidays.regions.find(r=>r.code===code);
    if(!region)throw Error("没有这个预置地区方案");
    const names=de?OMGermanNames:null,years=Object.fromEntries(region.years.map(y=>[y,[]]));
    for(const [date,key,work] of region.days){const [year,month,day]=date.split("-").map(Number);years[year].push({month,day,off:!work,name:de?names[key]:OMHolidays.names[key][1]});}
    const p=validate({format,code,name:de?"Deutschland":region.zh,locale:de?"de-DE":"zh-CN",timeZone:{CN:"Asia/Shanghai",SG:"Asia/Singapore",TW:"Asia/Taipei",DE:"Europe/Berlin"}[code],weekStart:de?1:0,weekend:[0,6],years});
    catalog.set(code,p);return p;
  }
  function selection(data){return data.activeRegion || nativeCodes[data.screenProfile?.country??data.settings.calendarCountry] || "CN";}
  function get(data,key=selection(data)){return key.startsWith("custom:")?data.regionProfiles[key.slice(7)]:preset(key);}
  function install(data,profile){const p=validate(profile); data.regionProfiles={...data.regionProfiles,[p.code]:p};data.activeRegion="custom:"+p.code;return p;}
  function checkWorkspace(data) {
    if (data.regionProfiles!==undefined) {
      if (!data.regionProfiles || typeof data.regionProfiles!=="object" || Array.isArray(data.regionProfiles)) throw Error("地区方案列表无效");
      for(const [code,p] of Object.entries(data.regionProfiles)){
        if(code!==p?.code)throw Error("地区配置代码不一致");
        data.regionProfiles[code]=validate(p);
      }
    }
    if(data.activeRegion!==undefined && !["CN","SG","TW","DE"].includes(data.activeRegion) &&
       !(typeof data.activeRegion==="string" && data.activeRegion.startsWith("custom:") && validCode(data.activeRegion.slice(7)) && Object.hasOwn(data.regionProfiles||{},data.activeRegion.slice(7))))
      throw Error("找不到选择的地区方案");
  }
  function nativeId(p){const id=nativeCodes.indexOf(p.code);return id>=0 && (p===preset(p.code) || JSON.stringify(p)===JSON.stringify(preset(p.code)))?id:null;}
  function localDate(p,instant=new Date()){
    const parts=new Intl.DateTimeFormat("en-GB",{timeZone:p.timeZone,year:"numeric",month:"numeric",day:"numeric"}).formatToParts(instant);
    const map=Object.fromEntries(parts.map(v=>[v.type,Number(v.value)]));return new Date(map.year,map.month-1,map.day,12);
  }
  const supported=c=>c.sdkRevision>=32 && !!(c.sdkCapabilities&2048);
  return {format,annualFormat,checkWorkspace,validCode,annual,validate,preset,selection,get,install,nativeId,localDate,supported,iso};
})();
