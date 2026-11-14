"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),zlib=require("node:zlib");
const root=process.env.OM6626_WEB_ROOT||path.resolve(__dirname,"..");
const ctx={TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Float32Array,DataView,Blob,DecompressionStream,console};
const {P,F,A}=vm.runInNewContext(["i18n.js","holidays.js","charset.js","protocol.js","features.js","archive.js"].map(f=>fs.readFileSync(path.join(root,f),"utf8")).join("\n")+";OMI18n.setLanguage('zh');({P:OMProtocol,F:OMFeatures,A:OMArchive})",ctx);
const plain=value=>JSON.parse(JSON.stringify(value));
async function calendarFont(fetcher) {
 const font=vm.runInNewContext(fs.readFileSync(path.join(root,'calendar-font.js'),'utf8')+';OMCalendarFont',{
  document:{currentScript:{src:'https://elink.test/calendar-font.js'}},URL,Response,DecompressionStream,
  fetch:fetcher|| (async url=>new Response(fs.readFileSync(path.join(root,new URL(url).pathname.slice(1)))))
 });
 await Promise.all([font.load(10),font.load(12)]);return font;
}
function pixelCanvas() {
 const pixels=new Uint8ClampedArray(480000).fill(255),colors={white:[255,255,255],black:[0,0,0],'#000':[0,0,0],'#fff':[255,255,255],'#b81928':[184,25,40],'#ffd200':[255,210,0]};
 const drawing={fillStyle:'black',fillRect(x,y,w,h){assert.ok([x,y,w,h].every(Number.isInteger));assert.ok(x>=0&&y>=0&&x+w<=400&&y+h<=300,JSON.stringify({x,y,w,h}));const c=colors[this.fillStyle];assert.ok(c,this.fillStyle);for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)pixels.set([...c,255],(row*400+col)*4);},fillText(){throw Error('Browser text must not draw the stock screen');}};
 return {pixels,drawing,getContext:()=>drawing};
}

test('A-share refresh windows use Beijing time, verified closures and never open make-up weekends',()=>{
 const session=time=>F.stockSession(new Date('2026-11-13T'+time+'+08:00'));
 for(const [time,open] of [['09:14:59',false],['09:15:00',true],['09:24:59',true],['09:25:00',false],['09:30:00',true],['11:29:59',true],['11:30:00',false],['12:59:59',false],['13:00:00',true],['14:57:00',true],['14:59:59',true],['15:00:00',false]])assert.equal(session(time).open,open,time);
 assert.equal(session('11:30:00').phase,'午间休市');assert.equal(session('14:57:00').phase,'收盘竞价');
 for(const date of ['2026-02-14','2026-02-23','2026-10-01','2026-10-10','2026-11-14'])assert.equal(F.stockSession(new Date(date+'T10:00:00+08:00')).open,false,date);
 assert.equal(F.stockSession(new Date('2027-01-04T10:00:00+08:00')).known,false);
 assert.equal(F.stockSession(new Date('2026-11-13T01:30:00-05:00')).open,true);
});

test('stock change and previous close are real optional quote fields and retain old backups',()=>{
 const fields=Array(33).fill('');Object.assign(fields,{1:'上证指数',2:'000001',3:'3200',4:'3250',30:'20261113113000',31:'-50',32:'-1.54'});
 const q=F.stockTencent('v_sh000001="'+fields.join('~')+'";',['sh000001']).quotes[0];assert.equal(q.change,-50);assert.equal(q.prevClose,3250);
 const state={symbols:['sh000001'],quotes:[q],updated:'2026-11-13T03:30:00Z',stale:false};assert.equal(F.stockState(state).quotes[0].change,-50);
 const legacy=plain(state);delete legacy.quotes[0].change;delete legacy.quotes[0].prevClose;assert.equal(F.stockState(legacy).quotes.length,1);
 assert.throws(()=>F.stockState({...state,quotes:[{...q,prevClose:-1}]}));
});

test('stock rendering uses calendar glyphs, controlled rise colors and unknown reference values',async()=>{
 const drawn=[],drawing={fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},measureText:text=>({width:String(text).length*7}),fillText(text,x,y){drawn.push({text,x,y,color:this.fillStyle});}};
 const font=await calendarFont(),tracked={...font,draw(ctx,text,x,y,...rest){drawn.push({text,x,y,color:ctx.fillStyle,scale:rest[0]??1,size:rest[2]??12});font.draw(ctx,text,x,y,...rest);}};
 const renderer=vm.runInNewContext(fs.readFileSync(path.join(root,'render.js'),'utf8')+';OMRender',{OMFeatures:F,OMCalendarFont:tracked,Date});
 await renderer.stockCalendar({getContext:()=>drawing},{quotes:[{symbol:'sh600000',name:'示例',price:10,change:0.001,changePercent:0,time:'2026-11-13 10:00:00'},{symbol:'sz000001',name:'未知昨收',price:20,prevClose:0,changePercent:null,time:'2026-11-13 10:00:00'}]},{date:new Date('2026-11-13T10:00:00+08:00'),deviceName:'ELINK42-TEST',millivolts:2940});
 assert.equal(drawn.find(row=>row.text==='10.00').color,'#000');assert.equal(drawn.find(row=>row.text==='20.00').x,220);assert.equal(drawn.find(row=>row.text==='+0.00').color,'#b81928');
 assert.ok(drawn.some(row=>row.text==='—'&&row.x===309&&row.color==='#000'));assert.ok(drawn.some(row=>row.text==='ELINK42-TEST'));assert.ok(drawn.some(row=>row.text==='2.94 V'));
 assert.ok(drawn.some(row=>row.text==='涨跌额'));assert.ok(!drawn.some(row=>row.text==='1'||row.text==='2'));
 assert.ok(!drawn.some(row=>row.text.includes('指数·点')||row.text.includes('11-13 10:00:00')));
 for(const text of ['2026.11.13','周五 10:00 更新','ELINK42-TEST','2.94 V']){const row=drawn.find(row=>row.text===text);assert.ok(row,text);assert.equal(row.size,12);assert.equal(row.scale,1);}
 assert.equal(drawn.find(row=>row.text==='ELINK42-TEST').y,283);assert.equal(drawn.find(row=>row.text==='2.94 V').y,283);
 assert.equal(drawn.find(row=>row.text==='股票行情').size,10);assert.equal(drawn.find(row=>row.text==='股票行情').scale,2);
});

test('12px stock glyph pixels match the actual C calendar renderer',async()=>{
 const font=await calendarFont(),canvas=pixelCanvas(),engine=(await WebAssembly.instantiate(fs.readFileSync(path.join(root,'sdk-preview.wasm')),{})).instance.exports;
 const label='日历0123456789',name=new Uint8Array(engine.memory.buffer,engine.preview_name(),20);name.fill(0);new TextEncoder().encodeInto(label,name);
 const address=engine.preview_render(2026,11,13,0,2,5,2930),native=P.rgba({packed:new Uint8Array(engine.memory.buffer,address,30000).slice()});
 font.draw(canvas.drawing,label,11,283);
 for(let y=283;y<295;y++)for(let x=11;x<95;x++){const i=(y*400+x)*4;assert.equal(canvas.pixels[i],native[i],`${x},${y}`);}
 for(const c of '上证指数深证成指创业板指平安银行贵州茅台中信证券')assert.equal(font.measure(c),12,c);
 assert.equal(font.measure('𠮷'),font.measure('?'));assert.ok(font.measure(font.fit('东方财富证券股份有限公司',104,2,10),2,10)<=104);
});

test('stock reference layout fits three to five rows with exact panel colors and full footers',async()=>{
 const font=await calendarFont(),renderer=vm.runInNewContext(fs.readFileSync(path.join(root,'render.js'),'utf8')+';OMRender',{OMFeatures:F,OMCalendarFont:font,Date});
 const names=['上证指数','深证成指','创业板指','平安银行','东方财富证券股份有限公司'];
 for(const count of [0,3,4,5])for(const model of [2,5]){
  const canvas=pixelCanvas(),quotes=names.slice(0,count).map((name,i)=>({symbol:'sh60000'+i,name,price:i===1?10953.71:3629.28,change:i===3?0.28:-244.27,changePercent:i===3?2.37:-2.18,time:'2026-11-13 14:37:03'}));
  await renderer.stockCalendar(canvas,{quotes},{model,date:new Date('2026-11-13T14:40:00+08:00'),deviceName:'FONT-TEST',millivolts:2930});
  const packed=P.planes(canvas.pixels,false,model),roundtrip=P.rgba(packed);
  assert.deepEqual(roundtrip,canvas.pixels);const i=(58*400+12)*4;assert.equal(canvas.pixels[i],0);
  const sample=(y,x)=>[...canvas.pixels.slice((y*400+x)*4,(y*400+x)*4+3)];
  assert.deepEqual(sample(51,12),model===5?[255,210,0]:[0,0,0]);
  if(count>=4)assert.deepEqual(sample(84+3*Math.min(63,Math.floor(181/count))+5,312),model===5?[255,210,0]:[255,255,255]);
 }
});

test('monochrome packing cannot turn antialiased gray into red on either panel',()=>{
 const pixels=new Uint8ClampedArray(480000).fill(255);
 for(let i=0;i<120000;i++){const value=i%256;pixels.set([value,value,value,255],i*4);}pixels.set([0,0,0,0]);
 const bw=F.monochrome(pixels);assert.equal(bw[0],255);
 for(const model of [2,5]){const frame=P.planes(bw,false,model),roundtrip=P.rgba(frame);for(let i=0;i<roundtrip.length;i+=4){assert.ok(roundtrip[i]===0||roundtrip[i]===255);assert.equal(roundtrip[i],roundtrip[i+1]);assert.equal(roundtrip[i],roundtrip[i+2]);}}
 assert.throws(()=>F.monochrome(new Uint8ClampedArray(4)));
});

test('A-share quote parsing preserves nulls and source times and rejects malformed or incomplete results',()=>{
  assert.deepEqual(plain(F.stockSymbols('SH000001, sz000001 bj920001')),['sh000001','sz000001','bj920001']);
  for(const value of ['', '000001','usAAPL','sh000001,sh000001','sh000001&key=secret'])assert.throws(()=>F.stockSymbols(value));
  const fields=Array(33).fill('');Object.assign(fields,{1:'上证指数',2:'000001',3:'',30:'20261113113000',32:''});
  const text='v_sh000001="'+fields.join('~')+'";',state=F.stockTencent(text,['sh000001']);
  assert.equal(state.quotes[0].price,null);assert.equal(state.quotes[0].time,'2026-11-13 11:30:00');
  const data=F.defaults();data.stocks=state;const before=JSON.stringify(data);assert.equal(F.validate(data).stocks.quotes[0].name,'上证指数');
  for(const bad of ['',text+'\n'+text,text.replace('v_sh','v_sz'),text.replace('20261113113000','20260230113000'),text.replace('~000001~~','~000001~oops~'),'x'.repeat(32001)])assert.throws(()=>F.stockTencent(bad,['sh000001']));
  assert.equal(JSON.stringify(data),before);assert.throws(()=>F.validate({...data,settings:{...data.settings,stockInterval:1}}));
});

test('built-in wallpapers exclude the reported error screenshot and retain stable image IDs',()=>{
  const rows=vm.runInNewContext(fs.readFileSync(path.join(root,'wallpapers.js'),'utf8')+';OMWallpapers');
  assert.equal(rows.length,106);assert.equal(rows.filter(r=>r.kind==='calendar').length,62);
  assert.equal(new Set(rows.map(r=>r.id)).size,106);
  assert.ok(!rows.some(r=>r.id==='full-39'||r.original_sha256==='f2536f21c356d69d148735869b8814922e3a172bf10d5c56f8d0a1b5ff43ab1b'));
  assert.ok(!rows.some(r=>['full-40','full-41'].includes(r.id)||['AAA','BBB'].includes(r.code)));
  assert.ok(rows.every(r=>typeof r.title==='string'&&r.title.length>1&&typeof r.title_en==='string'&&r.title_en.length>1));
  const monthly=rows.filter(r=>r.month);
  assert.deepEqual(Array.from(monthly,r=>r.month).sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i+1));
  assert.ok(monthly.every(r=>r.image.endsWith('-yellow.png')&&r.width===512&&r.height===600));
  assert.equal(rows.filter(r=>r.kind==='full'&&r.image.endsWith('-yellow.png')).length,6);
  const terms=rows.filter(r=>r.category==='term');assert.equal(terms.length,24);
  assert.deepEqual(Array.from(terms,r=>r.term).sort((a,b)=>a-b),Array.from({length:24},(_,i)=>i));
  assert.ok(terms.every(r=>!r.month&&!r.title.includes('/')));
  const holidays=rows.filter(r=>r.category==='holiday');
  const data=vm.runInNewContext(fs.readFileSync(path.join(root,'holidays.js'),'utf8')+';OMHolidays');
  assert.deepEqual(Array.from(holidays,r=>r.holiday).sort(),Object.keys(data.names).filter(k=>!['work','observed'].includes(k)).sort());
  assert.equal(new Set(rows.filter(r=>['term','holiday'].includes(r.category)).map(r=>r.original_sha256)).size,44);
  assert.ok(rows.filter(r=>r.kind==='calendar').every(r=>r.width===512&&r.height===600));
  for(const row of rows)for(const key of ['image','thumbnail'])assert.ok(fs.existsSync(path.join(root,row[key])));
});

test("local workspace is transactional, validated and preserves prior value on quota failure",()=>{
  let saved=null,fail=false;
  const storage={getItem:()=>saved,setItem(k,v){if(fail)throw Error("quota");saved=v;}};
  const store=new F.Store(storage);store.change(d=>d.todos.push({id:"1",title:"test",description:"hello",due:"",done:false}));
  const before=saved;fail=true;assert.throws(()=>store.change(d=>d.todos[0].done=true),/quota/);
  assert.equal(saved,before);assert.equal(store.data.todos[0].done,false);
  assert.throws(()=>F.validate({...F.defaults(),courses:["one"]}),/结构/);
  assert.throws(()=>F.template({...F.defaultTemplates()[0],elements:[{type:"script"}]}),/类型/);
  assert.throws(()=>F.template({...F.defaultTemplates()[0],elements:[{type:"image",x:0,y:0,width:10,height:10,color:"black",src:"https://example.com/evil.svg"}]}),/内嵌/);
});

test("all four processing algorithms output exact native colors; transparent input remains white",()=>{
  const pixels=new Uint8ClampedArray(480000).fill(255);
  for(let i=0;i<120000;i++){pixels[i*4]=i%256;pixels[i*4+1]=(i*7)%256;pixels[i*4+2]=(i*31)%256;}
  for(const model of [2,5])for(const dither of ["none","floyd","atkinson","bayer"]){
    const output=F.process(pixels,model,{...F.defaults().settings,dither});
    const frame=P.planes(output,false,model);assert.equal(P.imageBytes(frame,model).length,30000);
    assert.deepEqual(P.rgba(frame),output);
  }
  pixels.fill(0);const out=F.process(pixels,5,F.defaults().settings);assert.ok(out.every(c=>c===255));
  assert.throws(()=>F.process(pixels,5,{...F.defaults().settings,gamma:0}),/Gamma/);
});

test("job scheduler uses target identity, refuses missed replay and advances calendar days without drift",()=>{
  const at=new Date("2026-10-19T08:30:00+08:00"), base={id:"a",enabled:true,device:"A",at:at.toISOString(),repeat:"daily"};
  assert.equal(F.dueJobs([base],new Date(+at+1000),"B").length,0);
  assert.equal(F.dueJobs([base],new Date(+at-1),"A").length,0);
  assert.equal(F.dueJobs([base],new Date(+at+301000),"A")[0].missed,true);
  assert.equal(new Date(F.nextJob(base,new Date(+at+3*86400000)).at).getTime(),+at+4*86400000);
  assert.equal(F.nextJob({...base,repeat:"once"}).enabled,false);
  assert.equal(F.placeholders("{{title}} {{weather}} {{missing}}",{title:"x"}),"x  ");
});

test("weather response parser validates real Seniverse envelope and hides absent optional fields",()=>{
  const now={results:[{location:{name:"北京"},last_update:"2026-10-19T08:00:00+08:00",now:{text:"晴",temperature:"21",code:"0"}}]};
  const daily={results:[{daily:[{date:"2026-10-19",text_day:"晴",text_night:"晴",low:"10",high:"22",code_day:"0"}]}]};
  const data=F.seniverse(now,daily);assert.equal(data.current.temperature,21);assert.equal(data.days[0].low,10);
  assert.equal(F.placeholders("{{city}} {{humidity}}",{weather:data}),"北京 ");
  assert.throws(()=>F.seniverse({status:"error"},daily),/响应/);
});

test("template ZIP roundtrip, unicode, CRC, bounds and APK-format rejection",async()=>{
  const spec=F.defaultTemplates()[0],blob=A.pack(spec),bytes=new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(plain(await A.unpack(bytes.buffer)),plain(spec));
  assert.equal(Buffer.from(bytes.subarray(0,4)).toString("hex"),"504b0304");
  const corrupt=bytes.slice();corrupt[100]^=1;await assert.rejects(A.unpack(corrupt.buffer),/CRC|长度/);
  await assert.rejects(A.unpack(bytes.slice(0,20).buffer),/大小|ZIP/);
  assert.equal(A.crc32(new TextEncoder().encode("123456789")),0xCBF43926);
  function deflated(format="om6626-web-template") {
    const input=new DataView(bytes.buffer),end=bytes.length-22;let pos=input.getUint32(end+16,true),offset=0;
    const locals=[],central=[];
    for(let i=0;i<2;i++){
      const length=input.getUint16(pos+28,true),start=input.getUint32(pos+42,true),name=bytes.slice(pos+46,pos+46+length);
      const localLength=30+input.getUint16(start+26,true)+input.getUint16(start+28,true),head=bytes.slice(start,start+localLength);
      const dir=bytes.slice(pos,pos+46+length),h=new DataView(head.buffer),d=new DataView(dir.buffer);
      let raw=bytes.slice(start+localLength,start+localLength+input.getUint32(pos+24,true));
      if(new TextDecoder().decode(name)==="manifest.json")raw=new TextEncoder().encode(JSON.stringify({format,version:1}));
      const compressed=zlib.deflateRawSync(raw),crc=A.crc32(raw);h.setUint16(8,8,true);h.setUint32(14,crc,true);h.setUint32(18,compressed.length,true);h.setUint32(22,raw.length,true);
      d.setUint16(10,8,true);d.setUint32(16,crc,true);d.setUint32(20,compressed.length,true);d.setUint32(24,raw.length,true);d.setUint32(42,offset,true);
      locals.push(head,compressed);central.push(dir);offset+=head.length+compressed.length;pos+=dir.length;
    }
    const footer=bytes.slice(end),view=new DataView(footer.buffer);view.setUint32(16,offset,true);
    return Uint8Array.from(Buffer.concat([...locals,...central,footer])).buffer;
  }
  assert.deepEqual(plain(await A.unpack(deflated())),plain(spec));
  await assert.rejects(A.unpack(deflated("gclab-unknown-template")),/schema|格式/);
});

function statePacket(external=false){
  const bytes=new Uint8Array(36),v=new DataView(bytes.buffer);bytes[0]=external?0x73:0x53;bytes.set(new TextEncoder().encode("EIMG"),2);
  v.setUint16(6,400,true);v.setUint16(8,300,true);bytes[10]=3;bytes[11]=0x30;
  v.setUint32(12,30000,true);v.setUint32(16,32768,true);bytes[20]=22;bytes[21]=255;bytes[23]=60;bytes.fill(255,25,32);return bytes;
}
test("storage parsing pins native header offsets and rejects unsafe capacity",()=>{
  const packet=statePacket(),state=P.storage(packet);assert.equal(state.count,22);assert.equal(state.imageBytes,30000);
  assert.equal(state.slotBytes*state.count,0xB0000);assert.deepEqual([...state.days],[255,255,255,255,255,255,255]);
  const bad=packet.slice();bad[20]=45;assert.throws(()=>P.storage(bad),/容量/);
  const ext=statePacket(true);new DataView(ext.buffer).setUint32(16,65536,true);assert.throws(()=>P.storage(ext,true),/容量/);
  const meta=new Uint8Array(18);meta.set([0x49,3,1,3,0x90,1,0x2c,1,0x30,0x75,0,0,0x34,0x12]);
  assert.deepEqual(plain(P.metadata(meta,3)),{slot:3,valid:true,color:3,width:400,height:300,size:30000,crc:0x1234});
  assert.equal(P.crc16(new TextEncoder().encode("123456789")),0x29B1);
  assert.deepEqual([...P.rotation(2,60,[6,0,1,2,3,4,5],22)],[0x44,2,60,6,0,1,2,3,4,5]);
  assert.throws(()=>P.rotation(2,0,[6,0,1,2,3,4,5],22),/间隔/);
  assert.throws(()=>P.rotation(2,1,[22,0,1,2,3,4,5],22),/槽位/);
});
test("holiday encoding uses little-endian native year and bit 12 off-days",()=>{
  assert.equal(Buffer.from(P.holidays(2026,[{month:10,day:1,off:true},{month:10,day:10,off:false}])).toString("hex"),"47ea07011a0a0a");
  assert.throws(()=>P.holidays(2026,[{month:2,day:30,off:true}]),/无效/);
  assert.throws(()=>P.holidays(2026,[{month:2,day:1,off:true},{month:2,day:1,off:false}]),/重复/);
});
test("APK-compatible GB2312 remarks preserve Chinese 2-byte encoding, exact 64-byte bound and reject emoji",()=>{
  assert.equal(Buffer.from(P.remarkBytes("你好ABC")).toString("hex"),"c4e3bac3414243");
  assert.equal(P.remarkText(Uint8Array.from([0xc4,0xe3,0xba,0xc3,255,255])),"你好");
  assert.equal(P.remarkBytes("中".repeat(32)).length,64);
  assert.throws(()=>P.remarkBytes("中".repeat(33)),/64/);
  assert.throws(()=>P.remarkBytes("😀"),/GB2312/);
  assert.equal(Buffer.from(P.remarkBytes("―")).toString("hex"),"a1aa");
  assert.throws(()=>P.remarkText(Uint8Array.of(0xc4)),/GB2312/);
});
