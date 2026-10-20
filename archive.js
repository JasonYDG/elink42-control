"use strict";
const OMArchive = (() => {
  const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", {fatal: true});
  function crc32(bytes, previous = 0) {
    let crc = (previous ^ 0xFFFFFFFF) >>> 0;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0); }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function pack(spec) {
    OMFeatures.template(spec);
    const files = {"manifest.json": JSON.stringify({format: "om6626-web-template", version: 1, appVersion: "0.5.3"}), "template.json": JSON.stringify(spec)};
    const local = [], central = []; let offset = 0;
    for (const [name, text] of Object.entries(files)) {
      const key = encoder.encode(name), data = encoder.encode(text), crc = crc32(data);
      const head = new Uint8Array(30 + key.length), h = new DataView(head.buffer);
      h.setUint32(0, 0x04034B50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, key.length, true); head.set(key, 30);
      const dir = new Uint8Array(46 + key.length), d = new DataView(dir.buffer);
      d.setUint32(0, 0x02014B50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true);
      d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, key.length, true);
      d.setUint32(42, offset, true); dir.set(key, 46);
      local.push(head, data); central.push(dir); offset += head.length + data.length;
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer), directoryBytes = central.reduce((s, b) => s + b.length, 0);
    if (offset + directoryBytes + 22 > 4000000) throw Error("模板压缩包超过 4 MB，请减少内嵌图片");
    e.setUint32(0, 0x06054B50, true); e.setUint16(8, 2, true); e.setUint16(10, 2, true); e.setUint32(12, directoryBytes, true); e.setUint32(16, offset, true);
    return new Blob([...local, ...central, end], {type: "application/zip"});
  }
  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 22 || bytes.length > 4000000) throw Error("模板压缩包大小无效（最大 4 MB）");
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054B50) end--;
    if (end < 0 || view.getUint32(end, true) !== 0x06054B50 || end + 22 + view.getUint16(end + 20, true) !== bytes.length ||
        view.getUint32(end + 4, true) !== 0) throw Error("模板 ZIP 目录无效");
    const count = view.getUint16(end + 10, true), directory = view.getUint32(end + 16, true);
    if (count < 2 || count > 40 || view.getUint16(end + 8, true) !== count || directory + view.getUint32(end + 12, true) !== end)
      throw Error("模板 ZIP 条目无效");
    const files = new Map(); let pos = directory, total = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014B50) throw Error("模板 ZIP 中央目录损坏");
      const method = view.getUint16(pos + 10, true), packed = view.getUint32(pos + 20, true), size = view.getUint32(pos + 24, true);
      const n = view.getUint16(pos + 28, true), extra = view.getUint16(pos + 30, true), comment = view.getUint16(pos + 32, true);
      const start = view.getUint32(pos + 42, true), expected = view.getUint32(pos + 16, true);
      total += size;
      if (total > 8000000 || pos + 46 + n + extra + comment > end || start + 30 > directory ||
          view.getUint32(start, true) !== 0x04034B50 || (view.getUint16(pos + 8, true) & 1) || ![0, 8].includes(method)) throw Error("模板 ZIP 尺寸或压缩方式无效");
      const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + n));
      if (files.has(name) || name.includes("..") || name.startsWith("/") || name.includes("\\")) throw Error("模板 ZIP 路径无效");
      const dataStart = start + 30 + view.getUint16(start + 26, true) + view.getUint16(start + 28, true);
      if (dataStart + packed > directory || view.getUint16(start + 8, true) !== method ||
          view.getUint16(start + 6, true) !== view.getUint16(pos + 8, true) ||
          decoder.decode(bytes.subarray(start + 30, start + 30 + view.getUint16(start + 26, true))) !== name)
        throw Error("ZIP 本地目录不匹配或数据越界");
      let raw = bytes.slice(dataStart, dataStart + packed);
      if (method === 8) {
        const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
        const chunks = []; let length = 0;
        for (;;) { const {value, done} = await reader.read(); if (done) break; length += value.length;
          if (length > size || length > 8000000) { await reader.cancel(); throw Error("模板解压长度超限"); } chunks.push(value); }
        raw = new Uint8Array(length); let cursor = 0; for (const chunk of chunks) { raw.set(chunk, cursor); cursor += chunk.length; }
      }
      if (raw.length !== size || crc32(raw) !== expected) throw Error("模板 ZIP 长度或 CRC 不符");
      files.set(name, raw); pos += 46 + n + extra + comment;
    }
    if (pos !== end) throw Error("ZIP 目录长度不符");
    return files;
  }
  async function unpack(buffer) {
    const files = await unzip(buffer);
    if (!files.has("manifest.json") || !files.has("template.json")) throw Error("模板缺少 manifest.json / template.json");
    const manifest = JSON.parse(decoder.decode(files.get("manifest.json")));
    if (manifest.format !== "om6626-web-template" || manifest.version !== 1)
      throw Error("此文件不是已验证的网页模板格式。原 APK 模板 schema 尚未完整恢复，已保留原文件");
    return OMFeatures.template(JSON.parse(decoder.decode(files.get("template.json"))));
  }
  return {pack, unpack, unzip, crc32};
})();
