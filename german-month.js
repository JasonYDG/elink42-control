"use strict";
const OMGermanMonth = (() => {
  const week=["SO","MO","DI","MI","DO","FR","SA"];
  const shortNames={Neujahr:"Neuj.",Karfreitag:"Karfr.",Ostermontag:"Ost-Mo.","Tag der Arbeit":"1. Mai","Christi Himmelfahrt":"Himm.",Pfingstmontag:"Pf.-Mo.","Tag der Deutschen Einheit":"Einheit","Erster Weihnachtstag":"1. Weih.","Zweiter Weihnachtstag":"2. Weih.",Heiligabend:"Hl. Ab.",Silvester:"Silv.",Ostersonntag:"Ostern",Pfingstsonntag:"Pfing."};
  const uses=p=>p.code==="DE" && /^de(?:-|$)/i.test(p.locale);
  function unpack(g){
    const [advance,dx,dy,w,h,bits]=g;
    return {advance,dx,dy,w:w||1,h:h||1,bytes:bits?Uint8Array.from(atob(bits),s=>s.charCodeAt(0)):Uint8Array.of(0)};
  }
  function label(value,role,compact,maxWidth,fallback) {
    const font=OMGermanFont[role],chars=Array.from(value);
    if(chars.some(c=>!font[c])){
      const s=fallback(value,compact?12:15,maxWidth,true);
      return {...s,advance:s.w,dx:0,dy:compact?-10:-13};
    }
    function compose(letters){
      const parts=[];let advance=0,top=0,bottom=0;
      for(const c of letters){
        const g=unpack(font[c]);parts.push([g,advance+(compact?0:g.dx)]);
        advance+=compact?(c===" "?3:g.w)+1:g.advance;
        if(c!==" "){top=Math.min(top,g.dy);bottom=Math.max(bottom,g.dy+g.h);}
      }
      if(compact)advance--;
      const w=Math.max(1,advance),h=Math.max(1,bottom-top),stride=Math.ceil(w/8),bytes=new Uint8Array(stride*h);
      for(const [g,x] of parts)for(let j=0;j<g.h;j++)for(let i=0;i<g.w;i++){
        if(g.bytes[j*Math.ceil(g.w/8)+(i>>3)]&(128>>(i%8)))bytes[(j+g.dy-top)*stride+((x+i)>>3)]|=128>>((x+i)%8);
      }
      return {advance:w,dx:0,dy:top,w,h,bytes};
    }
    let s=compose(chars);
    while(s.w>maxWidth && chars.length){chars.pop();s=compose([...chars,"."]);}
    return s;
  }
  function recordParts(p,fallback){
    const f=OMGermanFont,sprites=[],events=[],ids=new Map();
    const fixed=(role,s)=>sprites.push(unpack(f[role][s]));
    if(p.name==="Deutschland")fixed("meta","DEUTSCHLAND");
    else sprites.push(label(p.name.toLocaleUpperCase("de"),"status",false,112,fallback));
    Object.keys(f.title).forEach(m=>fixed("title",m));
    week.forEach(w=>fixed("meta",w));
    for(const role of ["day","dense"])for(let d=1;d<=31;d++)fixed(role,String(d));
    for(let d=0;d<=9;d++)fixed("year",String(d));
    fixed("meta","HEUTE");sprites.push(label("Feiertagsdaten fehlen","detail",false,240,fallback));
    for(let c=32;c<=126;c++)fixed("status",String.fromCharCode(c));
    for(const [year,configured] of Object.entries(p.years)){
      const days=new Map(configured.map(e=>[e.month*32+e.day,{...e,kind:Number(e.off)}]));
      const observe=(month,day,name)=>{const key=month*32+day;if(!days.has(key))days.set(key,{month,day,name,kind:2});};
      for(const e of configured){
        if(e.name!=="Ostermontag" && e.name!=="Pfingstmontag")continue;
        const sun=new Date(Date.UTC(+year,e.month-1,e.day-1));
        observe(sun.getUTCMonth()+1,sun.getUTCDate(),e.name==="Ostermontag"?"Ostersonntag":"Pfingstsonntag");
      }
      observe(12,24,"Heiligabend");observe(12,31,"Silvester");
      for(const e of [...days.values()].sort((a,b)=>a.month-b.month||a.day-b.day)){
        const name=e.name||(e.kind===1?"Frei":"Arbeitstag");
        if(!ids.has(name)){
          ids.set(name,sprites.length);
          sprites.push(label(Object.hasOwn(shortNames,name)?shortNames[name]:name,"status",true,51,fallback),label(name,"detail",false,244,fallback));
        }
        events.push({...e,year:+year,id:ids.get(name)});
      }
    }
    return {sprites,events};
  }
  // Sprite indices and integer baselines match the SDK's region_calendar.c.
  function render(canvas,date,bytes,{model=5,deviceName="",millivolts=0}={}){
    const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u=i=>d.getUint16(i,true);
    const years=u(12),eventPos=24+2*years+6*u(14),desc=eventPos+7*u(16),start=bytes[10],weekend=bytes[11];
    const ctx=canvas.getContext("2d"),black="#000",red="#b81928",yellow=model===2?red:"#ffd200",white="#fff";
    function rect(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x,y,w,h);}
    function draw(id,x,y,c){
      const a=desc+7*id,w=bytes[a],h=bytes[a+1],pos=u(a+2);
      x+=d.getInt8(a+5);y+=d.getInt8(a+6);
      for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(bytes[pos+j*Math.ceil(w/8)+(i>>3)]&(128>>(i%8)))rect(x+i,y+j,1,1,c);
      return bytes[a+4];
    }
    function status(s,x,y,c){for(const ch of s){const n=ch.charCodeAt(0);x+=draw(94+(n>=32&&n<=126?n:63)-32,x,y,c);}}
    const year=date.getFullYear(),month=date.getMonth()+1,today=date.getDate(),wd=date.getDay(),days=new Date(year,month,0).getDate();
    const first=(new Date(year,month-1,1).getDay()+7-start)%7,rows=Math.max(5,Math.ceil((first+days)/7)),dense=rows===6,marks=[];
    for(let i=0;i<u(16);i++){const a=eventPos+i*7;if(u(a)===year&&bytes[a+2]===month)marks[bytes[a+3]]={kind:bytes[a+4],id:u(a+5)};}
    rect(0,0,400,300,white);let x=19+draw(month,10,38,black);
    for(const c of String(year))x+=draw(82+Number(c),x,38,black);
    draw(0,373-bytes[desc+4],30,black);rect(378,20,13,3,black);rect(378,23,13,3,red);rect(378,26,13,3,model===2?white:yellow);
    rect(9,47,382,2,black);
    for(let col=0;col<7;col++){const w=(start+col)%7;draw(13+w,13+55*col,65,(weekend>>w)&1?red:black);}
    rect(9,70,382,1,black);
    for(let n=1;n<=days;n++){
      const cell=first+n-1,x=9+55*(cell%7),y=72+Math.floor(Math.floor(cell/7)*175/rows);
      const ev=marks[n],ink=ev?.kind===1?red:black,id=(dense?51:20)+n-1;
      if(n===today)rect(x+1,y,Math.max(21,bytes[desc+id*7+4]+8),dense?16:20,ink);
      draw(id,x+5,y+(dense?14:18),n===today?white:ink);
      if(ev){
        const base=y+(dense?27:32),a=desc+ev.id*7,pad=dense?0:1;
        if(ev.kind===2)rect(x+3+d.getInt8(a+5),base+d.getInt8(a+6)-pad,bytes[a]+2,bytes[a+1]+2*pad,yellow);
        draw(ev.id,x+4,base,ink);
      }
    }
    rect(9,249,382,1,black);draw(92,10,267,black);
    status(week[wd]+" "+String(today).padStart(2,"0")+"."+String(month).padStart(2,"0")+".",62,267,black);
    if(marks[today])draw(marks[today].id+1,144,268,marks[today].kind===1?red:black);
    else if(!Array.from({length:years},(_,i)=>u(24+2*i)).includes(year))draw(93,144,268,black);
    rect(9,277,382,1,black);status(deviceName||"--",11,293,black);
    const volts=millivolts?(Math.round(millivolts/10)/100).toFixed(2)+" V":"-- V",vx=390-volts.length*8-17;
    rect(vx,285,11,1,black);rect(vx,291,11,1,black);rect(vx,286,1,5,black);rect(vx+10,286,1,5,black);rect(vx+11,287,2,3,black);
    status(volts,390-volts.length*8,293,millivolts&&millivolts<2800?red:black);
  }
  return {uses,recordParts,render};
})();
