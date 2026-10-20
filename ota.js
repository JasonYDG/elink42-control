"use strict";
const OMOTA = (() => {
  const SERVICE = "0000fe59-0000-1000-8000-00805f9b34fb";
  const CONTROL = "8ec90001-f315-4f60-9fb8-838830daea50", DATA = "8ec90002-f315-4f60-9fb8-838830daea50";
  // The retained native table uses a 16-bit 0x0003 UUID for its version characteristic.
  const VERSION = "00000003-0000-1000-8000-00805f9b34fb";
  const SIZE = 238532, FOUNDATION = {"2": "92388266519726d537fe51e5e40a607badf4460d16ea63fe8250ea3fde59a037", "5": "685a36d764bddd7dd8e735f7833b6553a513b21eb46ddd1e23c778756527a986"};
  // Only reviewed C/OTA application functions vary; activation-removal hooks stay pinned.
  const APP = [[3600,13424],[21962,22122],[23616,23720],[23928,24196],[24684,25008],[26992,27046],[27048,27380],[54456,54756],[75280,75708],[77136,77248],[77556,80068],[116076,116796],[120388,120992],[121176,121564],[121808,121872],[124092,124104],[124324,124780],[138024,138188],[138512,139176],[139728,139892],[140216,140856],[143488,143530],[182340,182572],[182580,182832],[182868,183448],[183800,183936]];
  const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  const sha = async bytes => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const number = bytes => BigInt("0x" + hex(bytes));
  const little = bytes => number(bytes.slice().reverse());
  const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFFFFn;
  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFF99DEF836146BC9B1B4D22831n;
  const G = [0x188DA80EB03090F67CBF20EB43A18800F4FF0AFD82FF1012n, 0x07192B95FFC8DA78631011ED6B24CDD573F977A11E794811n];
  const KEY = "ad1c33024edd53cfc7a8380e418dd7c949a3d10aed9519d270b8c7cd45a09efafa4180fc7c9db6c8f7d8ce05a0d66ef1";
  const key = Uint8Array.from(KEY.match(/../g), b => parseInt(b, 16)), Q = [little(key.slice(0, 24)), little(key.slice(24))];
  const mod = (x, m) => (x % m + m) % m;
  function inverse(x, m) {
    let a = mod(x, m), b = m, u = 1n, v = 0n;
    while (a) { const q = b / a; [a, b] = [b % a, a]; [u, v] = [v - q * u, u]; }
    if (b !== 1n) throw Error("OTA 签名数值无效"); return mod(v, m);
  }
  function add(a, b) {
    if (!a) return b; if (!b) return a;
    const [x, y] = a, [u, v] = b;
    if (x === u && mod(y + v, P) === 0n) return null;
    const slope = mod((x === u ? 3n * x * x - 3n : v - y) * inverse(x === u ? 2n * y : u - x, P), P);
    const z = mod(slope * slope - x - u, P); return [z, mod(slope * (x - z) - y, P)];
  }
  function multiply(k, point) {
    let result = null;
    while (k) { if (k & 1n) result = add(result, point); point = add(point, point); k >>= 1n; }
    return result;
  }
  async function signature(dat) {
    const r = little(dat.slice(56, 80)), s = little(dat.slice(80, 104));
    if (r <= 0n || r >= N || s <= 0n || s >= N) return false;
    // The preserved uECC implementation consumes the low 192 bits of its little-endian SHA output.
    const h = number((await sha(dat.slice(0, 56))).slice(8)), w = inverse(s, N);
    const point = add(multiply(mod(h * w, N), G), multiply(mod(r * w, N), Q));
    return !!point && point[0] % N === r;
  }
  async function validate(datInput, binInput) {
    if (!(datInput instanceof Uint8Array) || !(binInput instanceof Uint8Array)) throw Error("OTA 包数据类型无效");
    const dat = datInput.slice(), bin = binInput.slice();
    if (dat.length !== 104) throw Error("firmware.dat 必须为 104 字节；HEX/BIN 不能代替独立签名 OTA 包");
    if (bin.length !== SIZE) throw Error("固件长度不符合已核验的 OM6626 4.2 寸布局；其他屏型或版本需先核验");
    const view = new DataView(dat.buffer);
    const model = (view.getUint32(12, true) >>> 8) & 255, revision = view.getUint32(16, true);
    if (view.getUint32(0, true) !== 0x5A4B4446 || view.getUint32(4, true) !== 1 ||
        view.getUint16(8, true) !== 1 || view.getUint16(10, true) !== 1 || view.getUint32(12, true) !== (0x5A4B0000 | (model << 8)) ||
        ![2, 5].includes(model) || !revision || view.getUint32(20, true) !== bin.length)
      throw Error("只接受本项目独立签名 OTA 包；原版、未签名或其他屏型包已拒绝");
    const digest = await sha(bin);
    if (hex(digest.slice().reverse()) !== hex(dat.slice(24, 56))) throw Error("firmware.bin 的 SHA-256 与签名包不符");
    if (!await signature(dat)) throw Error("OTA 项目签名无效；不接受作者或其他项目的签名");
    const protectedBytes = bin.slice(); for (const [start, end] of APP) protectedBytes.fill(0, start, end);
    if (hex((await sha(protectedBytes)).reverse()) !== FOUNDATION[model]) throw Error("OTA 包改变了已保护的启动、驱动、波形、激活移除或身份区域，已停止");
    if (new TextDecoder().decode(bin.slice(208405, 208416)) !== OMProtocol.OTA_MARKER || bin[51172] !== model ||
        new DataView(bin.buffer).getUint32(79984,true) !== revision || hex(bin.slice(79988,80036)) !== KEY || hex(bin.slice(80036,80068)) !== FOUNDATION[model])
      throw Error("固件中的独立 OTA 信任、屏型或标识不符");
    return {dat, bin, size: bin.length, version: String(revision), revision, model, sha256: hex(digest), independent: true};
  }
  async function parse(buffer) {
    const files = await OMArchive.unzip(buffer);
    if (files.size !== 3 || !["manifest.json", "firmware.dat", "firmware.bin"].every(n => files.has(n)))
      throw Error("OTA ZIP 只接受 manifest.json、firmware.dat、firmware.bin 三个文件");
    const manifest = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(files.get("manifest.json")));
    const app = manifest?.manifest?.application;
    if (!app || app.bin_file !== "firmware.bin" || app.dat_file !== "firmware.dat" ||
        Object.keys(manifest.manifest).some(k => k !== "application")) throw Error("OTA manifest 不是单一应用镜像");
    return validate(files.get("firmware.dat"), files.get("firmware.bin"));
  }
  function target(client) {
    if (!client.ready || !client.device?.gatt.connected || ![2, 5].includes(client.config?.model) ||
        client.board?.id !== 1 || client.board?.name !== OMProtocol.OTA_MARKER) throw Error("当前设备尚未接入独立 OTA；首次需有线刷入对应屏型的独立 OTA 引导 HEX");
  }
  async function inspect(client) {
    target(client);
    try {
      const service = await client.bounded(client.device.gatt.getPrimaryService(SERVICE), "读取 OTA 服务");
      const control = await client.bounded(service.getCharacteristic(CONTROL), "读取 DFU 控制接口");
      const data = await client.bounded(service.getCharacteristic(DATA), "读取 DFU 数据接口");
      if (!control.properties.write || !control.properties.notify || !data.properties.writeWithoutResponse)
        throw Error("DFU 特征属性与 OM6626 原协议不符");
      return {control, data};
    } catch (error) {
      if (error.name === "SecurityError") throw Error("当前蓝牙授权不含 OTA 服务；请断开后点连接屏幕，重新选择同一设备授权");
      throw error;
    }
  }
  function checkReply(bytes, opcode) {
    const length = opcode === 3 ? 11 : opcode === 6 ? 15 : 3;
    if (bytes.length !== length || bytes[0] !== 0x60 || bytes[1] !== opcode || bytes[2] !== 1) {
      const reason = bytes[2] === 4 ? (opcode === 1 ? "旧 v1 的启动记录检查不兼容；需有线刷入 v1-fixed，不能靠网页跳过固件检查" :
        "设备读写或提交读回失败，升级未确认；不会自动重写") : {
        129: "启动记录读取失败，尚未擦除暂存区", 130: "启动记录仍指向待完成升级的暂存区，已停止",
        131: "当前应用位置或长度超出已核验范围，尚未擦除暂存区", 132: "暂存区擦除失败"}[bytes[2]];
      throw Error(`DFU 命令 0x${opcode.toString(16)} 被拒绝或回包无效（状态 ${bytes[2] ?? "未知"}）${reason ? "：" + reason : ""}`);
    }
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  async function transfer(client, input, consent, progress = () => {}) {
    target(client); const device = client.device;
    if (consent?.deviceId !== device.id || consent.eraseImages !== true) throw Error("请确认目标设备、备份图片并明确同意清空图库");
    const pack = await validate(input.dat, input.bin);
    if (pack.model !== client.config.model) throw Error("OTA 包与当前设备屏型不匹配；没有发送升级命令");
    if (client.device !== device) throw Error("校验期间目标设备发生变化，未发送 OTA 命令");
    target(client);
    const {control, data} = await inspect(client);
    const connected = () => { if (client.device !== device || !device.gatt.connected) throw Error("OTA 蓝牙断开，结果未确认；不会自动重发"); };
    const notify = event => {
      if (event.target !== control) return;
      const value = event.target.value, bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
      if (bytes[0] !== 0x60) return;
      for (const waiter of [...client.pending]) if (waiter.match(bytes)) waiter.resolve(bytes);
    };
    const response = opcode => client.wait(b => b[0] === 0x60 && b[1] === opcode, "OTA 设备回执（结果未确认）", 45000);
    async function command(bytes) {
      connected(); const reply = response(bytes[0]);
      try {
        await client.bounded(control.writeValueWithResponse(bytes), "OTA 控制写入", 45000);
        return checkReply(await reply.promise, bytes[0]);
      } catch (error) { reply.cancel(error); throw error; }
    }
    function checksum(reply, offset, crc) {
      const view = checkReply(reply, 3);
      if (view.getUint32(3, true) !== offset || view.getUint32(7, true) !== crc)
        throw Error("OTA 设备确认的偏移或 CRC32 不符，已停止且不自动重发");
    }
    async function send(bytes, label, start, span) {
      let offset = 0, crc = 0;
      while (offset < bytes.length) {
        const count = Math.min(16, Math.ceil((bytes.length - offset) / 20));
        const receipt = count === 16 ? response(3) : null;
        try {
          for (let i = 0; i < count; i++) {
            connected(); const part = bytes.slice(offset, offset + 20);
            await client.bounded(data.writeValueWithoutResponse(part), "OTA 数据写入");
            offset += part.length; crc = OMArchive.crc32(part, crc);
          }
          if (receipt) checksum(await receipt.promise, offset, crc);
        } catch (error) { receipt?.cancel(error); throw error; }
        progress(start + Math.floor(offset / bytes.length * span), `${label} ${offset.toLocaleString()} / ${bytes.length.toLocaleString()} 字节`);
      }
      const result = await command(Uint8Array.of(3));
      if (result.getUint32(3, true) !== offset || result.getUint32(7, true) !== crc) throw Error("OTA 最终传输偏移或 CRC32 不符");
    }
    control.addEventListener("characteristicvaluechanged", notify);
    try {
      await client.bounded(control.startNotifications(), "启用 OTA 回执");
      for (const [type, bytes, label] of [[1, pack.dat, "签名命令包"], [2, pack.bin, "固件"]]) {
        const selected = await command(Uint8Array.of(6, type));
        if (selected.getUint32(3, true) < bytes.length) throw Error("设备 OTA 容量不足");
        const create = new Uint8Array(6); create.set([1, type]); new DataView(create.buffer).setUint32(2, bytes.length, true);
        await command(create); await command(Uint8Array.of(2, 16, 0));
        await send(bytes, label, type === 1 ? 0 : 2, type === 1 ? 2 : 96);
        if (type === 2) progress(99, "设备正在重新读取固件并校验 SHA-256，等待最终执行回执");
        await command(Uint8Array.of(4));
      }
      progress(99, "固件已校验并提交，等待重启后核对版本");
      client.disconnect();
      return {status: "device-verified-reboot-pending", independent: pack.independent, revision:pack.revision, model:pack.model};
    } finally { control.removeEventListener("characteristicvaluechanged", notify); }
  }
  async function confirmBoot(client, pack, progress) {
    const device = client.device, deadline = Date.now() + 120000;
    client.connectCancelled = false;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (client.device !== device || client.connectCancelled) throw Error("OTA 已提交，重连被取消；启动结果未确认");
      try { await client.openConnection(); }
      catch (error) {
        const retry = error.name === "NetworkError" || !device.gatt.connected;
        device.gatt.disconnect();
        client.control?.removeEventListener("characteristicvaluechanged", client.notify);
        device.removeEventListener?.("gattserverdisconnected", client.disconnected);
        if (client.connectCancelled || !retry) throw error;
        continue;
      }
      target(client);
      const service = await client.bounded(device.gatt.getPrimaryService(SERVICE), "重启后读取升级服务");
      const version = await client.bounded(service.getCharacteristic(VERSION), "读取固件版本接口");
      if (!version.properties.write || !version.properties.notify) throw Error("OTA 已提交，但版本接口不符；启动结果未确认");
      const notify = event => {
        if (event.target !== version) return;
        const v = event.target.value, bytes = new Uint8Array(v.buffer,v.byteOffset,v.byteLength).slice();
        for (const waiter of [...client.pending]) if (waiter.match(bytes)) waiter.resolve(bytes);
      };
      version.addEventListener("characteristicvaluechanged", notify);
      let receipt;
      try {
        await client.bounded(version.startNotifications(), "启用版本回执");
        receipt = client.wait(b => b.length === 12 && new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(0,true) === 0x5A4B4F54,
          "重启后的固件版本回执（启动未确认）", 15000);
        await client.bounded(version.writeValueWithResponse(Uint8Array.of(0)), "只读查询固件版本");
        const bytes = await receipt.promise, view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        if (client.device !== device || !device.gatt.connected || !client.ready || client.connectCancelled || Date.now() >= deadline)
          throw Error("OTA 重连或版本核对已中断，启动结果未确认");
        target(client);
        if (view.getUint32(4,true) !== pack.model || view.getUint32(8,true) !== pack.revision || client.config.model !== pack.model)
          throw Error("重启后的屏型或固件版本不匹配，OTA 结果未确认");
        progress(100, `升级完成，已重连并确认 ELINK 固件版本 ${pack.revision}；请核对实屏`);
        return {status:"boot-verified", revision:pack.revision, model:pack.model};
      } catch (error) { receipt?.cancel(error); throw error; }
      finally { version.removeEventListener("characteristicvaluechanged", notify); }
    }
    throw Error("OTA 已提交，但未在两分钟内确认新版本启动；不会重新擦写，请保留供电并核对设备");
  }
  return {SERVICE, CONTROL, DATA, VERSION, parse, validate, inspect, transfer, confirmBoot};
})();
