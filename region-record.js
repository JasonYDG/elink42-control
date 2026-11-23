"use strict";
// Layout shared with firmware/sdk/region_calendar.c. Times in UTC seconds, offsets in minutes.
const OMRegionRecord = (() => {
  const transitionCache=new Map();
  function transitions(zone) {
    if(transitionCache.has(zone))return transitionCache.get(zone);
    const fmt=new Intl.DateTimeFormat("en",{timeZone:zone,timeZoneName:"longOffset"});
    function offset(t){const s=fmt.formatToParts(new Date(t*1000)).find(v=>v.type==="timeZoneName").value;
      if(s==="GMT")return 0;
      const m=/^GMT([+-])(\d\d):(\d\d)(?::\d\d)?$/.exec(s);
      if(!m)throw Error("无法读取地区时区偏移");return (Number(m[2])*60+Number(m[3]))*(m[1]==="-"?-1:1);}
    const end=Date.UTC(2106,0,1)/1000,week=7*86400,rows=[[0,offset(0)]];
    for(let t=week;t<end+week;t+=week){
      const right=Math.min(t,end),next=offset(right);
      if(next===rows.at(-1)[1])continue;
      let lo=t-week,hi=right;
      while(hi-lo>60){const mid=Math.floor((lo+hi)/120)*60;if(offset(mid)===next)hi=mid;else lo=mid;}
      rows.push([hi,next]);
    }
    transitionCache.set(zone,rows);return rows;
  }
  function sprite(text,size,maxWidth,bold=false){
    const canvas=document.createElement("canvas");canvas.width=maxWidth;canvas.height=size+5;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.font=(bold?"bold ":"")+size+'px "Microsoft YaHei", Arial, sans-serif';
    ctx.textBaseline="middle";ctx.fillStyle="black";ctx.fillText(text,0,canvas.height/2,maxWidth);
    const w=Math.max(1,Math.min(maxWidth,Math.ceil(ctx.measureText(text).width)+1)),h=canvas.height;
    const pixels=ctx.getImageData(0,0,w,h).data,stride=Math.ceil(w/8),bytes=new Uint8Array(stride*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(pixels[(y*w+x)*4+3]>=110)bytes[y*stride+(x>>3)]|=128>>(x%8);
    return {w,h,bytes};
  }
  let cache;
  function pack(p,rasterize=sprite) {
    const key=JSON.stringify(p);
    if(rasterize===sprite && cache?.key===key)return cache.record;
    const years=Object.keys(p.years).map(Number),zones=transitions(p.timeZone),events=[],sprites=[],ids=new Map();
    const add=(s,n,w,b=false)=>{sprites.push(rasterize(s,n,w,b));return sprites.length-1;};
    add(p.name,19,240,true);
    const monthFmt=new Intl.DateTimeFormat(p.locale,{month:"long",calendar:"gregory",timeZone:"UTC"});
    const weekFmt=new Intl.DateTimeFormat(p.locale,{weekday:"short",timeZone:"UTC"});
    for(let i=0;i<12;i++)add(monthFmt.format(Date.UTC(2024,i,15)),19,180,true);
    for(let i=0;i<7;i++)add(weekFmt.format(Date.UTC(2024,0,7+i)),14,52);
    for(let i=0;i<10;i++)add(String(i),20,16,true);
    const lang=p.locale.split("-")[0],labels=lang==="de"?["Feiertagsdaten fehlen","Frei","Arbeitstag"]:lang==="zh"?["假期数据待更新","休息日","补班"]:["Holiday data unavailable","Day off","Workday"];
    for(const s of labels)add(s,14,230);
    for(const year of years)for(const {month,day,off,name} of p.years[year]){
      let id=off?31:32;
      if(name){if(!ids.has(name))ids.set(name,add(name,14,228));id=ids.get(name);}
      events.push({year,month,day,off,id});
    }
    const header=24,descriptors=header+years.length*2+zones.length*6+events.length*7;
    let pos=descriptors+sprites.length*4;
    const used=pos+sprites.reduce((n,s)=>n+s.bytes.length,0);
    if(used>30000)throw Error("地区配置超过设备单个应用槽的 30 KB 容量，请减少年份或缩短节日名称。");
    const record=new Uint8Array(30000),d=new DataView(record.buffer),u16=(at,v)=>d.setUint16(at,v,true);
    record.set(new TextEncoder().encode("ELREG01"));u16(8,used);record[10]=p.weekStart;record[11]=p.weekend.reduce((n,v)=>n|(1<<v),0);
    u16(12,years.length);u16(14,zones.length);u16(16,events.length);u16(18,sprites.length);
    let at=header;for(const year of years){u16(at,year);at+=2;}
    for(const [epoch,minutes] of zones){d.setUint32(at,epoch,true);d.setInt16(at+4,minutes,true);at+=6;}
    for(const e of events){u16(at,e.year);record[at+2]=e.month;record[at+3]=e.day;record[at+4]=Number(e.off);u16(at+5,e.id);at+=7;}
    for(const s of sprites){record[at]=s.w;record[at+1]=s.h;u16(at+2,pos);record.set(s.bytes,pos);pos+=s.bytes.length;at+=4;}
    if(rasterize===sprite)cache={key,record};return record;
  }
  function render(canvas,p,date,bytes=pack(p)){
    const d=new DataView(bytes.buffer),u16=i=>d.getUint16(i,true);
    const events=24+2*u16(12)+6*u16(14),desc=events+7*u16(16);
    const ctx=canvas.getContext("2d"),white="#fff",black="#000",red="#b81928";
    const rect=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
    function draw(id,x,y,color,center=false){const a=desc+id*4,w=bytes[a],h=bytes[a+1],pos=u16(a+2),stride=Math.ceil(w/8);
      if(center)x-=Math.floor(w/2);for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(bytes[pos+j*stride+(i>>3)]&(128>>(i%8)))rect(x+i,y+j,1,1,color);}
    function number(n,x,y,color){for(const c of String(n)){draw(20+Number(c),x,y,color);x+=14;}}
    rect(0,0,400,300,white);draw(0,8,4,black);number(date.getFullYear(),8,31,black);draw(date.getMonth()+1,77,31,black);
    rect(8,59,384,2,black);rect(8,88,384,1,black);rect(8,273,384,2,black);
    for(let col=0;col<7;col++){const wd=(p.weekStart+col)%7;draw(13+wd,32+col*56,65,p.weekend.includes(wd)?red:black,true);}
    const y=date.getFullYear(),m=date.getMonth()+1,items=p.years[y]||[],first=(new Date(y,m-1,1).getDay()-p.weekStart+7)%7;
    for(let day=1;day<=new Date(y,m,0).getDate();day++){
      const cell=first+day-1,c=cell%7,x=4+c*56,top=91+Math.floor(cell/7)*30,wd=(p.weekStart+c)%7;
      const ev=items.find(e=>e.month===m&&e.day===day),ink=(ev?ev.off:p.weekend.includes(wd))?red:black;
      number(day,x+(day<10?21:14),top+2,ink);
      if(ev)rect(x+47,top+10,3,9,ink);
      if(day===date.getDate()){rect(x+2,top,50,2,red);rect(x+2,top+26,50,2,red);rect(x+2,top,2,28,red);rect(x+50,top,2,28,red);}
    }
    let next=0;
    for(let i=0;i<u16(16);i++){const a=events+7*i;if(u16(a)===y && bytes[a+2]*32+bytes[a+3]>=m*32+date.getDate()){next=a;break;}}
    if(!Object.hasOwn(p.years,y))draw(30,8,278,black);
    else if(next){number(bytes[next+2],8,275,black);rect(39,291,3,3,black);number(bytes[next+3],48,275,black);draw(u16(next+5),90,279,bytes[next+4]?red:black);}
  }
  async function apply(client,p,progress,date=new Date()){
    if(!OMRegional.supported(client))throw Error("地区方案离线换日需要 SDK 32，请在设置中升级固件。");
    return OMSchool.apply(client,{country:0,date},false,progress,{format:5,style:15,supported:OMRegional.supported,bytes:pack(p)});
  }
  return {pack,render,apply,transitions};
})();
