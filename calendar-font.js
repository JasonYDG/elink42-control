"use strict";
const OMCalendarFont = (() => {
  const script = new URL(document.currentScript.src), pending = new Map(), faces = new Map();
  async function load(size = 12) {
    if (![10, 12].includes(size)) throw Error("日历字库仅支持10和12像素");
    if (!pending.has(size)) pending.set(size, (async () => {
      const asset = new URL(`fonts/fusion-pixel-${size}px-monospaced-zh_hans.bdf.gz`, script); asset.search = script.search;
      const response = await fetch(asset);
      if (!response.ok) throw Error("无法加载日历字库");
      const text = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).text();
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
  const glyph = (c, size) => faces.get(size).get(c) || faces.get(size).get("?");
  const measure = (text, scale = 1, size = 12) => [...String(text)].reduce((width, c) => width + glyph(c, size).advance * scale, 0);
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
      for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) if (g.rows[row] & (1 << (size - 1 - col))) ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
      x += g.advance * scale;
    }
  }
  const has = (value,size=12) => faces.get(size)?.has(value) || false;
  return {load, measure, fit, draw,has};
})();
