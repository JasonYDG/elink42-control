"use strict";
(() => {
  const params = new URLSearchParams(location.search), previewMode = params.get("preview") === "1";
  const embedded=params.get("embedded")==="1";document.documentElement.dataset.embedded=String(embedded);
  const key = previewMode ? "elink42-course-table-c-v1" : "om6626-workspace-v1", $ = id => document.getElementById(id);
  const weekdays = "日一二三四五六", sample = Array(7).fill("");
  sample[4] = ["08:00-08:45 语文", "08:55-09:40 数学", "10:10-10:55 英语", "11:05-11:50 物理",
    "14:00-14:45 化学", "14:55-15:40 生物", "16:00-16:45 体育", "16:55-17:40 自习"].join("\n");
  let courses = previewMode ? sample : Array(7).fill(""), exams = [], examDays = {}, dirty = false, storageError = false, hadSaved = false, draft, viewPage = 0, pendingImport = null;
  let date = new Date(), day = date.getDay();
  function status(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
  try {
    if (!previewMode) new OMFeatures.Store(localStorage);
    const raw = localStorage.getItem(key);
    hadSaved = !!raw;
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.version !== 1) throw Error("保存版本不支持");
      CourseTable.parseWeek(saved.courses); courses = saved.courses;
      exams = CourseTable.normalizeExams(saved.exams || []);
      examDays = CourseTable.normalizeExamDays(saved.examDays || {});
      const selectedDate = previewMode ? saved.selectedDate : saved.courseDate;
      if (selectedDate) { date = CourseTable.dateValue(selectedDate); day = date.getDay(); }
    }
  } catch (error) {
    storageError = true; status("本地课表读取失败，原数据未改动：" + error.message, true);
  }
  draft = CourseTable.parseWeek(courses);
  // Start the unsaved example on its actual weekday instead of copying it into other days.
  if (!hadSaved && previewMode) { date = new Date(2026, 10, 12, 12); day = 4; }
  $("date").value = CourseTable.formatDate(date); $("weekday").value = String(day);
  $("view").value = params.get("view") === "day" ? "day" : "week";
  $("workspace-note").textContent = previewMode ? "独立设计预览，不修改网页工作区。" : "使用控制台课程表工作区，保存后可在课程表菜单继续查看。";
  function snapshot() { return draft.map((rows, weekday) => {
    try { return CourseTable.serializeDay(rows, weekday); }
    catch (error) { throw Error("周" + weekdays[weekday] + "：" + error.message); }
  }); }
  function displayDevice() {
    if (previewMode) {
      $("device-note").textContent = "设备名与3.03 V为设计示例；实际页面使用控制台读取值。";
      return {deviceName: "ELINK42-" + ($("panel").value === "four" ? "4C" : "3C") + "7A2F", millivolts: 3030};
    }
    let cached = {};
    try { cached = JSON.parse(sessionStorage.getItem("elink42-course-device-v1") || "{}"); }
    catch (_) { /* No valid handoff: show unknown metadata without blocking course editing. */ }
    const device = CourseTable.deviceInfo(cached && typeof cached === "object" ? cached : {});
    $("device-note").textContent = device.deviceName ? "设备信息为控制台本次会话最近读取值；可返回控制台刷新。" : "尚未读取设备信息；在控制台连接屏幕后可读取名称和电池电压。";
    return device;
  }
  let previewToken=0;
  async function preview() {
    const token=++previewToken;
    if(embedded && window.parent!==window)window.parent.postMessage({type:"elink-course-draft",dirty},location.origin);
    $("screen").hidden=true;$("download").disabled=true;
    $("add").disabled = draft[day].length >= CourseTable.maxCourses;
    $("exam-add").disabled = exams.length >= 64;
    $("save").disabled = storageError || !dirty;
    try {
      date = CourseTable.dateValue($("date").value);
      const current = Array(7).fill(""); current[day] = CourseTable.serializeDay(draft[day], day);
      let weekError = "", allCourses;
      try { allCourses = snapshot(); } catch (error) { weekError = error.message; }
      $("save").disabled = storageError || !dirty || !!weekError;
      const weekly = $("view").value === "week";
      if (weekly && weekError) throw Error(weekError);
      const examData = CourseTable.normalizeExams(exams);
      const canvas=document.createElement("canvas");
      const proof = await OMSchool.render(canvas, {date, panel: $("panel").value, courses: weekly ? allCourses : current, exams: examData, examDays, page: viewPage, view: $("view").value, ...displayDevice()});
      if(token!==previewToken)return;
      $("screen").getContext("2d").drawImage(canvas,0,0);
      const selected = weekly ? CourseTable.dayModel(allCourses, date, examData, examDays) : proof;
      viewPage = proof.page;
      $("screen").hidden = false; $("invalid").hidden = true; $("download").disabled = false;
      $("screen").dataset.count = String(proof.count);
      $("screen").dataset.pages = String(proof.pages);
      $("screen").setAttribute("aria-label", `${weekly ? "本周，" : ""}${CourseTable.formatDate(date)}，星期${weekdays[day]}，${proof.classCount}节课，${proof.examCount}场考试，第${proof.page + 1}/${proof.pages}页：` + proof.visible.map(row => (row.date ? row.date + " " : "") + (row.kind === "exam" ? "考试：" : "") + row.subject).join("、") + (proof.notice ? `；临近考试：${proof.notice.subject}，${proof.notice.days}天后` : "") + `；${proof.device.deviceName || "设备未读取"}，电池电压${proof.device.voltage}`);
      $("preview-heading").textContent = weekly ? "一周综合课表" : "屏幕预览";
      $("preview-caption").textContent = weekly ? "原尺寸 · 时间在左，周一至周五" : "原尺寸 · 周历与全天课程";
      $("count").textContent = selected.weeklyCount + " 条录入记录";
      $("exam-day-policy").hidden = !selected.examCount;
      $("exam-day-mode").value = selected.policy;
      $("exam-day-date").textContent = CourseTable.formatDate(date);
      $("policy-note").textContent = selected.suspendedCount ? `当天${selected.suspendedCount}节常规课暂停显示，周课表保留，其他日期照常。` : "当天按周课表上课，考试以红色科目区分。";
      $("pagination").hidden = proof.pages <= 1;
      $("page-label").textContent = `${proof.page + 1} / ${proof.pages}`;
      $("page-prev").disabled = proof.page === 0; $("page-next").disabled = proof.page + 1 >= proof.pages;
      const conflict = selected.conflicts.length ? `考试与${selected.conflicts.length}节课时间重叠，请核对停课或调课；课程没有自动删除。` : "";
      $("conflict").textContent = conflict; $("conflict").hidden = !conflict;
      if (!storageError) status(weekError || (dirty ? "内容已修改，尚未保存。" : hadSaved ? "课表已载入，可直接修改表格。" : previewMode ? "当前为周四示例课表，修改后可保存。" : "还没有课程，可直接录入或导入 Excel。"), !!weekError);
    } catch (error) {
      if(token!==previewToken)return;
      $("screen").hidden = true; $("invalid").hidden = false; $("invalid").textContent = error.message;
      $("conflict").hidden = true;
      $("exam-day-policy").hidden = true;
      $("download").disabled = true; $("save").disabled = true; status(error.message, true);
    }
  }
  function editRows() {
    $("rows").replaceChildren();
    draft[day].forEach((row, index) => {
      const tr = document.createElement("tr"), number = document.createElement("td");
      number.textContent = String(index + 1).padStart(2, "0"); number.className = "row-number"; tr.append(number);
      for (const field of ["start", "end", "subject"]) {
        const td = document.createElement("td"), input = document.createElement("input");
        input.type = field === "subject" ? "text" : "time"; input.value = row[field];
        input.setAttribute("aria-label", `第${index + 1}节` + {start: "开始时间", end: "结束时间", subject: "课程名称"}[field]);
        if (field === "subject") { input.maxLength = 14; input.placeholder = "课程名称"; }
        input.addEventListener("input", () => { row[field] = input.value; dirty = true; viewPage = 0; preview(); });
        td.append(input); tr.append(td);
      }
      const td = document.createElement("td"), button = document.createElement("button");
      button.type = "button"; button.className = "remove"; button.textContent = "删除";
      button.setAttribute("aria-label", `删除第${index + 1}节`);
      button.addEventListener("click", () => { draft[day].splice(index, 1); dirty = true; viewPage = 0; editRows(); preview(); });
      td.append(button); tr.append(td); $("rows").append(tr);
    });
    $("empty").hidden = draft[day].length > 0;
  }
  function editExams() {
    $("exam-rows").replaceChildren();
    exams.forEach((exam, index) => {
      const tr = document.createElement("tr");
      for (const field of ["date", "start", "end", "subject"]) {
        const td = document.createElement("td"), input = document.createElement("input");
        input.type = field === "date" ? "date" : field === "subject" ? "text" : "time"; input.value = exam[field];
        input.setAttribute("aria-label", `第${index + 1}场考试` + {date: "日期", start: "开始时间", end: "结束时间", subject: "科目"}[field]);
        if (field === "subject") input.maxLength = 14;
        if (field === "date") { input.min = "1970-01-01"; input.max = "2105-12-31"; }
        input.addEventListener("input", () => { exam[field] = input.value; dirty = true; viewPage = 0; preview(); });
        td.append(input); tr.append(td);
      }
      const td = document.createElement("td"), button = document.createElement("button");
      button.type = "button"; button.className = "remove"; button.textContent = "删除";
      button.setAttribute("aria-label", `删除第${index + 1}场考试`);
      button.addEventListener("click", () => { exams.splice(index, 1); dirty = true; viewPage = 0; editExams(); preview(); });
      td.append(button); tr.append(td); $("exam-rows").append(tr);
    });
    $("exam-empty").hidden = exams.length > 0;
  }
  $("exam-add").addEventListener("click", () => {
    if (exams.length >= 64) return;
    exams.push({date: $("date").value, start: "", end: "", subject: ""}); dirty = true; viewPage = 0; editExams(); preview();
    $("exam-rows").lastElementChild.querySelector('input[type="time"]').focus();
  });
  $("exam-day-mode").addEventListener("change", () => {
    examDays[CourseTable.formatDate(date)] = $("exam-day-mode").value;
    dirty = true; viewPage = 0; preview();
  });
  $("page-prev").addEventListener("click", () => { viewPage--; preview(); });
  $("page-next").addEventListener("click", () => { viewPage++; preview(); });
  $("weekday").addEventListener("change", () => {
    const next = Number($("weekday").value); date.setDate(date.getDate() + next - date.getDay()); day = next;
    $("date").value = CourseTable.formatDate(date); viewPage = 0; editRows(); preview();
  });
  $("date").addEventListener("change", () => {
    try { date = CourseTable.dateValue($("date").value); day = date.getDay(); viewPage = 0; $("weekday").value = String(day); editRows(); preview(); }
    catch (error) { $("screen").hidden = true; $("invalid").hidden = false; $("invalid").textContent = error.message; $("exam-day-policy").hidden = true; $("download").disabled = true; $("save").disabled = true; status(error.message, true); }
  });
  $("panel").addEventListener("change", preview);
  $("view").addEventListener("change", () => {
    viewPage = 0;
    const url = new URL(location.href); url.searchParams.set("view", $("view").value); history.replaceState(null, "", url);
    preview();
  });
  $("add").addEventListener("click", () => {
    if (draft[day].length >= CourseTable.maxCourses) return;
    draft[day].push({start: "", end: "", subject: ""}); dirty = true; editRows(); preview();
    $("rows").lastElementChild.querySelector("input").focus();
  });
  $("save").addEventListener("click", () => {
    try {
      date = CourseTable.dateValue($("date").value);
      const next = snapshot();
      const examData = CourseTable.normalizeExams(exams);
      const examDayData = CourseTable.normalizeExamDays(Object.fromEntries(Object.entries(examDays).filter(([date]) => examData.some(exam => exam.date === date))));
      if (previewMode) localStorage.setItem(key, JSON.stringify({version: 1, courses: next, exams: examData, examDays: examDayData, selectedDate: CourseTable.formatDate(date)}));
      else {
        const store = new OMFeatures.Store(localStorage);
        store.change(data => { data.courses = next; data.exams = examData; data.examDays = examDayData; data.courseDate = CourseTable.formatDate(date); });
      }
      courses = next; exams = examData; examDays = examDayData; draft = CourseTable.parseWeek(courses); dirty = false; hadSaved = true; editRows(); editExams(); preview(); status(previewMode ? "课表与考试已保存到此预览工作区。" : "课表与考试已保存到网页工作区。");
    } catch (error) { status("没有保存：" + error.message, true); }
  });
  $("download").addEventListener("click", () => {
    const link = document.createElement("a"); link.href = $("screen").toDataURL("image/png");
    link.download = "course-" + ($("view").value === "week" ? "week-" : "table-") + CourseTable.formatDate(date) + ".png"; link.click();
  });
  $("excel-file").addEventListener("change", async event => {
    pendingImport = null; $("excel-apply").disabled = true;
    try {
      const incoming = await CourseImport.read(event.target.files[0]);
      CourseImport.merge(snapshot(), exams, examDays, incoming);
      pendingImport = incoming;
      $("excel-state").textContent = `已检查：${incoming.classCount}节课、${incoming.examCount}场考试。应用后${incoming.classCount ? "更新周一至周五，周末保留" : "保留原课表"}；其他考试保留。应用后请保存。`;
      $("excel-apply").disabled = storageError;
    } catch (error) { $("excel-state").textContent = "没有导入：" + error.message; }
    event.target.value = "";
  });
  $("excel-apply").addEventListener("click", () => {
    if (!pendingImport) return;
    try {
      const next = CourseImport.merge(snapshot(), exams, examDays, pendingImport);
      courses = next.courses; exams = next.exams; examDays = next.examDays; draft = CourseTable.parseWeek(courses);
      dirty = true; viewPage = 0; pendingImport = null; $("excel-apply").disabled = true;
      editRows(); editExams(); preview(); $("excel-state").textContent = "已应用到表格和预览，确认内容后点击保存。";
    } catch (error) { $("excel-state").textContent = "没有应用：" + error.message; }
  });
  window.addEventListener("message",event=>{
    if(!embedded || event.origin!==location.origin || event.source!==window.parent || event.data?.type!=="elink-course-select")return;
    if(["three","four"].includes(event.data.panel))$("panel").value=event.data.panel;
    const next=event.data.day;
    if(Number.isInteger(next)&&next>=0&&next<=6){
      try{date=CourseTable.schoolWeekDates(event.data.date?CourseTable.dateValue(event.data.date):new Date())[0];date.setDate(date.getDate()+(next+6)%7);day=next;$("date").value=CourseTable.formatDate(date);$("weekday").value=String(day);viewPage=0;editRows();}
      catch(error){status(error.message,true);return;}
    }
    preview();
  });
  editRows(); editExams(); preview();
})();
