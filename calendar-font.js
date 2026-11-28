"use strict";
const OMCalendarFont = (() => {
  const script = new URL(document.currentScript.src), pending = new Map(), faces = new Map();
  const browserGlyphs = new Map();
  const nativeStrikes = new Map();
  let browserContext;
  async function readBdf(name) {
    const asset = new URL(`fonts/${name}`, script); asset.search = script.search;
    const response = await fetch(asset);
    if (!response.ok) throw Error("无法加载日历字库");
    return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).text();
  }
  async function load(size = 12) {
    if (![10, 12].includes(size)) throw Error("日历字库仅支持10和12像素");
    if (!pending.has(size)) pending.set(size, (async () => {
      const text = await readBdf(`fusion-pixel-${size}px-monospaced-zh_hans.bdf.gz`);
      const next = new Map();
      for (const block of text.split("STARTCHAR ").slice(1)) {
        const encoding = block.match(/\nENCODING (\d+)/);
        if (!encoding) continue;
        const [w, h, left, bottom] = block.match(/\nBBX (\d+) (\d+) (-?\d+) (-?\d+)/).slice(1).map(Number);
        const rows = new Uint16Array(size), bitmap = block.match(/\nBITMAP\n([\s\S]*?)ENDCHAR/)[1].trim().split(/\r?\n/);
        bitmap.forEach((bits, y) => {
          const top = (size === 10 ? 9 : 10) - bottom - h + y, value = parseInt(bits, 16);
          if (top < 0 || top >= size) return;
          for (let x = 0; x < w; x++) if (left + x >= 0 && left + x < size && value & (1 << (Math.ceil(w / 8) * 8 - 1 - x))) rows[top] |= 1 << (size - 1 - left - x);
        });
        next.set(String.fromCodePoint(Number(encoding[1])), {advance: Number(block.match(/\nDWIDTH (\d+)/)[1]), rows});
      }
      if (!next.has("?") || !next.has("日") || !next.has("股")) throw Error("日历字库不完整");
      faces.set(size, next);
    })().catch(error => { pending.delete(size); throw error; }));
    await pending.get(size);
  }
  function nativeStrike(name) {
    if (!nativeStrikes.has(name)) nativeStrikes.set(name, readBdf(name).then(text => {
      const glyphs = new Map();
      for (const block of text.split("STARTCHAR ").slice(1)) {
        const code = block.match(/^ENCODING (\d+)\s*$/m);
        if (code) glyphs.set(Number(code[1]), block);
      }
      if (!glyphs.has(65)) throw Error("点阵字库不完整");
      return glyphs;
    }).catch(error => { nativeStrikes.delete(name); throw error; }));
    return nativeStrikes.get(name);
  }
  function nativeGlyph(strike, code, face, baseline) {
    const block = strike.get(code), value = String.fromCodePoint(code);
    if (!block) throw Error("点阵字库不支持字符：" + value);
    const [w, h, x, bottom] = block.match(/^BBX (\d+) (\d+) (-?\d+) (-?\d+)\s*$/m).slice(1).map(Number);
    const advance = Number(block.match(/^DWIDTH (\d+) 0\s*$/m)[1]) * 64;
    const rows = block.split(/^BITMAP[ \t]*\r?\n/m)[1].split("ENDCHAR")[0].trim().split(/\s+/);
    const pitch = Math.ceil(w / 8), bits = new Uint8Array(pitch * h);
    if (w > 40 || h > 40 || !advance || advance > 4096 || rows.length !== h || (!w && code !== 32)) throw Error("字体无法在设备上显示：" + value);
    rows.forEach((row, y) => {
      for (let b = 0; b < pitch; b++) bits[y * pitch + b] = parseInt(row.slice(b * 2, b * 2 + 2), 16);
    });
    return {code, face, w, h, pitch, x, y: baseline - bottom - h, advance, bits};
  }
  const glyph = (c, size) => faces.get(size).get(c) || faces.get(size).get("?");
  const measure = (text, scale = 1, size = 12) => [...String(text)].reduce((width, c) => width + (scale === 1 ? glyph(c, size).advance : browserGlyph(c.codePointAt(0), size * scale).advance / 64), 0);
  function fit(text, width, scale = 1, size = 12) {
    const chars = [...String(text)];
    if (measure(text, scale, size) <= width) return text;
    while (chars.length && measure(chars.join("") + "…", scale, size) > width) chars.pop();
    return chars.join("") + "…";
  }
  function draw(ctx, text, x, y, scale = 1, align = "left", size = 12) {
    x = Math.round(x - (align === "right" ? measure(text, scale, size) : align === "center" ? measure(text, scale, size) / 2 : 0));
    y = Math.round(y);
    for (const c of String(text)) {
      const g = glyph(c, size);
      if (scale === 1) {
        for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) if (g.rows[row] & (1 << (size - 1 - col))) ctx.fillRect(x + col, y + row, 1, 1);
      } else {
        const r = browserGlyph(c.codePointAt(0), size * scale);
        for (let row = 0; row < r.h; row++) for (let col = 0; col < r.w; col++) if (r.bits[row * r.pitch + (col >> 3)] & (128 >> (col & 7))) ctx.fillRect(Math.round(x) + r.x + col, y + size * scale / 2 + r.y + row, 1, 1);
      }
      x += scale === 1 ? g.advance : browserGlyph(c.codePointAt(0), size * scale).advance / 64;
    }
  }
  const has = (value,size=12) => faces.get(size)?.has(value) || false;
  function browserGlyph(code, size, weight = size === 36 ? 600 : 400) {
    const key = `${size}:${weight}:${code}`;
    if (browserGlyphs.has(key)) return browserGlyphs.get(key);
    if (!browserContext) {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 96;
      browserContext = canvas.getContext("2d", {willReadFrequently: true});
    }
    const ctx = browserContext, value = String.fromCodePoint(code);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 96, 96);
    ctx.font = `${weight} ${size}px ${code < 128 ? '"Bahnschrift", ' : ''}"Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = "#000"; ctx.fillText(value, 32, 48);
    const advance = Math.round(ctx.measureText(value).width * 64), rgba = ctx.getImageData(0, 0, 96, 96).data;
    let left = 96, top = 96, right = -1, bottom = -1;
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (rgba[(y * 96 + x) * 4] < 128) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    const w = right < 0 ? 0 : right - left + 1, h = bottom < 0 ? 0 : bottom - top + 1, pitch = Math.ceil(w / 8), bits = new Uint8Array(h * pitch);
    if (!advance || advance > 4096 || w > 40 || h > 40 || (code !== 32 && !w) || (w && (left - 32 < -16 || left - 32 > 16 || Math.abs(top - 48) > 40))) throw Error("字体无法在设备上显示：" + value);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[((top + y) * 96 + left + x) * 4] < 128) bits[y * pitch + (x >> 3)] |= 128 >> (x & 7);
    const g = {w, h, pitch, x: w ? left - 32 : 0, y: h ? top - 48 : 0, advance, bits};
    browserGlyphs.set(key, g); return g;
  }
  function raster(code, face, size = 12, scale = 1, weight) {
    const value = String.fromCodePoint(code);
    if (![1, 2, 3].includes(scale)) throw Error("点阵字形仅支持整数倍缩放");
    if (scale > 1) return {code, face, ...browserGlyph(code, size * scale, weight)};
    if (!has(value, size)) throw Error("点阵字库不支持字符：" + value);
    const g = glyph(value, size);
    let left = size, top = size, right = -1, bottom = -1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (g.rows[y] & (1 << (size - 1 - x))) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    const w = right < 0 ? 0 : right - left + 1, h = bottom < 0 ? 0 : bottom - top + 1;
    const pitch = Math.ceil(w / 8), bits = new Uint8Array(h * pitch);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (g.rows[top + y] & (1 << (size - 1 - left - x))) bits[y * pitch + (x >> 3)] |= 128 >> (x & 7);
    return {code, face, w, h, pitch, x: w ? left : 0, y: h ? top - size / 2 : 0, advance: g.advance * 64, bits};
  }
  return {load, measure, fit, draw, has, raster, nativeStrike, nativeGlyph};
})();
