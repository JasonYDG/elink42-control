"use strict";
(() => {
  const $ = id => document.getElementById(id), F = OMFeatures;
  let tab = "calendar", frame = null, bitmap = null, loading = false, previewToken = 0, imageToken = 0, uiBusy = false;
  let gallery = null, scheduler = null, schedulerRunning = false, wakeLock = null, saying = "", elementImage = "", transientWorkspace = false;
  let otaPackage = null;
  let draft = F.defaultTemplates()[0], editingTodo = null, courseDay = 1, store;
  const lines = [], drawable = new Set(["image", "todo", "template", "course", "weather"]);
  const supported = window.isSecureContext && !!navigator.bluetooth;
  function result(text, error = false) { $("result").textContent = text + (transientWorkspace ? "（临时工作区，请导出保存）" : ""); $("result").classList.toggle("error", error); }
  function log(text) { lines.push(new Date().toLocaleTimeString("zh-CN") + "  " + text); $("log").textContent = lines.slice(-150).join("\n"); }
  try { store = new F.Store(localStorage); }
  catch (error) {
    log("读取本地工作区失败：" + error.message + "；原数据未改写，本次使用临时工作区");
    transientWorkspace = true;
    store = new F.Store({getItem: () => null, setItem() {}});
    result("工作区读取失败；原数据保留，本次修改无法持久保存，请查看日志。", true);
  }
  const client = new OMClient(update, log);
  const external = () => $("gallery-source").value === "1";
  const model = () => Number($("preview-model").value);
  const uid = () => crypto.randomUUID();
  const settingsMap = {theme: "theme", "font-size": "fontSize", "urgent-hours": "urgentHours", dither: "dither",
    "dither-strength": "strength", brightness: "brightness", contrast: "contrast", gamma: "gamma", "red-threshold": "redThreshold", "packet-bytes": "packetBytes", "packet-delay": "packetDelay"};
  function change(callback) { store.change(callback); refreshLists(); preview(); }
  function options(id, rows, empty = "请选择") {
    const control = $(id), before = control.value; control.replaceChildren();
    if (!rows.length) rows = [["", empty]];
    for (const [value, text] of rows) { const option = document.createElement("option"); option.value = String(value); option.textContent = text; control.append(option); }
    if (rows.some(row => String(row[0]) === before)) control.value = before;
  }
  function button(text, callback) {
    const b = document.createElement("button"); b.textContent = text;
    b.addEventListener("click", () => action(callback)); return b;
  }
  function row(container, text, buttons = []) {
    const div = document.createElement("div"), label = document.createElement("span"); div.className = "list-row";
    label.textContent = text; div.append(label, ...buttons); $(container).append(div);
  }
  function update() {
    const busy = client.busy || uiBusy || schedulerRunning, ready = client.ready && !busy;
    $("connect").disabled = !supported || busy || client.ready;
    $("reconnect").disabled = !supported || busy || client.ready || !navigator.bluetooth?.getDevices || !$("saved-device").value;
    $("disconnect").disabled = !client.device?.gatt.connected || client.otaActive;
    const otaReady = ready && client.board?.name === OMProtocol.OTA_MARKER;
    $("ota-inspect").disabled = !otaReady;
    $("ota-file").disabled = busy;
    $("ota-consent").disabled = busy;
    $("ota-start").disabled = !otaReady || !otaPackage || otaPackage.model !== client.config?.model || !!scheduler || !$("ota-consent").checked;
    $("ota-capability").textContent = !client.ready ? "v1-fixed HEX 已集成全部当前功能；有线刷入即可使用，ZIP 用于后续升级。" :
      client.board.name === OMProtocol.OTA_MARKER ? "已连接 ELINK 独立固件，可以升级。" : "当前是旧独立固件：请先有线刷入对应屏型的独立 OTA v1-fixed HEX。";
    $("scheduler-start").disabled = busy;
    for (const id of ["native-calendar", "calendar-style", "set-time", "background-clear", "holiday-read", "holiday-write",
      "gallery-read", "course-send-week", "job-add"]) $(id).disabled = !ready;
    $("native-clock").disabled = !ready || (client.config?.model === 5 && !$("clock-full").checked);
    $("led-off").disabled = $("led-on").disabled = !ready || client.config?.model !== 5;
    $("preview-model").disabled = client.ready || busy;
    $("packet-bytes").disabled = $("packet-delay").disabled = $("render-reset").disabled = busy;
    const canSend = ready && client.canPublish && !!frame && !loading && drawable.has(tab);
    $("publish").disabled = $("store-frame").disabled = !canSend;
    $("download").disabled = !frame || loading || !drawable.has(tab);
    const slot = gallery?.external === external() && gallery.slots.find(s => s.slot === Number($("gallery-slot").value));
    for (const id of ["slot-display", "slot-delete", "slot-background", "slot-remark-save"]) $(id).disabled = !ready || !slot?.valid;
    $("rotation-save").disabled = !ready || !gallery || gallery.external !== external();
    $("connection-state").textContent = busy ? "操作中" : client.ready ? "已连接" : "未连接";
    $("connection-state").classList.toggle("online", client.ready);
    $("device-name").textContent = client.ready ? client.device.name || "OM6626 屏幕" : "连接一台屏幕开始";
    $("device-id").textContent = client.ready ? client.device.id : "—";
    $("firmware-state").textContent = client.ready ? client.refreshStatus ? "配套固件 · 支持 BUSY 完成回执" : "旧配套固件 · 需升级刷新回执" : "待核对";
    $("screen-model").textContent = client.ready ? client.config.model === 5 ? "JD79668 · 四色" : "SSD1619 · 黑白红" : "三色 / 四色 · 连接后识别";
    $("mtu-state").textContent = `${client.reportedPayload || 20} B ATT / ${client.payload} B 当前发送`;
    $("clock-capability").textContent = client.ready ? client.config.model === 5 ?
      "JD79668：原驱动局刷回调为空，只能启用原版全刷时钟；不建议长期开启。" :
      "SSD1619：原驱动提供局刷。设备每分钟更新，首次、跨日及定期清屏会全刷。" :
      "SSD1619 原驱动有局刷；JD79668 原驱动没有局刷接口。";
    $("nfc-write").disabled = !ready || !("NDEFReader" in window);
    $("nfc-read").disabled = !("NDEFReader" in window);
  }
  function frameFrom(canvas, settings = store.data.settings, chosenModel = model()) {
    const pixels = OMFeatures.process(canvas.getContext("2d").getImageData(0, 0, 400, 300).data, chosenModel, settings);
    return OMProtocol.planes(pixels, $("rotate").checked, chosenModel);
  }
  function context() { return {title: $("template-title").value, content: $("template-content").value, todos: store.data.todos, weather: store.data.weather, saying}; }
  function newCanvas() { const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 300; return canvas; }
  async function preview() {
    const token = ++previewToken; frame = null; update();
    $("preview-panel").hidden = !drawable.has(tab) || (tab === "weather" && !store.data.weather);
    if (!drawable.has(tab)) return;
    try {
      const canvas = newCanvas(), settings = F.clone(store.data.settings), chosenModel = model();
      if (tab === "image") {
        if (!bitmap || loading) { OMRender.image(canvas, null); $("preview").getContext("2d").drawImage(canvas, 0, 0); return; }
        OMRender.image(canvas, bitmap, {fit: $("image-fit").value, angle: Number($("image-angle").value), zoom: Number($("image-zoom").value), x: Number($("image-x").value), y: Number($("image-y").value)});
      } else if (tab === "todo") {
        const items = $("todo-mode").value === "single" ? store.data.todos.filter(t => t.id === $("todo-selected").value) : store.data.todos;
        OMRender.todos(canvas, items, $("todo-title").value, settings, $("todo-mode").value === "single");
      } else if (tab === "template") await OMRender.template(canvas, F.clone(draft), context());
      else if (tab === "course") OMRender.course(canvas, $("course-text").value, Number($("course-day").value), settings.fontSize);
      else if (tab === "weather") OMRender.weather(canvas, store.data.weather);
      if (token !== previewToken) return;
      frame = frameFrom(canvas, settings, chosenModel);
      $("preview").getContext("2d").putImageData(new ImageData(OMProtocol.rgba(frame), 400, 300), 0, 0);
      $("preview-label").textContent = {image: "图片", todo: "待办", template: "模板", course: "周日程 / 课表", weather: "天气"}[tab] +
        ` · 400 × 300 · ${chosenModel === 5 ? "四色（黑白黄红）" : "三色（黑白红）"}`;
      $("preview").setAttribute("aria-label", $("preview-label").textContent + "预览");
    } catch (error) { if (token === previewToken) { frame = null; result(error.message, true); } }
    finally { if (token === previewToken) update(); }
  }
  function snapshot() { if (!frame || loading || !drawable.has(tab)) throw Error("当前没有可发送的画面"); return frame.packed ? {packed: frame.packed.slice()} : {black: frame.black.slice(), red: frame.red.slice()}; }
  function progress(value, label) { $("progress").value = value; result(label); }
  async function action(callback, complete = "操作完成；设备显示和灯光请核对实物。") {
    try { const value = await callback(); if (complete) result(complete); return value; }
    catch (error) { result(error.message, true); log(error.message); return undefined; }
    finally { update(); }
  }
  function bind(id, callback, complete) { $(id).addEventListener("click", () => action(callback, complete)); }
  function download(name, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function jsonDownload(name, data) { download(name, new Blob([JSON.stringify(data, null, 2)], {type: "application/json"})); }
  async function jsonFile(file) { if (!file || file.size > 4500000) throw Error("JSON 文件最大 4.5 MB"); return JSON.parse(await file.text()); }
  const tabs = [...document.querySelectorAll("[data-tab]")];
  function selectTab(button) {
    tab = button.dataset.tab;
    for (const b of tabs) { const on = b === button; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; $(b.getAttribute("aria-controls")).hidden = !on; }
    preview();
  }
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => selectTab(b));
    b.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus(); selectTab(tabs[next]);
    });
  });
  async function connected(device) {
    gallery = null; await client.connect(device); $("preview-model").value = String(client.config.model);
    $("calendar-layout").value = String(client.config.layout); $("calendar-alternate").value = String(client.config.alternate);
    change(data => { if (!data.devices.some(d => d.id === client.device.id)) data.devices.push({id: client.device.id, name: client.device.name || "OM6626"}); });
    $("saved-device").value = client.device.id; await preview();
  }
  bind("connect", () => connected(), "设备已连接。日历页可直接启用日历。");
  bind("reconnect", async () => {
    if (!navigator.bluetooth.getDevices) throw Error("此浏览器未提供已授权设备列表");
    const device = (await navigator.bluetooth.getDevices()).find(d => d.id === $("saved-device").value);
    if (!device) throw Error("此设备尚未授予网页蓝牙权限，请使用连接屏幕重新选择"); await connected(device);
  });
  bind("forget-device", () => change(data => { data.devices = data.devices.filter(d => d.id !== $("saved-device").value); }), "已取消本地记录。系统蓝牙权限可在浏览器站点设置中移除。");
  $("saved-device").addEventListener("change", update);
  bind("disconnect", () => { client.disconnect(); gallery = null; }, "已断开，已提交的刷新可能仍在继续。");
  bind("native-calendar", () => client.calendar(progress));
  bind("native-clock", () => client.mode(2, progress, new Date(), $("clock-full").checked));
  $("clock-full").addEventListener("change", update);
  bind("set-time", () => { const date = new Date($("custom-time").value); if (!Number.isFinite(+date)) throw Error("请选择有效时间"); return client.mode(1, progress, date); });
  bind("calendar-style", () => client.style(Number($("calendar-layout").value), Number($("calendar-alternate").value), progress));
  bind("background-clear", () => client.clearBackground(progress));
  bind("led-off", () => client.led(false)); bind("led-on", () => client.led(true));
  $("ota-file").addEventListener("change", event => action(async () => {
    if (client.busy || uiBusy || schedulerRunning) throw Error("设备或页面正在操作，请等待后再选择 OTA 包");
    otaPackage = null; $("ota-consent").checked = false;
    $("ota-package").textContent = "尚未选择有效的签名 OTA ZIP";
    $("ota-kind").textContent = "只接受本项目签名包，原版固件不能通过校验。";
    const file = event.target.files[0];
    if (!file) { $("ota-package").textContent = "尚未选择固件包"; update(); return; }
    if (!/\.zip$/i.test(file.name) || file.size > 1024 * 1024) throw Error("请选择 1 MB 内的签名 OTA ZIP");
    uiBusy = true; update(); $("ota-package").textContent = "正在校验 ZIP、签名、固件哈希及保护区…";
    try {
      otaPackage = await OMOTA.parse(await file.arrayBuffer());
      $("ota-package").textContent = `${file.name} · ${otaPackage.model === 5 ? "JD79668 四色" : "SSD1619 三色"} · ${otaPackage.size.toLocaleString()} 字节 · 版本 ${otaPackage.version} · SHA-256 ${otaPackage.sha256}`;
      $("ota-kind").textContent = "项目签名和保护区校验通过；升级继续保持独立模式，不恢复原版激活流程。";
      result("固件包校验通过，尚未向设备发送任何 OTA 命令。");
    } catch (error) { $("ota-package").textContent = "固件包校验未通过；没有发送升级命令"; throw error; }
    finally { uiBusy = false; update(); }
  }, ""));
  $("ota-consent").addEventListener("change", update);
  bind("ota-inspect", async () => {
    await client.otaInspect(); $("ota-service").textContent = "已发现 OM6626 FE59 DFU 服务、控制与数据特征；未进入升级。";
  }, "OTA 服务检测完成，没有发送升级控制命令。");
  bind("ota-start", async () => {
    if (!otaPackage || !client.ready) throw Error("请先连接屏幕并选择通过校验的 OTA ZIP");
    if (scheduler || schedulerRunning) throw Error("先停止本页定时器，再进行 OTA");
    const consent = {deviceId: client.device.id, eraseImages: $("ota-consent").checked};
    if (!consent.eraseImages) throw Error("请完成图库清空确认");
    const text = `目标：${client.device.name || client.device.id}\n固件 SHA-256：${otaPackage.sha256}\n升级会清空设备全部图片，期间不能断电或退出。` +
      "\n此包为独立固件，保留独立模式。确认开始 OTA？";
    if (!window.confirm(text)) { result("已取消 OTA，没有发送升级命令。"); return; }
    await client.ota(otaPackage, consent, progress);
      $("ota-service").textContent = "升级完成，已重新连接并核对固件版本；请查看实屏。";
  }, "");
  window.addEventListener("beforeunload", event => {
    if (!client.otaActive) return; event.preventDefault(); event.returnValue = "";
  });
  bind("publish", () => client.publish(snapshot(), progress));
  bind("store-frame", () => client.store(snapshot(), Number($("save-slot").value), external(), progress));
  bind("download", () => { snapshot(); return new Promise((resolve, reject) => $("preview").toBlob(blob => { if (!blob) { reject(Error("无法导出画面")); return; } download(`om6626-${tab}.png`, blob); resolve(); })); }, "已导出 PNG。");
  $("image-file").addEventListener("change", event => action(async () => {
    const file = event.target.files[0], token = ++imageToken; if (!file) return;
    if (file.size > 15 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "image/bmp"].includes(file.type)) throw Error("请选择 15 MB 内的 PNG/JPEG/WebP/BMP");
    loading = true; frame = null; update();
    try {
      const image = await createImageBitmap(file);
      if (token !== imageToken) { image.close(); return; }
      if (image.width * image.height > 40000000) { image.close(); throw Error("图片超过 4000 万像素"); }
      bitmap?.close(); bitmap = image; $("image-name").textContent = file.name;
    } finally { if (token === imageToken) { loading = false; await preview(); } }
  }, "图片已载入，可调整裁切、旋转和抖动。"));
  for (const id of ["image-fit", "image-angle", "image-zoom", "image-x", "image-y", "rotate", "preview-model", "todo-title", "todo-mode", "todo-selected", "template-title", "template-content"])
    $(id).addEventListener("input", preview);
  function refreshLists() {
    options("saved-device", store.data.devices.map(d => [d.id, d.name]));
    options("todo-selected", store.data.todos.map(t => [t.id, t.title]));
    options("template-list", store.data.templates.map(t => [t.id, t.name]));
    options("job-template", store.data.templates.map(t => [t.id, t.name]));
    $("todo-list").replaceChildren();
    for (const item of store.data.todos) row("todo-list", `${item.done ? "✓" : "□"} ${item.title}${item.due ? " · " + new Date(item.due).toLocaleString("zh-CN") : ""}`, [
      button(item.done ? "未完成" : "完成", () => change(data => { data.todos.find(t => t.id === item.id).done = !item.done; })),
      button("编辑", () => { editingTodo = item.id; $("todo-item-title").value = item.title; $("todo-description").value = item.description;
        $("todo-due").value = item.due ? localDate(new Date(item.due)) : ""; $("todo-add").textContent = "保存修改"; }),
      button("删除", () => change(data => { data.todos = data.todos.filter(t => t.id !== item.id); }))]);
    $("job-list").replaceChildren();
    for (const job of store.data.jobs) row("job-list", `${job.title} · ${new Date(job.at).toLocaleString("zh-CN")} · ${job.status || (job.enabled ? "等待" : "已停用")}`, [
      button(job.enabled ? "停用" : "启用", () => change(data => { const j = data.jobs.find(j => j.id === job.id); j.enabled = !j.enabled; j.status = ""; })),
      button("立即发送", () => runJob(job, true)), button("删除", () => change(data => { data.jobs = data.jobs.filter(j => j.id !== job.id); }))]);
    update();
  }
  function localDate(date) { return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  bind("todo-add", () => {
    const title = $("todo-item-title").value.trim(), due = $("todo-due").value;
    if (!title) throw Error("请输入待办标题");
    const item = {id: editingTodo || uid(), title, description: $("todo-description").value, due: due ? new Date(due).toISOString() : "", done: false};
    change(data => { const old = data.todos.findIndex(t => t.id === item.id); if (old < 0) data.todos.push(item); else data.todos[old] = {...item, done: data.todos[old].done}; });
    editingTodo = null; $("todo-add").textContent = "添加待办"; $("todo-item-title").value = $("todo-description").value = $("todo-due").value = "";
  }, "待办已保存到本地工作区。");
  bind("todo-export", () => jsonDownload("om6626-todos.json", {version: 1, todos: store.data.todos}), "已导出待办。");
  $("todo-import").addEventListener("change", e => action(async () => {
    const value = await jsonFile(e.target.files[0]); if (value.version !== 1 || !Array.isArray(value.todos)) throw Error("待办文件格式不符");
    const merged = F.clone(store.data); merged.todos = [...merged.todos, ...value.todos.map(t => ({...t, id: uid()}))]; store.commit(merged); refreshLists(); await preview();
  }, "待办已导入，并保留原有待办。"));
  function elementOptions() { options("element-list", draft.elements.map((e, i) => [i, `${i + 1}. ${e.type} ${e.text?.slice(0, 14) || ""}`])); }
  function loadDraft(spec) { draft = F.clone(spec); $("template-name").value = draft.name; elementOptions(); loadElement(); preview(); }
  function loadElement() {
    const e = draft.elements[Number($("element-list").value)]; if (!e) return;
    for (const k of ["type", "x", "y", "width", "height", "color"]) $("element-" + k).value = String(e[k]);
    $("element-size").value = String(e.fontSize || 22); $("element-text").value = e.text || ""; elementImage = e.src || "";
  }
  function readElement() {
    const e = {type: $("element-type").value, color: $("element-color").value};
    for (const k of ["x", "y", "width", "height"]) e[k] = Number($("element-" + k).value);
    if (e.type === "text") { e.fontSize = Number($("element-size").value); e.text = $("element-text").value; }
    if (e.type === "image") e.src = elementImage;
    F.template({...draft, elements: [e]}); return e;
  }
  $("element-list").addEventListener("change", loadElement);
  $("template-list").addEventListener("change", () => { const spec = store.data.templates.find(t => t.id === $("template-list").value); if (spec) loadDraft(spec); });
  $("element-image").addEventListener("change", e => action(async () => {
    const file = e.target.files[0]; if (!file || file.size > 900000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw Error("模板图片请选择 900 KB 内的 PNG/JPEG/WebP");
    elementImage = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error("图片读取失败")); reader.readAsDataURL(file); });
    $("element-type").value = "image";
  }, "图片已读取，点击添加元素或更新所选。"));
  bind("template-new", () => loadDraft({id: uid(), name: "新模板", width: 400, height: 300, elements: []}), "新画布已建立。");
  bind("template-save", () => { draft.name = $("template-name").value.trim() || "未命名模板"; F.template(draft);
    change(data => { const i = data.templates.findIndex(t => t.id === draft.id); if (i < 0) data.templates.push(F.clone(draft)); else data.templates[i] = F.clone(draft); }); $("template-list").value = draft.id;
  }, "模板已保存。");
  bind("template-delete", () => { const id = $("template-list").value; change(data => { data.templates = data.templates.filter(t => t.id !== id); }); loadDraft(F.defaultTemplates()[0]); }, "模板已删除。");
  bind("template-defaults", () => change(data => { for (const spec of F.defaultTemplates()) if (!data.templates.some(t => t.id === spec.id)) data.templates.push(spec); }), "缺少的默认模板已生成，保留已有模板。");
  bind("element-add", () => { draft.elements.push(readElement()); elementOptions(); $("element-list").value = String(draft.elements.length - 1); preview(); }, "元素已添加；保存模板以持久保留。");
  bind("element-update", () => { const i = Number($("element-list").value); if (!draft.elements[i]) throw Error("请选择元素"); draft.elements[i] = readElement(); elementOptions(); preview(); }, "元素已更新。");
  bind("element-delete", () => { draft.elements.splice(Number($("element-list").value), 1); elementOptions(); preview(); }, "元素已删除。");
  for (const [id, delta] of [["element-up", 1], ["element-down", -1]]) bind(id, () => {
    const i = Number($("element-list").value), j = i + delta; if (!draft.elements[i] || !draft.elements[j]) return;
    [draft.elements[i], draft.elements[j]] = [draft.elements[j], draft.elements[i]]; elementOptions(); $("element-list").value = String(j); preview();
  }, "图层顺序已更新。");
  bind("template-export", () => { const spec = {...draft, name: $("template-name").value}; download("om6626-template.epdtpl", OMArchive.pack(spec)); }, "网页模板已导出。");
  $("template-import").addEventListener("change", e => action(async () => {
    const file = e.target.files[0]; if (!file || file.size > 4000000) throw Error("模板文件最大 4 MB");
    const spec = await OMArchive.unpack(await file.arrayBuffer()); spec.id = uid(); change(data => data.templates.push(spec)); loadDraft(spec);
  }, "网页模板已导入，原有模板保留。"));
  $("course-day").addEventListener("change", () => { courseDay = Number($("course-day").value); $("course-text").value = store.data.courses[courseDay]; preview(); });
  $("course-text").addEventListener("input", () => action(() => change(data => { data.courses[courseDay] = $("course-text").value; }), ""));
  function daysInput(value) { const days = value.split(/[,，\s]+/).filter(Boolean).map(Number); if (days.length !== 7 || days.some(d => !Number.isInteger(d))) throw Error("请提供周一到周日的七个整数槽位"); return [days[6], ...days.slice(0, 6)]; }
  bind("course-send-week", async () => {
    const slots = daysInput($("course-slots").value), chosenModel = client.config?.model;
    if (slots.includes(255) || new Set(slots).size !== 7) throw Error("周日程需要七个不同的空槽");
    const sourceExternal = external(), settings = F.clone(store.data.settings), courses = [...store.data.courses], frames = [];
    uiBusy = true; update();
    try {
      // Validate and render all seven days before the first storage write.
      for (let day = 0; day < 7; day++) { const canvas = newCanvas(); OMRender.course(canvas, courses[day] || "当日无日程", day, settings.fontSize); frames.push(frameFrom(canvas, settings, chosenModel)); }
      const state = await client.gallery(sourceExternal);
      for (const slot of slots) if (slot < 0 || slot >= state.count || state.slots[slot].valid) throw Error("七天目标必须全是实际容量内的空槽");
      for (let day = 0; day < 7; day++) { await client.store(frames[day], slots[day], sourceExternal, progress); log("已保存星期" + "日一二三四五六"[day] + " 到槽 " + slots[day]); }
      await client.rotate(2, 60, slots, sourceExternal, progress);
    } finally { uiBusy = false; }
  });
  async function fetchWeather() {
    if (document.documentElement.dataset.hosting === "github-pages") throw Error("实时天气需要本地控制端；网页不会发送天气私钥");
    if (!$("weather-consent").checked || !$("weather-key").value.trim() || !$("weather-city").value.trim()) throw Error("请填写心知天气私钥、城市并勾选网络许可");
    const response = await fetch("/weather", {method: "POST", headers: {"Content-Type": "application/json", "X-OM6626-Request": "1"}, body: JSON.stringify({key: $("weather-key").value.trim(), city: $("weather-city").value.trim()}), signal: AbortSignal.timeout(35000)});
    if (!response.ok) throw Error("天气请求失败，请核对私钥、产品权限、城市及网络");
    const data = await response.json(), weather = F.seniverse(data.now, data.daily);
    change(value => { value.weather = weather; }); $("weather-state").textContent = weather.city + " · 更新 " + new Date(weather.updated).toLocaleString("zh-CN");
    return weather;
  }
  bind("weather-fetch", fetchWeather, "天气已获取并更新预览。");
  bind("saying-fetch", async () => {
    const response = await fetch("https://uapis.cn/api/v1/saying", {credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(18000)}); if (!response.ok) throw Error("一言获取失败");
    const value = await response.json(); saying = String(value.text || "").slice(0, 500); $("saying-text").textContent = saying; await preview();
  }, "一言已更新。");
  async function readGallery() {
    const state = await client.gallery(external()); gallery = state;
    $("gallery-state").textContent = `${state.external ? "外置" : "内部"} · ${state.count} 槽 · 每槽 ${state.slotBytes.toLocaleString()} B · 已用 ${state.slots.filter(s => s.valid).length}`;
    options("gallery-slot", state.slots.map(s => [s.slot, `${s.slot} · ${s.valid ? (s.remark || "已有图片") : "空槽"}`]));
    $("gallery-list").replaceChildren();
    for (const s of state.slots) row("gallery-list", `${s.slot} · ${s.valid ? s.size + " B · CRC " + s.crc.toString(16).padStart(4, "0") + " · " + (s.remark || "") : "空槽"}`);
    $("rotation-mode").value = String(state.mode); $("rotation-interval").value = String(state.interval || 60);
    $("rotation-days").value = [...state.days.slice(1), state.days[0]].join(","); slotSelected(); update();
  }
  function slotSelected() { $("slot-remark").value = gallery?.slots.find(s => s.slot === Number($("gallery-slot").value))?.remark || ""; update(); }
  bind("gallery-read", readGallery, "图库元数据已读取。");
  $("gallery-slot").addEventListener("change", slotSelected);
  $("gallery-source").addEventListener("change", () => { gallery = null; $("gallery-list").replaceChildren(); $("gallery-state").textContent = "存储源已切换，请重新读取。"; options("gallery-slot", []); update(); });
  for (const [id, name] of [["slot-display", "display"], ["slot-background", "background"], ["slot-delete", "delete"], ["slot-remark-save", "remark"]]) bind(id, async () => {
    const slot = Number($("gallery-slot").value);
    if (name === "delete" && !window.confirm(`确定删除${external() ? "外置" : "内部"}槽 ${slot} 的图片和备注？原设备没有图片导出接口，此操作无法从网页撤销。`)) return;
    await client.slotAction(name, slot, external(), progress, $("slot-remark").value);
    if (["delete", "remark"].includes(name)) await readGallery();
  });
  bind("rotation-save", () => client.rotate(Number($("rotation-mode").value), Number($("rotation-interval").value), daysInput($("rotation-days").value), external(), progress));
  function showHolidays(value) { $("holiday-year").value = String(value.year); $("holiday-text").value = value.entries.map(e => `${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")} ${e.off ? "休" : "班"}`).join("\n"); }
  bind("holiday-read", async () => showHolidays(await client.holidays()), "已读取设备调休表。");
  bind("holiday-write", async () => {
    const entries = $("holiday-text").value.trim().split(/\r?\n/).filter(Boolean).map(line => {
      const match = line.trim().match(/^(\d{1,2})-(\d{1,2})\s+(休|班)$/); if (!match) throw Error("调休格式应为 MM-DD 休 或 MM-DD 班");
      return {month: Number(match[1]), day: Number(match[2]), off: match[3] === "休"};
    });
    const year = Number($("holiday-year").value); OMProtocol.holidays(year, entries);
    const old = await client.holidays(); jsonDownload("om6626-holidays-before.json", old);
    showHolidays(await client.holidays(entries, year));
  }, "原表已导出备份，新表已保存并读回核对。");
  bind("job-add", () => {
    if (!client.ready) throw Error("先连接目标设备");
    const date = new Date($("job-time").value); if (!Number.isFinite(+date) || date <= new Date()) throw Error("请选择将来的任务时间");
    const job = {id: uid(), title: $("job-title").value.trim() || "日程提醒", text: $("job-text").value, kind: $("job-kind").value,
      at: date.toISOString(), repeat: $("job-repeat").value, device: client.device.id, templateId: $("job-template").value, enabled: true};
    if (job.kind === "template" && !store.data.templates.some(t => t.id === job.templateId)) throw Error("请选择已保存模板");
    change(data => data.jobs.push(job));
  }, "任务已保存，开启本页定时器后执行。");
  async function runJob(job, manual = false) {
    if (schedulerRunning || uiBusy || client.busy) throw Error("设备正在操作，任务等待");
    if (!client.ready || client.device.id !== job.device) throw Error("请先连接此任务绑定的设备");
    const target = client.device;
    schedulerRunning = true; update();
    try {
      const canvas = newCanvas(), settings = F.clone(store.data.settings);
      if (job.kind === "weather") OMRender.weather(canvas, await fetchWeather());
      else if (job.kind === "template") {
        const spec = store.data.templates.find(t => t.id === job.templateId); if (!spec) throw Error("任务模板已删除");
        await OMRender.template(canvas, spec, {...context(), title: job.title, content: job.text});
      } else OMRender.todos(canvas, [{title: job.title, description: job.text, done: false, due: job.at}], job.title, settings, true);
      const image = frameFrom(canvas, settings, client.config.model);
      if (!client.ready || client.device !== target || client.device.id !== job.device)
        throw Error("任务准备期间设备连接或身份改变，已停止发送");
      // Persist before submitting; uncertain delivery must never auto-repeat after a restart.
      change(data => { const current = data.jobs.find(j => j.id === job.id); if (current) { current.enabled = false; current.status = "已提交，显示待确认"; } });
      await client.publish(image, progress);
      change(data => { const i = data.jobs.findIndex(j => j.id === job.id); if (i >= 0) data.jobs[i] = {...(manual ? data.jobs[i] : F.nextJob(job)), status: "已发送，实物待确认"}; });
    } catch (error) {
      change(data => { const current = data.jobs.find(j => j.id === job.id); if (current) { current.enabled = false; current.status = "失败或结果不确定，请检查后手动重试"; } }); throw error;
    } finally { schedulerRunning = false; update(); }
  }
  async function tick() {
    if (schedulerRunning || uiBusy || client.busy || !client.ready) return;
    const due = F.dueJobs(store.data.jobs, new Date(), client.device.id);
    for (const job of due) {
      if (job.missed) { change(data => { const j = data.jobs.find(j => j.id === job.id); j.enabled = false; j.status = "已错过，等待手动发送"; }); continue; }
      await action(() => runJob(job)); break;
    }
  }
  bind("scheduler-start", async () => {
    if (scheduler) return;
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { log("浏览器未授予屏幕唤醒锁，请手动保持电脑唤醒"); }
    scheduler = setInterval(tick, 5000); $("scheduler-state").textContent = "本页定时器运行中。关闭、休眠或断线会停止发送；超过 5 分钟的任务不自动补发。"; await tick();
  }, "本页定时器已开启。");
  bind("scheduler-stop", async () => { clearInterval(scheduler); scheduler = null; await wakeLock?.release(); wakeLock = null; $("scheduler-state").textContent = "本页定时器已停止。"; }, "本页定时器已停止。");
  function applySettings() {
    for (const [id, key] of Object.entries(settingsMap)) $(id).value = String(store.data.settings[key]);
    document.documentElement.dataset.theme = store.data.settings.theme;
    if (client.transferPayload !== store.data.settings.packetBytes || client.packetDelay !== store.data.settings.packetDelay)
      client.setTransfer(store.data.settings.packetBytes, store.data.settings.packetDelay);
  }
  for (const [id, key] of Object.entries(settingsMap)) $(id).addEventListener("input", () => action(() => {
    const value = ["theme", "dither"].includes(key) ? $(id).value : Number($(id).value);
    change(data => { data.settings[key] = value; }); applySettings();
  }, ""));
  bind("render-reset", () => { change(data => { data.settings = F.defaults().settings; }); applySettings(); }, "渲染默认值已恢复。");
  bind("workspace-export", () => jsonDownload("om6626-workspace.json", store.data), "已导出工作区（不含天气私钥）。");
  $("workspace-import").addEventListener("change", e => action(async () => {
    const value = F.validate(await jsonFile(e.target.files[0]));
    if (!window.confirm("导入会替换本浏览器工作区。将先导出当前工作区备份，继续？")) return;
    if (client.busy || uiBusy || schedulerRunning || scheduler) throw Error("先停止定时器并等待设备操作完成");
    jsonDownload("om6626-workspace-before.json", store.data); store.commit(value); applySettings(); refreshLists(); $("course-text").value = store.data.courses[courseDay]; loadDraft(store.data.templates[0] || F.defaultTemplates()[0]);
  }, "工作区已导入，原工作区已导出备份。"));
  bind("log-export", () => download("om6626-web-log.txt", new Blob([lines.join("\n")], {type: "text/plain"})), "已导出日志。");
  $("nfc-state").textContent = "NDEFReader" in window ? "支持 Web NFC；需要 NFC 硬件和浏览器权限。标签是本网页独立格式。" : "此浏览器不提供 Web NFC（Windows Edge 不支持）；当前不可读写 NFC。";
  bind("nfc-write", async () => {
    if (!client.ready || !("NDEFReader" in window)) throw Error("先连接设备并使用支持 Web NFC 的浏览器");
    const reader = new NDEFReader(); await reader.write({records: [{recordType: "mime", mediaType: "application/json", data: new TextEncoder().encode(JSON.stringify({format: "om6626-web-device", id: client.device.id, name: client.device.name || "OM6626"}))}]});
  }, "网页设备标签已写入。");
  let nfcAbort;
  bind("nfc-read", async () => {
    if (!("NDEFReader" in window)) throw Error("浏览器不支持 Web NFC");
    nfcAbort?.abort(); nfcAbort = new AbortController(); const reader = new NDEFReader();
    reader.onreading = event => action(() => {
      const record = [...event.message.records].find(r => r.recordType === "mime" && r.mediaType === "application/json");
      if (!record) throw Error("标签不含网页设备信息"); const value = JSON.parse(new TextDecoder().decode(record.data));
      if (value.format !== "om6626-web-device" || !store.data.devices.some(d => d.id === value.id)) throw Error("此标签设备尚未绑定，先使用蓝牙选择器连接");
      $("saved-device").value = value.id; nfcAbort.abort(); update();
    }, "已选中标签设备，点击连接所选设备完成连接。");
    reader.onreadingerror = () => result("NFC 标签读取失败", true); await reader.scan({signal: nfcAbort.signal});
  }, "请靠近 NFC 标签。");
  // Canvas dragging changes only editor coordinates; transmission uses an immutable frame snapshot.
  let drag;
  $("preview").addEventListener("pointerdown", e => {
    if (!["image", "template"].includes(tab)) return;
    drag = {x: e.clientX, y: e.clientY, left: tab === "image" ? Number($("image-x").value) : draft.elements[Number($("element-list").value)]?.x,
      top: tab === "image" ? Number($("image-y").value) : draft.elements[Number($("element-list").value)]?.y};
    $("preview").setPointerCapture(e.pointerId);
  });
  $("preview").addEventListener("pointermove", e => {
    if (!drag || drag.left === undefined) return; const scale = 400 / $("preview").getBoundingClientRect().width;
    const x = Math.round(drag.left + (e.clientX - drag.x) * scale), y = Math.round(drag.top + (e.clientY - drag.y) * scale);
    if (tab === "image") { $("image-x").value = String(Math.max(-400, Math.min(400, x))); $("image-y").value = String(Math.max(-300, Math.min(300, y))); }
    else { const item = draft.elements[Number($("element-list").value)]; if (item) { item.x = Math.max(-400, Math.min(800, x)); item.y = Math.max(-300, Math.min(600, y)); loadElement(); } }
    preview();
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) $("preview").addEventListener(event, () => { drag = null; });
  const table = document.createElement("table");
  for (const [feature, state] of F.matrix) { const tr = document.createElement("tr"), th = document.createElement("th"), td = document.createElement("td"); th.textContent = feature; td.textContent = state; tr.append(th, td); table.append(tr); } $("feature-matrix").append(table);
  $("compatibility").textContent = supported ? "浏览器支持蓝牙，连接由你点击发起。" : "请使用支持 Web Bluetooth 的桌面 Edge / Chrome，并从本地启动器打开。";
  applySettings(); refreshLists(); loadDraft(store.data.templates[0] || F.defaultTemplates()[0]);
  $("course-text").value = store.data.courses[courseDay]; preview();
})();
