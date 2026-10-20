"use strict";
const OMRender = (() => {
  const FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
  function start(canvas) {
    const ctx = canvas.getContext("2d", {willReadFrequently: true});
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 400, 300);
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.fillStyle = "black"; ctx.strokeStyle = "black"; ctx.lineWidth = 1;
    return ctx;
  }
  function line(ctx, x, y, x2, y2) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke(); }
  function fit(ctx, text, width) {
    const letters = [...text];
    while (letters.length && ctx.measureText(letters.join("")).width > width) letters.pop();
    return letters.length < [...text].length ? letters.slice(0, -1).join("") + "…" : text;
  }
  function todo(canvas, title, text) {
    const ctx = start(canvas), rows = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (rows.length > 7) throw Error("一屏最多 7 项待办，请减少行数");
    ctx.font = `bold 22px ${FONT}`; ctx.fillStyle = "#b81928";
    ctx.fillText(fit(ctx, title.trim() || "今日待办", 350), 20, 30);
    ctx.fillStyle = "black"; line(ctx, 20, 53, 380, 53);
    if (!rows.length) { ctx.font = `16px ${FONT}`; ctx.fillText("在左上方输入待办，每行一项", 20, 88); }
    rows.forEach((row, i) => {
      const done = /^\[x\]\s*/i.test(row), label = row.replace(/^\[(x| )\]\s*/i, "");
      const y = 79 + i * 28;
      ctx.strokeRect(21, y - 7, 13, 13);
      if (done) { line(ctx, 23, y, 27, y + 4); line(ctx, 27, y + 4, 33, y - 5); }
      ctx.font = `16px ${FONT}`; const fitted = fit(ctx, label, 330); ctx.fillText(fitted, 44, y);
      if (done) line(ctx, 44, y, 44 + ctx.measureText(fitted).width, y);
    });
    line(ctx, 20, 275, 380, 275); ctx.font = `11px ${FONT}`;
    ctx.fillText(`${rows.filter(row => /^\[x\]/i.test(row)).length} / ${rows.length} 已完成`, 20, 288);
  }
  function image(canvas, bitmap, options = {}) {
    const ctx = start(canvas);
    if (!bitmap) { ctx.font = `16px ${FONT}`; ctx.textAlign = "center"; ctx.fillText("选择图片后在此预览", 200, 150); return; }
    const angle = options.angle || 0, swapped = angle % 180 !== 0;
    const w = swapped ? bitmap.height : bitmap.width, h = swapped ? bitmap.width : bitmap.height;
    const scale = (options.fit === "cover" ? Math.max : Math.min)(400 / w, 300 / h) * (options.zoom || 1);
    ctx.save(); ctx.translate(200 + (options.x || 0), 150 + (options.y || 0)); ctx.rotate(angle * Math.PI / 180);
    ctx.drawImage(bitmap, -bitmap.width * scale / 2, -bitmap.height * scale / 2, bitmap.width * scale, bitmap.height * scale); ctx.restore();
  }
  const COLORS = {black: "#000", white: "#fff", red: "#b81928", yellow: "#ffd200"};
  function textBlock(ctx, text, x, y, width, height, size) {
    ctx.font = `${size}px ${FONT}`; ctx.textBaseline = "top";
    let row = "", top = y;
    const flush = () => { if (top + size <= y + height) ctx.fillText(row, x, top); row = ""; top += size * 1.35; };
    for (const char of text) {
      if (char === "\n") { flush(); continue; }
      if (row && ctx.measureText(row + char).width > width) flush();
      row += char;
    }
    flush();
  }
  function todos(canvas, items, title, settings, single = false) {
    const ctx = start(canvas), size = settings.fontSize, now = Date.now();
    ctx.fillStyle = COLORS.red; textBlock(ctx, title || "待办清单", 18, 15, 365, 35, 24);
    line(ctx, 18, 56, 382, 56);
    const shown = single ? items.slice(0, 1) : items;
    let y = 70;
    for (const item of shown) {
      const urgent = !item.done && item.due && Date.parse(item.due) - now <= settings.urgentHours * 3600000;
      const detail = [item.description, item.due ? "截止 " + new Date(item.due).toLocaleString("zh-CN") : ""].filter(Boolean).join("\n");
      const height = single ? 185 : size * (detail ? 3.5 : 1.7);
      if (y + height > 274) throw Error("待办超出一屏，请选择单项或减少内容/字号");
      ctx.fillStyle = urgent ? COLORS.red : COLORS.black;
      textBlock(ctx, `${item.done ? "☑" : "□"} ${item.title}`, 20, y, 360, single ? 60 : size * 1.4, single ? 26 : size);
      if (detail) textBlock(ctx, detail, 40, y + (single ? 65 : size * 1.5), 338, height - size * 1.5, Math.max(10, size - 3));
      y += height;
    }
    if (!shown.length) { ctx.fillStyle = COLORS.black; textBlock(ctx, "暂无待办事项", 20, 80, 360, 60, size); }
    ctx.fillStyle = COLORS.black; textBlock(ctx, `${items.filter(t => t.done).length} / ${items.length} 已完成`, 20, 280, 360, 20, 11);
  }
  function course(canvas, text, weekday, size = 16) {
    const ctx = start(canvas); ctx.fillStyle = COLORS.red;
    textBlock(ctx, "星期" + "日一二三四五六"[weekday] + " · 课程 / 日程", 20, 16, 360, 40, 24);
    line(ctx, 20, 58, 380, 58); ctx.fillStyle = COLORS.black;
    const rows = text.split("\n").filter(Boolean);
    if (rows.length * size * 1.8 > 210 || rows.some(row => ctx.measureText(row).width > 1600)) throw Error("当天课表内容过多");
    textBlock(ctx, rows.join("\n"), 20, 78, 360, 200, size);
  }
  function weatherIcon(ctx, text, x, y, w, h, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(w / 100, h / 100); ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = 4;
    if (/雨|雪|雷|rain|snow|thunder/i.test(text)) {
      ctx.beginPath(); ctx.arc(50, 32, 23, Math.PI, 0); ctx.lineTo(86, 60); ctx.lineTo(15, 60); ctx.closePath(); ctx.fill();
      for (let i = 0; i < 4; i++) line(ctx, 25 + i * 17, 72, 19 + i * 17, 88);
    } else if (/云|阴|cloud|overcast/i.test(text)) {
      ctx.beginPath(); ctx.arc(45, 42, 28, Math.PI, 0); ctx.arc(72, 53, 19, -Math.PI/2, Math.PI/2); ctx.lineTo(17, 72); ctx.arc(17, 55, 17, Math.PI/2, -Math.PI/2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(50, 50, 22, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line(ctx, 50 + Math.cos(a) * 32, 50 + Math.sin(a) * 32, 50 + Math.cos(a) * 44, 50 + Math.sin(a) * 44); }
    }
    ctx.restore();
  }
  function weather(canvas, data) {
    if (!data) throw Error("请先获取天气");
    OMFeatures.weather(data);
    const ctx = start(canvas); ctx.fillStyle = COLORS.red;
    textBlock(ctx, data.city + " · 天气", 20, 14, 360, 35, 24); line(ctx, 20, 55, 380, 55);
    ctx.fillStyle = COLORS.black;
    textBlock(ctx, `${data.current?.temperature ?? "—"}°`, 20, 70, 220, 65, 48);
    textBlock(ctx, data.current?.text || "", 20, 140, 240, 38, 24);
    weatherIcon(ctx, data.current?.text || "", 265, 70, 105, 105, COLORS.red);
    data.days.slice(0, 3).forEach((day, i) => textBlock(ctx, `${day.date}\n${day.text}\n${day.low}–${day.high}°`, 20 + i * 123, 194, 117, 73, 13));
    textBlock(ctx, "数据更新 " + new Date(data.updated).toLocaleString("zh-CN"), 20, 282, 360, 16, 10);
  }
  async function template(canvas, spec, context) {
    OMFeatures.template(spec);
    const images = new Map();
    try {
      for (const item of spec.elements.filter(e => e.type === "image")) {
        const blob = await (await fetch(item.src)).blob(), bitmap = await createImageBitmap(blob);
        if (bitmap.width * bitmap.height > 16000000) { bitmap.close(); throw Error("模板图片像素过大"); }
        images.set(item, bitmap);
      }
      const ctx = start(canvas);
      for (const e of spec.elements) {
        ctx.save(); ctx.beginPath(); ctx.rect(e.x, e.y, e.width, e.height); ctx.clip();
        ctx.fillStyle = ctx.strokeStyle = COLORS[e.color];
        if (e.type === "text") textBlock(ctx, OMFeatures.placeholders(e.text, context), e.x, e.y, e.width, e.height, e.fontSize);
        if (e.type === "rect") { if (e.outline) ctx.strokeRect(e.x, e.y, e.width, e.height); else ctx.fillRect(e.x, e.y, e.width, e.height); }
        if (e.type === "line") line(ctx, e.x, e.y, e.x + e.width, e.y + e.height);
        if (e.type === "image") ctx.drawImage(images.get(e), e.x, e.y, e.width, e.height);
        if (e.type === "weather") weatherIcon(ctx, context.weather?.current?.text || "", e.x, e.y, e.width, e.height, COLORS[e.color]);
        ctx.restore();
      }
    } finally { for (const bitmap of images.values()) bitmap.close(); }
  }
  return {todo, todos, image, course, weather, template, textBlock};
})();
