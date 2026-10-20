"use strict";
class OMClient {
  constructor(update = () => {}, log = () => {}) {
    this.update = update;
    this.log = log;
    this.pending = new Set();
    this.busy = false;
    this.ready = false;
    this.payload = 20;
    this.reportedPayload = undefined;
    this.commandSequence = 0;
    this.refreshStatus = false;
    this.otaActive = false;
  }
  get canPublish() { return [2, 5].includes(this.config?.model); }
  setTransfer(payload, delay) {
    OMProtocol.integer(payload, 20, 180, "传输上限"); OMProtocol.integer(delay, 0, 100, "包间隔");
    if (this.busy) throw Error("传输中无法修改包设置");
    this.transferPayload = payload; this.packetDelay = delay;
    this.payload = Math.min(this.reportedPayload || 20, payload);
  }
  notify = event => {
    if (event.target !== this.control) return;
    const value = event.target.value;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    if (bytes.length === 15 && !this.config) {
      this.config = OMProtocol.config(bytes);
      this.update();
    }
    for (const waiter of [...this.pending]) if (waiter.match(bytes)) waiter.resolve(bytes);
  };
  disconnected = event => {
    if (event?.target && event.target !== this.device) return;
    this.ready = false;
    this.refreshStatus = false;
    this.control?.removeEventListener("characteristicvaluechanged", this.notify);
    for (const waiter of [...this.pending]) waiter.reject(Error("蓝牙已断开；已提交的刷新结果需要查看屏幕确认"));
    this.log("蓝牙已断开");
    this.update();
  };
  wait(match, label, ms = 8000) {
    let timer, waiter;
    const promise = new Promise((resolve, reject) => {
      const finish = (callback, value) => { clearTimeout(timer); this.pending.delete(waiter); callback(value); };
      waiter = {match, resolve: value => finish(resolve, value), reject: error => finish(reject, error)};
      timer = setTimeout(() => waiter.reject(Error(label + "超时")), ms);
      this.pending.add(waiter);
    });
    // Install a rejection observer before the write, which can itself fail first.
    promise.catch(() => {});
    return {promise, cancel: error => waiter.reject(error)};
  }
  async bounded(operation, label, ms = 10000) {
    let timer, expired = false;
    const device = this.device;
    try {
      return await Promise.race([
        operation.then(value => { if (expired) device?.gatt.disconnect(); return value; }),
        new Promise((_, reject) => timer = setTimeout(() => {
          expired = true; this.disconnect(); reject(Error(label + "超时，已断开以停止旧命令"));
        }, ms)),
      ]);
    } finally { clearTimeout(timer); }
  }
  async write(bytes) {
    if (!this.device?.gatt.connected || !this.control) throw Error("请先连接屏幕");
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > Math.min(247, this.payload))
      throw Error("蓝牙包长度超出已确认的范围");
    await this.bounded(this.control.writeValueWithResponse(bytes), "蓝牙写入");
    if (this.packetDelay) await this.pause(this.packetDelay);
  }
  async request(bytes, match, label) {
    const waiter = this.wait(match, label);
    try { await this.write(bytes); return await waiter.promise; }
    catch (error) { waiter.cancel(error); throw error; }
  }
  async connect(existingDevice) {
    if (this.busy || this.device?.gatt.connected) throw Error("当前连接或操作尚未结束");
    this.busy = true;
    this.connectCancelled = false;
    this.config = null;
    this.reportedPayload = undefined;
    this.ready = false;
    this.refreshStatus = false;
    this.payload = 20;
    this.update();
    try {
      this.device = existingDevice || await navigator.bluetooth.requestDevice({
        filters: [{namePrefix: "ELINK42-"}, {namePrefix: "GCLab_EPD_"}, {services: [OMProtocol.SERVICE]}],
        optionalServices: [OMProtocol.SERVICE, "0000fe59-0000-1000-8000-00805f9b34fb"],
      });
      for (let attempt = 0; ; attempt++) {
        try { await this.openConnection(); break; }
        catch (error) {
          const retry = attempt === 0 && !this.connectCancelled &&
            (error.name === "NetworkError" || !this.device.gatt.connected);
          this.device.gatt.disconnect();
          this.control?.removeEventListener("characteristicvaluechanged", this.notify);
          this.device.removeEventListener?.("gattserverdisconnected", this.disconnected);
          if (!retry) throw error;
          this.log("首次握手断开，正在重连同一屏幕（仅一次）");
          await new Promise(resolve => setTimeout(resolve, 400));
          if (this.connectCancelled) throw Error("连接已取消");
        }
      }
    } catch (error) { this.disconnect(); throw error; }
    finally { this.busy = false; this.update(); }
  }
  async openConnection() {
    if (this.connectCancelled) throw Error("连接已取消");
    this.config = null; this.board = null; this.control = null;
    this.device.addEventListener("gattserverdisconnected", this.disconnected, {once: true});
    const server = await this.bounded(this.device.gatt.connect(), "蓝牙连接", 15000);
    if (this.connectCancelled) throw Error("连接已取消");
    const service = await this.bounded(server.getPrimaryService(OMProtocol.SERVICE), "读取服务");
    this.control = await this.bounded(service.getCharacteristic(OMProtocol.CONTROL), "读取控制接口");
    this.control.addEventListener("characteristicvaluechanged", this.notify);
    const initial = this.wait(bytes => bytes.length === 15, "读取配置");
    try { await this.bounded(this.control.startNotifications(), "启用通知"); await initial.promise; }
    catch (error) { initial.cancel(error); throw error; }
    this.board = OMProtocol.board(await this.request(Uint8Array.of(0), b => b[0] === 0x42, "读取板型"));
    if (!OMProtocol.independentBoard(this.board))
      throw Error("这台设备未运行配套 Web 测试固件，请先刷入交付包中的 HEX");
    if (![2, 5].includes(this.config.model)) throw Error("仅支持 SSD1619 三色编号 2 和 JD79668 四色编号 5");
    const sequence = this.nextSequence();
    const probe = this.wait(b => (b.length === 4 && b[0] === 0x51 && b[1] === 0x24 && b[2] === sequence) ||
      (b.length === 2 && b[0] === 0x55), "检测刷新回执（等待设备命令队列）", 65000);
    try { await this.write(Uint8Array.of(0x24, sequence)); }
    catch (error) { probe.cancel(error); throw error; }
    const status = await probe.promise;
    this.refreshStatus = status[0] === 0x51;
    if (!this.refreshStatus) this.log("当前固件没有带序号的刷新回执；请升级 refresh-state 配套固件后再操作屏幕");
    if (this.connectCancelled || !this.device.gatt.connected) throw Error("连接已断开");
    this.ready = true;
    this.log("已连接 " + (this.device.name || this.device.id) + " · Web 固件 / " +
      (this.config.model === 5 ? "JD79668 四色" : "SSD1619 三色"));
  }
  disconnect() {
    this.connectCancelled = true;
    this.ready = false;
    this.device?.gatt.disconnect();
    this.update();
  }
  async operation(callback) {
    if (this.busy) throw Error("上一次操作仍在进行");
    if (!this.ready || !this.device?.gatt.connected) throw Error("请先连接配套 Web 固件");
    this.busy = true;
    this.update();
    try { return await callback(); }
    catch (error) { this.disconnect(); throw error; }
    finally { this.busy = false; this.update(); }
  }
  async pause(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (!this.device?.gatt.connected) throw Error("蓝牙已断开，画面结果待确认");
      await new Promise(resolve => setTimeout(resolve, Math.min(250, end - Date.now())));
    }
  }
  nextSequence() { return this.commandSequence = this.commandSequence % 255 + 1; }
  requireRefreshStatus() {
    if (!this.refreshStatus) throw Error("当前固件不能报告刷新完成，请先升级 refresh-state 配套固件；没有发送刷新命令");
  }
  async command(bytes, progress = () => {}) {
    this.requireRefreshStatus();
    // BUSY is only meaningful for refreshes; a sleeping panel may hold the pin active.
    const checkBusy = bytes[0] !== 6 && !(bytes[0] === 0x20 && bytes[6] === 0);
    const sequence = this.nextSequence();
    const done = this.wait(b => b.length === 4 && b[0] === 0x51 && b[1] === bytes[0] && b[2] === sequence,
      "设备处理回执（结果未确认，不会自动重发）", 65000);
    progress(99, checkBusy ? "设备正在处理，等待完成回执及 BUSY 状态" : "等待设备命令处理回执");
    try {
      await this.write(Uint8Array.of(...bytes, sequence));
      const reply = await done.promise;
      if (checkBusy && reply[3] !== 0) throw Error("原驱动已返回，但屏幕 BUSY 仍有效；刷新未确认，已停止后续命令");
      progress(100, checkBusy ? "收到本次处理完成回执，屏幕 BUSY 已释放；请核对实物画面" : "收到设备命令处理回执");
    } catch (error) { done.cancel(error); throw error; }
  }
  async calendar(progress) {
    return this.mode(1, progress);
  }
  async mode(mode, progress, date = new Date(), allowFullClock = false) {
    const packet = OMProtocol.time(date, mode);
    if (mode === 2 && this.config?.model === 5 && allowFullClock !== true)
      throw Error("JD79668 原驱动没有局刷；须明确选择允许原版全刷时钟");
    return this.operation(async () => {
      this.requireRefreshStatus();
      await this.initialize();
      await this.command(packet, progress);
      this.config.mode = mode;
      this.log("已提交时间及" + ["静态画面", "设备日历", "设备时钟", "设备相册"][mode] + "模式");
      await this.checkBoard();
      this.log("设备仍在线；日历是否正确显示请以实物为准");
    });
  }
  async checkBoard() {
    const board = OMProtocol.board(await this.request(Uint8Array.of(0), b => b[0] === 0x42, "核对设备"));
    if (!OMProtocol.independentBoard(board) || board.name !== this.board.name) throw Error("设备身份发生变化");
  }
  async otaInspect() { return this.operation(() => OMOTA.inspect(this)); }
  async ota(pack, consent, progress) {
    return this.operation(async () => {
      this.otaActive = true; this.update();
      try {
        const verified = await OMOTA.transfer(this, pack, consent, progress);
        return await OMOTA.confirmBoot(this, verified, progress);
      }
      finally { this.otaActive = false; this.update(); }
    });
  }
  async panel(command, data) {
    await this.write(Uint8Array.of(3, command));
    if (data) await this.write(Uint8Array.of(4, ...data));
  }
  async led(enabled) {
    const packet = OMProtocol.led(enabled);
    if (this.config?.model !== 5) throw Error("LED 控制仅用于当前 JD79668 四色屏");
    return this.operation(async () => {
      await this.write(packet);
      await this.checkBoard();
      this.log(enabled ? "已提交 LED 恢复正常指示，请查看灯光" : "已提交关闭 LED，请查看灯光");
    });
  }
  async initialize() {
    const initialized = this.wait(b => OMProtocol.text(b).startsWith("t="), "初始化屏幕");
    const mtu = this.wait(b => /^mtu=\d+$/.test(OMProtocol.text(b)), "读取传输大小");
    try {
      await this.write(Uint8Array.of(1));
      const size = Number(OMProtocol.text(await mtu.promise).slice(4));
      if (!Number.isInteger(size) || size < 20 || size > 512) throw Error("设备返回的传输大小无效");
      this.payload = Math.min(size, this.transferPayload || 180);
      this.reportedPayload = size;
      this.log("原屏型初始化完成，设备回执 " + OMProtocol.text(await initialized.promise));
    } catch (error) { initialized.cancel(error); mtu.cancel(error); throw error; }
  }
  async style(layout, alternate, progress) {
    OMProtocol.integer(layout, 0, 6, "日历版式"); OMProtocol.integer(alternate, 0, 1, "布局版本");
    return this.operation(async () => {
      this.requireRefreshStatus();
      await this.initialize();
      // Pause native rendering while updating both style fields, then render once.
      const mode = this.config.mode || 1;
      await this.command(OMProtocol.time(new Date(), 0));
      await this.write(Uint8Array.of(0x21, layout));
      await this.write(Uint8Array.of(0x23, alternate));
      const reply = await this.request(Uint8Array.of(0x24), b => b.length === 2 && b[0] === 0x55, "读取布局版本");
      if (reply[1] !== alternate) throw Error("布局版本读回不符");
      await this.command(OMProtocol.time(new Date(), mode), progress);
      this.config.layout = layout; this.config.alternate = alternate;
      await this.checkBoard();
    });
  }
  async storageState(external) {
    if (this.reportedPayload < 44) throw Error("图库状态需要至少 44 字节通知容量，请使用支持 MTU 协商的连接");
    const opcode = external ? 0x51 : 0x46, marker = external ? 0x73 : 0x53;
    return OMProtocol.storage(await this.request(Uint8Array.of(opcode), b => b[0] === marker, "读取图库"), external);
  }
  async slotMetadata(slot, external) {
    const marker = external ? 0x74 : 0x49;
    return OMProtocol.metadata(await this.request(Uint8Array.of(external ? 0x52 : 0x4B, slot),
      b => b[0] === marker && b[1] === slot, "读取槽位"), slot, external);
  }
  storedFormat(row) {
    if (!row.valid || row.width !== 400 || row.height !== 300 || row.size !== 30000 ||
        row.color !== (this.config.model === 5 ? 3 : 2)) throw Error("槽位图片格式不符合当前屏型，已停止显示以保留设备数据");
  }
  async gallery(external = false) {
    return this.operation(async () => {
      await this.initialize();
      const state = await this.storageState(external), slots = [];
      for (let slot = 0; slot < state.count; slot++) {
        const row = await this.slotMetadata(slot, external);
        if (row.valid && this.reportedPayload >= 66) {
          const reply = await this.request(Uint8Array.of(external ? 0x54 : 0x4A, slot),
            b => b[0] === (external ? 0x75 : 0x52) && b[1] === slot, "读取备注");
          if (reply.length !== 66) throw Error("备注长度不符");
          row.remark = OMProtocol.remarkText(reply.subarray(2));
        }
        slots.push(row);
      }
      return {...state, slots};
    });
  }
  async store(frame, slot, external, progress) {
    const bytes = OMProtocol.imageBytes(frame, this.config?.model), crc = OMProtocol.crc16(bytes);
    OMProtocol.integer(slot, 0, 44, "槽位");
    return this.operation(async () => {
      await this.initialize();
      const state = await this.storageState(external);
      if (slot >= state.count || state.type !== (this.config.model === 5 ? 3 : 2)) throw Error("槽位或色彩格式不符");
      const previous = await this.slotMetadata(slot, external);
      if (previous.valid) throw Error("此槽位已有图片。先备份所需内容并手动删除，再保存新图");
      const start = new Uint8Array(7), view = new DataView(start.buffer);
      start[0] = external ? 0x4C : 0x40; start[1] = slot;
      view.setUint16(2, 400, true); view.setUint16(4, 300, true); start[6] = this.config.model === 5 ? 3 : 2;
      await this.write(start);
      for (let off = 0; off < bytes.length; off += this.payload - 1) {
        await this.write(Uint8Array.of(external ? 0x4D : 0x41, ...bytes.subarray(off, off + this.payload - 1)));
        progress(Math.min(99, Math.floor((off + this.payload - 1) / 300)), "保存图片至空槽 " + slot);
      }
      await this.write(Uint8Array.of(external ? 0x4E : 0x42));
      const row = await this.slotMetadata(slot, external);
      if (!row.valid || row.width !== 400 || row.height !== 300 || row.size !== bytes.length || row.crc !== crc || row.color !== start[6])
        throw Error("设备记录的图片长度、格式或 CRC 与发送内容不符；未提交显示");
      this.log("槽位 " + slot + " 已记录 30,000 字节及匹配 CRC；Flash 实际内容和显示仍需实机确认");
      return row;
    });
  }
  async slotAction(action, slot, external, progress, remark = "") {
    OMProtocol.integer(slot, 0, 44, "槽位");
    if (!["display", "delete", "background", "remark"].includes(action)) throw Error("无效图库操作");
    const text = action === "remark" ? OMProtocol.remarkBytes(remark) : null;
    return this.operation(async () => {
      if (action === "display" || action === "background") this.requireRefreshStatus();
      await this.initialize();
      const state = await this.storageState(external);
      if (slot >= state.count) throw Error("槽位超出实际容量");
      const row = await this.slotMetadata(slot, external);
      if (!row.valid) throw Error("此槽位没有有效图片");
      if (action === "display") {
        this.storedFormat(row);
        await this.command(OMProtocol.time(new Date(), 0));
        await this.command(Uint8Array.of(external ? 0x50 : 0x45, slot), progress);
        this.config.mode = 0;
      } else if (action === "background") {
        this.storedFormat(row);
        const mode = this.config.mode;
        await this.command(OMProtocol.time(new Date(), 0));
        await this.write(Uint8Array.of(0x56, slot, external ? 1 : 0));
        await this.command(OMProtocol.time(new Date(), mode), progress);
      } else if (action === "delete") {
        await this.write(Uint8Array.of(external ? 0x4F : 0x43, slot));
        if ((await this.slotMetadata(slot, external)).valid) throw Error("槽位删除未获元数据确认");
      } else {
        if (this.reportedPayload < 66) throw Error("备注读回需要至少 66 字节通知容量");
        await this.write(Uint8Array.of(external ? 0x53 : 0x49, slot, ...text));
        const response = await this.request(Uint8Array.of(external ? 0x54 : 0x4A, slot),
          b => b[0] === (external ? 0x75 : 0x52) && b[1] === slot, "核对备注");
        if (response.length !== 66 || OMProtocol.remarkText(response.subarray(2)) !== remark) throw Error("备注读回不符");
      }
      await this.checkBoard();
    });
  }
  async clearBackground(progress) {
    return this.operation(async () => {
      this.requireRefreshStatus();
      const mode = this.config.mode;
      await this.command(OMProtocol.time(new Date(), 0));
      await this.initialize(); await this.write(Uint8Array.of(0x56, 255, 0));
      await this.command(OMProtocol.time(new Date(), mode), progress);
      await this.checkBoard();
    });
  }
  async rotate(mode, interval, days, external, progress) {
    return this.operation(async () => {
      if (mode) this.requireRefreshStatus();
      await this.initialize(); const state = await this.storageState(external);
      const packet = OMProtocol.rotation(mode, interval, days, state.count, external);
      if (mode) {
        const required = mode === 2 ? [...new Set(days.filter(s => s !== 255))] : [...Array(state.count).keys()];
        let valid = 0;
        for (const slot of required) {
          const row = await this.slotMetadata(slot, external); valid += row.valid ? 1 : 0;
          if (row.valid) this.storedFormat(row);
          if (mode === 2 && !row.valid) throw Error("星期映射中有空槽 " + slot);
        }
        if (!valid) throw Error("轮播没有有效图片");
      }
      await this.write(packet);
      const after = await this.storageState(external);
      if (after.mode !== mode || after.interval !== interval || after.days.some((s, i) => s !== days[i])) throw Error("轮播设置读回不符");
      if (mode) {
        await this.command(OMProtocol.time(new Date(), 3), progress); this.config.mode = 3;
      }
      await this.checkBoard();
    });
  }
  async holidayRead() {
    if (this.reportedPayload < 82) throw Error("读取原调休表需要至少 82 字节通知容量");
    const reply = await this.request(Uint8Array.of(0x48), b => b[0] === 0x48, "读取调休表");
    if (reply.length < 4 || reply.length !== 4 + reply[3] * 2) throw Error("调休表格式无效");
    const view = new DataView(reply.buffer, reply.byteOffset, reply.byteLength);
    return {year: view.getUint16(1, true), entries: Array.from({length: reply[3]}, (_, i) => {
      const v = view.getUint16(4 + i * 2, true); return {month: (v >> 8) & 15, day: v & 255, off: !!(v & 0xF000)};
    })};
  }
  async holidays(entries, year) {
    return this.operation(async () => {
      await this.initialize();
      if (entries === undefined) return this.holidayRead();
      const packet = OMProtocol.holidays(year, entries);
      if (packet.length > this.payload || 4 + entries.length * 2 > this.reportedPayload)
        throw Error("调休表超出本连接单包容量；未修改设备");
      await this.write(packet); const result = await this.holidayRead();
      if (result.year !== year || JSON.stringify(result.entries) !== JSON.stringify(entries)) throw Error("调休表读回不符");
      return result;
    });
  }
  async publish(frame, progress) {
    if (!this.canPublish) throw Error("不支持的屏幕型号");
    const fourcolor = this.config.model === 5;
    if (fourcolor ? !(frame.packed instanceof Uint8Array) || frame.packed.length !== 30000 :
        !(frame.black instanceof Uint8Array) || !(frame.red instanceof Uint8Array) ||
        frame.black.length !== 15000 || frame.red.length !== 15000) throw Error("像素格式或长度与屏型不符");
    return this.operation(async () => {
      this.requireRefreshStatus();
      await this.command(OMProtocol.time(new Date(), 0));
      this.config.mode = 0;
      await this.initialize();
      if (fourcolor) await this.panel(0x83, [0, 0, 1, 143, 0, 0, 1, 43, 1]);
      else {
        await this.panel(0x11, [3]);
        await this.panel(0x44, [0, 49]);
        await this.panel(0x45, [0, 0, 43, 1]);
      }
      let sent = 0;
      for (const [command, bytes] of fourcolor ? [[0x10, frame.packed]] : [[0x24, frame.black], [0x26, frame.red]]) {
        if (!fourcolor) {
          await this.panel(0x4E, [0]);
          await this.panel(0x4F, [0, 0]);
        }
        await this.panel(command);
        for (let offset = 0; offset < bytes.length; offset += this.payload - 1) {
          const chunk = bytes.subarray(offset, offset + this.payload - 1);
          await this.write(Uint8Array.of(4, ...chunk));
          sent += chunk.length;
          progress(Math.floor(sent / 300), `已发送 ${sent.toLocaleString()} / 30,000 字节`);
        }
      }
      await this.command(Uint8Array.of(5), progress);
      this.log((fourcolor ? "四色像素" : "双层像素") + "已获 GATT 写入确认，已提交原驱动全刷");
      await this.command(Uint8Array.of(6), () => {});
      await this.checkBoard();
      this.log("已请求屏幕休眠；实物画面请人工确认");
    });
  }
}
