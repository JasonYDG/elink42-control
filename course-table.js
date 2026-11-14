"use strict";
const CourseTable = (() => {
  const inks = {black: "#000000", white: "#ffffff", red: "#b81928", yellow: "#ffd200"};
  const weekdays = "日一二三四五六";
  const maxCourses = 12, pageSize = 6;
  const type = {date: 32, title: 20, course: 20, time: 13, body: 12, meta: 11};
  function deviceInfo({deviceName = "", millivolts = null} = {}) {
    const name = typeof deviceName === "string" ? Array.from(deviceName.replace(/[\u0000-\u001f\u007f]/g, "").trim()).slice(0, 64).join("") : "";
    const mv = Number.isInteger(millivolts) && millivolts >= 1000 && millivolts <= 5000 ? millivolts : null;
    return {deviceName: name, millivolts: mv, voltage: mv === null ? "-- V" : (Math.round(mv / 10) / 100).toFixed(2) + " V"};
  }
  function dateValue(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error("请选择有效日期");
    const date = new Date(value + "T12:00:00");
    if (!Number.isFinite(+date) || formatDate(date) !== value || date.getFullYear() < 1970 || date.getFullYear() > 2105) throw Error("请选择1970至2105年的有效日期");
    return date;
  }
  function formatDate(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }
  function weekDates(date) {
    const first = new Date(+date); first.setDate(first.getDate() - first.getDay());
    return Array.from({length: 7}, (_, day) => {
      const result = new Date(+first); result.setDate(first.getDate() + day); return result;
    });
  }
  function schoolWeekDates(date) {
    const monday = new Date(+date); monday.setDate(date.getDate() - (date.getDay() + 6) % 7);
    return Array.from({length: 5}, (_, i) => { const day = new Date(+monday); day.setDate(monday.getDate() + i); return day; });
  }
  function parseWeek(courses) {
    if (!Array.isArray(courses) || courses.length !== 7 || courses.some(day => typeof day !== "string")) throw Error("课表需要周日到周六七天内容");
    return courses.map((day, weekday) => parseDay(day, weekday).map(item => {
      const [start = "", end = ""] = item.time.split("-");
      return {start, end, subject: item.subject};
    }));
  }
  function parseDay(value, day) {
    const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length > maxCourses) throw Error("每天最多12节课，超出不会被截掉");
    // Reuse the existing time/name validation one row at a time; the old eight-row cap is not a display policy.
    return lines.map(line => OMPlanner.lessons(line, day)[0]).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  }
  function serializeDay(rows, day) {
    if (!Array.isArray(rows) || rows.length > maxCourses) throw Error("每天最多12节课，所有课程都会保留");
    const lines = [];
    for (const row of rows) {
      const start = String(row.start || ""), end = String(row.end || ""), subject = String(row.subject || "").trim();
      if (!start && !end && !subject) continue;
      if (!subject) throw Error("请填写课程名称");
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)) throw Error("请填写开始时间");
      if (end && (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start)) throw Error("结束时间必须晚于开始时间");
      lines.push(start + (end ? "-" + end : "") + " " + subject);
    }
    return parseDay(lines.join("\n"), day).map(row => row.time + " " + row.subject).join("\n");
  }
  function normalizeExams(exams = []) {
    if (!Array.isArray(exams) || exams.length > 64) throw Error("考试记录需要数组，最多64项");
    const records = [], seen = new Set();
    for (const source of exams) {
      if (!source || typeof source !== "object") throw Error("考试记录无效");
      const entry = {date: String(source.date || ""), start: String(source.start || ""), end: String(source.end || ""), subject: String(source.subject || "").trim()};
      if (!Object.values(entry).some(Boolean)) continue;
      const date = dateValue(entry.date);
      const normalized = serializeDay([entry], date.getDay());
      if (!normalized) throw Error("请填写考试科目和时间");
      const id = [entry.date, entry.start, entry.subject].join("/");
      if (seen.has(id)) throw Error("同一天同一时间的考试重复了");
      seen.add(id); records.push(entry);
    }
    return records.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }
  function daysBetween(a, b) {
    return (Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000;
  }
  function normalizeExamDays(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 64) throw Error("考试日设置无效，最多64天");
    const result = {};
    for (const [date, mode] of Object.entries(value)) {
      dateValue(date);
      if (!["all", "morning", "afternoon", "none"].includes(mode)) throw Error("考试日停课设置无效");
      result[date] = mode;
    }
    return result;
  }
  function dayModel(courses, date, exams = [], examDays = {}) {
    const rawRows = parseWeek(courses)[date.getDay()], weeklyRows = rawRows.filter(row => !/自习|自修/u.test(row.subject));
    const allExams = normalizeExams(exams), todayExams = allExams.filter(exam => exam.date === formatDate(date));
    const policies = normalizeExamDays(examDays), policy = todayExams.length ? policies[formatDate(date)] || "all" : "none";
    const rows = weeklyRows.filter(row => policy === "none" ||
      (policy === "morning" && row.start >= "12:00") || (policy === "afternoon" && row.start < "12:00"));
    const morning = [], afternoon = [];
    const items = [...rows.map(row => ({...row, kind: "class"})), ...todayExams.map(exam => ({...exam, kind: "exam"}))];
    items.sort((a, b) => (a.start || "99").localeCompare(b.start || "99"));
    items.forEach((row, index) => (row.start ? Number(row.start.slice(0, 2)) < 12 : index < 4) ? morning.push(row) : afternoon.push(row));
    const upcoming = allExams.find(exam => { const days = daysBetween(dateValue(exam.date), date); return days >= 0 && days <= 7; });
    const conflicts = [];
    for (const exam of todayExams) for (const row of rows) {
      const overlaps = row.start && (exam.start === row.start ||
        (row.end && exam.start >= row.start && exam.start < row.end) ||
        (exam.end && row.start >= exam.start && row.start < exam.end));
      if (overlaps) conflicts.push({exam: exam.subject, course: row.subject});
    }
    return {morning, afternoon, count: items.length, classCount: rows.length, examCount: todayExams.length,
      weeklyCount: rawRows.length, suspendedCount: weeklyRows.length - rows.length, hiddenStudyCount: rawRows.length - weeklyRows.length, policy,
      rowCount: Math.min(pageSize, Math.max(4, morning.length, afternoon.length)),
      pages: Math.max(1, Math.ceil(morning.length / pageSize), Math.ceil(afternoon.length / pageSize)), upcoming, conflicts, exams: allExams};
  }
  function weekModel(courses, date, exams = [], examDays = {}) {
    const dates = schoolWeekDates(date), days = dates.map(day => dayModel(courses, day, exams, examDays)), slots = new Map();
    const examColumns = days.map((day, col) => day.exams.filter(exam => exam.date === formatDate(dates[col])));
    days.forEach((day, col) => {
      if (examColumns[col].length) return;
      for (const item of [...day.morning, ...day.afternoon].filter(item => item.kind === "class")) {
        const key = item.start + "/" + item.end;
        if (!slots.has(key)) slots.set(key, {start: item.start, end: item.end, days: Array.from({length: 5}, () => [])});
        slots.get(key).days[col].push({...item, date: formatDate(dates[col])});
      }
    });
    const rows = [...slots.values()].sort((a, b) => (a.start || "99").localeCompare(b.start || "99") || a.end.localeCompare(b.end))
      .flatMap(slot => Array.from({length: Math.max(...slot.days.map(items => items.length))}, (_, i) =>
        ({start: slot.start, end: slot.end, items: slot.days.map(items => items[i] || null)})));
    const classCount = rows.reduce((sum, row) => sum + row.items.filter(Boolean).length, 0), examCount = examColumns.flat().length;
    return {dates, days, rows, examColumns, count: classCount + examCount, classCount, examCount,
      pages: Math.max(1, Math.ceil(rows.length / 10), ...examColumns.map(exams => Math.ceil(new Set(exams.map(exam => exam.subject)).size / 4)))};
  }
  function drawing(canvas, panel) {
    canvas.width = 400; canvas.height = 300;
    const ctx = canvas.getContext("2d", {willReadFrequently: true});
    ctx.fillStyle = inks.white; ctx.fillRect(0, 0, 400, 300);
    const labels = [], boxes = [];
    function rect(x, y, width, height, color = inks.black) {
      ctx.fillStyle = color; ctx.fillRect(x, y, width, height);
    }
    function text(value, x, y, size = 13, {color = inks.black, weight = 400, align = "left", numeric = false} = {}) {
      ctx.font = `${weight} ${size}px ${numeric ? '"Bahnschrift"' : '"Microsoft YaHei"'}, sans-serif`;
      ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillStyle = color;
      const metrics = ctx.measureText(value);
      const left = x - (align === "center" ? metrics.width / 2 : align === "right" ? metrics.width : 0);
      const box = [left, y - metrics.actualBoundingBoxAscent, left + metrics.width, y + metrics.actualBoundingBoxDescent];
      if (box[0] < 8 || box[1] < 8 || box[2] > 392 || box[3] > 292) throw Error("文字越出画面：" + value);
      for (const previous of boxes) {
        const b = previous.box;
        if (Math.min(box[2], b[2]) > Math.max(box[0], b[0]) && Math.min(box[3], b[3]) > Math.max(box[1], b[1])) throw Error("文字重叠：" + value + " / " + previous.text);
      }
      boxes.push({text: value, box, color, size, font: ctx.font}); labels.push(value);
      ctx.fillText(value, x, y);
    }
    function subject(value, cx, cy, rowHeight, width = 76, color = inks.black) {
      let size = 12;
      const steps = rowHeight >= 30 ? [type.course, 18] : [type.course, 18, 16, 14, 12];
      for (const candidate of steps.filter(value => value <= rowHeight - 6)) {
        size = candidate;
        ctx.font = `${size}px "Microsoft YaHei", sans-serif`;
        if (ctx.measureText(value).width <= width) break;
      }
      ctx.font = `${size}px "Microsoft YaHei", sans-serif`;
      if (ctx.measureText(value).width <= width) { text(value, cx, cy, size, {align: "center", color}); return; }
      const chars = Array.from(value), middle = Math.ceil(chars.length / 2);
      const lines = [chars.slice(0, middle).join(""), chars.slice(middle).join("")];
      for (const candidate of [16, 14, 12, 11].filter(value => value * 2 <= rowHeight)) {
        size = candidate;
        ctx.font = `${size}px "Microsoft YaHei", sans-serif`;
        if (lines.every(line => ctx.measureText(line).width <= width)) break;
      }
      lines.forEach((line, index) => text(line, cx, cy + (index - .5) * (size + 1), size, {align: "center", color}));
    }
    function footer(device, page, pages) {
      const info = deviceInfo(device), limit = pages > 1 ? 230 : 284;
      let name = info.deviceName || "设备未读取";
      const size = type.meta;
      ctx.font = `${size}px "Microsoft YaHei", sans-serif`;
      const chars = Array.from(name);
      if (ctx.measureText(name).width > limit) {
        while (chars.length && ctx.measureText(chars.join("") + "…").width > limit) chars.pop();
        name = chars.join("") + "…";
      }
      text(name, 16, 284, size);
      if (pages > 1) text(`${page + 1}/${pages}`, 286, 284, 10, {align: "right", numeric: true});
      // Match the native electrical outline; no fill bars or inferred battery percentage.
      rect(321, 280, 11, 1); rect(321, 287, 11, 1); rect(321, 281, 1, 6); rect(331, 281, 1, 6); rect(332, 282, 2, 4);
      text(info.voltage, 384, 284, type.meta, {align: "right", numeric: true, color: info.millivolts !== null && info.millivolts < 2800 ? inks.red : inks.black});
      return info;
    }
    function finish() {
      const image = ctx.getImageData(0, 0, 400, 300), pixels = image.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const rgb = panel === "four" && r > 180 && g > 130 && b < 95 ? [255, 210, 0] :
          r > 105 && r > g * 1.35 && r > b * 1.35 ? [184, 25, 40] : r * .299 + g * .587 + b * .114 < 160 ? [0, 0, 0] : [255, 255, 255];
        pixels.set([...rgb, 255], i);
      }
      ctx.putImageData(image, 0, 0);
    }
    return {ctx, text, rect, subject, footer, finish, labels, boxes};
  }
  function render(canvas, {date, courses, exams = [], examDays = {}, panel = "four", page = 0, view = "day", deviceName = "", millivolts = null}) {
    if (!(date instanceof Date) || !Number.isFinite(+date) || !["four", "three"].includes(panel) || !["day", "week"].includes(view)) throw Error("预览日期、屏型或视图无效");
    if (view === "week") return renderWeek(canvas, {date, courses, exams, examDays, panel, page, deviceName, millivolts});
    const model = dayModel(courses, date, exams, examDays);
    page = Math.max(0, Math.min(model.pages - 1, Number.isInteger(page) ? page : 0));
    const {ctx, text, rect, subject, footer, finish, labels, boxes} = drawing(canvas, panel);
    text(`${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}`, 16, 14, 11, {numeric: true});
    text(String(date.getDate()), 16, 43, type.date, {numeric: true});
    text("周" + weekdays[date.getDay()], 66, 45, type.body, {color: inks.red});
    rect(112, 12, 1, 42);
    const cell = 256 / 7;
    weekDates(date).forEach((day, col) => {
      const cx = 128 + cell * (col + .5), current = day.getDay() === date.getDay();
      if (current) rect(Math.round(cx) - 14, 9, 29, 46, panel === "four" ? inks.yellow : inks.black);
      const color = current ? panel === "four" ? inks.black : inks.white : col === 0 || col === 6 ? inks.red : inks.black;
      text(weekdays[col], cx, 21, type.meta, {align: "center", color});
      const otherMonth = day.getMonth() !== date.getMonth() || day.getFullYear() !== date.getFullYear();
      text(otherMonth ? `${day.getMonth() + 1}/${day.getDate()}` : String(day.getDate()), cx, 43, otherMonth ? 12 : 16, {align: "center", color, numeric: true});
      if (model.exams.some(exam => exam.date === formatDate(day))) rect(Math.round(cx) - 1, 57, 3, 3, inks.red);
    });
    const policyLabels = {all: "全天按考试安排", morning: "上午停课", afternoon: "下午停课", none: "保留当天课程"};
    const status = model.examCount ? `考试日 · ${model.examCount}场` : `今日课程 · ${model.classCount}节`;
    text(status, 16, 76, 12, {color: model.examCount ? inks.red : inks.black});
    let detail = model.examCount ? policyLabels[model.policy] : "";
    if (!model.examCount && model.upcoming) {
      const days = daysBetween(dateValue(model.upcoming.date), date);
      detail = (days === 1 ? "明日" : days + "天后") + "考试 · " + model.upcoming.subject;
    }
    if (detail) {
      let size = 11;
      while (size > 8) {
        ctx.font = `${size}px "Microsoft YaHei", sans-serif`;
        if (ctx.measureText(detail).width <= 220) break;
        size--;
      }
      text(detail, 384, 76, size, {align: "right", color: inks.red});
    }
    const top = 94, groupEnd = top + 22, headerEnd = top + 42, bottom = 270;
    const slice = list => {
      const localPage = Math.min(page, Math.max(0, Math.ceil(list.length / pageSize) - 1));
      return {items: list.slice(localPage * pageSize, (localPage + 1) * pageSize), first: localPage * pageSize, total: list.length};
    };
    const am = slice(model.morning), pm = slice(model.afternoon);
    const rowCount = Math.max(4, am.items.length, pm.items.length);
    const rowHeight = (bottom - headerEnd) / rowCount;
    // One-pixel rules align to physical pixels, keeping the table sharp after palette conversion.
    [top, groupEnd, headerEnd, bottom].forEach(y => rect(16, y, 369, 1));
    for (let i = 1; i < rowCount; i++) rect(16, Math.round(headerEnd + rowHeight * i), 369, 1);
    [16, 200, 384].forEach(x => rect(x, top, 1, bottom - top + 1));
    [110, 294].forEach(x => rect(x, groupEnd, 1, bottom - groupEnd + 1));
    const columns = [{left: 16, label: "上午", group: am}, {left: 200, label: model.afternoon.some(row => row.start >= "18:00") ? "下午 / 晚间" : "下午", group: pm}];
    for (const column of columns) {
      const x = column.left;
      const range = column.group.total > pageSize ? ` ${column.group.first + 1}–${column.group.first + column.group.items.length}/${column.group.total}` : "";
      text(column.label + range, x + 92, top + 11, 13, {align: "center", weight: 600});
      text("时间", x + 47, groupEnd + 10, 11, {align: "center"});
      text("科目", x + 139, groupEnd + 10, 11, {align: "center"});
      column.group.items.forEach((row, index) => {
        const cy = headerEnd + rowHeight * (index + .5);
        const time = row.start ? row.start + (row.end ? "-" + row.end : "") : "—";
        text(time, x + 47, cy, type.time, {numeric: true, align: "center", color: row.kind === "exam" ? inks.red : inks.black});
        subject(row.subject, x + 139, cy, rowHeight, 76, row.kind === "exam" ? inks.red : inks.black);
      });
    }
    const device = footer({deviceName, millivolts}, page, model.pages);
    finish();
    const notice = model.upcoming ? {...model.upcoming, days: daysBetween(dateValue(model.upcoming.date), date)} : null;
    return {labels, boxes, device, count: model.count, classCount: model.classCount, examCount: model.examCount, notice,
      rows: rowCount, page, pages: model.pages, conflicts: model.conflicts, palette: panel,
      weeklyCount: model.weeklyCount, suspendedCount: model.suspendedCount, policy: model.policy,
      layout: {top, headerEnd, bottom, timeCenters: [63, 247], subjectCenters: [155, 339]},
      visible: [...am.items, ...pm.items].map(row => ({kind: row.kind, subject: row.subject, start: row.start}))};
  }
  function renderWeek(canvas, {date, courses, exams, examDays, panel, page, deviceName, millivolts}) {
    const model = weekModel(courses, date, exams, examDays);
    page = Math.max(0, Math.min(model.pages - 1, Number.isInteger(page) ? page : 0));
    const {ctx, text, rect, footer, finish, labels, boxes} = drawing(canvas, panel);
    const left = 12, timeEnd = 74, right = 388, top = 54, headerEnd = 86;
    const width = (right - timeEnd) / 5, rows = model.rows.slice(page * 10, (page + 1) * 10);
    const rowCount = Math.max(7, rows.length), tableBottom = 270, height = (tableBottom - headerEnd) / rowCount;
    const shortDate = day => `${String(day.getMonth() + 1).padStart(2, "0")}.${String(day.getDate()).padStart(2, "0")}`;
    const [first, last] = [model.dates[0], model.dates[4]];
    const range = first.getFullYear() === last.getFullYear() ? `${shortDate(first)}–${shortDate(last)}` : `${first.getFullYear()}.${shortDate(first)}–${last.getFullYear()}.${shortDate(last)}`;
    text("一周课表", left, 22, type.title, {weight: 600});
    text(range, right, 22, 12, {align: "right", numeric: true});
    text(`${date.getFullYear()}年${date.getMonth() + 1}月`, left, 40, 11);
    text("课程", 346, 40, 11, {align: "right"});
    text("考试", right, 40, 11, {align: "right", color: inks.red});
    model.dates.forEach((day, col) => {
      const x = timeEnd + width * col, current = formatDate(day) === formatDate(date);
      if (current) rect(Math.round(x), top, Math.round(x + width) - Math.round(x), headerEnd - top, panel === "four" ? inks.yellow : inks.black);
      const color = current && panel === "three" ? inks.white : inks.black;
      text("周" + weekdays[day.getDay()], x + width / 2, 64, 12, {align: "center", color});
      text(day.getMonth() !== date.getMonth() || day.getFullYear() !== date.getFullYear() ? `${day.getMonth() + 1}/${day.getDate()}` : String(day.getDate()), x + width / 2, 79, 12, {align: "center", color, numeric: true});
    });
    text("时间", (left + timeEnd) / 2, 71, 12, {align: "center"});
    [top, headerEnd, tableBottom].forEach(y => rect(left, y, right - left + 1, 1));
    [left, ...Array.from({length: 6}, (_, col) => Math.round(timeEnd + width * col))].forEach(x => rect(x, top, 1, tableBottom - top + 1));
    for (let i = 1; i < rowCount; i++) {
      const y = Math.round(headerEnd + height * i);
      rect(left, y, timeEnd - left, 1);
      model.examColumns.forEach((exams, col) => { if (!exams.length) rect(Math.round(timeEnd + width * col), y, Math.round(timeEnd + width * (col + 1)) - Math.round(timeEnd + width * col), 1); });
    }
    function cellSubject(value, x, y, color) {
      let size = type.course;
      for (const candidate of [type.course, 18, 16, 14, 12].filter(value => value <= height - 4)) {
        size = candidate;
        ctx.font = `${size}px "Microsoft YaHei", sans-serif`;
        if (ctx.measureText(value).width <= width - 5) break;
      }
      ctx.font = `${size}px "Microsoft YaHei", sans-serif`;
      if (ctx.measureText(value).width <= width - 5) { text(value, x, y, size, {align: "center", color}); return; }
      size = 11;
      ctx.font = `${size}px "Microsoft YaHei", sans-serif`;
      const chars = Array.from(value), lines = [], maxLines = height >= 26 ? 2 : 1;
      for (let line = 0; chars.length && line < maxLines; line++) {
        let part = "", count = 0;
        const limit = maxLines === 2 && line === 0 ? Math.ceil(chars.length / 2) : Infinity;
        while (chars.length && count < limit && ctx.measureText(part + chars[0]).width <= width - 5) { part += chars.shift(); count++; }
        if (line === maxLines - 1 && chars.length) {
          while (ctx.measureText(part + "…").width > width - 5) part = part.slice(0, -1);
          part += "…";
        }
        lines.push(part);
      }
      lines.forEach((line, index) => text(line, x, y + (index - (lines.length - 1) / 2) * 12, size, {align: "center", color}));
    }
    rows.forEach((row, index) => {
      const cy = headerEnd + height * (index + .5);
      const color = row.items.filter(Boolean).every(item => item.kind === "exam") ? inks.red : inks.black;
      const timeSize = height >= 23 ? type.meta : 10, offset = timeSize / 2;
      if (row.end) {
        text(row.start || "—", (left + timeEnd) / 2, cy - offset, timeSize, {align: "center", numeric: true, color});
        text(row.end, (left + timeEnd) / 2, cy + offset, timeSize, {align: "center", numeric: true, color});
      } else text(row.start || "—", (left + timeEnd) / 2, cy, 11, {align: "center", numeric: true, color});
      row.items.forEach((item, col) => { if (item) cellSubject(item.subject, timeEnd + width * (col + .5), cy, item.kind === "exam" ? inks.red : inks.black); });
    });
    const visibleExams = [];
    model.examColumns.forEach((exams, col) => {
      const subjects = [...new Set(exams.map(exam => exam.subject))], localPage = Math.min(page, Math.max(0, Math.ceil(subjects.length / 4) - 1));
      const names = subjects.slice(localPage * 4, localPage * 4 + 4), blockHeight = (tableBottom - headerEnd) / Math.max(1, names.length);
      names.forEach((name, i) => cellSubject(name, timeEnd + width * (col + .5), headerEnd + blockHeight * (i + .5), inks.red));
      visibleExams.push(...exams.filter(exam => names.includes(exam.subject)).map(exam => ({...exam, kind: "exam"})));
    });
    const device = footer({deviceName, millivolts}, page, model.pages);
    finish();
    return {labels, boxes, device, count: model.count, classCount: model.classCount, examCount: model.examCount,
      rows: rowCount, page, pages: model.pages, palette: panel, notice: null,
      visible: [...rows.flatMap(row => row.items.filter(Boolean)), ...visibleExams], view: "week"};
  }
  return {parseWeek, serializeDay, normalizeExams, normalizeExamDays, dayModel, weekModel, weekDates, schoolWeekDates, dateValue, formatDate, daysBetween, deviceInfo, render, maxCourses};
})();
