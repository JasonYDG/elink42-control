"use strict";
const OMCalendar = (() => {
  const regions = OMHolidays.regions;
  function region(code) {
    const found = regions.find(r => r.code === code);
    if (!found) throw Error("Unknown calendar country");
    return found;
  }
  const weekdays=(code,language)=>OMHolidays.weekdays[region(code).weekdays || language];
  const hasAlmanac=code=>region(code).almanac;
  function day(code, date) {
    const r = region(code), key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
    const row = r.days.find(d => d[0] === key);
    return {known:r.years.includes(date.getFullYear()), holiday:row && !row[2], work:!!row?.[2], names:row ? OMHolidays.names[row[1]] : null};
  }
  function month(code, year, monthIndex) {
    region(code);
    if (!Number.isInteger(year) || year < 1970 || year > 2105 || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) throw Error("Invalid calendar month");
    const first = new Date(year, monthIndex, 1).getDay();
    return Array.from({length:42}, (_, i) => {
      const date = new Date(year, monthIndex, i-first+1);
      return {date, current:date.getMonth()===monthIndex, ...day(code,date)};
    });
  }
  const zones = {CN:"Asia/Shanghai", DE:"Europe/Berlin", SG:"Asia/Singapore", TW:"Asia/Taipei", JP:"Asia/Tokyo", MY:"Asia/Kuala_Lumpur"};
  function zone(code, date = new Date()) {
    region(code);
    const parts = new Intl.DateTimeFormat("en-GB", {timeZone:zones[code], timeZoneName:"longOffset"}).formatToParts(date);
    const name = parts.find(p=>p.type==="timeZoneName").value;
    return name==="GMT" ? 0 : Number(name.replace("GMT","" ).split(":")[0]);
  }
  function localDate(code, date = new Date()) {
    region(code);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:zones[code],year:"numeric",month:"numeric",day:"numeric"}).formatToParts(date).map(p=>[p.type,p.value]));
    return new Date(Number(parts.year),Number(parts.month)-1,Number(parts.day),12);
  }
  const ordinal=(year,month,day)=>Math.round((Date.UTC(year,month,day)-Date.UTC(year,0,1))/86400000);
  function week(date){const thursday=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()+3-(date.getDay()+6)%7));return Math.floor((ordinal(thursday.getUTCFullYear(),thursday.getUTCMonth(),thursday.getUTCDate()))/7)+1;}
  const solarNames=[['Minor Cold','小寒'],['Major Cold','大寒'],['Spring Begins','立春'],['Rain Water','雨水'],['Awakening','惊蛰'],['Spring Equinox','春分'],['Clear Bright','清明'],['Grain Rain','谷雨'],['Summer Begins','立夏'],['Grain Buds','小满'],['Grain in Ear','芒种'],['Summer Solstice','夏至'],['Minor Heat','小暑'],['Major Heat','大暑'],['Autumn Begins','立秋'],['Heat Ends','处暑'],['White Dew','白露'],['Autumn Equinox','秋分'],['Cold Dew','寒露'],['Frost Falls','霜降'],['Winter Begins','立冬'],['Minor Snow','小雪'],['Major Snow','大雪'],['Winter Solstice','冬至']];
  function almanac(date){
    const year=date.getFullYear(),month=date.getMonth()+1,day=date.getDate(),r=OMAlmanacData;
    if(year<2000||year>2050)return null;
    let n=ordinal(year,month-1,day),index=year-1999,first=r.lunar_new_years[index];
    if(n<first){n+=365+(new Date(year-1,1,29).getMonth()===1?1:0);index--;first=r.lunar_new_years[index];}
    let remaining=n+1-first,lm=0,leap=false;
    for(;lm<=12;lm++){const length=29+((r.lunar_month_lengths[index+1]>>(12-lm))&1);if(remaining<=length){const after=((r.lunar_leap_months[index]-1)&255)<lm;leap=after&&lm===r.lunar_leap_months[index];if(!after)lm++;break;}remaining-=length;}
    let term=(month-1)*2+(day>14?1:0);
    const termDay=t=>r.solar_term_days[t]+((r.solar_adjustments[year-2000]&(1<<t))?(t<22 && ((1<<t)&0x240802) && year<2044?1:-1):0);
    let distance=termDay(term)-day;
    if(distance<0){term++;distance=term<month*2?termDay(term)-day:new Date(year,month,0).getDate()-day+termDay(term%24);}
    const days=['','初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];
    const months=['','正月','二月','三月','四月','五月','六月','七月','八月','九月','十月','冬月','腊月'];
    return {lunarFull:(leap?"闰":"")+months[lm]+days[remaining],lunarMonth:lm,lunarDay:remaining,leap,lunar:remaining===1?(leap?'闰':'')+months[lm]:days[remaining],solar:solarNames[term%24],distance};
  }
  function nextHoliday(code,date){
    const r=region(code),now=Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
    if(!r.years.includes(date.getFullYear()))return null;
    for(let i=0;i<r.days.length;i++){
      const [key,name,work]=r.days[i],time=Date.parse(key+'T00:00:00Z'),previous=r.days[i-1];
      if(work||time<=now||previous&&!previous[2]&&time-Date.parse(previous[0]+'T00:00:00Z')===86400000)continue;
      return {date:key,names:OMHolidays.names[name],days:(time-now)/86400000};
    }
    return null;
  }
  return {regions, region, day, month, zone, localDate, week, weekdays, hasAlmanac, almanac, nextHoliday, photoWidth:256};
})();
