"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = process.env.OM6626_WEB_ROOT || path.resolve(__dirname, "..");
const source = ["i18n.js", "charset.js", "protocol.js", "ble.js"].map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const sandbox = {
  TextDecoder, TextEncoder, Uint8Array, Uint8ClampedArray, DataView, setTimeout, clearTimeout, console,
  navigator: {},
};
const {P, Client} = vm.runInNewContext(source + ";OMI18n.setLanguage('zh');({P:OMProtocol,Client:OMClient})", sandbox);
const encode = text => new TextEncoder().encode(text);
test("legacy style API uses current country configuration without clearing the saved language",async()=>{
 const client=new Client(),calls=[];client.calendarProtocol=2;client.config={alternate:2};
 client.internationalCalendar=async(...args)=>calls.push(args);
 await client.style(1,0,()=>{});await client.style(6,1,()=>{});
 assert.deepEqual(calls.map(a=>a.slice(0,5)),[[1,'zh',false,255,false],[0,'zh',false,255,false]]);
});

function simulatedPeripheral(payload = 20, failAt = -1) {
  const client = new Client(), packets = [];
  client.device = {gatt: {connected: true, disconnect() { this.connected = false; }}};
  client.ready = true;
  client.board = {id: 1, name: "BOARD_ZKWEB"};
  client.config = {model: 2};
  client.pause = async () => {};
  client.refreshStatus = true;
  function notify(bytes) {
    client.control.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    client.notify({target: client.control});
  }
  client.control = {async writeValueWithResponse(bytes) {
    packets.push(bytes.slice());
    if (packets.length === failAt) throw Error("simulated link failure");
    if ([1,0x25].includes(bytes[0])) { notify(encode("mtu=" + payload)); notify(encode("t=123")); }
    if (bytes[0] === 0) notify(Uint8Array.of(0x42, 1, ...encode(P.MARKER)));
    if ([5, 6, 0x20, 0x24, 0x25, 0x45, 0x50].includes(bytes[0]))
      notify(Uint8Array.of(0x51, bytes[0], bytes.at(-1), 0xA0));
  }};
  return {client, packets};
}

test("v19 initializes through the acknowledged queue and never sends legacy command 1",async()=>{
 const {client,packets}=simulatedPeripheral();client.firmwareRevision=19;client.lifecycleSupported=true;client.timingSupported=true;
 await client.initialize();
 assert.equal(packets.filter(p=>p[0]===0x25).length,1);
 assert.equal(packets.filter(p=>p[0]===1).length,0);
 assert.equal(client.reportedPayload,20);
});

test("ADC timeout and initialization failure preserve the connection and stop the operation",async()=>{
 for(const reason of [4,5,8]){
  const {client}=simulatedPeripheral();
  client.control.writeValueWithResponse=async bytes=>{
   const value=Uint8Array.of(0x51,bytes[0],bytes.at(-1),0xA8,reason,0);
   client.control.value=new DataView(value.buffer);client.notify({target:client.control});
  };
  await assert.rejects(client.operation(()=>client.command(Uint8Array.of(0x20,0,0,0,0,8,1))),error=>error.code==="DISPLAY_NOT_READY");
  assert.equal(client.device.gatt.connected,true);
 }
});

test("big-endian timestamp, signed timezone, calendar mode and bounds", () => {
  const packet = P.time({getTime: () => 1760000000000, getTimezoneOffset: () => -480}, 1);
  assert.equal(Buffer.from(packet).toString("hex"), "2068e778000801");
  assert.throws(() => P.time({getTime: () => NaN, getTimezoneOffset: () => 0}), /日期/);
  assert.throws(() => P.time({getTime: () => 0, getTimezoneOffset: () => -330}), /整小时/);
  for (const mode of [0, 1, 2, 3]) assert.equal(P.time(new Date(), mode)[6], mode);
  assert.throws(() => P.time(new Date(), 4), /模式/);
});

test("RGB plane polarity, alpha blending and 180 degree bit orientation", () => {
  const pixels = new Uint8ClampedArray(400 * 300 * 4).fill(255);
  pixels.set([0, 0, 0, 255], 0);
  pixels.set([184, 25, 40, 255], 4);
  pixels.set([0, 0, 0, 0], 8);
  const normal = P.planes(pixels), rotated = P.planes(pixels, true);
  assert.equal(normal.black.length, 15000);
  assert.equal(normal.black[0], 0x7F);
  assert.equal(normal.red[0], 0xBF);
  assert.equal(rotated.black[14999], 0xFE);
  assert.equal(rotated.red[14999], 0xFD);
  assert.deepEqual([...P.rgba(normal).slice(0, 12)], [0, 0, 0, 255, 184, 25, 40, 255, 255, 255, 255, 255]);
  assert.throws(() => P.planes(new Uint8ClampedArray(4)), /400/);
});

test("JD79668 packs native black/white/yellow/red codes, alpha and rotation", () => {
  const pixels = new Uint8ClampedArray(400 * 300 * 4).fill(255);
  [[0,0,0,255], [255,255,255,255], [255,210,0,255], [184,25,40,255], [0,0,0,0]]
    .forEach((color,i) => pixels.set(color,i*4));
  const frame = P.planes(pixels,false,5), reversed = P.planes(pixels,true,5);
  assert.equal(frame.packed.length,30000);
  assert.equal(frame.packed[0],0x1B);
  assert.equal(frame.packed[1],0x55);
  assert.equal(reversed.packed[29999],0xE4);
  assert.deepEqual([...P.rgba(frame).slice(0,20)], [0,0,0,255,255,255,255,255,255,210,0,255,184,25,40,255,255,255,255,255]);
  assert.throws(() => P.planes(pixels,false,3), /型号/);
  assert.throws(() => P.rgba({packed:new Uint8Array(29999)}), /长度/);
  const packed = new Uint8Array(30000).map((_,i)=>(i*29)&255);
  assert.deepEqual(P.planes(P.rgba({packed}),false,5).packed,packed);
});

test("short board identity and exact configuration parsing", () => {
  assert.equal(P.board(Uint8Array.of(0x42, 1, ...encode(P.MARKER))).name, "BOARD_ZKWEB");
  assert.throws(() => P.board(Uint8Array.of(0x44, 1)), /格式/);
  assert.throws(() => P.config(new Uint8Array(14)), /15/);
});

test("calendar initializes the existing driver before setting time", async () => {
  const {client, packets} = simulatedPeripheral();
  await client.calendar(() => {});
  assert.deepEqual(packets.map(p=>p[0]),[0x24,0x20,0x24,1,0x24,0x20,0]);
  assert.equal(packets[1][6],0);assert.equal(packets[5][6],1);
  assert.equal(packets.at(-1)[0], 0);
  assert.equal(client.busy, false);
});

function connectablePeripheral(model = 5, marker = P.MARKER, status = true) {
  const result = simulatedPeripheral();
  const {client, packets} = result, device = client.device, control = client.control;
  result.state = {initialized: false, refreshes: 0};
  client.ready = false;
  device.name = "GCLab_EPD_test";
  device.addEventListener = () => {};
  device.gatt.connected = false;
  device.gatt.connect = async () => {
    device.gatt.connected = true;
    return {getPrimaryService: async id => {
      assert.equal(id, P.SERVICE);
      return {getCharacteristic: async id => { assert.equal(id, P.CONTROL); return control; }};
    }};
  };
  control.addEventListener = control.removeEventListener = () => {};
  function notify(bytes) {
    control.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    client.notify({target: control});
  }
  control.startNotifications = async () => {
    const config = new Uint8Array(15); config[7] = model; config[11] = 1; notify(config);
  };
  control.writeValueWithResponse = async bytes => {
    packets.push(bytes.slice());
    if (bytes[0] === 0) notify(Uint8Array.of(0x42, 1, ...encode(marker)));
    if (bytes[0] === 1) {
      result.state.initialized = true;
      notify(encode("mtu=20")); notify(encode("t=123"));
    }
    // Native lifecycle tests establish that time alone cannot render without a display context.
    if (bytes[0] === 0x20 && bytes[6]!==0 && result.state.initialized) result.state.refreshes++;
    if (status && [0x24, 0x20].includes(bytes[0])) notify(Uint8Array.of(0x51, bytes[0], bytes.at(-1), 0xA0));
    if (!status && bytes[0] === 0x24) notify(Uint8Array.of(0x55, 0));
  };
  sandbox.navigator.bluetooth = {requestDevice: async () => device};
  return result;
}

test("JD79668 connects read-only, initializes the native display, then sets calendar time", async () => {
  const {client, packets, state} = connectablePeripheral();
  await client.connect();
  assert.equal(client.ready, true);
  assert.equal(client.config.model, 5);
  assert.equal(client.canPublish, true);
  assert.deepEqual(packets.map(p => p[0]), [0, 0x24, 0x24]);
  await client.calendar(() => {});
  assert.deepEqual(packets.map(p => p[0]), [0,0x24,0x24,0x24,0x20,0x24,1,0x24,0x20,0]);
  assert.equal(state.refreshes, 1);
  assert.equal(packets[8].length, 8);
  assert.equal(packets[8][6], 1);
  assert.ok(Math.abs(new DataView(packets[8].buffer).getUint32(1, false) - Date.now() / 1000) < 3);
});

test("failed JD79668 initialization stops before sending time and clears pending waiters", async () => {
  const {client, packets, state} = connectablePeripheral();
  await client.connect();
  const write = client.control.writeValueWithResponse;
  client.control.writeValueWithResponse = async bytes => {
    if (bytes[0] === 1) { packets.push(bytes.slice()); throw Error("initialization write failed"); }
    return write(bytes);
  };
  await assert.rejects(client.calendar(() => {}), /initialization write failed/);
  assert.deepEqual(packets.map(p => p[0]), [0,0x24,0x24,0x24,0x20,0x24,1]);
  assert.equal(state.refreshes, 0);
  assert.equal(client.pending.size, 0);
  assert.equal(client.ready, false);
  assert.equal(client.busy, false);
});

test("SSD1619 retains connection, initialization and time sync", async () => {
  const {client, packets} = connectablePeripheral(2);
  await client.connect();
  assert.equal(client.canPublish, true);
  await client.calendar(() => {});
  assert.deepEqual(packets.map(p => p[0]), [0,0x24,0x24,0x24,0x20,0x24,1,0x24,0x20,0]);
});

test("a readable configuration connects when subscribing does not repeat the initial notification", async () => {
  for (const model of [2, 5]) {
    const {client, packets} = connectablePeripheral(model), control = client.control;
    let reads = 0;
    control.properties = {read: true};
    control.startNotifications = async () => {};
    control.readValue = async () => {
      reads++;
      const bytes = new Uint8Array(19); bytes[9] = model; bytes[13] = 1;
      return new DataView(bytes.buffer, 2, 15);
    };
    const wait = client.wait.bind(client);
    client.wait = (match, label, ms) => wait(match, label, label === "读取配置" ? 20 : ms);
    await client.connect();
    assert.equal(reads, 1); assert.equal(client.config.model, model); assert.equal(client.ready, true);
    assert.equal(client.pending.size, 0); assert.deepEqual(packets.map(p => p[0]), [0, 0x24, 0x24]);
    client.disconnect();
  }
});

test("an initial configuration notification needs no extra GATT read", async () => {
  const {client} = connectablePeripheral();
  client.control.properties = {read: true};
  client.control.readValue = async () => { throw Error("unnecessary read"); };
  await client.connect(); assert.equal(client.ready, true); client.disconnect();
});

test("notify-only devices retain delayed configuration support and bounded failure cleanup", async () => {
  for (const send of [true, false]) {
    const {client} = connectablePeripheral(), control = client.control, notify = control.startNotifications;
    control.startNotifications = async () => { if (send) setTimeout(notify, 0); };
    const wait = client.wait.bind(client);
    client.wait = (match, label, ms) => wait(match, label, label === "读取配置" ? 20 : ms);
    if (send) { await client.connect(); assert.equal(client.ready, true); client.disconnect(); }
    else await assert.rejects(client.connect(), /读取配置超时/);
    assert.equal(client.pending.size, 0); assert.equal(client.busy, false);
    assert.equal(client.device.gatt.connected, false);
  }
});

test("configuration read errors and stalls clean up and allow the next connection", async () => {
  for (const failure of ["rejected", "malformed", "stalled"]) {
    const {client, packets} = connectablePeripheral(), control = client.control;
    control.properties = {read: true}; control.startNotifications = async () => {};
    control.readValue = async () => {
      if (failure === "rejected") throw Error("config read failed");
      if (failure === "malformed") return new DataView(new ArrayBuffer(14));
      return new Promise(() => {});
    };
    const bounded = client.bounded.bind(client);
    client.bounded = (op, label, ms, discovery) => bounded(op, label, label === "读取配置" ? 20 : ms, discovery);
    await assert.rejects(client.connect(), /config read failed|15 字节|读取配置.*超时/);
    assert.equal(client.ready, false); assert.equal(client.busy, false);
    assert.equal(client.device.gatt.connected, false); assert.equal(client.pending.size, 0);
    assert.equal(packets.length, 0);
    control.readValue = async () => {
      const bytes = new Uint8Array(15); bytes[7] = 5; bytes[11] = 1;
      return new DataView(bytes.buffer);
    };
    await client.connect(); assert.equal(client.ready, true); client.disconnect();
  }
});

test("a timed-out configuration read arriving late cannot disconnect a new connection", async () => {
  const {client} = connectablePeripheral(), control = client.control;
  let finishOld;
  const bytes = new Uint8Array(15); bytes[7] = 5; bytes[11] = 1;
  control.properties = {read: true}; control.startNotifications = async () => {};
  control.readValue = () => new Promise(resolve => { finishOld = resolve; });
  const bounded = client.bounded.bind(client);
  client.bounded = (op, label, ms, discovery) => bounded(op, label, label === "读取配置" ? 20 : ms, discovery);
  await assert.rejects(client.connect(), /读取配置.*超时/);
  control.readValue = async () => new DataView(bytes.buffer);
  await client.connect();
  finishOld(new DataView(bytes.buffer)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.ready, true); assert.equal(client.device.gatt.connected, true);
  assert.equal(client.pending.size, 0); client.disconnect();
});

test("initial handshake disconnect reconnects the same device once without repeating the chooser or a display write", async () => {
  const {client,packets}=connectablePeripheral();const device=client.device,connect=device.gatt.connect;
  let connects=0,choices=0; sandbox.navigator.bluetooth.requestDevice=async options=>{
    choices++; assert.ok(options.filters.some(f=>f.namePrefix==="ELINK42-"));return device;
  };
  device.gatt.connect=async()=>{if(++connects===1){const e=Error("initial link lost");e.name="NetworkError";throw e;}return connect();};
  await client.connect();assert.equal(client.ready,true);assert.equal(connects,2);assert.equal(choices,1);
  assert.deepEqual(packets.map(p=>p[0]),[0,0x24,0x24]);assert.equal(client.pending.size,0);
});

test("two handshake failures stop, and manual disconnect cancels a pending reconnect", async () => {
  for(const cancel of [false,true]){
    const {client}=connectablePeripheral();let connects=0;
    client.device.gatt.connect=async()=>{connects++;const e=Error("link lost");e.name="NetworkError";throw e;};
    const result=client.connect(client.device); if(cancel)setTimeout(()=>client.disconnect(),50);
    await assert.rejects(result,/link lost|取消/);assert.equal(connects,cancel?1:2);
    assert.equal(client.ready,false);assert.equal(client.busy,false);assert.equal(client.pending.size,0);
  }
});

test("service discovery timeout retries once and its late result leaves the new link connected", async t => {
  const {client,packets}=connectablePeripheral();
  const device=client.device,connect=device.gatt.connect;
  let attempts=0,finishOld;
  device.gatt.connect=async()=>{
    const server=await connect(); attempts++;
    return attempts===1 ? {getPrimaryService:()=>new Promise(resolve=>{finishOld=resolve;})} : server;
  };
  const bounded=client.bounded.bind(client);
  client.bounded=(op,label,ms,discovery)=>bounded(op,label,discovery?10:ms,discovery);
  t.after(()=>client.disconnect());
  await client.connect(device);
  finishOld({});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,2);assert.equal(device.gatt.connected,true);assert.equal(client.ready,true);
  assert.deepEqual(packets.map(b=>b[0]),[0,0x24,0x24]);
});

test("unknown screen models and original firmware remain rejected without mutating commands", async () => {
  for (const [model, marker] of [[3, P.MARKER], [5, "BOARD_ZKONG"]]) {
    const {client, packets} = connectablePeripheral(model, marker);
    await assert.rejects(client.connect(), /仅支持|配套/);
    assert.equal(client.ready, false);
    assert.equal(client.device.gatt.connected, false);
    assert.deepEqual(packets.map(p => p[0]), [0]);
  }
});

test("frames for another screen model are rejected before any BLE write", async () => {
  const {client, packets} = simulatedPeripheral();
  client.config = {model: 5};
  await assert.rejects(client.publish({black: new Uint8Array(15000), red: new Uint8Array(15000)}, () => {}), /格式或长度/);
  client.config = {model: 2};
  await assert.rejects(client.publish({packed: new Uint8Array(30000)}, () => {}), /格式或长度/);
  assert.equal(packets.length, 0);
  assert.equal(client.ready, true);
});

test("LED switch is strictly boolean and sends only native 93 plus a read-only identity check", async () => {
  assert.deepEqual([...P.led(false)], [0x93,0]);
  assert.deepEqual([...P.led(true)], [0x93,1]);
  assert.throws(() => P.led(1), /布尔/);
  const {client,packets}=simulatedPeripheral();
  await assert.rejects(client.led(false), /仅用于/);
  assert.equal(packets.length,0);
  client.config={model:5};
  await client.led(false); await client.led(true);
  assert.deepEqual(packets.map(p => [...p]), [[0x93,0],[0],[0x93,1],[0]]);
});

test("failed LED write does not claim success or send another command", async () => {
  const {client,packets}=simulatedPeripheral(20,1);
  client.config={model:5};
  await assert.rejects(client.led(false), /link failure/);
  assert.deepEqual(packets.map(p => [...p]), [[0x93,0]]);
  assert.equal(client.ready,false);
});

for (const payload of [20,180,244]) test(`JD79668 full 30 KB packed transfer and native window, ATT ${payload}`, async () => {
  const {client,packets}=simulatedPeripheral(payload);
  client.config={model:5};
  const frame={packed:new Uint8Array(30000).map((_,i)=>(i*19)&255)};
  await client.publish(frame,()=>{});
  assert.deepEqual(packets.filter(p=>p[0]===3).map(p=>p[1]), [0x83,0x10]);
  const window=packets.findIndex(p=>p[0]===3&&p[1]===0x83);
  assert.deepEqual([...packets[window+1]], [4,0,0,1,143,0,0,1,43,1]);
  const start=packets.findIndex(p=>p[0]===3&&p[1]===0x10);
  assert.deepEqual(Uint8Array.from(packets.slice(start+1).filter(p=>p[0]===4).flatMap(p=>[...p.slice(1)])),frame.packed);
  assert.ok(packets.every(p=>p.length<=Math.min(payload,180)));
  assert.deepEqual(packets.slice(-3).map(p=>p[0]),[5,6,0]);
  assert.equal(packets.find(p=>p[0]===0x20)[6],0);
});

test("failed fourcolor transfer stops before refresh and sleep", async () => {
  const {client,packets}=simulatedPeripheral(180,20);
  client.config={model:5};
  await assert.rejects(client.publish({packed:new Uint8Array(30000)},()=>{}),/link failure/);
  assert.ok(!packets.some(p=>p[0]===5||p[0]===6));
  assert.equal(client.ready,false);
});

for (const payload of [20, 180, 244]) test(`full 30 KB transfer and SSD1619 sequence, ATT payload ${payload}`, async () => {
  const {client, packets} = simulatedPeripheral(payload);
  const frame = {black: new Uint8Array(15000).map((_, i) => i & 255),
                 red: new Uint8Array(15000).map((_, i) => (255 - i) & 255)};
  await client.publish(frame, () => {});
  const planes = new Map([[0x24, []], [0x26, []]]);
  let command;
  for (const packet of packets) {
    assert.ok(packet.length <= Math.min(payload, 180));
    if (packet[0] === 3) command = packet[1];
    if (packet[0] === 4 && planes.has(command)) planes.get(command).push(...packet.slice(1));
  }
  assert.deepEqual(Uint8Array.from(planes.get(0x24)), frame.black);
  assert.deepEqual(Uint8Array.from(planes.get(0x26)), frame.red);
  assert.deepEqual(packets.filter(p => p[0] === 3).map(p => p[1]), [0x11, 0x44, 0x45, 0x4E, 0x4F, 0x24, 0x4E, 0x4F, 0x26]);
  assert.equal(packets.find(p=>p[0]===0x20)[6], 0);
  assert.equal(packets.at(-3)[0], 5);
  assert.equal(packets.at(-2)[0], 6);
  assert.equal(packets.at(-1)[0], 0);
});

test("write failure stops a partial image before refresh", async () => {
  const {client, packets} = simulatedPeripheral(180, 20);
  await assert.rejects(client.publish({black: new Uint8Array(15000), red: new Uint8Array(15000)}, () => {}), /link failure/);
  assert.ok(!packets.some(p => p[0] === 5));
  assert.equal(client.ready, false);
  assert.equal(client.busy, false);
});

test("failed request cleans pending waiter and busy rejects a second transaction", async () => {
  const {client} = simulatedPeripheral(20, 1);
  await assert.rejects(client.request(Uint8Array.of(0), () => false, "probe"), /link failure/);
  assert.equal(client.pending.size, 0);
  client.busy = true;
  await assert.rejects(client.calendar(() => {}), /上一次/);
});

test("late events from an old device or characteristic cannot close the new session", () => {
  const {client} = simulatedPeripheral();
  for (const config of [undefined, {model: 5}]) {
    client.config = config;
    client.disconnected({target: {gatt: {connected: false}}});
    assert.equal(client.ready, true);
    client.notify({target: {value: new DataView(new ArrayBuffer(15))}});
    assert.equal(client.config, config);
  }
});

function galleryPeripheral(external = false, payload = 180) {
  const result = simulatedPeripheral(payload), {client, packets} = result;
  client.config = {model: 5, mode: 1};
  const slots = new Map(), remarks = new Map(); let chunks = [], target, rotation = [0,60,255,255,255,255,255,255,255];
  const original = client.control.writeValueWithResponse;
  const emit = b => {client.control.value=new DataView(b.buffer,b.byteOffset,b.byteLength);client.notify({target:client.control});};
  client.control.writeValueWithResponse = async bytes => {
    await original(bytes);
    const op = bytes[0], slot = bytes[1];
    if (op === (external ? 0x51 : 0x46)) {
      const b = new Uint8Array(36), v=new DataView(b.buffer);b[0]=external?0x73:0x53;b.set(encode("EIMG"),2);
      v.setUint16(6,400,true);v.setUint16(8,300,true);b[10]=3;b[11]=0x30;v.setUint32(12,30000,true);v.setUint32(16,32768,true);b[20]=22;
      b.set(rotation.slice(0,2),22);b.set(rotation.slice(2),25);emit(b);
    }
    if (op === (external?0x52:0x4B)) {
      const b=new Uint8Array(18),v=new DataView(b.buffer);b.set([external?0x74:0x49,slot]);
      if(slots.has(slot)){b.set([1,3,0x90,1,0x2c,1],2);v.setUint32(8,30000,true);v.setUint16(12,slots.get(slot),true);}emit(b);
    }
    if (op === (external?0x4C:0x40)){target=slot;chunks=[];}
    if (op === (external?0x4D:0x41))chunks.push(...bytes.slice(1));
    if (op === (external?0x4E:0x42))slots.set(target,P.crc16(Uint8Array.from(chunks)) ^ (result.badCrc ? 1 : 0));
    if (op === (external?0x4F:0x43))slots.delete(slot);
    if (op === (external?0x53:0x49))remarks.set(slot,bytes.slice(2));
    if (op === (external?0x54:0x4A)){const b=new Uint8Array(66).fill(255);b.set([external?0x75:0x52,slot]);b.set(remarks.get(slot)||[],2);emit(b);}
    if (op === (external?0x55:0x44))rotation=[...bytes.slice(1)];
  };
  return {...result, slots, remarks, raw:result, chunks:()=>Uint8Array.from(chunks)};
}
test("JD clock full refresh requires explicit opt-in before any write; SSD1619 preserves partial mode",async()=>{
  const {client,packets}=simulatedPeripheral();client.config={model:5};
  await assert.rejects(client.mode(2,()=>{}),/没有局刷/);assert.equal(packets.length,0);
  await client.mode(2,()=>{},new Date(),true);assert.equal(packets.find(p=>p[0]===0x20&&p[6]===2)[6],2);
});
for(const external of [false,true])test(`gallery ${external?"external":"internal"}: empty-slot save, CRC, read, GB2312 remark, rotation and delete`,async()=>{
  const {client,packets,slots,remarks,chunks}=galleryPeripheral(external),frame={packed:new Uint8Array(30000).map((_,i)=>i&255)};
  await client.store(frame,3,external,()=>{});assert.deepEqual(chunks(),frame.packed);assert.equal(slots.get(3),P.crc16(frame.packed));
  const state=await client.gallery(external);assert.equal(state.count,22);assert.equal(state.slots[3].valid,true);
  await client.slotAction("remark",3,external,()=>{},"你好");assert.equal(Buffer.from(remarks.get(3)).toString("hex"),"c4e3bac3");
  await client.rotate(2,60,[3,3,3,3,3,3,3],external,()=>{});assert.ok(packets.some(p=>p[0]===0x20&&p[6]===3));
  await client.slotAction("delete",3,external,()=>{});assert.equal(slots.has(3),false);
});
test("storage rejects occupied or out-of-range slot before erase command, and CRC mismatch never displays",async()=>{
  for(const occupied of [true,false]){
    const {client,packets,slots}=galleryPeripheral();if(occupied)slots.set(3,123);
    await assert.rejects(client.store({packed:new Uint8Array(30000)},occupied?3:22,false,()=>{}),/已有图片|槽位/);
    assert.ok(!packets.some(p=>p[0]===0x40||p[0]===0x41));
  }
  const r=galleryPeripheral();r.raw.badCrc=true;
  await assert.rejects(r.client.store({packed:new Uint8Array(30000)},0,false,()=>{}),/CRC/);
  assert.ok(!r.packets.some(p=>p[0]===0x45||p[0]===0x05));assert.equal(r.client.ready,true);assert.equal(r.client.device.gatt.connected,true);
});
test("small-MTU gallery fails safely, weekly mapping rejects empty slots and link failure omits commit",async()=>{
  const small=galleryPeripheral(false,20);
  await assert.rejects(small.client.gallery(),/44/);assert.deepEqual(small.packets.map(p=>p[0]),[0x24,1,0x24]);
  const empty=galleryPeripheral();await assert.rejects(empty.client.rotate(2,60,[0,1,2,3,4,5,6],false,()=>{}),/空槽/);
  assert.ok(!empty.packets.some(p=>p[0]===0x44));
  const failed=galleryPeripheral(),write=failed.client.control.writeValueWithResponse;
  failed.client.control.writeValueWithResponse=async bytes=>{if(bytes[0]===0x41)throw Error("lost link");return write(bytes);};
  await assert.rejects(failed.client.store({packed:new Uint8Array(30000)},0,false,()=>{}),/lost link/);
  assert.ok(!failed.packets.some(p=>p[0]===0x42||p[0]===0x45));
});
test("transport settings are bounded by negotiated capacity and cannot change mid-transaction",async()=>{
  const {client,packets}=simulatedPeripheral(180);client.config={model:5};
  client.setTransfer(60,0);await client.publish({packed:new Uint8Array(30000)},()=>{});
  assert.ok(packets.every(p=>p.length<=60));
  client.busy=true;assert.throws(()=>client.setTransfer(180,0),/传输中/);assert.equal(client.transferPayload,60);
  client.busy=false;assert.throws(()=>client.setTransfer(181,0),/范围/);assert.throws(()=>client.setTransfer(60,-1),/范围/);
});

function statusPeripheral() {
  let expire;
  const timers = {...sandbox, setTimeout(callback, ms) { if (ms === 65000) { expire = callback; return 'refresh'; } return setTimeout(callback, ms); },
    clearTimeout(timer) { if (timer !== 'refresh') clearTimeout(timer); }};
  const StatusClient = vm.runInNewContext(source + ";OMI18n.setLanguage('zh');OMClient", timers), client = new StatusClient(), packets = [];
  client.device = {gatt:{connected:true,disconnect(){this.connected=false;}}}; client.ready = client.refreshStatus = true;
  client.control = {removeEventListener(){}, async writeValueWithResponse(bytes){packets.push(bytes.slice());}};
  function emit(command, sequence, busy=0) {const b=Uint8Array.of(0x51,command,sequence,busy);client.control.value=new DataView(b.buffer);client.notify({target:client.control});}
  return {client,packets,emit,expire:()=>expire()};
}
test('refresh waits for this command and sequence, ends immediately on idle ACK, never polls or counts down', async()=>{
  const r=statusPeripheral(),progress=[];let finished=false;
  const task=r.client.operation(()=>r.client.command(Uint8Array.of(5),(v,s)=>progress.push([v,s]))).then(()=>finished=true);
  assert.equal(r.packets.length,1);const seq=r.packets[0][1];
  r.emit(0x20,seq);r.emit(5,seq+1);await new Promise(setImmediate);assert.equal(finished,false);
  assert.equal(r.client.busy,true);assert.equal(r.client.pending.size,1);assert.equal(progress[0][0],99);
  r.emit(5,seq);await task;assert.equal(finished,true);assert.equal(r.client.pending.size,0);
  assert.equal(progress.at(-1)[0],100);assert.equal(r.packets.length,1);assert.ok(progress.every(([,s])=>!s.includes('秒')));
});
test('BUSY still asserted after driver returns stops the operation without sleep or retry',async()=>{
  const r=statusPeripheral(),task=r.client.operation(()=>r.client.command(Uint8Array.of(5)));
  r.emit(5,r.packets[0][1],1);await assert.rejects(task,/屏幕仍忙/);
  assert.equal(r.client.device.gatt.connected,true);assert.equal(r.client.busy,false);assert.equal(r.client.pending.size,0);
  assert.deepEqual(r.packets.map(p=>p[0]),[5]);
});
test('missing completion ACK times out as unconfirmed, disconnects, cleans waiter and never retries',async()=>{
  const r=statusPeripheral(),task=r.client.operation(()=>r.client.command(Uint8Array.of(5)));
  r.expire();await assert.rejects(task,/结果未确认.*超时/);assert.equal(r.client.device.gatt.connected,false);
  assert.equal(r.client.pending.size,0);assert.equal(r.client.busy,false);assert.equal(r.packets.length,1);
});
test('disconnect while awaiting completion rejects immediately and does not send sleep',async()=>{
  const r=statusPeripheral(),task=r.client.operation(()=>r.client.command(Uint8Array.of(5)));
  r.client.disconnected({target:r.client.device});await assert.rejects(task,/蓝牙已断开/);
  assert.equal(r.client.pending.size,0);assert.deepEqual(r.packets.map(p=>p[0]),[5]);
});
test('legacy firmware connects for existing non-refresh controls but screen actions stop before mutations',async()=>{
  const {client,packets}=connectablePeripheral(5,P.MARKER,false),wait=client.wait.bind(client);
  client.wait=(match,label,ms)=>wait(match,label,ms===1500?5:ms);
  await client.connect();assert.equal(client.ready,true);assert.equal(client.refreshStatus,false);
  await assert.rejects(client.calendar(()=>{}),/先升级.*没有发送/);
  assert.deepEqual(packets.map(p=>p[0]),[0,0x24]);assert.equal(client.pending.size,0);
});

test('sleeping panel BUSY level does not reject mode-zero or sleep command acknowledgements',async()=>{
  for(const bytes of [Uint8Array.of(6),P.time(new Date(),0)]){
    const r=statusPeripheral(),labels=[],task=r.client.command(bytes,(v,s)=>labels.push(s));
    r.emit(bytes[0],r.packets[0].at(-1),1);await task;
    assert.ok(!labels.at(-1).includes('BUSY 已释放'));assert.equal(r.client.pending.size,0);
  }
});

test('publish receiving a still-busy refresh ACK never sends sleep',async()=>{
  const {client,packets}=simulatedPeripheral(180),write=client.control.writeValueWithResponse;
  client.config={model:5};
  client.control.writeValueWithResponse=async bytes=>{
    if(bytes[0]!==5)return write(bytes);
    packets.push(bytes.slice());const b=Uint8Array.of(0x51,5,bytes.at(-1),1);
    client.control.value=new DataView(b.buffer);client.notify({target:client.control});
  };
  await assert.rejects(client.publish({packed:new Uint8Array(30000)},()=>{}),/屏幕仍忙/);
  assert.ok(!packets.some(p=>p[0]===6));assert.equal(client.device.gatt.connected,true);
});

function idlePeripheral(ota = {}, keepConnection = () => false) {
  let elapsed = 0, serial = 0;
  const timers = new Map(), logs = [], packets = [];
  const clock = {
    setTimeout(callback, delay) {
      const id = ++serial;
      timers.set(id, {callback, at: elapsed + delay});
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const IdleClient = vm.runInNewContext(source + ";OMClient", {...sandbox, ...clock, OMOTA: ota});
  const client = new IdleClient(() => {}, message => logs.push(message), keepConnection);
  client.device = {gatt: {connected: true, disconnect() { this.connected = false; }}};
  client.ready = true;
  client.control = {removeEventListener() {}, async writeValueWithResponse(bytes) { packets.push([...bytes]); }};
  function advance(ms) {
    const end = elapsed + ms;
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      elapsed = due[1].at;
      timers.delete(due[0]);
      due[1].callback();
    }
    elapsed = end;
  }
  return {client, advance, timers, logs, packets};
}

test("idle connection releases after three minutes without sending a screen command", async () => {
  const peer = idlePeripheral();
  await peer.client.operation(async () => {});
  peer.advance(179999);
  assert.equal(peer.client.device.gatt.connected, true);
  peer.advance(1);
  assert.equal(peer.client.device.gatt.connected, false);
  assert.equal(peer.logs.length, 1);
  assert.match(peer.logs[0], /3 minutes/);
  assert.deepEqual(peer.packets, []);
});

test("new activity restarts idle time and busy refresh retains the link until completion", async () => {
  const peer = idlePeripheral();
  await peer.client.operation(async () => {});
  peer.advance(170000);
  await peer.client.write(Uint8Array.of(0));
  peer.advance(170000);
  assert.equal(peer.client.device.gatt.connected, true);
  let finish;
  const task = peer.client.operation(() => new Promise(resolve => { finish = resolve; }));
  peer.advance(600000);
  assert.equal(peer.client.device.gatt.connected, true);
  finish();
  await task;
  peer.advance(179999);
  assert.equal(peer.client.device.gatt.connected, true);
  peer.advance(1);
  assert.equal(peer.client.device.gatt.connected, false);
  assert.deepEqual(peer.packets, [[0]]);
});

test("OTA transfer and boot confirmation are protected from idle disconnect", async () => {
  let finishTransfer, finishBoot;
  const peer = idlePeripheral({
    transfer: () => new Promise(resolve => { finishTransfer = resolve; }),
    confirmBoot: () => new Promise(resolve => { finishBoot = resolve; }),
  });
  await peer.client.operation(async () => {});
  const task = peer.client.ota({}, true, () => {});
  peer.advance(600000);
  assert.equal(peer.client.device.gatt.connected, true);
  assert.equal(peer.client.otaActive, true);
  finishTransfer({});
  await new Promise(setImmediate);
  peer.advance(600000);
  assert.equal(peer.client.device.gatt.connected, true);
  finishBoot({});
  await task;
  assert.equal(peer.client.otaActive, false);
  peer.advance(180000);
  assert.equal(peer.client.device.gatt.connected, false);
});

test("failed OTA clears its locks and timer; a new connection receives a full idle interval", async () => {
  let fail;
  const peer=idlePeripheral({transfer:()=>new Promise((_,reject)=>{fail=reject;})});
  await peer.client.operation(async()=>{});
  const task=peer.client.ota({},true,()=>{});const rejected=assert.rejects(task,/validation failed/);
  peer.advance(600000);assert.equal(peer.client.device.gatt.connected,true);assert.equal(peer.client.otaActive,true);
  fail(Error("validation failed"));await rejected;
  assert.equal(peer.client.otaActive,false);assert.equal(peer.client.busy,false);
  assert.equal(peer.client.device.gatt.connected,false);assert.equal(peer.timers.size,0);
  peer.client.device.gatt.connected=true;peer.client.ready=true;
  await peer.client.operation(async()=>{});
  peer.advance(179999);assert.equal(peer.client.device.gatt.connected,true);
  peer.advance(1);assert.equal(peer.client.device.gatt.connected,false);
});

test("pending reply and a remote disconnect cannot leave an active stale idle timer", async () => {
  const peer = idlePeripheral();
  await peer.client.operation(async () => {});
  peer.client.pending.add({});
  peer.advance(180000);
  assert.equal(peer.client.device.gatt.connected, true);
  peer.client.pending.clear();
  peer.client.disconnected({target: peer.client.device});
  assert.equal(peer.timers.size, 0);
  peer.advance(180000);
  assert.equal(peer.logs.filter(line => /3 minutes/.test(line)).length, 0);
});

test("page schedules retain the connection until the scheduler stops", async () => {
  let scheduled = true;
  const peer = idlePeripheral({}, () => scheduled);
  await peer.client.operation(async () => {});
  peer.advance(600000);
  assert.equal(peer.client.device.gatt.connected, true);
  scheduled = false;
  peer.client.armIdleDisconnect();
  peer.advance(180000);
  assert.equal(peer.client.device.gatt.connected, false);
});
