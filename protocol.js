"use strict";
// OM6626Full-261008 with the hash-pinned Web 0.1.0 firmware patch.
const OMProtocol = (() => {
  const SERVICE = "eccb3c47-dafc-3296-ba96-605efd44e4ac";
  const CONTROL = "6bc61b23-f80f-3979-b2b1-a6f823bc8064";
  const MARKER = "BOARD_ZKWEB";
  const OTA_MARKER = "BOARD_ELINK";
  const independentBoard = board => board?.id === 1 && [MARKER, "BOARD_ZKOTA", OTA_MARKER].includes(board.name);
  const WIDTH = 400, HEIGHT = 300, PLANE_BYTES = 15000;
  const FOUR_COLORS = [[0, 0, 0], [255, 255, 255], [255, 210, 0], [184, 25, 40]];
  const text = bytes => new TextDecoder().decode(bytes).replace(/\0.*$/s, "");
  function board(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes[0] !== 0x42 || bytes.length < 3 || bytes.length > 18)
      throw Error("板型回执格式不符");
    return {id: bytes[1], name: text(bytes.subarray(2))};
  }
  function config(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 15) throw Error("配置回执必须是 15 字节");
    return {raw: bytes.slice(), model: bytes[7], mode: bytes[11], layout: bytes[12], alternate: bytes[14]};
  }
  function time(date = new Date(), mode = 1) {
    const seconds = Math.floor(date.getTime() / 1000), zone = -date.getTimezoneOffset() / 60;
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 0xFFFFFFFF) throw Error("日期超出固件范围");
    // shortcut: this firmware accepts whole-hour timezones; reject fractional offsets.
    if (!Number.isInteger(zone) || zone < -12 || zone > 14) throw Error("原固件只支持整小时时区");
    if (![0, 1, 2, 3].includes(mode)) throw Error("显示模式必须为 0–3");
    const bytes = new Uint8Array(7);
    bytes[0] = 0x20;
    new DataView(bytes.buffer).setUint32(1, seconds, false);
    bytes[5] = zone & 255;
    bytes[6] = mode;
    return bytes;
  }
  function led(enabled) {
    if (typeof enabled !== "boolean") throw Error("LED 开关必须是布尔值");
    return Uint8Array.of(0x93, enabled ? 1 : 0);
  }
  function planes(rgba, rotate = false, model = 2) {
    if (!(rgba instanceof Uint8ClampedArray) || rgba.length !== WIDTH * HEIGHT * 4)
      throw Error("只接受 400 × 300 RGBA 像素");
    if (![2, 5].includes(model)) throw Error("不支持的屏幕型号");
    if (model === 5) {
      const packed = new Uint8Array(PLANE_BYTES * 2);
      for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
        const off = pixel * 4, alpha = rgba[off + 3] / 255;
        const rgb = [0, 1, 2].map(i => Math.round(rgba[off + i] * alpha + 255 * (1 - alpha)));
        let color = 0, distance = Infinity;
        FOUR_COLORS.forEach((candidate, index) => {
          const value = candidate.reduce((sum, channel, i) => sum + (rgb[i] - channel) ** 2, 0);
          if (value < distance) { distance = value; color = index; }
        });
        const dst = rotate ? WIDTH * HEIGHT - 1 - pixel : pixel;
        packed[dst >> 2] |= color << (6 - (dst & 3) * 2);
      }
      return {packed};
    }
    const black = new Uint8Array(PLANE_BYTES).fill(255), red = black.slice();
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
      const off = pixel * 4, alpha = rgba[off + 3] / 255;
      const [r, g, b] = [0, 1, 2].map(i => Math.round(rgba[off + i] * alpha + 255 * (1 - alpha)));
      const dst = rotate ? WIDTH * HEIGHT - 1 - pixel : pixel;
      const mask = 0x80 >> (dst & 7);
      if (r > 105 && r > g * 1.35 && r > b * 1.35) red[dst >> 3] &= ~mask;
      else if (r * 0.299 + g * 0.587 + b * 0.114 < 160) black[dst >> 3] &= ~mask;
    }
    return {black, red};
  }
  function rgba({black, red, packed}) {
    if (packed !== undefined) {
      if (!(packed instanceof Uint8Array) || packed.length !== PLANE_BYTES * 2) throw Error("四色像素长度不符");
      const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
      for (let i = 0; i < WIDTH * HEIGHT; i++)
        pixels.set([...FOUR_COLORS[(packed[i >> 2] >> (6 - (i & 3) * 2)) & 3], 255], i * 4);
      return pixels;
    }
    if (black.length !== PLANE_BYTES || red.length !== PLANE_BYTES) throw Error("色层长度不符");
    const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      const bit = 0x80 >> (i & 7), isRed = !(red[i >> 3] & bit), isBlack = !(black[i >> 3] & bit);
      pixels.set(isRed ? [184, 25, 40, 255] : isBlack ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
    }
    return pixels;
  }
  function integer(value, min, max, label) {
    if (!Number.isInteger(value) || value < min || value > max) throw Error(label + "超出范围");
    return value;
  }
  function crc16(bytes) {
    let crc = 0xFFFF;
    for (const byte of bytes) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 65535;
    }
    return crc;
  }
  let remarkCodes;
  function remarkBytes(text) {
    if (typeof text !== "string") throw Error("备注必须是文字");
    if (!remarkCodes) {
      remarkCodes = new Map();
      for (let i = 0; i < OMCharset.length; i++) if (OMCharset[i] !== "\0") remarkCodes.set(OMCharset[i], [0xA1 + Math.floor(i / 94), 0xA1 + i % 94]);
    }
    const bytes = [];
    for (const char of text) {
      const code = char.codePointAt(0);
      if (code > 0 && code < 128) bytes.push(code);
      else if (remarkCodes.has(char)) bytes.push(...remarkCodes.get(char));
      else throw Error("备注包含设备 GB2312 无法编码的字符：" + char);
    }
    if (bytes.length > 64) throw Error("备注最多 64 字节（GB2312 汉字 2 字节）");
    return Uint8Array.from(bytes);
  }
  function remarkText(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]; if (!byte || byte === 255) break;
      if (byte < 128) out += String.fromCharCode(byte);
      else {
        const next = bytes[++i], index = (byte - 0xA1) * 94 + next - 0xA1;
        if (byte < 0xA1 || byte > 0xF7 || next < 0xA1 || next > 0xFE || !OMCharset[index] || OMCharset[index] === "\0")
          throw Error("设备备注含无法解析的 GB2312 字节，已停止以保留原内容");
        out += OMCharset[index];
      }
    }
    return out;
  }
  function storage(bytes, external = false) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 36 || bytes[0] !== (external ? 0x73 : 0x53) ||
        bytes.length !== 36 + bytes[1] || text(bytes.subarray(2, 6)) !== "EIMG") throw Error("图库状态格式无效或尚未初始化");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const state = {external, width: view.getUint16(6, true), height: view.getUint16(8, true),
      type: bytes[10], panel: bytes[11], imageBytes: view.getUint32(12, true), slotBytes: view.getUint32(16, true),
      count: bytes[20], current: bytes[21], mode: bytes[22], interval: bytes[23], cursor: bytes[24],
      days: [...bytes.slice(25, 32)], last: view.getUint32(32, true)};
    if (state.width !== WIDTH || state.height !== HEIGHT || state.count > 45 || !state.count ||
        state.imageBytes !== 30000 || state.slotBytes !== 32768 ||
        (!external && state.slotBytes * state.count > 0xB6000)) throw Error("设备图库容量或画面格式不符合本屏，已停止写入");
    return state;
  }
  function metadata(bytes, slot, external = false) {
    integer(slot, 0, 44, "槽位");
    if (!(bytes instanceof Uint8Array) || bytes.length !== 18 || bytes[0] !== (external ? 0x74 : 0x49) || bytes[1] !== slot)
      throw Error("图片元数据格式无效");
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {slot, valid: bytes[2] === 1, color: bytes[3], width: v.getUint16(4, true), height: v.getUint16(6, true),
      size: v.getUint32(8, true), crc: v.getUint16(12, true)};
  }
  function imageBytes(frame, model) {
    if (model === 5 && frame.packed instanceof Uint8Array && frame.packed.length === 30000) return frame.packed.slice();
    if (model === 2 && frame.black instanceof Uint8Array && frame.red instanceof Uint8Array &&
        frame.black.length === 15000 && frame.red.length === 15000) {
      const bytes = new Uint8Array(30000); bytes.set(frame.black); bytes.set(frame.red, 15000); return bytes;
    }
    throw Error("像素格式或长度与屏型不符");
  }
  function rotation(mode, interval, days, count, external = false) {
    integer(mode, 0, 2, "轮播模式"); integer(interval, 1, 255, "间隔分钟"); integer(count, 1, 45, "槽位数量");
    if (!Array.isArray(days) || days.length !== 7) throw Error("请提供周日至周六的七个槽位");
    for (const slot of days) if (slot !== 255) integer(slot, 0, count - 1, "星期槽位");
    return Uint8Array.of(external ? 0x55 : 0x44, mode, interval, ...days);
  }
  function holidays(year, entries) {
    integer(year, 1970, 2105, "年份");
    if (!Array.isArray(entries) || !entries.length || entries.length > 120) throw Error("调休表需要 1–120 项");
    const bytes = new Uint8Array(3 + entries.length * 2), view = new DataView(bytes.buffer);
    bytes[0] = 0x47; view.setUint16(1, year, true);
    const seen = new Set();
    entries.forEach((row, i) => {
      integer(row.month, 1, 12, "月份"); integer(row.day, 1, 31, "日期");
      if (typeof row.off !== "boolean" || new Date(year, row.month - 1, row.day).getMonth() !== row.month - 1 ||
          seen.has(row.month * 32 + row.day)) throw Error("调休日期重复或无效");
      seen.add(row.month * 32 + row.day);
      view.setUint16(3 + i * 2, (row.off ? 0x1000 : 0) | (row.month << 8) | row.day, true);
    });
    return bytes;
  }
  return {SERVICE, CONTROL, MARKER, OTA_MARKER, independentBoard, WIDTH, HEIGHT, PLANE_BYTES, FOUR_COLORS, text, board, config, time, led,
    planes, rgba, integer, crc16, remarkBytes, remarkText, storage, metadata, imageBytes, rotation, holidays};
})();
