"use strict";
const OMCalendar = (() => {
  const regions = OMHolidays.regions;
  function region(code) {
    const found = regions.find(r => r.code === code);
    if (!found) throw Error("Unknown calendar country");
    return found;
  }
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
  return {regions, region, day, month, zone, localDate, photoWidth:256};
})();
