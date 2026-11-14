"use strict";
const CourseImport = (() => {
  const modes = {"全天停课": "all", "上午停课": "morning", "下午停课": "afternoon", "保留课程": "none"};
  let loading;
  function load() {
    if (typeof XLSX !== "undefined") return Promise.resolve(XLSX);
    if (!loading) loading = new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "vendor/xlsx.full.min.js";
      script.onload = () => resolve(XLSX); script.onerror = () => { loading = null; script.remove(); reject(Error("Excel 组件读取失败，请重试")); };
      document.head.append(script);
    });
    return loading;
  }
  function parse(workbook, xlsx) {
    const courses = Array.from({length: 7}, () => []), exams = [], examDays = {};
    if (workbook.vbaraw) throw Error("请使用不含宏的 .xlsx 文件");
    if (!workbook.Sheets["课程"] && !workbook.Sheets["考试"]) throw Error("请使用网页提供的模板，保留“课程”和“考试”工作表名称");
    function cell(sheet, row, col) {
      const entry = sheet[xlsx.utils.encode_cell({r: row, c: col})];
      if (entry?.f || entry?.t === "e") throw Error(`第${row + 1}行包含公式或错误，请改填实际内容`);
      return entry?.v ?? "";
    }
    function rows(name, headers, limit) {
      const sheet = workbook.Sheets[name]; if (!sheet) return [];
      const range = xlsx.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
      if (range.e.r > limit || range.e.c >= headers.length) throw Error(`${name}表超出模板范围，最多${limit}条`);
      headers.forEach((header, i) => { if (String(cell(sheet, 0, i)).trim() !== header) throw Error(`${name}表第${i + 1}列应为“${header}”`); });
      return Array.from({length: range.e.r}, (_, i) => headers.map((_, col) => cell(sheet, i + 1, col)));
    }
    function time(value) {
      if (value === "") return "";
      if (typeof value === "number") {
        const minute = Math.round(value * 1440);
        if (value < 0 || value >= 1 || Math.abs(value * 1440 - minute) > 1e-6 || minute >= 1440) throw Error("时间请填写小时和分钟，例如08:00");
        return String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");
      }
      const text = String(value).trim();
      if (!/^\d{1,2}:\d{2}$/.test(text)) throw Error("时间格式应为08:00");
      return text.padStart(5, "0");
    }
    function date(value) {
      if (typeof value === "number") {
        const parsed = xlsx.SSF.parse_date_code(value, {date1904: !!workbook.Workbook?.WBProps?.date1904});
        if (!parsed) throw Error("考试日期无效");
        value = `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
      }
      const text = String(value).trim(); CourseTable.dateValue(text); return text;
    }
    const seen = new Set();
    for (const row of rows("课程", ["开始时间", "结束时间", "周一", "周二", "周三", "周四", "周五"], 100)) {
      for (let day = 1; day <= 5; day++) {
        const subject = String(row[day + 1]).trim(); if (!subject) continue;
        const item = {start: time(row[0]), end: time(row[1]), subject};
        const key = [day, item.start, item.end, subject].join("/");
        if (seen.has(key)) throw Error(`周${"一二三四五"[day - 1]}存在重复课程：${subject}`);
        seen.add(key); courses[day].push(item);
      }
    }
    for (const row of rows("考试", ["日期", "科目", "开始时间", "结束时间", "当天课程"], 64)) {
      if (row.every(value => value === "")) continue;
      const day = date(row[0]), mode = String(row[4]).trim() || "全天停课";
      if (!Object.keys(modes).includes(mode)) throw Error("当天课程请填写：全天停课、上午停课、下午停课或保留课程");
      if (examDays[day] && examDays[day] !== modes[mode]) throw Error("同一天考试的停课设置不一致");
      examDays[day] = modes[mode];
      exams.push({date: day, subject: String(row[1]).trim(), start: time(row[2]), end: time(row[3])});
    }
    const serialized = courses.map((rows, day) => CourseTable.serializeDay(rows, day));
    const result = {courses: serialized, exams: CourseTable.normalizeExams(exams), examDays,
      classCount: courses.flat().length, examCount: exams.length};
    if (!result.classCount && !result.examCount) throw Error("文件没有可导入的课程或考试");
    return result;
  }
  async function read(file) {
    if (!file || !/\.xlsx$/i.test(file.name) || file.size > 2000000) throw Error("请选择2 MB以内的 .xlsx 模板文件");
    const xlsx = await load();
    const workbook = xlsx.read(await file.arrayBuffer(), {type: "array", cellDates: false, cellFormula: true, bookVBA: true, sheetRows: 102});
    return parse(workbook, xlsx);
  }
  function merge(courses, exams, examDays, incoming) {
    const next = [...courses];
    if (incoming.classCount) for (let day = 1; day <= 5; day++) next[day] = incoming.courses[day];
    const records = new Map(exams.map(exam => [[exam.date, exam.start, exam.subject].join("/"), exam]));
    incoming.exams.forEach(exam => records.set([exam.date, exam.start, exam.subject].join("/"), exam));
    CourseTable.parseWeek(next);
    return {courses: next, exams: CourseTable.normalizeExams([...records.values()]), examDays: CourseTable.normalizeExamDays({...examDays, ...incoming.examDays})};
  }
  return {read, parse, merge};
})();
