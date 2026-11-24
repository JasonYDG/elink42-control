"use strict";
const OMGermanMonth = (() => {
  const week=["SO","MO","DI","MI","DO","FR","SA"];
  const shortNames={Neujahr:"Neuj.",Karfreitag:"Karfr.",Ostermontag:"Ost-Mo.","Tag der Arbeit":"1. Mai","Christi Himmelfahrt":"Himm.",Pfingstmontag:"Pf.-Mo.","Tag der Deutschen Einheit":"Einheit","Erster Weihnachtstag":"1. Weih.","Zweiter Weihnachtstag":"2. Weih.",Heiligabend:"Hl. Ab.",Silvester:"Silv.",Ostersonntag:"Ostern",Pfingstsonntag:"Pfing."};
  const agendaNames=Object.assign(Object.create(null),{"Tag der Deutschen Einheit":"Deutsche Einheit","Erster Weihnachtstag":"1. Weihnachtstag","Zweiter Weihnachtstag":"2. Weihnachtstag"});
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
          sprites.push(label(Object.hasOwn(shortNames,name)?shortNames[name]:name,"status",true,51,fallback),label(agendaNames[name] || name,"status",false,160,fallback));
        }
        events.push({...e,year:+year,id:ids.get(name)});
      }
    }
    return {sprites,events};
  }
  // Sprite indices and integer baselines match the SDK's region_calendar.c.
  function render(canvas,date,bytes,{model=5,deviceName="",millivolts=0}={}){
    const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u=i=>d.getUint16(i,true);
    const years=u(12),eventPos=24+2*years+6*u(14),desc=eventPos+7*u(16),start=bytes[10];
    const ctx=canvas.getContext("2d"),black="#000",red="#b81928",yellow=model===2?red:"#ffd200",white="#fff";
    function rect(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x,y,w,h);}
    function draw(id,x,y,c){
      const a=desc+7*id,w=bytes[a],h=bytes[a+1],pos=u(a+2);
      x+=d.getInt8(a+5);y+=d.getInt8(a+6);
      for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(bytes[pos+j*Math.ceil(w/8)+(i>>3)]&(128>>(i%8)))rect(x+i,y+j,1,1,c);
      return bytes[a+4];
    }
    function status(s,x,y,c){for(const ch of s){const n=ch.charCodeAt(0);x+=draw(94+(n>=32&&n<=126?n:63)-32,x,y,c);}}
    const year=date.getFullYear(),month=date.getMonth()+1,today=date.getDate();
    const days=new Date(year,month,0).getDate(),first=(new Date(year,month-1,1).getDay()+7-start)%7;
    const rows=Math.ceil((first+days)/7),step=rows===6?27:33,cellH=step-3,marks=[];
    for(let i=0;i<u(16);i++){
      const a=eventPos+i*7;
      if(u(a)===year&&bytes[a+2]===month)marks[bytes[a+3]]={kind:bytes[a+4],id:u(a+5)};
    }
    const sprite=id=>desc+7*id;
    function centered(id,x,y,w,h,c){
      const a=sprite(id);
      draw(id,x+Math.floor((w-bytes[a])/2)-d.getInt8(a+5),y+Math.floor((h-bytes[a+1])/2)-d.getInt8(a+6),c);
    }
    function smallNumber(s,x,y,h,c){
      // KW and 1- or 2-digit numbers all have the same ten ink rows.
      const firstGlyph=sprite(94+s.charCodeAt(0)-32),last=sprite(94+s.charCodeAt(s.length-1)-32);
      const left=d.getInt8(firstGlyph+5),w=(s.length-1)*8+d.getInt8(last+5)+bytes[last]-left;
      status(s,x+Math.floor((24-w)/2)-left,y+Math.floor((h-10)/2)+10,c);
    }
    function outline(x,y,w,h,c){
      rect(x,y,w,1,c);rect(x,y+h-1,w,1,c);rect(x,y+1,1,h-2,c);rect(x+w-1,y+1,1,h-2,c);
    }
    const todayFill=model===2?black:yellow,todayInk=model===2?white:black;
    rect(0,0,400,300,white);
    const m=sprite(month);
    let x=19+draw(month,9-d.getInt8(m+5),10-d.getInt8(m+6),black);
    for(const c of String(year))x+=draw(82+Number(c),x,30,black);
    draw(0,373-bytes[desc+4],29,black);
    rect(378,16,13,3,black);rect(378,19,13,3,red);if(model!==2)rect(378,22,13,3,yellow);
    rect(9,38,382,2,black);smallNumber("KW",8,43,16,black);
    for(let col=0;col<7;col++)centered(13+(start+col)%7,38+51*col,43,48,16,black);
    for(let row=0;row<rows;row++){
      const th=new Date(Date.UTC(year,month-1,1-first+7*row+(4-start+7)%7));
      const kw=1+Math.floor((th.getTime()-Date.UTC(th.getUTCFullYear(),0,1))/(7*86400000));
      smallNumber(String(kw),8,62+row*step,cellH,black);
    }
    const list=[];
    for(let n=1;n<=days;n++){
      const cell=first+n-1,left=38+51*(cell%7),y=62+step*Math.floor(cell/7);
      const off=marks[n]?.kind===1,selected=n===today;
      if(off||selected)rect(left,y,48,cellH,off?red:todayFill);
      if(!off)outline(left,y,48,cellH,black);
      if(off&&selected)outline(left+2,y+2,44,cellH-4,white);
      centered(19+n,left,y,48,cellH,off?white:selected?todayInk:black);
      if(marks[n])list.push(n);
    }
    rect(9,230,382,1,black);
    const known=Array.from({length:years},(_,i)=>u(24+2*i)).includes(year);
    if(!known)draw(93,10,254,black);
    else{
      if(list.length<4&&!marks[today]){list.push(today);list.sort((a,b)=>a-b);}
      const upcoming=list.filter(n=>n<today).length;
      const begin=Math.max(0,Math.min(upcoming,list.length-4));
      list.slice(begin,begin+4).forEach((n,i)=>{
        const left=i%2?202:9,y=i<2?235:255,ev=marks[n],off=ev?.kind===1,selected=n===today;
        if(off||selected)rect(left,y,24,15,off?red:todayFill);
        else outline(left,y,24,15,black);
        smallNumber(String(n).padStart(2,"0"),left,y,15,off?white:selected?todayInk:black);
        const full=ev?ev.id+1:92,id=ev&&bytes[sprite(full)]>160?ev.id:full,a=sprite(id);
        draw(id,left+29-d.getInt8(a+5),y+Math.trunc((15-bytes[a+1])/2)-d.getInt8(a+6),black);
      });
    }
    rect(9,277,382,1,black);status(deviceName||"--",11,293,black);
    const volts=millivolts?(Math.round(millivolts/10)/100).toFixed(2)+" V":"-- V",vx=392-volts.length*8;
    outline(vx-19,284,11,8,black);rect(vx-8,286,2,4,black);
    status(volts,vx,293,millivolts&&millivolts<2800?red:black);
  }
  return {uses,recordParts,render};
})();
