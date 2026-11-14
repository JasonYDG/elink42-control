"use strict";
const OMPlanner = (() => {
  const bytes = 30000, capability = 32;
  const width = text => [...text].reduce((n, c) => n + (c.codePointAt(0) < 128 ? 6 : 12), 0);
  const clean = text => String(text || "").replace(/\s+/gu, " ").trim();
  function lessons(text, day) {
    const rows = String(text).split(/\r?\n/).map(clean).filter(Boolean);
    if (rows.length > 8) throw Error(`星期${"日一二三四五六"[day]}超过8节；大字课表不会省略课程，请先调整当天内容。`);
    return rows.map(line => {
      const match = line.match(/^((?:[01]?\d|2[0-3]):[0-5]\d)(?:\s*[-~–]\s*((?:[01]?\d|2[0-3]):[0-5]\d))?\s+(.+)$/u);
      if (!match && /^\d.*:/u.test(line)) throw Error("课程时间格式应为 08:00-08:45 语文，或 08:00 语文。");
      const pad = value => value.padStart(5, "0");
      const time = match ? pad(match[1]) + (match[2] ? "-" + pad(match[2]) : "") : "";
      const subject = match ? match[3] : line;
      if (width(subject) > 84) throw Error(`课程名称过长：${subject}。请缩短至7个汉字或14个英文字符，教室无需填写。`);
      if (match?.[2] && pad(match[2]) <= pad(match[1])) throw Error("课程结束时间必须晚于开始时间。");
      return {time, subject};
    }).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  }
  function raster(character) {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 12;
    const ctx = canvas.getContext("2d", {willReadFrequently: true});
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 12, 12);
    ctx.fillStyle = "black"; ctx.font = '12px "Microsoft YaHei", sans-serif'; ctx.textBaseline = "alphabetic";
    ctx.fillText(character, 0, 11);
    const pixels = ctx.getImageData(0, 0, 12, 12).data, rows = new Uint16Array(12);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++)
      if (pixels[(y * 12 + x) * 4] < 160) rows[y] |= 1 << (11 - x);
    if (!rows.some(Boolean)) throw Error(`当前字体无法绘制“${character}”，没有同步空白文字。`);
    return rows;
  }
  function pack(data, device = "", glyph = raster) {
    if (!data || !Array.isArray(data.courses) || data.courses.length !== 7 || !Array.isArray(data.todos) || !Array.isArray(data.jobs))
      throw Error("日历需要现有工作区的七天课表、待办和日程数据。");
    const courses = data.courses.map(lessons), entries = [];
    const epoch = value => {
      const n = Date.parse(value) / 1000;
      if (!Number.isFinite(n) || n < 1 || n >= 4291747200) throw Error("日历日期超出1970至2105年的支持范围。");
      return Math.floor(n);
    };
    for (const todo of data.todos) {
      if (typeof todo.done !== "boolean" || !clean(todo.title)) throw Error("待办标题或状态无效。");
      if (todo.done) continue;
      entries.push({at: todo.due ? epoch(todo.due) : 0, title: clean(todo.title), detail: clean(todo.description), kind: 0, repeat: 0});
    }
    for (const job of data.jobs) if (job.enabled && device && job.device === device) {
      const repeat = ["once", "daily", "weekly"].indexOf(job.repeat);
      if (repeat < 0 || !clean(job.title)) throw Error("日程标题或重复规则无效。");
      entries.push({at: epoch(job.at), title: clean(job.title), detail: clean(job.text), kind: 1, repeat});
    }
    if (entries.length > 64) throw Error("离线日历最多同步64项未完成待办和本设备日程；原有数据未改动。");
    const strings = ["", ...entries.flatMap(e => [e.title, e.detail]), ...courses.flat().flatMap(row => [row.time, row.subject])];
    const codes = [...new Set(strings.join(""))].map(c => c.codePointAt(0)).filter(c => c >= 128).sort((a, b) => a - b);
    if (codes.length > 255) throw Error("日历所需字形超过255个；原有数据未改动，请精简长备注。");
    const encoded = new Map(), encoder = new TextEncoder();
    for (const text of strings) {
      if (/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(text)) throw Error("日历文字包含无效控制字符或不完整字符。");
      if (!encoded.has(text)) encoded.set(text, encoder.encode(text + "\0"));
    }
    const count = courses.flat().length, glyphBase = 44 + entries.length * 12 + count * 4;
    let offset = glyphBase + codes.length * 28;
    const needed = offset + [...encoded.values()].reduce((n, s) => n + s.length, 0);
    if (needed > bytes) throw Error("日历数据超过一个图库槽的安全容量；未省略内容或覆盖已有数据。");
    const result = new Uint8Array(bytes), view = new DataView(result.buffer), locations = new Map();
    result.set(encoder.encode("ELPLAN1\0")); view.setUint16(8, needed, true);
    result[10] = entries.length; result[11] = codes.length; result[12] = count;
    for (const [text, value] of encoded) { locations.set(text, offset); result.set(value, offset); offset += value.length; }
    let rowIndex = 0;
    courses.forEach((rows, day) => {
      view.setUint16(16 + day * 4, rowIndex, true); view.setUint16(18 + day * 4, rows.length, true);
      for (const row of rows) {
        const at = 44 + entries.length * 12 + rowIndex++ * 4;
        view.setUint16(at, locations.get(row.time), true); view.setUint16(at + 2, locations.get(row.subject), true);
      }
    });
    entries.forEach((e, i) => {
      const at = 44 + i * 12;
      view.setUint32(at, e.at, true); view.setUint16(at + 4, locations.get(e.title), true);
      view.setUint16(at + 6, locations.get(e.detail), true); result[at + 8] = e.kind; result[at + 9] = e.repeat;
    });
    codes.forEach((code, i) => {
      const rows = glyph(String.fromCodePoint(code));
      if (!rows || rows.length !== 12 || [...rows].some(row => !Number.isInteger(row) || row < 0 || row > 4095)) throw Error("日历字形格式无效。");
      view.setUint32(glyphBase + i * 28, code, true);
      rows.forEach((row, y) => view.setUint16(glyphBase + i * 28 + 4 + y * 2, row, true));
    });
    return result;
  }
  async function apply(client, data, style, country, external, progress, date = new Date()) {
    if (![6, 7].includes(style) || !(client.sdkCapabilities & capability))
      throw Error("当前设备尚未接入离线待办/课表日历，本次没有写入；请等待配套固件完成后再启用。");
    const blob = pack(data, client.device?.id);
    const target = client.device;
    const state = await client.gallery(external), empty = state.slots.find(s => !s.valid);
    if (!empty) throw Error("同步需要一个空槽保存新数据；没有覆盖已有图片或当前日历。");
    await client.operation(async () => {
      await client.readCalendar();
    });
    const old = {...client.config};
    await client.store({plan: blob}, empty.slot, external, progress);
    if (!client.ready || client.device !== target) throw Error("同步期间设备改变，未启用新数据。");
    await client.operation(async () => {
      await client.command(OMProtocol.time(date, 0, OMCalendar.zone(OMCalendar.byId(country).code, date)));
      await client.write(Uint8Array.of(0x57, empty.slot, Number(external)));
      await client.readCalendar();
      if (client.config.photoSlot !== empty.slot || client.config.photoSource !== Number(external)) throw Error("日历数据槽位读回不一致，未启用日历。");
    });
    await client.internationalCalendar(country, "zh", false, empty.slot, external, progress, date, "prepared", style);
    if (client.config.photoSlot !== empty.slot || client.config.photoSource !== Number(external)) throw Error("启用后的日历数据源不一致。");
    if ((old.alternate >> 3) >= 6 && old.photoSlot !== empty.slot && old.photoSource === Number(external)) {
      const previous = state.slots.find(s => s.slot === old.photoSlot);
      if (previous?.valid && (previous.color & 128)) {
        try { await client.slotAction("delete", previous.slot, external, progress); }
        catch (error) { client.log("新日历已启用，旧数据槽未清理：" + error.message); }
      }
    }
    return {slot: empty.slot, bytes: blob.length};
  }
  return {pack, lessons, apply, capability, bytes};
})();
