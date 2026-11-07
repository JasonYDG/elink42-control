"use strict";
class OMClient {
  constructor(update = () => {}, log = () => {}, keepConnection = () => false, idleDisconnected = () => {}) {
    this.update = update;
    this.log = log;
    this.keepConnection = keepConnection;
    this.idleDisconnected = idleDisconnected;
    this.pending = new Set();
    this.busy = false;
    this.ready = false;
    this.payload = 20;
    this.reportedPayload = undefined;
    this.commandSequence = 0;
    this.refreshStatus = false;
    this.lifecycleSupported = false;
    this.timingSupported = false;
    this.otaActive = false;
    this.firmwareRevision = null;
    this.idleTimer = null;
  }
  get canPublish() { return [2, 5].includes(this.config?.model); }
  setTransfer(payload, delay) {
    OMProtocol.integer(payload, 20, 180, OMI18n.t("传输上限")); OMProtocol.integer(delay, 0, 100, OMI18n.t("包间隔"));
    if (this.busy) throw Error(OMI18n.t("传输中无法修改包设置"));
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
    clearTimeout(this.idleTimer);
    this.ready = false;
    this.refreshStatus = false;
    this.lifecycleSupported = false;
    this.timingSupported = false;
    this.control?.removeEventListener("characteristicvaluechanged", this.notify);
    for (const waiter of [...this.pending]) waiter.reject(Error(OMI18n.t("蓝牙已断开；已提交的刷新结果需要查看屏幕确认")));
    this.log(OMI18n.t("蓝牙已断开"));
    this.update();
  };
  wait(match, label, ms = 8000) {
    let timer, waiter;
    const promise = new Promise((resolve, reject) => {
      const finish = (callback, value) => { clearTimeout(timer); this.pending.delete(waiter); callback(value); };
      waiter = {match, resolve: value => finish(resolve, value), reject: error => finish(reject, error)};
      timer = setTimeout(() => waiter.reject(Error(label + OMI18n.t("超时"))), ms);
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
          expired = true; this.disconnect(); reject(Error(label + OMI18n.t("超时，已断开以停止旧命令")));
        }, ms)),
      ]);
    } catch (error) { this.log(label+" · "+error.name+": "+error.message);throw error; }
    finally { clearTimeout(timer); }
  }
  async write(bytes) {
    if (!this.device?.gatt.connected || !this.control) throw Error(OMI18n.t("请先连接屏幕"));
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > Math.min(247, this.payload))
      throw Error(OMI18n.t("蓝牙包长度超出已确认的范围"));
    await this.bounded(this.control.writeValueWithResponse(bytes), OMI18n.t("蓝牙写入"));
    if (this.packetDelay) await this.pause(this.packetDelay);
    this.armIdleDisconnect();
  }
  async request(bytes, match, label, timeout = 8000) {
    const waiter = this.wait(match, label, timeout);
    try { await this.write(bytes); return await waiter.promise; }
    catch (error) { waiter.cancel(error); throw error; }
  }
  async connect(existingDevice) {
    if (this.busy || this.device?.gatt.connected) throw Error(OMI18n.t("当前连接或操作尚未结束"));
    this.busy = true;
    this.connectCancelled = false;
    this.config = null;
    this.reportedPayload = undefined;
    this.ready = false;
    this.refreshStatus = false;
    this.timingSupported = false;
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
          this.log(OMI18n.t("首次握手断开，正在重连同一屏幕（仅一次）"));
          await new Promise(resolve => setTimeout(resolve, 400));
          if (this.connectCancelled) throw Error(OMI18n.t("连接已取消"));
        }
      }
    } catch (error) { this.disconnect(); throw error; }
    finally { this.busy = false; this.armIdleDisconnect(); this.update(); }
  }
  async openConnection() {
    if (this.connectCancelled) throw Error(OMI18n.t("连接已取消"));
    this.config = null; this.board = null; this.control = null; this.firmwareRevision = null;
    this.device.addEventListener("gattserverdisconnected", this.disconnected, {once: true});
    const server = await this.bounded(this.device.gatt.connect(), OMI18n.t("蓝牙连接"), 15000);
    if (this.connectCancelled) throw Error(OMI18n.t("连接已取消"));
    const service = await this.bounded(server.getPrimaryService(OMProtocol.SERVICE), OMI18n.t("读取服务"));
    this.control = await this.bounded(service.getCharacteristic(OMProtocol.CONTROL), OMI18n.t("读取控制接口"));
    this.control.addEventListener("characteristicvaluechanged", this.notify);
    const initial = this.wait(bytes => bytes.length === 15, OMI18n.t("读取配置"));
    try { await this.bounded(this.control.startNotifications(), OMI18n.t("启用通知")); await initial.promise; }
    catch (error) { initial.cancel(error); throw error; }
    this.board = OMProtocol.board(await this.request(Uint8Array.of(0), b => b[0] === 0x42, OMI18n.t("读取板型")));
    if (!OMProtocol.independentBoard(this.board))
      throw Error(OMI18n.t("这台设备未运行配套 Web 测试固件，请先刷入交付包中的 HEX"));
    if (![2, 5].includes(this.config.model)) throw Error(OMI18n.t("仅支持 SSD1619 三色编号 2 和 JD79668 四色编号 5"));
    const sequence = this.nextSequence();
    const probe = this.wait(b => (b.length === 4 && b[0] === 0x51 && b[1] === 0x24 && b[2] === sequence) ||
      (b.length === 2 && b[0] === 0x55), OMI18n.t("检测刷新回执（等待设备命令队列）"), 65000);
    try { await this.write(Uint8Array.of(0x24, sequence)); }
    catch (error) { probe.cancel(error); throw error; }
    const status = await probe.promise;
    this.refreshStatus = status[0] === 0x51;
    this.lifecycleSupported = this.refreshStatus && !!(status[3] & 0x80);
    this.timingSupported = this.refreshStatus && !!(status[3] & 0x20);
    if (!this.refreshStatus) this.log(OMI18n.t("当前固件没有带序号的刷新回执；请升级 refresh-state 配套固件后再操作屏幕"));
    if (this.refreshStatus) await this.readCalendar();
    if (this.connectCancelled || !this.device.gatt.connected) throw Error(OMI18n.t("连接已断开"));
    this.ready = true;
    this.log(OMI18n.t("已连接 ") + (this.device.name || this.device.id) + OMI18n.t(" · Web 固件 / ") +
      (this.config.model === 5 ? OMI18n.t("JD79668 四色") : OMI18n.t("SSD1619 三色")));
  }
  armIdleDisconnect() {
    clearTimeout(this.idleTimer);
    if (!this.ready || this.busy || this.otaActive || this.keepConnection() || !this.device?.gatt.connected) return;
    this.idleTimer = setTimeout(() => {
      if (!this.ready || !this.device?.gatt.connected) return;
      if (this.busy || this.otaActive || this.keepConnection() || this.pending.size) {
        this.armIdleDisconnect();
        return;
      }
      const message = OMI18n.t("空闲 3 分钟，已断开蓝牙以省电；下次操作请重新连接。");
      this.log(message);
      this.disconnect();
      this.idleDisconnected(message);
    }, 180000);
    this.idleTimer?.unref?.();
  }
  disconnect() {
    clearTimeout(this.idleTimer);
    this.connectCancelled = true;
    this.ready = false;
    this.device?.gatt.disconnect();
    this.update();
  }
  async operation(callback) {
    if (this.busy) throw Error(OMI18n.t("上一次操作仍在进行"));
    if (!this.ready || !this.device?.gatt.connected) throw Error(OMI18n.t("请先连接配套 Web 固件"));
    this.busy = true;
    this.update();
    try { return await callback(); }
    catch (error) { if (error.code !== "DISPLAY_NOT_READY" && error.code !== "OTA_PRECHECK") { if(this.device?.gatt.connected)this.log(OMI18n.t("操作未确认，停止发送并断开：")+error.message);this.disconnect(); } throw error; }
    finally { this.busy = false; this.armIdleDisconnect(); this.update(); }
  }
  async pause(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (!this.device?.gatt.connected) throw Error(OMI18n.t("蓝牙已断开，画面结果待确认"));
      await new Promise(resolve => setTimeout(resolve, Math.min(250, end - Date.now())));
    }
  }
  nextSequence() { return this.commandSequence = this.commandSequence % 255 + 1; }
  requireRefreshStatus() {
    if (!this.refreshStatus) throw Error(OMI18n.t("当前固件不能报告刷新完成，请先升级 refresh-state 配套固件；没有发送刷新命令"));
  }
  async command(bytes, progress = () => {}) {
    this.requireRefreshStatus();
    // BUSY is only meaningful for refreshes; a sleeping panel may hold the pin active.
    const checkBusy = bytes[0] !== 6 && !(bytes[0] === 0x20 && bytes[6] === 0);
    const sequence = this.nextSequence();
    const done = this.wait(b => (b.length === 4 || b.length === 6) && b[0] === 0x51 && b[1] === bytes[0] && b[2] === sequence,
      OMI18n.t("设备处理回执（结果未确认，不会自动重发）"), 65000);
    progress(99, checkBusy ? OMI18n.t("设备正在处理，等待完成回执及 BUSY 状态") : OMI18n.t("等待设备命令处理回执"));
    try {
      await this.write(Uint8Array.of(...bytes, sequence));
      this.log(OMI18n.msg`已提交命令 0x${bytes[0].toString(16)}，序号=${sequence}`);
      const reply = await done.promise;
      if(reply[3]===0xA8 && reply.length===6 && reply[5]===0 && reply[4]>=1 && reply[4]<=5) {
        const message=["","SPI 传输失败，已停止刷新，蓝牙连接已保留","刷新计时器未运行，已停止刷新，蓝牙连接已保留","屏幕 BUSY 超时，刷新未确认，蓝牙连接已保留","电压采样超时，已停止刷新，蓝牙连接已保留","屏幕初始化失败，已停止刷新，蓝牙连接已保留"][reply[4]];
        const error=Error(OMI18n.t(message));error.code="DISPLAY_NOT_READY";throw error;
      }
      if (reply[3] & 4) {
        if (reply.length !== 6 || reply[3] !== 0xA4) throw Error(OMI18n.t("设备就绪状态回执无效"));
        const mv = reply[4] | (reply[5] << 8);
        const error = Error(OMI18n.t("供电不足，未开始刷新；实测电压 ") + (Math.round(mv/10)/100).toFixed(2) + OMI18n.t(" V。请更换电池或改用稳定供电。"));
        error.code = "DISPLAY_NOT_READY";
        error.millivolts = mv;
        throw error;
      }
      if ((reply[3] & 0x5C) || (!(reply[3] & 0x80) && reply[3] > 1)) throw Error(OMI18n.t("设备就绪状态回执无效"));
      if (checkBusy && (reply[3] & 3)) {
        const error=Error(OMI18n.t("屏幕仍忙，刷新未确认；蓝牙连接已保留"));
        error.code="DISPLAY_NOT_READY";throw error;
      }
      progress(100, checkBusy ? OMI18n.t("收到本次处理完成回执，屏幕 BUSY 已释放；请核对实物画面") : OMI18n.t("收到设备命令处理回执"));
    } catch (error) { done.cancel(error); throw error; }
  }
  async calendar(progress) {
    return this.mode(1, progress);
  }
  async mode(mode, progress, date = new Date(), allowFullClock = false) {
    const packet = OMProtocol.time(date, mode);
    if (mode === 2 && this.config?.model === 5 && allowFullClock !== true)
      throw Error(OMI18n.t("JD79668 原驱动没有局刷；须明确选择允许原版全刷时钟"));
    return this.operation(async () => {
      this.requireRefreshStatus();
      await this.waitForDisplay();
      await this.command(OMProtocol.time(date,0));
      await this.initialize();
      await this.command(packet, progress);
      this.config.mode = mode;
      this.log(OMI18n.t("已提交时间及") + [OMI18n.t("静态画面"), OMI18n.t("设备日历"), OMI18n.t("设备时钟"), OMI18n.t("设备相册")][mode] + OMI18n.t("模式"));
      await this.checkBoard();
      this.log(OMI18n.t("设备仍在线；日历是否正确显示请以实物为准"));
    });
  }
  async checkBoard() {
    const board = OMProtocol.board(await this.request(Uint8Array.of(0), b => b[0] === 0x42, OMI18n.t("核对设备")));
    if (!OMProtocol.independentBoard(board) || board.name !== this.board.name) throw Error(OMI18n.t("设备身份发生变化"));
  }
  async otaInspect() { return this.operation(() => OMOTA.inspect(this)); }
  async ota(pack, consent, progress) {
    return this.operation(async () => {
      this.otaActive = true; this.update();
      try {
        if(pack.bundle) return await OMOTA.upgradeBundle(this,pack,consent,progress);
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
    if (this.config?.model !== 5) throw Error(OMI18n.t("LED 控制仅用于当前 JD79668 四色屏"));
    return this.operation(async () => {
      await this.write(packet);
      await this.checkBoard();
      this.log(enabled ? OMI18n.t("已提交 LED 恢复正常指示，请查看灯光") : OMI18n.t("已提交关闭 LED，请查看灯光"));
    });
  }
  async waitForDisplay(panelReady = false) {
    const deadline=Date.now()+65000;let previous;
    for (;;) {
      const sequence=this.nextSequence();
      const state=await this.request(Uint8Array.of(0x24,sequence),b=>b.length===4 && b[0]===0x51 && b[1]===0x24 && b[2]===sequence,OMI18n.t("等待屏幕完成上次工作"),65000);
      const flags=state[3];
      if ((flags & 0x5C) || (!(flags & 0x80) && flags > 1)) throw Error(OMI18n.t("设备就绪状态回执无效"));
      if (flags!==previous) { this.log(OMI18n.t("屏幕就绪状态")+" 0x"+flags.toString(16));previous=flags; }
      const supported=!!(flags&0x80);
      this.lifecycleSupported=supported;
      this.timingSupported=!!(flags&0x20);
      if (supported && this.timingSupported && !(flags & (panelReady?3:2))) return;
      if (!supported || !this.timingSupported || Date.now()>=deadline) {
        const error=Error(OMI18n.t(supported && this.timingSupported?"屏幕仍未就绪，连接已保留；未提交新的刷新，请稍后重试":"当前固件缺少刷新计时恢复，请先升级固件 v9；没有发送屏幕初始化命令"));
        error.code="DISPLAY_NOT_READY";throw error;
      }
      await this.pause(250);
    }
  }
  async initialize() {
    await this.waitForDisplay();
    if(this.board?.name===OMProtocol.OTA_MARKER && this.firmwareRevision===null) await OMOTA.readRevision(this);
    const initialized = this.wait(b => OMProtocol.text(b).startsWith("t="), OMI18n.t("初始化屏幕"));
    const mtu = this.wait(b => /^mtu=\d+$/.test(OMProtocol.text(b)), OMI18n.t("读取传输大小"));
    try {
      if(this.firmwareRevision===18) { const error=Error(OMI18n.t("v18 过渡接收器只用于继续升级，请留在 OTA 页面"));error.code="DISPLAY_NOT_READY";throw error; }
      if(this.firmwareRevision>=19) await this.command(Uint8Array.of(0x25));
      else await this.write(Uint8Array.of(1));
      const size = Number(OMProtocol.text(await mtu.promise).slice(4));
      if (!Number.isInteger(size) || size < 20 || size > 512) throw Error(OMI18n.t("设备返回的传输大小无效"));
      this.payload = Math.min(size, this.transferPayload || 180);
      this.reportedPayload = size;
      this.log(OMI18n.t("原屏型初始化完成，设备回执 ") + OMProtocol.text(await initialized.promise));
      await this.waitForDisplay(true);
    } catch (error) { initialized.cancel(error); mtu.cancel(error); throw error; }
  }
  async style(layout, alternate, progress) {
    OMProtocol.integer(layout, 0, 6, OMI18n.t("日历版式")); OMProtocol.integer(alternate, 0, 1, OMI18n.t("布局版本"));
    if (this.calendarProtocol===2) return this.internationalCalendar(layout===6?0:layout,"zh",false,255,false,progress);
    return this.operation(async () => {
      this.requireRefreshStatus();
      // Pause native rendering while updating both style fields, then render once.
      const mode = this.config.mode || 1;
      await this.waitForDisplay();
      await this.command(OMProtocol.time(new Date(), 0));
      await this.initialize();
      await this.write(Uint8Array.of(0x21, layout));
      await this.write(Uint8Array.of(0x23, alternate));
      const reply = await this.request(Uint8Array.of(0x24), b => b.length === 2 && b[0] === 0x55, OMI18n.t("读取布局版本"));
      if (reply[1] !== alternate) throw Error(OMI18n.t("布局版本读回不符"));
      await this.command(OMProtocol.time(new Date(), mode), progress);
      this.config.layout = layout; this.config.alternate = alternate;
      await this.checkBoard();
    });
  }
  async readCalendar() {
    const sequence=this.nextSequence();
    const reply=await this.request(Uint8Array.of(0x24,0x4A,sequence),b=>
      (b.length===7 && b[0]===0x55 && b[2]===0x4A) ||
      (b.length===4 && b[0]===0x51 && b[1]===0x24 && b[2]===sequence),OMI18n.t("Read calendar settings"));
    this.calendarProtocol=reply.length===7 ? 2 : 0;
    if(this.calendarProtocol){
      if(reply[1]>7 || reply[3]>=6 || reply[4]>3 || reply[6]>1)throw Error(OMI18n.t("Invalid calendar settings"));
      Object.assign(this.config,{alternate:reply[1],layout:reply[3],mode:reply[4],photoSlot:reply[5],photoSource:reply[6]});
      this.log(OMI18n.msg`日历读回：国家=${reply[3]}，模式=${reply[4]}，标志=${reply[1]}，槽位=${reply[5]}`);
    }
    return this.calendarProtocol===2;
  }
  async internationalCalendar(country, language, photo, slot, external, progress, date = new Date(), fit="contain") {
    OMProtocol.integer(country,0,5,OMI18n.t("Country"));
    if (!["en","zh"].includes(language) || typeof photo!=="boolean" || typeof external!=="boolean") throw Error(OMI18n.t("Invalid calendar settings"));
    if(!["contain","prepared"].includes(fit))throw Error(OMI18n.t("Invalid calendar settings"));
    const region=OMCalendar.byId(country);
    if(!region)throw Error(OMI18n.t("Invalid calendar settings"));
    const code=region.code, option=(photo?1:0) | 2 | (photo && fit==="contain"?4:0);
    const time=OMProtocol.time(date,1,OMCalendar.zone(code,date));
    return this.operation(async()=>{
      this.requireRefreshStatus();
      if (!await this.readCalendar()) throw Error(OMI18n.t("Calendar configuration requires firmware revision 6 or later. Update firmware and reload this page."));
      await this.waitForDisplay();
      await this.command(OMProtocol.time(date,0,OMCalendar.zone(code,date)));
      await this.initialize();
      if(photo){
        OMProtocol.integer(slot,0,44,"Slot");
        const state=await this.storageState(external);
        if(slot>=state.count)throw Error(OMI18n.t("Slot exceeds actual capacity"));
        this.storedFormat(await this.slotMetadata(slot,external));
      }
      if(photo)await this.write(Uint8Array.of(0x56,slot,external?1:0));
      const presentation=await this.request(Uint8Array.of(0x24,0x4A,country,option,this.nextSequence()),
        b=>b.length===7 && b[0]===0x55 && b[2]===0x4A,OMI18n.t("Read calendar presentation"));
      if(presentation[1]!==option || presentation[3]!==country || (photo && (presentation[5]!==slot || presentation[6]!==Number(external))))throw Error(OMI18n.t("Calendar presentation readback mismatch"));
      this.log(OMI18n.t("日历样式已读回，开始刷新"));
      await this.waitForDisplay(true);
      await this.command(time,progress);
      this.config.layout=country;this.config.alternate=option;this.config.mode=1;
      if(photo){this.config.photoSlot=slot;this.config.photoSource=Number(external);}
      await this.readCalendar();
      await this.checkBoard();
    });
  }
  async storageState(external) {
    if (this.reportedPayload < 44) throw Error(OMI18n.t("图库状态需要至少 44 字节通知容量，请使用支持 MTU 协商的连接"));
    const opcode = external ? 0x51 : 0x46, marker = external ? 0x73 : 0x53;
    return OMProtocol.storage(await this.request(Uint8Array.of(opcode), b => b[0] === marker, OMI18n.t("读取图库")), external);
  }
  async slotMetadata(slot, external) {
    const marker = external ? 0x74 : 0x49;
    return OMProtocol.metadata(await this.request(Uint8Array.of(external ? 0x52 : 0x4B, slot),
      b => b[0] === marker && b[1] === slot, OMI18n.t("读取槽位")), slot, external);
  }
  storedFormat(row) {
    if (!row.valid || row.width !== 400 || row.height !== 300 || row.size !== 30000 ||
        row.color !== (this.config.model === 5 ? 3 : 2)) throw Error(OMI18n.t("槽位图片格式不符合当前屏型，已停止显示以保留设备数据"));
  }
  async gallery(external = false) {
    return this.operation(async () => {
      await this.initialize();
      const state = await this.storageState(external), slots = [];
      for (let slot = 0; slot < state.count; slot++) {
        const row = await this.slotMetadata(slot, external);
        if (row.valid && this.reportedPayload >= 66) {
          const reply = await this.request(Uint8Array.of(external ? 0x54 : 0x4A, slot),
            b => b[0] === (external ? 0x75 : 0x52) && b[1] === slot, OMI18n.t("读取备注"));
          if (reply.length !== 66) throw Error(OMI18n.t("备注长度不符"));
          row.remark = OMProtocol.remarkText(reply.subarray(2));
        }
        slots.push(row);
      }
      return {...state, slots};
    });
  }
  async store(frame, slot, external, progress) {
    const bytes = OMProtocol.imageBytes(frame, this.config?.model), crc = OMProtocol.crc16(bytes);
    OMProtocol.integer(slot, 0, 44, OMI18n.t("槽位"));
    return this.operation(async () => {
      await this.initialize();
      const state = await this.storageState(external);
      if (slot >= state.count || state.type !== (this.config.model === 5 ? 3 : 2)) throw Error(OMI18n.t("槽位或色彩格式不符"));
      const previous = await this.slotMetadata(slot, external);
      if (previous.valid) throw Error(OMI18n.t("此槽位已有图片。先备份所需内容并手动删除，再保存新图"));
      const start = new Uint8Array(7), view = new DataView(start.buffer);
      start[0] = external ? 0x4C : 0x40; start[1] = slot;
      view.setUint16(2, 400, true); view.setUint16(4, 300, true); start[6] = this.config.model === 5 ? 3 : 2;
      await this.write(start);
      for (let off = 0; off < bytes.length; off += this.payload - 1) {
        await this.write(Uint8Array.of(external ? 0x4D : 0x41, ...bytes.subarray(off, off + this.payload - 1)));
        progress(Math.min(99, Math.floor((off + this.payload - 1) / 300)), OMI18n.t("保存图片至空槽 ") + slot);
      }
      await this.write(Uint8Array.of(external ? 0x4E : 0x42));
      const row = await this.slotMetadata(slot, external);
      if (!row.valid || row.width !== 400 || row.height !== 300 || row.size !== bytes.length || row.crc !== crc || row.color !== start[6])
        throw Error(OMI18n.t("设备记录的图片长度、格式或 CRC 与发送内容不符；未提交显示"));
      this.log(OMI18n.t("槽位 ") + slot + OMI18n.t(" 已记录 30,000 字节及匹配 CRC；Flash 实际内容和显示仍需实机确认"));
      return row;
    });
  }
  async slotAction(action, slot, external, progress, remark = "") {
    OMProtocol.integer(slot, 0, 44, OMI18n.t("槽位"));
    if (!["display", "delete", "background", "remark"].includes(action)) throw Error(OMI18n.t("无效图库操作"));
    const text = action === "remark" ? OMProtocol.remarkBytes(remark) : null;
    return this.operation(async () => {
      if (action === "display" || action === "background") this.requireRefreshStatus();
      await this.initialize();
      const state = await this.storageState(external);
      if (slot >= state.count) throw Error(OMI18n.t("槽位超出实际容量"));
      const row = await this.slotMetadata(slot, external);
      if (!row.valid) throw Error(OMI18n.t("此槽位没有有效图片"));
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
        if ((await this.slotMetadata(slot, external)).valid) throw Error(OMI18n.t("槽位删除未获元数据确认"));
      } else {
        if (this.reportedPayload < 66) throw Error(OMI18n.t("备注读回需要至少 66 字节通知容量"));
        await this.write(Uint8Array.of(external ? 0x53 : 0x49, slot, ...text));
        const response = await this.request(Uint8Array.of(external ? 0x54 : 0x4A, slot),
          b => b[0] === (external ? 0x75 : 0x52) && b[1] === slot, OMI18n.t("核对备注"));
        if (response.length !== 66 || OMProtocol.remarkText(response.subarray(2)) !== remark) throw Error(OMI18n.t("备注读回不符"));
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
          if (mode === 2 && !row.valid) throw Error(OMI18n.t("星期映射中有空槽 ") + slot);
        }
        if (!valid) throw Error(OMI18n.t("轮播没有有效图片"));
      }
      await this.write(packet);
      const after = await this.storageState(external);
      if (after.mode !== mode || after.interval !== interval || after.days.some((s, i) => s !== days[i])) throw Error(OMI18n.t("轮播设置读回不符"));
      if (mode) {
        await this.command(OMProtocol.time(new Date(), 3), progress); this.config.mode = 3;
      }
      await this.checkBoard();
    });
  }
  async holidayRead() {
    if (this.reportedPayload < 82) throw Error(OMI18n.t("读取原调休表需要至少 82 字节通知容量"));
    const reply = await this.request(Uint8Array.of(0x48), b => b[0] === 0x48, OMI18n.t("读取调休表"));
    if (reply.length < 4 || reply.length !== 4 + reply[3] * 2) throw Error(OMI18n.t("调休表格式无效"));
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
        throw Error(OMI18n.t("调休表超出本连接单包容量；未修改设备"));
      await this.write(packet); const result = await this.holidayRead();
      if (result.year !== year || JSON.stringify(result.entries) !== JSON.stringify(entries)) throw Error(OMI18n.t("调休表读回不符"));
      return result;
    });
  }
  async publish(frame, progress) {
    if (!this.canPublish) throw Error(OMI18n.t("不支持的屏幕型号"));
    const fourcolor = this.config.model === 5;
    if (fourcolor ? !(frame.packed instanceof Uint8Array) || frame.packed.length !== 30000 :
        !(frame.black instanceof Uint8Array) || !(frame.red instanceof Uint8Array) ||
        frame.black.length !== 15000 || frame.red.length !== 15000) throw Error(OMI18n.t("像素格式或长度与屏型不符"));
    return this.operation(async () => {
      this.requireRefreshStatus();
      await this.waitForDisplay();
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
          progress(Math.floor(sent / 300), OMI18n.msg`已发送 ${sent.toLocaleString()} / 30,000 字节`);
        }
      }
      await this.command(Uint8Array.of(5), progress);
      this.log((fourcolor ? OMI18n.t("四色像素") : OMI18n.t("双层像素")) + OMI18n.t("已获 GATT 写入确认，已提交原驱动全刷"));
      await this.command(Uint8Array.of(6), () => {});
      await this.checkBoard();
      this.log(OMI18n.t("已请求屏幕休眠；实物画面请人工确认"));
    });
  }
}
