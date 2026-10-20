"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),zlib=require("node:zlib");
const root=process.env.OM6626_WEB_ROOT||path.resolve(__dirname,"..");
const ctx={TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Float32Array,DataView,Blob,DecompressionStream,console};
const {P,F,A}=vm.runInNewContext(["charset.js","protocol.js","features.js","archive.js"].map(f=>fs.readFileSync(path.join(root,f),"utf8")).join("\n")+";({P:OMProtocol,F:OMFeatures,A:OMArchive})",ctx);
const plain=value=>JSON.parse(JSON.stringify(value));

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
