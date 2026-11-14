"use strict";
(() => {
  const $ = id => document.getElementById(id), F = OMFeatures, C = OMCalendar;
  const sdkOnly=document.documentElement.dataset?.firmwareFamily==="sdk";
  let tab = "calendar", frame = null, bitmap = null, loading = false, previewToken = 0, imageToken = 0, uiBusy = false;
  let gallery = null, scheduler = null, schedulerRunning = false, wakeLock = null, saying = "", elementImage = "", transientWorkspace = false;
  let otaPackage = null,firmwareRequest=null;
  let sdkPackage=null, pendingIdentityReceipt=null;
  let stockTimer=null,stockFetching=false,stockTarget=null,stockGeneration=0,stockProxy=false;
  let libraryKind="full",libraryCategory="month",selectedWallpaper=null,libraryObserver=null;
  const bundledFirmwareRevision=33;
  const sectionViews={calendar:"calendar",photo:"photo-calendar",reminder:"todo",course:"course",stock:"stock",gallery:"image",settings:"settings"};
  let draft = F.defaultTemplates()[0], editingTodo = null, store;
  const lines = [], drawable = new Set(["image", "todo", "template", "course", "stock"]);
  const supported = window.isSecureContext && !!navigator.bluetooth;
  function result(text, error = false) { $("result").textContent = OMI18n.t(text) + (transientWorkspace ? OMI18n.t("（临时工作区，请导出保存）") : ""); $("result").classList.toggle("error", error); }
  function log(text) { lines.push(new Date().toLocaleTimeString(OMI18n.locale) + "  " + text); $("log").textContent = lines.slice(-150).join("\n"); }
  try { store = new F.Store(localStorage); }
  catch (error) {
    log(OMI18n.t("读取本地工作区失败：") + error.message + OMI18n.t("；原数据未改写，本次使用临时工作区"));
    transientWorkspace = true;
    store = new F.Store({getItem: () => null, setItem() {}});
    result(OMI18n.t("工作区读取失败；原数据保留，本次修改无法持久保存，请查看日志。"), true);
  }
  const client = new OMClient(update, log, () => tab === "ota" || uiBusy || scheduler !== null || !!stockTimer&&!!stockTarget, message => {
    gallery = null; result(message); window.alert(message);
  });
  for (const event of ["pointerdown", "keydown", "input", "wheel"])
    window.addEventListener(event, () => client.armIdleDisconnect(), {passive: true});
  const external = () => $("gallery-source").value === "1";
  const model = () => Number($("preview-model").value);
  const uid = () => crypto.randomUUID();
  function connectedName() {
    if (!client.ready) return "";
    const mac = client.deviceInfo?.mac;
    if (mac && OMProtocol.sdkBoard(client.board)) {
      const hex = mac.replaceAll(":", "").toUpperCase();
      const panel = client.config?.model;
      if (client.sdkRevision >= 11 && (panel === 2 || panel === 5))
        return "ELINK42-" + (panel === 5 ? "4C" : "3C") + hex.slice(-4);
      return client.device.name || "ELINK42-" + hex.slice(-6);
    }
    return client.device.name || "";
  }
  const settingsMap = {theme: "theme", "font-size": "fontSize", "urgent-hours": "urgentHours", dither: "dither",
    "dither-strength": "strength", brightness: "brightness", contrast: "contrast", gamma: "gamma", "red-threshold": "redThreshold", "packet-bytes": "packetBytes", "packet-delay": "packetDelay", "stock-interval":"stockInterval"};
  function change(callback) { store.change(callback); refreshLists(); preview(); }
  function options(id, rows, empty = OMI18n.t("请选择")) {
    const control = $(id), before = control.value; control.replaceChildren();
    if (!rows.length) rows = [["", empty]];
    for (const [value, text] of rows) { const option = document.createElement("option"); option.value = String(value); option.textContent = text; control.append(option); }
    if (rows.some(row => String(row[0]) === before)) control.value = before;
  }
  function button(text, callback, complete) {
    const b = document.createElement("button"); b.textContent = text;
    b.addEventListener("click", () => action(callback,complete)); return b;
  }
  function row(container, text, buttons = []) {
    const div = document.createElement("div"), label = document.createElement("span"); div.className = "list-row";
    label.textContent = text; div.append(label, ...buttons); $(container).append(div);
  }
  function bundledRevision() {
    const revision=client.firmwareRevision;
    return OMOTA.pairedRevision(revision) ?? (revision!==null && (revision<30 || revision===31) ? 32 : bundledFirmwareRevision);
  }
  function update() {
    $("preview-model").disabled=client.ready || client.busy || uiBusy;
    const sdkView=sdkOnly || OMProtocol.sdkBoard(client.board);
    for(const id of ["calendar-language","photo-language"]){
      const english=$(id).querySelector?.('option[value="en"]');
      if(english)english.disabled=client.ready && !(client.sdkRevision>=6);
    }
    if($("sdk-ota-panel")){
      const sdkSupported=typeof OMSdkOTA!=="undefined" && OMSdkOTA.supported(client);
      const ready=client.ready && sdkSupported && !client.busy && !uiBusy && !schedulerRunning;
      const revision=Number($("sdk-ota-panel").dataset.revision);
      const model=client.ready && client.config?.model;
      const panel=model===2?"SSD1619":model===5?"JD79668":"";
      $("sdk-ota-panel").hidden=!sdkView;$("legacy-ota-content").hidden=sdkView;
      $("sdk-ota-bundled").disabled=!ready || !panel || !Number.isInteger(client.sdkRevision) || client.sdkRevision>revision;
      const label=client.ready && client.sdkRevision>revision?"设备版本高于内置包":client.ready && client.sdkRevision===revision?"重新刷入内置":"刷入内置";
      $("sdk-ota-bundled").textContent=OMI18n.t(label)+" SDK "+revision+(panel?" · "+panel:"");
      $("sdk-ota-power-hint").textContent=client.ready && sdkSupported?`当前 SDK ${client.sdkRevision} 的 OTA 门限为 ${(OMSdkOTA.minimumMillivolts(client.sdkRevision)/1000).toFixed(2)} V。SDK19起支持2.80 V；SDK2–18的本次升级仍需达到旧固件的2.90 V。`:"SDK19起 OTA 门限为2.80 V；SDK2–18仍为2.90 V。门限由当前设备固件决定，升级后会核对版本和运行镜像。";
      $("sdk-ota-start").disabled=!ready || !sdkPackage || !$("sdk-ota-consent").checked;
      $("sdk-ota-abort").disabled=!ready;
      $("sdk-ota-inspect").disabled=!ready;
      $("sdk-ota-file").disabled=$("sdk-ota-consent").disabled=uiBusy || client.busy || schedulerRunning;
    }
    const busy = client.busy || uiBusy || schedulerRunning, ready = client.ready && !busy;
    for(const name of Object.keys(sectionViews))$("nav-"+name).disabled=busy;
    for(const button of $("feature-tabs").children)button.disabled=busy;
    $("stock-save").disabled=busy||stockFetching;$("stock-start").disabled=busy||stockFetching;
    $("school-view").disabled=$("school-page").disabled=busy;
    $("transfer-status").classList.toggle("busy",busy);
    if(!client.ready)client.offlineRotation=null;
    $("connect").disabled = !supported || busy || client.ready;
    $("reconnect").disabled = !supported || busy || client.ready || !navigator.bluetooth?.getDevices || !$("saved-device").value;
    $("disconnect").disabled = !client.device?.gatt.connected || client.otaActive;
    const otaReady = ready && client.board?.name === OMProtocol.OTA_MARKER;
    if(!client.ready)$("ota-service").textContent=OMI18n.t("尚未检测；开始升级时会自动检查。");
    $("ota-inspect").disabled = !otaReady;
    $("ota-file").disabled = busy;
    $("ota-bundled").disabled = !otaReady || client.firmwareRevision === null || client.firmwareRevision >= bundledFirmwareRevision;
    const paired=OMOTA.pairedRevision(client.firmwareRevision);
    const bundledLabel=paired?"载入原配无线升级包":bundledRevision()===32?"载入内置 v32 兼容升级包":"载入内置 v33 升级包";
    $("ota-bundled").setAttribute("data-i18n",bundledLabel);$("ota-bundled").textContent=OMI18n.t(bundledLabel);
    $("ota-consent").disabled = busy;
    const revision=client.firmwareRevision;
    const needsTransition=!!otaPackage && (otaPackage.bundleVersion===7 ? !OMOTA.bundleRoute(revision) :
      !otaPackage.bundle && ((paired && otaPackage.revision!==paired) || (otaPackage.boot && revision!==29 && revision!==31 && revision<30) || (revision>=30 && !otaPackage.boot) || (!otaPackage.boot && otaPackage.hardened && revision!==27 && revision<28) ||
      (revision>=28 && !otaPackage.hardened) || (otaPackage.lifecycle && revision<18) || (otaPackage.repaired && revision<15)));
    const otaModel=otaPackage?.bundle?client.config?.model:otaPackage?.model;
    $("ota-start").disabled = !otaReady || !otaPackage || needsTransition || (otaPackage.bundle && client.firmwareRevision>=otaPackage.revision) || otaModel !== client.config?.model || !!scheduler || !$("ota-consent").checked;
    $("ota-capability").textContent = !client.ready ? OMI18n.t("v1-fixed HEX 已集成全部当前功能；有线刷入即可使用，ZIP 用于后续升级。") :
      client.board.name === OMProtocol.OTA_MARKER ? OMI18n.t("已连接 ELINK 独立固件，可以升级。") : OMI18n.t("当前是旧独立固件：请先有线刷入对应屏型的独立 OTA v1-fixed HEX。");
    if(otaReady && otaPackage?.bundle)
      $("ota-capability").textContent=OMI18n.t(revision===32?"已升级到 v32；再次载入内置 v33 升级包即可完成更新。":"旧版按原路线经配套 v31 或 v30 升至 v32，每次操作最多两次刷写；完成后再次载入内置 v33。锁定旧镜像或启动记录不兼容的版本仍使用对应屏型 HEX。");
    if(otaReady && needsTransition && !otaPackage.bundle)
      $("ota-capability").textContent=OMI18n.t(otaPackage.hardened?"本修复包需要配套过渡接收器；请使用内置整合包，没有发送升级命令":revision>=28?"当前版本不接受旧底层固件回退；没有发送升级命令":otaPackage.lifecycle?"本修复包需要过渡接收器；请使用新版两阶段整合包，没有发送升级命令":"请先升级 v15 过渡包并读回版本，再升级 v16 修复包；没有发送升级命令");
    if(otaReady && paired)
      $("ota-capability").textContent=OMI18n.t("请先载入原配无线升级包：")+"v"+revision+" → v"+paired+"。"+OMI18n.t("重启核对屏型和版本后，再载入内置包继续升级。");
    if(otaReady && revision===bundledFirmwareRevision && !otaPackage)
      $("ota-capability").textContent=OMI18n.t("v33 已是内置旧系列的最新版本。当前没有可从此版本安装 SDK 6 的无线包。");
    if(otaReady && otaPackage?.bundle && [1,2].includes(revision))
      $("ota-capability").textContent=OMI18n.t("v1/v2 的启动记录检查不兼容；请使用对应屏型 HEX，未发送升级命令");
    $("sdk-month-style-field").hidden=true;
    for(const button of $("calendar-presets").children){
      const style=Number(button.dataset.style);
      button.disabled=busy || (client.ready && style>0 && client.sdkRevision<(style===5?8:7));
      button.setAttribute("aria-pressed",String(style===Number($("sdk-month-style").value)));
    }
    $("calendar-preset-note").textContent=client.ready && !(client.sdkRevision>=7)?"当前固件可使用经典月历，其他布局可断开连接后预览。":"选择方案后在右侧查看实际像素效果。";
    $("sdk-single-day").disabled=$("sdk-single-day").hidden=client.ready && !(client.sdkRevision>=8);
    $("scheduler-start").disabled = busy;
    for (const id of ["native-calendar", "calendar-style", "set-time", "background-clear", "holiday-read", "holiday-write",
      "gallery-read", "photo-gallery-read", "job-add"]) $(id).disabled = !ready;
    $("photo-read-preview").disabled=!ready || !(client.sdkRevision>=16) || $("photo-slot").value==="";
    for(const id of ["holiday-read","holiday-write"])$(id).disabled=!ready || Number($("calendar-layout").value)!==0;
    $("photo-calendar-start").disabled = !ready || $("photo-slot").value==="" || !gallery || gallery.external!==($("photo-source").value==="1");
    $("native-clock").disabled = !ready || ((client.config?.model === 5 || OMProtocol.sdkBoard(client.board)) && !$("clock-full").checked);
    $("led-off").disabled = $("led-on").disabled = !ready || client.config?.model !== 5;
    $("preview-model").disabled = client.ready || busy;
    $("rotate").disabled=busy || ["calendar","photo-calendar","course"].includes(tab) || (tab==="image" && $("image-target").value==="calendar");
    $("packet-bytes").disabled = $("packet-delay").disabled = $("render-reset").disabled = busy;
    const canSend = ready && client.canPublish && !!frame && !loading && drawable.has(tab);
    const screenScene=["calendar","photo-calendar","course","todo","stock"].includes(tab);document.documentElement.dataset.screenScene=String(screenScene);
    $("publish").disabled = $("store-frame").disabled = !canSend || screenScene;
    $("download").disabled = !frame || loading || (!drawable.has(tab) && !["calendar","photo-calendar"].includes(tab));
    $("image-file").disabled=busy || loading;
    for(const id of ["image-target","image-fit","photo-source","photo-slot","photo-fit","gallery-source","save-auto","auto-frequency"])$(id).disabled=busy || loading;
    for(const node of $("library-grid").children)node.disabled=busy || loading;
    $("save-slot").disabled=$("save-auto").checked || busy;
    const imageTab=tab==="image",prepared=imageTab && $("image-target").value==="calendar";
    $("publish").textContent=OMI18n.t(imageTab?(prepared?"保存并启用图片日历":"保存并显示图片"):"发送到屏幕");
    $("store-frame").textContent=OMI18n.t(prepared?"保存并继续设置日历":"仅保存到设备");
    $("quick-change").disabled=!ready || !client.canPublish || !OMRotation.presentation(client);
    const rotation=client.offlineRotation;
    $("auto-rotation-panel").hidden=!["photo-calendar","image","gallery"].includes(tab);
    $("auto-apply").disabled=!ready || !OMRotation.supported(client) || (!rotation?.active && !OMRotation.presentation(client));
    $("auto-state").textContent=OMI18n.t(!client.ready?"连接设备后可读取自动换图状态。":!OMRotation.supported(client)?"离线日、周、月换图需要 v24 固件，请先升级。":!rotation?"自动换图状态尚未核实，请重新读取或连接。":rotation.active?"已在设备启用，关闭网页后仍会执行。当前存储源的全部有效图片依次参与轮播。":"尚未启用。启用图片日历或换图时，保存两张以上图片会默认每天更换。");
    const slot = gallery?.external === external() && gallery.slots.find(s => s.slot === Number($("gallery-slot").value));
    for (const id of ["slot-display", "slot-delete", "slot-background", "slot-remark-save"]) $(id).disabled = !ready || !slot?.valid;
    if(slot?.color&128)$("slot-display").disabled=$("slot-background").disabled=true;
    $("rotation-save").disabled = !ready || !gallery || gallery.external !== external();
    $("connection-state").textContent = busy ? OMI18n.t("操作中") : client.ready ? OMI18n.t("已连接") : OMI18n.t("未连接");
    $("connection-state").classList.toggle("online", client.ready);
    $("device-name").textContent = client.ready ? connectedName() || OMI18n.t("OM6626 屏幕") : OMI18n.t("连接一台屏幕开始");
    $("device-id").textContent = client.ready ? client.device.id : "—";
    const info = client.ready ? client.deviceInfo : null;
    try {
      if (client.ready) window.sessionStorage?.setItem("elink42-course-device-v1", JSON.stringify({deviceName: connectedName(), millivolts: info?.millivolts ?? null}));
      else window.sessionStorage?.removeItem("elink42-course-device-v1");
    } catch (_) { /* Optional editor handoff must not interrupt device queries when session storage is unavailable. */ }
    $("device-mac").textContent = info?.mac || "—";
    $("device-voltage").textContent = info?.millivolts == null ? "—" : (Math.round(info.millivolts / 10) / 100).toFixed(2) + " V";
    $("device-voltage").classList.toggle("low-voltage", info?.millivolts != null && info.millivolts < 2800);
    $("device-info-hint").textContent = OMI18n.t(!client.ready ? "连接后读取设备电压和 MAC。" :
      !client.deviceInfoSupported ? "设备信息与初始页需要 v32 或更新固件" :
      !info || info.millivolts == null ? "电压尚未读出，可点击刷新设备信息。" :
      info.millivolts < 2700 ? "电量不足：停止新刷新，蓝牙与查询仍可使用。" :
      info.millivolts < 2800 ? "电池电量低，仍可刷屏；请准备更换电池。" : "电压为最近一次采样，点击刷新可重新读取。");
    for (const id of ["device-info-refresh", "device-home"]) $(id).disabled = !ready || !client.deviceInfoSupported || client.otaActive;
    $("firmware-state").textContent = client.ready && OMProtocol.sdkBoard(client.board) ? `SDK ${client.sdkRevision}` : client.ready && client.firmwareRevision ? `v${client.firmwareRevision}` +
      OMI18n.t(" · 网页内置 v") + bundledFirmwareRevision + (client.firmwareRevision < bundledFirmwareRevision ? OMI18n.t(" · 发现内置更新") : "") : OMI18n.t("待核对");
    $("screen-model").textContent = client.ready ? client.config.model === 5 ? OMI18n.t("JD79668 · 四色") : OMI18n.t("SSD1619 · 黑白红") : OMI18n.t("三色 / 四色 · 连接后识别");
    $("device-summary").hidden = !client.ready;
    $("device-summary").textContent = client.ready ? `OM6626B · ${$("screen-model").textContent.split(" · ")[0]} · ${$("firmware-state").textContent.split(" · ")[0]} · ${info?.millivolts == null ? OMI18n.t("电压尚未读出") : $("device-voltage").textContent}` : "";
    $("device-summary").classList.toggle("low-voltage", info?.millivolts != null && info.millivolts < 2800);
    $("mtu-state").textContent = OMI18n.msg`${client.reportedPayload || 20} B ATT / ${client.payload} B 当前发送`;
    $("clock-capability").textContent = client.ready && OMProtocol.sdkBoard(client.board) ? OMI18n.t("独立固件的三色和四色时钟均使用全刷，请先确认接受频繁刷新。") : client.ready ? client.config.model === 5 ?
      OMI18n.t("JD79668：原驱动局刷回调为空，只能启用原版全刷时钟；不建议长期开启。") :
      OMI18n.t("SSD1619：原驱动提供局刷。设备每分钟更新，首次、跨日及定期清屏会全刷。") :
      OMI18n.t("SSD1619 原驱动有局刷；JD79668 原驱动没有局刷接口。");
    const clockConsent=$("clock-full").nextElementSibling;
    if(clockConsent){const text=OMProtocol.sdkBoard(client.board)?"我接受时钟频繁全刷":"我接受 JD79668 原版频繁全刷时钟";clockConsent.setAttribute("data-i18n",text);clockConsent.textContent=OMI18n.t(text);}
    const clockHint=$("native-clock").nextElementSibling;
    if(clockHint && clockHint.classList.contains("hint"))clockHint.textContent=OMI18n.t(OMProtocol.sdkBoard(client.board)?"独立固件每分钟全刷一次；两种屏型均不宣称局刷。":"三色时钟使用原局刷路径，首次及定期清屏仍会全刷。四色不会标为局刷。");
    $("nfc-write").disabled = !ready || !("NDEFReader" in window);
    $("nfc-read").disabled = !("NDEFReader" in window);
    if([18,20,23,27,29,31].includes(revision)) for(const id of ["native-calendar","calendar-style","set-time","background-clear","holiday-write",
      "photo-calendar-start","native-clock","publish","store-frame","slot-display","slot-delete",
      "slot-background","slot-remark-save","rotation-save","scheduler-start","quick-change","auto-apply"] ) $(id).disabled=true;
    OMScreen.device({ready:client.ready,busy,frame:!!frame&&!loading&&(tab!=="stock"||!!store.data.stocks?.quotes.length),school:OMSchool.supported(client),reminder:OMReminder.supported(client),runtime:client.runtime});
  }
  function frameFrom(canvas, settings = store.data.settings, chosenModel = model()) {
    const pixels = OMFeatures.process(canvas.getContext("2d").getImageData(0, 0, 400, 300).data, chosenModel, settings);
    return OMProtocol.planes(pixels, $("rotate").checked && !(tab==="image" && $("image-target").value==="calendar"), chosenModel);
  }
  function context() { return {title: $("template-title").value, content: $("template-content").value, todos: store.data.todos, weather: store.data.weather, saying}; }
  function newCanvas() { const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 300; return canvas; }
  async function preview() {
    const token = ++previewToken; frame = null; update();
    const calendarTab=tab==="calendar" || tab==="photo-calendar";
    if(tab==="calendar")renderPresets();
    $("preview-panel").hidden = (!drawable.has(tab) && !calendarTab);
    if (!drawable.has(tab) && !calendarTab) return;
    try {
      const canvas = newCanvas(), settings = F.clone(store.data.settings), chosenModel = model();let pageLabel="";
      if(calendarTab){
        const region=C.byId(Number($("calendar-layout").value))||C.regions[0];
        const date=$("calendar-date").value ? new Date($("calendar-date").value+"T12:00:00") : C.localDate(region.code);
        const style=tab==="calendar"?Number($("sdk-month-style").value)||0:0;
        const sdkLayout=client.ready ? OMProtocol.sdkBoard(client.board) && client.sdkRevision>=6 : sdkOnly || style>0 || (tab==="calendar" && [0,2,3].includes(region.id));
        if(sdkLayout){
          const photo=tab==="photo-calendar", info=client.ready?client.deviceInfo:null;
          const name=connectedName();
          await OMSdkPreview.calendar(canvas,{date,country:Number($("calendar-layout").value),model:chosenModel,
            revision:client.ready?client.sdkRevision:12,flags:(style<<3)|(photo?1:0)|($("calendar-language").value==="zh"?2:0),millivolts:info?.millivolts,deviceName:name});
          if(token!==previewToken)return;
          if(photo)OMScreen.paintBackground(canvas,chosenModel);
        }else OMRender.calendar(canvas,{code:region.code,date,language:$("calendar-language").value,photo:tab==="photo-calendar",bitmap:null,slot:$("photo-slot").value,model:chosenModel});
        frame=OMProtocol.planes(canvas.getContext("2d").getImageData(0,0,400,300).data,false,chosenModel);
        $("preview").getContext("2d").drawImage(canvas,0,0);
        $("preview-label").textContent=OMI18n.t(tab==="calendar"?"标准日历":"图片日历")+" · "+OMI18n.t(region.zh)+" · 400 × 300"+(sdkLayout && tab==="photo-calendar" && !OMScreen.current().background?" · "+OMI18n.t("设备照片未读回，左侧留白"):"");
        return;
      }
      if (tab === "image") {
        if (!bitmap || loading) { OMRender.image(canvas, null); $("preview").getContext("2d").drawImage(canvas, 0, 0);$("preview-label").textContent=OMI18n.t("尚未选择图片"); return; }
        OMRender.image(canvas, bitmap, {target:$("image-target").value,fit: $("image-fit").value, angle: Number($("image-angle").value), zoom: Number($("image-zoom").value), x: Number($("image-x").value), y: Number($("image-y").value)});
      } else if (tab === "todo") {
        const p=OMScreen.capture(),items=p.reminderId?store.data.todos.filter(t=>t.id===p.reminderId):store.data.todos;
        await OMRender.reminderCalendar(canvas,items,{date:p.date?new Date(p.date+"T12:00:00"):new Date(),country:p.country,title:p.reminderTitle,model:chosenModel,deviceName:connectedName(),millivolts:client.deviceInfo?.millivolts});
      } else if (tab === "template") await OMRender.template(canvas, F.clone(draft), context());
      else if (tab === "course") {
        const p=OMScreen.capture(),date=p.update==="snapshot"&&p.date?CourseTable.dateValue(p.date):C.localDate((C.byId(Number($("calendar-layout").value)) || C.regions[0]).code);
        const proof=await OMSchool.render(canvas, {date, courses: store.data.courses, exams: store.data.exams || [],
          examDays: store.data.examDays || {}, view: $("school-view").value, page:Number($("school-page").value)-1, panel: chosenModel === 5 ? "four" : "three",
          deviceName: connectedName(), millivolts: client.ready ? client.deviceInfo?.millivolts : null});
        pageLabel=` · 第${proof.page+1}/${proof.pages}页`;
      }
      else if (tab === "stock") await OMRender.stockCalendar(canvas,store.data.stocks,{date:new Date(),model:chosenModel,deviceName:connectedName(),millivolts:client.deviceInfo?.millivolts});
      if (token !== previewToken) return;
      frame = ["stock","course","todo"].includes(tab) ? OMProtocol.planes(canvas.getContext("2d").getImageData(0,0,400,300).data,false,chosenModel) : frameFrom(canvas, settings, chosenModel);
      $("preview").getContext("2d").putImageData(new ImageData(OMProtocol.rgba(frame), 400, 300), 0, 0);
      $("preview-label").textContent = {image: OMI18n.t("图片"), todo: "提醒日历",stock:"股票日历", template: OMI18n.t("模板"), course: OMI18n.t("周日程 / 课表")}[tab] +
        ` · 400 × 300 · ${chosenModel === 5 ? OMI18n.t("四色（黑白黄红）") : OMI18n.t("三色（黑白红）")}`+pageLabel;
      $("preview").setAttribute("aria-label", $("preview-label").textContent + OMI18n.t("预览"));
    } catch (error) { if (token === previewToken) { frame = null; result(error.message, true); } }
    finally { if (token === previewToken) update(); }
  }
  function snapshot() { if (!frame || loading || (!drawable.has(tab) && !["calendar","photo-calendar"].includes(tab))) throw Error(OMI18n.t("当前没有可发送的画面")); return frame.packed ? {packed: frame.packed.slice()} : {black: frame.black.slice(), red: frame.red.slice()}; }
  function progress(value, label) { $("progress").value = value; result(label); }
  async function action(callback, complete = OMI18n.t("操作完成；设备显示和灯光请核对实物。")) {
    try { const value = await callback(); if (complete) result(complete); return value; }
    catch (error) { result(error.message, true); log(error.message); return undefined; }
    finally { client.armIdleDisconnect(); update(); }
  }
  function bind(id, callback, complete) { $(id).addEventListener("click", () => action(callback, complete)); }
  function download(name, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function jsonDownload(name, data) { download(name, new Blob([JSON.stringify(data, null, 2)], {type: "application/json"})); }
  async function jsonFile(file) { if (!file || file.size > 4500000) throw Error(OMI18n.t("JSON 文件最大 4.5 MB")); return JSON.parse(await file.text()); }
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const sectionOf=name=>name==="photo-calendar"?"photo":name==="todo"?"reminder":["image","gallery"].includes(name)?"gallery":["calendar","course","stock"].includes(name)?name:"settings";
  function selectTab(button) {
    tab = button.dataset.tab;
    const nativeScene=["calendar","photo-calendar","course","todo","stock"].includes(tab);
    if(nativeScene)$("rotate").checked=false;
    if($("rotate").parentElement)$("rotate").parentElement.hidden=nativeScene;
    const section=sectionOf(tab);sectionViews[section]=tab;
    for (const b of tabs) { const on = b === button; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; $(b.getAttribute("aria-controls")).hidden = !on; }
    for(const b of tabs)b.hidden=sectionOf(b.dataset.tab)!==section;
    $("feature-tabs").hidden=!["settings","gallery"].includes(section);
    $("screen-workbench").hidden=["settings","gallery"].includes(section);
    $("screen-date-settings").hidden=section==="stock";
    document.documentElement.dataset.section=section;
    if($("transfer-status").parentElement)(section==="settings"||tab==="gallery"?$("content-editor").parentElement:$("preview-panel")).append($("transfer-status"));
    $("scene-title").textContent={calendar:"日历",photo:"图片日历",reminder:"提醒日历",course:"课程日历",stock:"股票日历",gallery:"图库",settings:"设置"}[section];
    for(const name of Object.keys(sectionViews))$("nav-"+name).setAttribute("aria-pressed",String(name===section));
    renderLibrary();
    if(tab==="calendar")renderPresets();
    OMScreen.context(tab);
    client.armIdleDisconnect();
    preview();
    window.scrollTo?.({top:0,behavior:"instant"});
  }
  for(const name of Object.keys(sectionViews))bind("nav-"+name,()=>selectTab($("tab-"+sectionViews[name])),"");
  let presetKey="";
  function renderPresets(){
    if(typeof OMSdkPreview==="undefined")return;
    const date=$("calendar-date").value?new Date($("calendar-date").value+"T12:00:00"):C.localDate(C.byId(Number($("calendar-layout").value)).code);
    const key=[$("preview-model").value,$("calendar-layout").value,date.toDateString()].join(":");
    if(key===presetKey)return;presetKey=key;
    for(const button of $("calendar-presets").children){
      const canvas=button.querySelector("canvas"),region=C.byId(Number($("calendar-layout").value));
      OMSdkPreview.calendar(canvas,{date,country:region.id,model:model(),revision:16,flags:(Number(button.dataset.style)<<3)|2}).catch(error=>{presetKey="";$("calendar-preset-note").textContent=error.message;});
    }
  }
  function setupShell(){
    for(const [style,name] of [[0,"经典月历"],[1,"月历全览"],[2,"今日侧栏"],[4,"全屏极简"],[5,"单日极简"]]){
      const b=document.createElement("button"),canvas=newCanvas(),label=document.createElement("span");
      b.dataset.style=String(style);b.setAttribute("aria-pressed",String(style===0));label.textContent=name;b.append(canvas,label);
      b.addEventListener("click",()=>{if(b.disabled)return;$("sdk-month-style").value=String(style);$("calendar-language").value="zh";syncCalendar();OMScreen.persist();});
      $("calendar-presets").append(b);
    }
    if(!$("content-editor").parentElement)return;
    const main=document.querySelector("main"),oldAside=main.querySelector("aside"),header=document.querySelector("header"),rail=document.createElement("aside");
    rail.className="navigation-rail";rail.append(document.querySelector(".primary-nav"),document.querySelector(".site-links"));main.prepend(rail);
    const settings=$("settings-editor"),device=$("device-panel");
    settings.prepend($("compatibility"),$("device-details"),oldAside.querySelector(".device-extras"));header.insertBefore(device,header.querySelector(".header-tools"));oldAside.remove();
    const backup=document.createElement("details"),summary=document.createElement("summary");summary.textContent="导入 / 导出方案";backup.className="plan-backup";backup.append(summary,document.querySelector(".plan-actions"));$("screen-workbench").append(backup);
    $("preview-panel").insertBefore($("screen-apply"),$("preview-panel").querySelector(".preview-caption"));
    $("preview-panel").append($("transfer-status"));
    $("settings-editor").append($("operation-log"));
  }
  tabs.forEach(b => {
    b.addEventListener("click", () => selectTab(b));
    b.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();const shown=tabs.filter(item=>!item.hidden),i=shown.indexOf(b);
      const next = event.key === "Home" ? 0 : event.key === "End" ? shown.length - 1 : (i + (event.key === "ArrowRight" ? 1 : -1) + shown.length) % shown.length;
      shown[next].focus(); selectTab(shown[next]);
    });
  });
  function restoreDevicePresentation() {
    $("preview-model").value=String(client.config.model);
    if(OMScreen.hasProfile()){OMScreen.restore();return;}
    const style=client.config.alternate>>3;
    $("sdk-month-style").value=String(client.sdkRevision>=7 && client.config.alternate!==26 && style<6?style:0);
    if(client.sdkRevision>=15 && (client.sdkCapabilities&32) && [6,7].includes(style))$("school-view").value=style===7?"week":"day";
    $("preview-model").value = String(client.config.model);
    $("calendar-layout").value = String(C.byId(client.config.layout)?client.config.layout:0);
    $("calendar-language").value = client.sdkRevision>=6 && !(client.config.alternate&2) ? "en" : "zh"; syncCalendar();
    if(client.calendarProtocol===2){
      const school=client.sdkRevision>=15 && [6,7].includes(style),reminder=client.sdkRevision>=17 && style===8;
      $("photo-source").value=String(client.config.photoSource);
      options("photo-slot",school || reminder || client.config.photoSlot===255?[]:[[client.config.photoSlot,OMI18n.t("Device slot")+" "+client.config.photoSlot]]);
      if(school || reminder)$("gallery-source").value=String(client.config.photoSource);
      $("photo-fit").value=!(client.config.alternate&1)||client.config.alternate&4?"contain":"prepared";
      selectTab($(reminder?"tab-todo":school?"tab-course":client.config.alternate&1?"tab-photo-calendar":"tab-calendar"));
    }
  }
  function sdkBootComplete(state){
    const text=OMI18n.t("升级完成")+" · "+(state.model===5?"JD79668":"SSD1619")+" · SDK "+state.revision+
      " · CRC32 "+state.runningCrc.toString(16).toUpperCase().padStart(8,"0");
    $("sdk-ota-state").textContent=text; log(text); progress(100,text);
  }
  async function finishSdkUpdate(receipt){
    if(receipt.identityChange){
      pendingIdentityReceipt=receipt; client.disconnect();
      const text=OMI18n.t("固件已提交。等屏幕显示新名称后，点击「连接屏幕」选择该名称，网页会自动核对升级结果。");
      $("sdk-ota-state").textContent=text; log(text); progress(99,text);
      return;
    }
    const state=await OMSdkOTA.confirmBoot(client,receipt,progress);
    if(client.deviceInfoSupported)await client.operation(()=>client.readDeviceInfo());
    await client.operation(()=>client.readRuntime());
    restoreDevicePresentation(); sdkBootComplete(state);
  }
  async function connected(device) {
    const stayOnOTA = tab === "ota";
    if(!transientWorkspace)store=new F.Store(localStorage);
    const keepProfile=OMScreen.hasProfile();
    gallery = null; await client.connect(device); $("device-details").open = true;
    if(pendingIdentityReceipt){
      try{
        const state=await OMSdkOTA.confirmRestoredAddress(client,pendingIdentityReceipt,progress);
        sdkBootComplete(state);
        pendingIdentityReceipt=null;
      }catch(error){client.disconnect();throw error;}
    }
    restoreDevicePresentation();
    if(sdkOnly && !OMProtocol.sdkBoard(client.board)){client.disconnect();throw Error(OMI18n.t("此控制台仅用于独立 SDK 固件，请为原设备使用原控制台。"));}
    if (stayOnOTA) selectTab($("tab-ota"));
    change(data => {
      const saved = data.devices.find(d => d.id === client.device.id);
      const name = connectedName() || "OM6626";
      if (saved) saved.name = name;
      else data.devices.push({id: client.device.id, name});
    });
    $("saved-device").value = client.device.id; await preview();
    if (OMProtocol.sdkBoard(client.board)) {
      if(client.deviceInfoSupported && !client.deviceInfo)await client.operation(()=>client.readDeviceInfo());
      await client.operation(()=>client.readRuntime());
      if(OMSchool.supported(client)){const state=await client.operation(()=>OMSchool.state(client));if(state.format===2&&!keepProfile){$("school-page").value=String(state.page+1);OMScreen.persist();}}
      await preview();
      if(OMRotation.supported(client)){await OMRotation.read(client);if(!keepProfile && client.offlineRotation.frequency)$("auto-frequency").value=String(client.offlineRotation.frequency);}
    } else if (client.board.name === OMProtocol.OTA_MARKER) {
      try { await client.operation(() => OMOTA.readRevision(client)); }
      catch (error) { log(error.message); throw Error(OMI18n.t("无法核对固件版本，请重新连接后重试；没有发送升级命令。")); }
      if(client.firmwareRevision===34)await showMigrationProbe();
      if(client.deviceInfoSupported) await client.operation(() => client.readDeviceInfo());
      if(OMRotation.supported(client)){await OMRotation.read(client);if(!keepProfile && client.offlineRotation.frequency)$("auto-frequency").value=String(client.offlineRotation.frequency);}
      if (client.firmwareRevision < bundledFirmwareRevision && window.confirm(
        OMI18n.msg`当前固件 v${client.firmwareRevision}，网页内置升级包 v${bundledFirmwareRevision}。网页已内置对应屏型的升级包。升级会清空图库，请先备份。现在前往 OTA 升级？`)) {
        selectTab($("tab-ota")); await loadBundledFirmware();
      }
    }
  }
  bind("connect", () => connected(), OMI18n.t("设备已连接。日历页可直接启用日历。"));
  bind("reconnect", async () => {
    if (!navigator.bluetooth.getDevices) throw Error(OMI18n.t("此浏览器未提供已授权设备列表"));
    const device = (await navigator.bluetooth.getDevices()).find(d => d.id === $("saved-device").value);
    if (!device) throw Error(OMI18n.t("此设备尚未授予网页蓝牙权限，请使用连接屏幕重新选择")); await connected(device);
  });
  bind("forget-device", () => change(data => { data.devices = data.devices.filter(d => d.id !== $("saved-device").value); }), OMI18n.t("已取消本地记录。系统蓝牙权限可在浏览器站点设置中移除。"));
  $("saved-device").addEventListener("change", update);
  bind("disconnect", () => { client.disconnect(); gallery = null; }, OMI18n.t("已断开，已提交的刷新可能仍在继续。"));
  bind("device-info-refresh", async () => {await client.operation(() => client.readDeviceInfo());await preview();}, "");
  bind("device-home", () => client.home(progress), OMI18n.t("已回到设备初始页；保存的图片仍保留。"));
  const startCalendar=(photo=false,date=new Date())=>{client.offlineRotation=null;return client.internationalCalendar(Number($("calendar-layout").value),$("calendar-language").value,photo,Number($("photo-slot").value),$("photo-source").value==="1",progress,date,$("photo-fit").value,photo?0:Number($("sdk-month-style").value)||0);};
  bind("native-calendar", () => startCalendar());
  bind("native-clock", () => client.mode(2, progress, new Date(), $("clock-full").checked));
  $("clock-full").addEventListener("change", update);
  if($("sdk-ota-panel")){
    $("sdk-ota-file").addEventListener("change",()=>action(async()=>{
      sdkPackage=null;const file=$("sdk-ota-file").files[0];
      $("sdk-ota-consent").checked=false;update();
      if(!file)return;
      sdkPackage=await OMSdkOTA.parse(await file.arrayBuffer());
      $("sdk-ota-state").textContent=file.name+" · SDK "+sdkPackage.revision+" · "+(sdkPackage.model===2?"SSD1619":"JD79668")+" · "+sdkPackage.size+" B";
    },""));
    $("sdk-ota-consent").addEventListener("change",update);
    async function flashSdk(bundled){
      const device=client.device, model=client.config?.model;
      if(uiBusy || client.busy || schedulerRunning || !client.ready || !OMSdkOTA.supported(client))return;
      if(!bundled && (!sdkPackage || !$("sdk-ota-consent").checked))throw Error(OMI18n.t("请先选择 SDK 升级包并确认供电稳定。"));
      uiBusy=true;update();
      try{
        let pkg=sdkPackage;
        if(bundled){
          const button=$("sdk-ota-bundled"), revision=Number($("sdk-ota-panel").dataset.revision);
          const url=button.getAttribute("data-src-"+model), integrity=button.getAttribute("data-integrity-"+model);
          if(!url || !integrity || !Number.isInteger(client.sdkRevision) || client.sdkRevision>revision)throw Error(OMI18n.t("升级包与当前 SDK 版本或屏型不匹配，没有开始写入。"));
          $("sdk-ota-state").textContent=OMI18n.t("正在载入内置升级包，请稍候…");
          let data;
          try{
            const response=await fetch(url,{mode:"same-origin",redirect:"error",integrity,signal:AbortSignal.timeout(30000)});
            if(!response.ok)throw Error(String(response.status));
            data=await response.arrayBuffer();
          }catch{throw Error(OMI18n.t("无法读取或校验内置 SDK 包，请刷新页面后重试。"));}
          pkg=await OMSdkOTA.parse(data);
          if(pkg.model!==model || pkg.revision!==revision)throw Error(OMI18n.t("升级包与当前 SDK 版本或屏型不匹配，没有开始写入。"));
        }
        if(!client.ready || client.device!==device || client.config?.model!==model)throw Error(OMI18n.t("升级期间目标设备发生变化，已停止"));
        $("sdk-ota-state").textContent="SDK "+pkg.revision+" · "+(model===2?"SSD1619":"JD79668");
        OMScreen.saveBeforeOTA();log('屏幕方案已保存到本机，开始升级。需要文件备份可使用“导出方案”。');
        const receipt=await OMSdkOTA.transfer(client,pkg,progress);
        await finishSdkUpdate(receipt);
        $("sdk-ota-consent").checked=false;
      }catch(error){
        $("sdk-ota-state").textContent=error.message+(error.otaState?' '+OMSdkOTA.describe(error.otaState):'');throw error;
      }finally{uiBusy=false;update();}
    }
    bind("sdk-ota-bundled",()=>flashSdk(true),"");
    bind("sdk-ota-start",()=>flashSdk(false),"");
    bind("sdk-ota-inspect",async()=>{const state=await OMSdkOTA.inspect(client),text=OMSdkOTA.describe(state);$("sdk-ota-state").textContent=text;log(text);},"");
    bind("sdk-ota-abort",async()=>{await OMSdkOTA.abort(client);$("sdk-ota-state").textContent=OMI18n.t("未提交的升级已取消，原应用和图库仍保留。");});
  }
  bind("set-time", () => { const date = new Date($("custom-time").value); if (!Number.isFinite(+date)) throw Error(OMI18n.t("请选择有效时间")); return client.internationalCalendar(client.config.layout,$("calendar-language").value,!!(client.config.alternate&1),client.config.photoSlot,!!client.config.photoSource,progress,date,client.config.alternate&4?"contain":"prepared",client.config.alternate===26?0:client.config.alternate>>3); });
  bind("calendar-style", () => startCalendar());
  bind("photo-calendar-start",()=>locked(async()=>{await startCalendar(true);await defaultRotation(Number($("photo-slot").value),$("photo-source").value==="1",true);}));
  $("sdk-month-style").addEventListener("change",()=>{
    if(Number($("sdk-month-style").value))$("calendar-language").value="zh";
    syncCalendar();
  });
  function syncCalendar(fromPhoto=false,persist=true){
    if(fromPhoto){$("calendar-layout").value=$("photo-country").value;$("calendar-language").value=$("photo-language").value;}
    else {$("photo-country").value=$("calendar-layout").value;$("photo-language").value=$("calendar-language").value;}
    if($("calendar-language").value!=="zh")$("sdk-month-style").value="0";
    if(persist)store.change(data=>{data.settings.calendarCountry=Number($("calendar-layout").value);data.settings.calendarLanguage=$("calendar-language").value;});
    calendarInfo();preview();
  }
  function calendarInfo(){
    const region=C.byId(Number($("calendar-layout").value))||C.regions[0], date=$("calendar-date").value ? new Date($("calendar-date").value+"T12:00:00"):C.localDate(region.code);
    const known=region.years.includes(date.getFullYear());
    $("holiday-summary").textContent=OMI18n.t("Offline holidays: ")+region.years.join(", ")+". "+OMI18n.t(known?"National holidays; local/state holidays are excluded.":"Holiday data is unavailable for this year. Update the holiday table; dates are still shown.");
    const next=C.nextHoliday(region.code,date);
    if(next)$("holiday-summary").textContent+=" "+OMI18n.t("下一假期：")+OMI18n.label(next.names[OMI18n.language==="en"?0:1])+" · "+next.date+".";
    if(region.code==="MY")$("holiday-summary").textContent+=" "+OMI18n.t("Malaysia: nationwide dates only; state holidays and replacement days vary. Islamic dates may change.");
    if(region.code==="TW")$("holiday-summary").textContent+=" "+OMI18n.t("Taiwan: government-office calendar.");
    $("holiday-list").replaceChildren();
    for(const [dateKey,key,work] of region.days.filter(d=>d[0].startsWith(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`)))
      row("holiday-list",dateKey.slice(5)+" · "+OMI18n.label(OMHolidays.names[key][OMI18n.language==="en"?0:1])+(work?" · "+OMI18n.t("班"):""));
    const link=document.createElement("a");link.href=OMHolidays.sources[region.code];link.target="_blank";link.rel="noopener noreferrer";link.textContent=OMI18n.t("Official holiday source");$("holiday-summary").append(" ",link);
  }
  for(const id of ["calendar-layout","calendar-language"])$(id).addEventListener("change",()=>action(()=>syncCalendar(),""));
  for(const id of ["photo-country","photo-language"])$(id).addEventListener("change",()=>action(()=>syncCalendar(true),""));
  $("calendar-date").addEventListener("input",()=>{calendarInfo();preview();});
  bind("background-clear", () => client.clearBackground(progress));
  bind("led-off", () => client.led(false)); bind("led-on", () => client.led(true));
  async function loadFirmware(file, expectedArchiveHash) {
    if (client.busy || uiBusy || schedulerRunning) throw Error(OMI18n.t("设备或页面正在操作，请等待后再选择 OTA 包"));
    otaPackage = null; $("ota-consent").checked = false;
    $("ota-package").textContent = OMI18n.t("尚未选择有效的签名 OTA ZIP");
    $("ota-kind").textContent = OMI18n.t("只接受本项目签名包，原版固件不能通过校验。");
    if (!file) { $("ota-package").textContent = OMI18n.t("尚未选择固件包"); update(); return; }
    if (!/\.zip$/i.test(file.name) || file.size > 2 * 1024 * 1024) throw Error(OMI18n.t("请选择 2 MB 内的签名 OTA ZIP"));
    uiBusy = true; update(); $("ota-package").textContent = OMI18n.t("正在校验 ZIP、签名、固件哈希及保护区…");
    try {
      const raw=await file.arrayBuffer();
      if(expectedArchiveHash) {
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",raw)),b=>b.toString(16).padStart(2,"0")).join("");
        if(digest!==expectedArchiveHash)throw Error(OMI18n.t("内置固件版本或屏型不匹配，已停止"));
      }
      otaPackage = await OMOTA.parse(raw);
      if(otaPackage.bundle && otaPackage.bundleVersion!==7) throw Error(OMI18n.t("旧整合包已停用，请载入内置 v32 两阶段升级包"));
      $("ota-package").textContent = OMI18n.msg`${file.name} · ${otaPackage.bundle?OMI18n.t("SSD1619 三色 / JD79668 四色整合包"):otaPackage.model === 5 ? OMI18n.t("JD79668 四色") : OMI18n.t("SSD1619 三色")} · ${otaPackage.size.toLocaleString()} 字节 · 版本 ${otaPackage.version} · SHA-256 ${otaPackage.sha256}`;
      $("ota-kind").textContent = OMI18n.t(otaPackage.bundle?"整合包签名、屏型和配对校验通过；确认一次，最多两次刷写到 v32。":"项目签名和保护区校验通过；升级继续保持独立模式，不恢复原版激活流程。");
      result(OMI18n.t("固件包校验通过，尚未向设备发送任何 OTA 命令。"));
    } catch (error) { otaPackage=null;$("ota-package").textContent = OMI18n.t("固件包校验未通过；没有发送升级命令"); throw error; }
    finally { uiBusy = false; client.armIdleDisconnect(); update(); }
  }
  async function loadBundledFirmware() {
    if(client.busy || uiBusy || schedulerRunning)throw Error(OMI18n.t("设备或页面正在操作，请等待后再选择 OTA 包"));
    if (!client.ready || client.board?.name !== OMProtocol.OTA_MARKER || !client.firmwareRevision)
      throw Error(OMI18n.t("请先连接屏幕并核对固件版本"));
    if (client.firmwareRevision >= bundledFirmwareRevision) throw Error(OMI18n.t("没有更高版本的内置升级包"));
    const device=client.device, model=client.config.model, revision=bundledRevision();
    if(typeof OMFirmware==="undefined"){
      otaPackage=null;$("ota-consent").checked=false;uiBusy=true;$("ota-package").textContent=OMI18n.t("正在载入内置升级包，请稍候…");update();
      let timer;
      try{
        if(!firmwareRequest)firmwareRequest=new Promise((resolve,reject)=>{
          const script=document.createElement("script");
          script.onload=resolve;
          script.onerror=()=>{script.remove();firmwareRequest=null;reject(Error(OMI18n.t("载入内置升级包失败，请检查网络后重试")));};
          script.src=$("ota-bundled").dataset.firmwareSrc;document.head.append(script);
        });
        await Promise.race([firmwareRequest,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error(OMI18n.t("载入内置升级包超时，请检查网络后重试"))),60000);})]);
      }catch(error){$("ota-package").textContent=error.message;throw error;}finally{clearTimeout(timer);uiBusy=false;update();}
    }
    if(typeof OMFirmware==="undefined" || OMFirmware.revision!==bundledFirmwareRevision)throw Error(OMI18n.t("内置固件版本或屏型不匹配，已停止"));
    if(client.device!==device || !client.ready || client.config?.model!==model || bundledRevision()!==revision)
      throw Error(OMI18n.t("校验期间目标设备发生变化，未发送 OTA 命令"));
    const catalog=revision===32?OMFirmware.legacy:revision===bundledFirmwareRevision?OMFirmware:OMFirmware.paired?.[revision];
    const pack=catalog?.packages[model];
    if(!pack)throw Error(OMI18n.t("内置固件版本或屏型不匹配，已停止"));
    const bytes = Uint8Array.from(atob(pack.data), c => c.charCodeAt(0));
    await loadFirmware({name: pack.name, size: bytes.length, arrayBuffer: async () => bytes.buffer},pack.sha256);
    if (!otaPackage || client.device!==device || !client.ready || client.config?.model!==model || bundledRevision()!==revision ||
        otaPackage.revision !== revision || (otaPackage.bundle ? !otaPackage.models[model] : otaPackage.model !== model)) {
      otaPackage = null; update(); throw Error(OMI18n.t("内置固件版本或屏型不匹配，已停止"));
    }
  }
  $("ota-file").addEventListener("change", event => action(() => loadFirmware(event.target.files[0]), ""));
  bind("ota-bundled", loadBundledFirmware, "");
  $("ota-consent").addEventListener("change", update);
  async function showMigrationProbe(){
    const device=client.device, model=client.config.model;
    $("ota-service").textContent=OMI18n.t("正在查询昂瑞微 DFU 版本…");
    const message=await client.operation(async()=>{
      try{
        const kind=await OMOTA.probeOnMicroDfu(client);
        return OMI18n.t({
          absent:"未发现昂瑞微 DFU 服务。SDK 8 迁移未就绪。",
          permission:"请断开并重新选择这台设备，以授权查询昂瑞微 DFU 服务。",
          "protocol-3":"已读回昂瑞微 DFU 协议 3。SDK 8 安装能力尚未验证。",
          unrecognized:"DFU 版本回执不匹配。SDK 8 迁移未就绪。"
        }[kind]);
      }catch(error){return OMI18n.t("迁移服务未确认。")+" "+error.message;}
    });
    if(client.device===device && client.ready && device.gatt.connected && client.config?.model===model && client.firmwareRevision===34){
      $("ota-service").textContent=(model===2?"SSD1619":"JD79668")+" · v34 · "+message;
      log($("ota-service").textContent);
    }
  }
  bind("ota-inspect", async () => {
    if(client.firmwareRevision===34)return showMigrationProbe();
    await client.otaInspect(); $("ota-service").textContent = OMI18n.t("已发现 OM6626 FE59 DFU 服务、控制与数据特征；未进入升级。");
  }, OMI18n.t("OTA 服务检测完成，没有发送升级控制命令。"));
  bind("ota-start", async () => {
    if (!otaPackage || !client.ready) throw Error(OMI18n.t("请先连接屏幕并选择通过校验的 OTA ZIP"));
    if (scheduler || schedulerRunning) throw Error(OMI18n.t("先停止本页定时器，再进行 OTA"));
    const consent = {deviceId: client.device.id, eraseImages: $("ota-consent").checked};
    if (!consent.eraseImages) throw Error(OMI18n.t("请完成图库清空确认"));
    const text = OMI18n.msg`目标：${client.device.name || client.device.id}\n固件 SHA-256：${otaPackage.sha256}\n升级会清空设备全部图片，期间不能断电或退出。` +
      OMI18n.t(otaPackage.bundle?"\n最多两次刷写：匹配的 v31 → v32（v29：原配 v30 → v32）。会暂时清零设备时间；过渡期间请勿操作，最终重启显示设备名、MAC 和版本。每次重新核对启动版本，失败即停止。确认开始？":"\n此包为独立固件，保留独立模式。确认开始 OTA？");
    if (!window.confirm(text)) { result(OMI18n.t("已取消 OTA，没有发送升级命令。")); return; }
    const paired=OMOTA.pairedRevision(client.firmwareRevision);
    await client.ota(otaPackage, consent, progress);
    if(client.firmwareRevision===34)await showMigrationProbe();
    if(paired && client.firmwareRevision===paired){
      gallery=null;otaPackage=null;$("ota-consent").checked=false;
      $("ota-package").textContent=OMI18n.t("尚未选择固件包");$("ota-file").value="";
      $("ota-service").textContent=OMI18n.t("重启核对屏型和版本后，再载入内置包继续升级。");selectTab($("tab-ota"));update();return;
    }
    if(otaPackage.revision===15 || otaPackage.revision===18 || [20,23,27,29,31].includes(otaPackage.revision)) {
      const message=OMI18n.t(otaPackage.revision!==15?"过渡接收器已确认；请载入内置整合包继续升级。":"v15 过渡版已确认；请继续选择配套 v16。尚未启用日历或时间同步。");
      gallery=null;otaPackage=null;$("ota-consent").checked=false;
      $("ota-service").textContent=message;result(message);selectTab($("tab-ota"));update();return;
    }
    if(!otaPackage.bundle){otaPackage=null;$("ota-consent").checked=false;$("ota-file").value="";$("ota-package").textContent=OMI18n.t("尚未选择固件包");}
    gallery=null;restoreDevicePresentation();await preview();
    $("ota-service").textContent = OMI18n.t("升级完成，已重新连接并核对固件版本；日历需手动启用，请查看实屏。");
  }, "");
  window.addEventListener("beforeunload", event => {
    if (!client.otaActive) return; event.preventDefault(); event.returnValue = "";
  });
  async function locked(callback){
    if(uiBusy || client.busy || schedulerRunning)throw Error(OMI18n.t("设备正在操作，请稍后重试"));
    uiBusy=true;update();try{return await callback();}finally{uiBusy=false;update();}
  }
  function screenData(){if(!transientWorkspace)store.data=new F.Store(localStorage).data;return store.data;}
  async function applyScreen(p,automaticStock=false){
    if(model()!==client.config?.model)throw Error("预览屏型与已连接设备不一致，请重新连接后核对。");
    OMScreen.persist();p=OMScreen.capture();await preview();let applied=OMScreen.signature(screenData(),p);
    if(automaticStock&&!F.stockSession(new Date()).open)throw Error("已离开交易时段，停止自动推送");
    if(!frame || loading || OMScreen.dirty())throw Error("请先保存表格并等待预览完成");
    if(p.update==="snapshot")await client.publish(frame,progress);
    else if(p.content==="reminder"){
      const todos=p.reminderId?screenData().todos.filter(t=>t.id===p.reminderId):screenData().todos;
      const saved=await OMReminder.apply(client,{todos:F.clone(todos),date:new Date(),country:p.country,title:p.reminderTitle,model:client.config.model,deviceName:connectedName(),millivolts:client.deviceInfo?.millivolts},!!p.source,progress);
      log("离线提醒已应用并核对完整内容：位置 "+saved.slot);client.offlineRotation=null;
    }else if(["day","week"].includes(p.content)){
      const saved=await OMSchool.apply(client,{...F.clone(screenData()),date:new Date(),country:p.country,view:p.content,page:p.page,panel:client.config.model===5?"four":"three",deviceName:connectedName(),millivolts:client.deviceInfo?.millivolts},!!p.source,progress);
      log("课表已应用并读回：位置 "+saved.slot+"，页 "+(saved.page+1));client.offlineRotation=null;
    }else if(p.content==="photo"){
      const pixels=OMScreen.background(client.config.model);if(!pixels)throw Error("请先读取或选择背景图片，让预览与屏幕一致");
      const crc=OMProtocol.crc16(OMProtocol.imageBytes(pixels,client.config.model));let slot=p.slot,row=slot===255?null:await client.operation(()=>client.slotMetadata(slot,!!p.source));
      if(!row?.valid || row.color!==(client.config.model===5?3:2) || row.crc!==crc){
        const state=await client.gallery(!!p.source);slot=state.slots.find(s=>!s.valid)?.slot;if(slot===undefined)throw Error("没有空图片位置，原有图片未覆盖");
        await client.store(pixels,slot,!!p.source,progress);OMScreen.setBackground(pixels,client.config.model,slot,p.source,p.fit);p=OMScreen.capture();applied=OMScreen.signature(screenData(),p);
      }
      await client.internationalCalendar(p.country,p.language,true,slot,!!p.source,progress,new Date(),p.fit);
      if(p.frequency)await OMRotation.configure(client,{frequency:p.frequency,slot,source:p.source,photo:true});
    }else await client.internationalCalendar(p.country,p.language,false,255,false,progress,new Date(),"prepared",p.style);
    const runtime=await client.operation(()=>client.readRuntime());if(runtime?.error)throw Error("设备返回错误 "+runtime.error+"，显示状态未确认");OMScreen.confirmed(runtime,connectedName(),applied);
    if(runtime)log("设备开机标识 "+runtime.bootId.toString(16)+"；课表缓存读取 "+runtime.schoolReads+" 次");
    result("已应用并确认。方案保存在本机，可导出后在升级后恢复。");await preview();
  }
  bind("photo-read-preview",()=>locked(async()=>{
    const slot=Number($("photo-slot").value),source=$("photo-source").value==="1";
    const pixels=await client.readImage(slot,source,progress);OMScreen.setBackground(pixels,client.config.model,slot,source,$("photo-fit").value);await preview();
  }),"图片已读入预览，并包含在方案备份中。");
  async function defaultRotation(slot,source,photo){
    client.offlineRotation=null;
    if(!OMRotation.supported(client))return;
    const state=gallery?.external===source?gallery:await client.gallery(source);
    if(state.slots.filter(s=>s.valid && !(s.color&128)).length<2){await OMRotation.read(client);return;}
    const frequency=Number($("auto-frequency").value);
    await OMRotation.configure(client,{frequency,slot,source:Number(source),photo});
  }
  async function rememberPicture(slot,source){
    await client.operation(async()=>{
      await client.write(Uint8Array.of(0x56,slot,Number(source)));await client.readCalendar();
      if(client.config.photoSlot!==slot || client.config.photoSource!==Number(source))throw Error(OMI18n.t("显示图片位置读回不符"));
    });
  }
  async function savePicture(show=false,knownState=null){
    const pixels=snapshot(),prepared=tab==="image" && $("image-target").value==="calendar",source=external(),device=client.device;
    const country=Number($("calendar-layout").value),fit=prepared?"prepared":$("photo-fit").value;
    const state=knownState || await client.gallery(source);
    if(state.external!==source)throw Error(OMI18n.t("存储源已切换，请重新读取。"));
    if(client.device!==device || !device.gatt.connected)throw Error(OMI18n.t("目标设备已变化，未保存图片"));
    let slot=Number($("save-slot").value);
    if($("save-auto").checked){
      const used=state.slots.filter(s=>s.valid).map(s=>s.slot),start=used.length?Math.max(...used)+1:0;
      slot=Array.from({length:state.count},(_,i)=>(start+i)%state.count).find(i=>!state.slots.find(s=>s.slot===i)?.valid);
      if(slot===undefined)throw Error(OMI18n.t("设备图片已满，请到设备图片页面手动删除不需要的图片；本次没有覆盖或删除。"));
    }
    const saved=await client.store(pixels,slot,source,progress);
    if(prepared)OMScreen.setBackground(pixels,client.config.model,slot,source,"prepared");
    gallery={...state,slots:state.slots.map(s=>s.slot===slot?saved:s)};renderGallery();
    $("gallery-slot").value=String(slot);$("photo-slot").value=String(slot);$("save-slot").value=String(slot);
    if(prepared)$("photo-fit").value="prepared";
    if(!show){if(prepared)selectTab($("tab-photo-calendar"));result(OMI18n.t("图片已保存到位置 ")+slot);return;}
    try{
      if(prepared)await client.internationalCalendar(country,$("calendar-language").value,true,slot,source,progress,new Date(),fit);
      else {await client.slotAction("display",slot,source,progress);await rememberPicture(slot,source);}
      await defaultRotation(slot,source,prepared);
      result(OMI18n.t("图片已保存并提交显示，位置 ")+slot);
    }catch(error){throw Error(OMI18n.t("图片已保存到位置 ")+slot+OMI18n.t("；显示或自动换图未确认，请勿重复保存。 ")+error.message);}
  }
  bind("publish",()=>locked(()=>{if(["calendar","photo-calendar","course"].includes(tab))throw Error('请使用屏幕方案的应用按钮');return tab==="image"?savePicture(true):client.publish(snapshot(),progress);}),"");
  bind("store-frame",()=>locked(()=>{if(["calendar","photo-calendar","course"].includes(tab))throw Error('请使用屏幕方案的应用按钮');return savePicture();}),"");
  $("save-auto").addEventListener("change",update);
  bind("download", () => { snapshot(); const output=newCanvas();if(tab==="image" && $("image-target").value==="calendar")output.width=256;output.getContext("2d").drawImage($("preview"),0,0);return new Promise((resolve, reject) => output.toBlob(blob => { if (!blob) { reject(Error(OMI18n.t("无法导出画面"))); return; } download(`om6626-${tab}-${output.width}x300.png`, blob); resolve(); })); }, OMI18n.t("已导出 PNG。"));
  async function loadImage(file,target){
    const token = ++imageToken; if (!file) return;
    if (file.size > 15 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "image/bmp"].includes(file.type)) throw Error(OMI18n.t("请选择 15 MB 内的 PNG/JPEG/WebP/BMP"));
    loading = true; frame = null; update();
    try {
      const image = await createImageBitmap(file);
      if (token !== imageToken) { image.close(); return; }
      if (image.width * image.height > 40000000) { image.close(); throw Error(OMI18n.t("图片超过 4000 万像素")); }
      bitmap?.close(); bitmap = image; $("image-name").textContent = file.name;
      for(const [id,value] of [["image-angle","0"],["image-zoom","1"],["image-x","0"],["image-y","0"]])$(id).value=value;
      const calendar=target?target==="calendar":Math.abs(image.width/image.height-256/300)<0.002;
      $("image-target").value=calendar?"calendar":"full";
      $("image-fit").value="cover";$("rotate").checked=false;
      store.change(d=>{d.settings.imageTarget=$("image-target").value;});
    } finally { if (token === imageToken) { loading = false; await preview(); } }
  }
  $("image-file").addEventListener("change",event=>action(async()=>{selectedWallpaper=null;await loadImage(event.target.files[0]);renderLibrary();},OMI18n.t("图片已载入，可调整裁切、旋转和抖动。")));
  function wallpaperLabel(item){return OMI18n.language==="en"?item.title_en:OMI18n.label(item.title);}
  function renderLibrary(){
    libraryObserver?.disconnect();
    $("library-grid").replaceChildren();
    if(tab!=="image" || !$("wallpaper-library").open)return;
    if(!libraryObserver && typeof IntersectionObserver!=="undefined")libraryObserver=new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.isIntersecting){const img=entry.target;img.src=img.dataset.src;libraryObserver.unobserve(img);}
    },{root:$("library-grid"),rootMargin:"80px"});
    $("library-category-label").hidden=libraryKind!=="calendar";
    for(const item of OMWallpapers.filter(p=>p.kind===libraryKind && (libraryKind!=="calendar" || libraryCategory==="all" || p.category===libraryCategory))){
      const node=button("",()=>chooseWallpaper(item),OMI18n.t("点击缩略图载入预览，保存后才会发送到屏幕。"));node.className="wallpaper-card";node.dataset.wallpaper=item.id;
      node.setAttribute("aria-pressed",String(item.id===selectedWallpaper));
      const img=document.createElement("img");img.alt="";img.loading="lazy";img.decoding="async";img.width=item.kind==="calendar"?128:160;img.height=item.kind==="calendar"?150:120;
      const label=document.createElement("span");label.textContent=wallpaperLabel(item);node.append(img,label);$("library-grid").append(node);
      if(libraryObserver){img.dataset.src=item.thumbnail;libraryObserver.observe(img);}else img.src=item.thumbnail;
    }
    for(const kind of ["full","calendar"])$("library-"+kind).setAttribute("aria-pressed",String(kind===libraryKind));
    $("library-state").textContent=OMI18n.t("点击缩略图载入预览，保存后才会发送到屏幕。");update();
  }
  async function chooseWallpaper(item){
    loading=true;update();
    try{
      const response=await fetch(item.image);if(!response.ok)throw Error(OMI18n.t("图片载入失败，请重试"));
      const blob=await response.blob();Object.defineProperty(blob,"name",{value:wallpaperLabel(item)+".png"});
      await loadImage(blob,item.kind);selectedWallpaper=item.id;$("wallpaper-library").open=false;renderLibrary();
    }finally{loading=false;update();}
  }
  for(const kind of ["full","calendar"])bind("library-"+kind,()=>{libraryKind=kind;renderLibrary();},"");
  $("library-category").addEventListener("change",()=>{libraryCategory=$("library-category").value;renderLibrary();});
  $("wallpaper-library").addEventListener("toggle",renderLibrary);
  bind("photo-choose-new",()=>{selectTab($("tab-image"));libraryKind="calendar";$("wallpaper-library").open=true;renderLibrary();},"");
  bind("quick-change",()=>locked(async()=>{
    const purpose=OMRotation.presentation(client);if(!purpose)throw Error(OMI18n.t("请先启用图片日历或全屏图片"));
    const source=!!(client.offlineRotation?.active?client.offlineRotation.source:client.config.photoSource);
    const state=await client.gallery(source);
    if(!state.slots.some(s=>!s.valid))throw Error(OMI18n.t("设备图片已满，请到设备图片页面手动删除不需要的图片；本次没有覆盖或删除。"));
    const candidates=OMWallpapers.filter(p=>p.kind===purpose && !p.reference),index=candidates.findIndex(p=>p.id===selectedWallpaper);
    const item=candidates[(index+1)%candidates.length];
    $("gallery-source").value=String(Number(source));$("save-auto").checked=true;selectTab($("tab-image"));await chooseWallpaper(item);await savePicture(true,state);
  }),"");
  bind("auto-apply",()=>locked(async()=>{
    const current=await OMRotation.read(client),photo=OMRotation.presentation(client)==="calendar";
    const source=current.active?current.source:Number(client.config.photoSource);
    const slot=current.active?current.slot:client.config.photoSlot;
    await OMRotation.configure(client,{frequency:Number($("auto-frequency").value),slot,source,photo});
  }));
  for (const id of ["image-target", "image-fit", "image-angle", "image-zoom", "image-x", "image-y", "rotate", "preview-model", "todo-title", "todo-mode", "todo-selected", "template-title", "template-content"])
    $(id).addEventListener("input", preview);
  $("image-target").addEventListener("change",()=>action(()=>{store.change(d=>{d.settings.imageTarget=$("image-target").value;});preview();},""));
  function refreshLists() {
    if(store.data.stocks){$("stock-text").value=store.data.stocks.symbols.join(",");$("stock-state").textContent=(store.data.stocks.stale?"上游缓存 · ":"上次获取 · ")+new Date(store.data.stocks.updated).toLocaleString()+" · 行情时间见预览";}
    options("saved-device", store.data.devices.map(d => [d.id, d.name]));
    options("todo-selected", store.data.todos.map(t => [t.id, t.title]));
    options("template-list", store.data.templates.map(t => [t.id, t.name]));
    options("job-template", store.data.templates.map(t => [t.id, t.name]));
    $("todo-list").replaceChildren();
    for (const item of store.data.todos) row("todo-list", `${item.done ? "✓" : "□"} ${item.title}${item.due ? " · " + new Date(item.due).toLocaleString(OMI18n.locale) : ""}`, [
      button(item.done ? OMI18n.t("未完成") : OMI18n.t("完成"), () => change(data => { data.todos.find(t => t.id === item.id).done = !item.done; })),
      button(OMI18n.t("编辑"), () => { editingTodo = item.id; $("todo-item-title").value = item.title; $("todo-description").value = item.description;
        $("todo-due").value = item.due ? localDate(new Date(item.due)) : ""; $("todo-add").textContent = OMI18n.t("保存修改"); }),
      button(OMI18n.t("删除"), () => change(data => { data.todos = data.todos.filter(t => t.id !== item.id); }))]);
    $("job-list").replaceChildren();
    for (const job of store.data.jobs) row("job-list", `${job.title} · ${new Date(job.at).toLocaleString(OMI18n.locale)} · ${job.status || (job.enabled ? OMI18n.t("等待") : OMI18n.t("已停用"))}`, [
      button(job.enabled ? OMI18n.t("停用") : OMI18n.t("启用"), () => change(data => { const j = data.jobs.find(j => j.id === job.id); j.enabled = !j.enabled; j.status = ""; })),
      button(OMI18n.t("立即发送"), () => runJob(job, true)), button(OMI18n.t("删除"), () => change(data => { data.jobs = data.jobs.filter(j => j.id !== job.id); }))]);
    update();
  }
  function localDate(date) { return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  bind("todo-add", () => {
    const title = $("todo-item-title").value.trim(), due = $("todo-due").value;
    if (!title) throw Error(OMI18n.t("请输入待办标题"));
    const item = {id: editingTodo || uid(), title, description: $("todo-description").value, due: due ? new Date(due).toISOString() : "", done: false};
    change(data => { const old = data.todos.findIndex(t => t.id === item.id); if (old < 0) data.todos.push(item); else data.todos[old] = {...item, done: data.todos[old].done}; });
    editingTodo = null; $("todo-add").textContent = OMI18n.t("添加待办"); $("todo-item-title").value = $("todo-description").value = $("todo-due").value = "";
  }, OMI18n.t("待办已保存到本地工作区。"));
  bind("todo-export", () => jsonDownload("om6626-todos.json", {version: 1, todos: store.data.todos}), OMI18n.t("已导出待办。"));
  $("todo-import").addEventListener("change", e => action(async () => {
    const value = await jsonFile(e.target.files[0]); if (value.version !== 1 || !Array.isArray(value.todos)) throw Error(OMI18n.t("待办文件格式不符"));
    const merged = F.clone(store.data); merged.todos = [...merged.todos, ...value.todos.map(t => ({...t, id: uid()}))]; store.commit(merged); refreshLists(); await preview();
  }, OMI18n.t("待办已导入，并保留原有待办。")));
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
    const file = e.target.files[0]; if (!file || file.size > 900000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw Error(OMI18n.t("模板图片请选择 900 KB 内的 PNG/JPEG/WebP"));
    elementImage = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error(OMI18n.t("图片读取失败"))); reader.readAsDataURL(file); });
    $("element-type").value = "image";
  }, OMI18n.t("图片已读取，点击添加元素或更新所选。")));
  bind("template-new", () => loadDraft({id: uid(), name: OMI18n.t("新模板"), width: 400, height: 300, elements: []}), OMI18n.t("新画布已建立。"));
  bind("template-save", () => { draft.name = $("template-name").value.trim() || OMI18n.t("未命名模板"); F.template(draft);
    change(data => { const i = data.templates.findIndex(t => t.id === draft.id); if (i < 0) data.templates.push(F.clone(draft)); else data.templates[i] = F.clone(draft); }); $("template-list").value = draft.id;
  }, OMI18n.t("模板已保存。"));
  bind("template-delete", () => { const id = $("template-list").value; change(data => { data.templates = data.templates.filter(t => t.id !== id); }); loadDraft(F.defaultTemplates()[0]); }, OMI18n.t("模板已删除。"));
  bind("template-defaults", () => change(data => { for (const spec of F.defaultTemplates()) if (!data.templates.some(t => t.id === spec.id)) data.templates.push(spec); }), OMI18n.t("缺少的默认模板已生成，保留已有模板。"));
  bind("element-add", () => { draft.elements.push(readElement()); elementOptions(); $("element-list").value = String(draft.elements.length - 1); preview(); }, OMI18n.t("元素已添加；保存模板以持久保留。"));
  bind("element-update", () => { const i = Number($("element-list").value); if (!draft.elements[i]) throw Error(OMI18n.t("请选择元素")); draft.elements[i] = readElement(); elementOptions(); preview(); }, OMI18n.t("元素已更新。"));
  bind("element-delete", () => { draft.elements.splice(Number($("element-list").value), 1); elementOptions(); preview(); }, OMI18n.t("元素已删除。"));
  for (const [id, delta] of [["element-up", 1], ["element-down", -1]]) bind(id, () => {
    const i = Number($("element-list").value), j = i + delta; if (!draft.elements[i] || !draft.elements[j]) return;
    [draft.elements[i], draft.elements[j]] = [draft.elements[j], draft.elements[i]]; elementOptions(); $("element-list").value = String(j); preview();
  }, OMI18n.t("图层顺序已更新。"));
  bind("template-export", () => { const spec = {...draft, name: $("template-name").value}; download("om6626-template.epdtpl", OMArchive.pack(spec)); }, OMI18n.t("网页模板已导出。"));
  $("template-import").addEventListener("change", e => action(async () => {
    const file = e.target.files[0]; if (!file || file.size > 4000000) throw Error(OMI18n.t("模板文件最大 4 MB"));
    const spec = await OMArchive.unpack(await file.arrayBuffer()); spec.id = uid(); change(data => data.templates.push(spec)); loadDraft(spec);
  }, OMI18n.t("网页模板已导入，原有模板保留。")));
  function daysInput(value) { const days = value.split(/[,，\s]+/).filter(Boolean).map(Number); if (days.length !== 7 || days.some(d => !Number.isInteger(d))) throw Error(OMI18n.t("请提供周一到周日的七个整数槽位")); return [days[6], ...days.slice(0, 6)]; }
  bind("saying-fetch", async () => {
    const hosted=document.documentElement.dataset.hosting==="github-pages";
    const response = await fetch(hosted?"https://uapis.cn/api/v1/saying":"/saying", {headers:hosted?{}:{"X-OM6626-Request":"1"},credentials:"omit",referrerPolicy:"no-referrer",signal: AbortSignal.timeout(18000)}); if (!response.ok) throw Error(OMI18n.t("一言获取失败"));
    const value = await response.json(); saying = String(value.text || "").slice(0, 500); $("saying-text").textContent = saying; await preview();
  }, OMI18n.t("一言已更新。"));
  async function readGallery() {
    gallery = await client.gallery(external());renderGallery();
  }
  function renderGallery(){
    const state=gallery,valid=state.slots.filter(s=>s.valid);
    $("gallery-state").textContent = OMI18n.t(state.external?"外置":"内部")+" · "+OMI18n.t("已存图片 ")+valid.length+" / "+state.count;
    options("gallery-slot", valid.map(s => [s.slot, `${s.slot} · ${s.remark || OMI18n.t("已有图片")}`]));
    $("photo-source").value=String(state.external?1:0);
    options("photo-slot",state.slots.filter(s=>s.valid && !(s.color&128)).map(s=>[s.slot,`${s.slot} · ${s.remark||OMI18n.t("已有图片")}`]));
    $("photo-state").textContent=OMI18n.t("Slot pixels are read by the device; this browser preview shows the date layout only.");
    $("gallery-list").replaceChildren();
    for (const s of valid) row("gallery-list", OMI18n.t("位置 ")+s.slot+" · "+(s.color&128?"课表 / 提醒原生数据":s.remark||OMI18n.t("已有图片")),[button(OMI18n.t("选择"),()=>{$("gallery-slot").value=String(s.slot);slotSelected();})]);
    $("rotation-mode").value = String(state.mode<=2?state.mode:0); $("rotation-interval").value = String(state.interval || 60);
    $("rotation-days").value = [...state.days.slice(1), state.days[0]].join(","); slotSelected(); update();
  }
  function slotSelected() { $("slot-remark").value = gallery?.slots.find(s => s.slot === Number($("gallery-slot").value))?.remark || ""; update(); }
  bind("gallery-read", readGallery, OMI18n.t("图库元数据已读取。"));
  bind("photo-gallery-read",()=>{ $("gallery-source").value=$("photo-source").value;return readGallery(); });
  $("photo-slot").addEventListener("change",()=>{update();preview();});
  $("photo-source").addEventListener("change",()=>{gallery=null;options("photo-slot",[]);$("photo-state").textContent=OMI18n.t("先读取图库并选择有效图片。");update();preview();});
  $("gallery-slot").addEventListener("change", slotSelected);
  $("gallery-source").addEventListener("change", () => { gallery = null; options("photo-slot",[]);$("gallery-list").replaceChildren(); $("gallery-state").textContent = OMI18n.t("存储源已切换，请重新读取。"); options("gallery-slot", []); update(); });
  for (const [id, name] of [["slot-display", "display"], ["slot-background", "background"], ["slot-delete", "delete"], ["slot-remark-save", "remark"]]) bind(id, async () => {
    const slot = Number($("gallery-slot").value);
    if(name==="background"){
      $("photo-source").value=$("gallery-source").value;$("photo-slot").value=String(slot);
      selectTab($("tab-photo-calendar"));return locked(async()=>{await startCalendar(true);await defaultRotation(slot,external(),true);});
    }
    if (name === "delete" && !window.confirm(OMI18n.msg`确定删除${external() ? OMI18n.t("外置") : OMI18n.t("内部")}槽 ${slot} 的图片和备注？原设备没有图片导出接口，此操作无法从网页撤销。`)) return;
    await client.slotAction(name, slot, external(), progress, $("slot-remark").value);
    if (["delete", "remark"].includes(name)) await readGallery();
    if(name==="display"){await rememberPicture(slot,external());await defaultRotation(slot,external(),false);}
    if(name==="delete" && OMRotation.supported(client)){
      const policy=await OMRotation.read(client);
      if(policy.active && policy.source===Number(external()) && gallery.slots.filter(s=>s.valid && !(s.color&128)).length<2)
        await OMRotation.configure(client,{frequency:0,slot,source:Number(external()),photo:policy.photo});
    }
  });
  bind("rotation-save", () => client.rotate(Number($("rotation-mode").value), Number($("rotation-interval").value), daysInput($("rotation-days").value), external(), progress));
  function showHolidays(value) { $("holiday-year").value = String(value.year); $("holiday-text").value = value.entries.map(e => `${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")} ${e.off ? "off" : "work"}`).join("\n"); }
  bind("holiday-read", async () => showHolidays(await client.holidays()), OMI18n.t("已读取设备调休表。"));
  bind("holiday-write", async () => {
    const entries = $("holiday-text").value.trim().split(/\r?\n/).filter(Boolean).map(line => {
      const match = line.trim().match(/^(\d{1,2})-(\d{1,2})\s+(off|work|休|班)$/); if (!match) throw Error(OMI18n.t("调休格式应为 MM-DD 休 或 MM-DD 班"));
      return {month: Number(match[1]), day: Number(match[2]), off: ["off","休"].includes(match[3])};
    });
    const year = Number($("holiday-year").value); OMProtocol.holidays(year, entries);
    const old = await client.holidays(); jsonDownload("om6626-holidays-before.json", old);
    showHolidays(await client.holidays(entries, year));
  }, OMI18n.t("原表已导出备份，新表已保存并读回核对。"));
  bind("job-add", () => {
    if (!client.ready) throw Error(OMI18n.t("先连接目标设备"));
    const date = new Date($("job-time").value); if (!Number.isFinite(+date) || date <= new Date()) throw Error(OMI18n.t("请选择将来的任务时间"));
    const job = {id: uid(), title: $("job-title").value.trim() || OMI18n.t("日程提醒"), text: $("job-text").value, kind: $("job-kind").value,
      at: date.toISOString(), repeat: $("job-repeat").value, device: client.device.id, templateId: $("job-template").value, enabled: true};
    if (job.kind === "template" && !store.data.templates.some(t => t.id === job.templateId)) throw Error(OMI18n.t("请选择已保存模板"));
    change(data => data.jobs.push(job));
  }, OMI18n.t("任务已保存，开启本页定时器后执行。"));
  async function runJob(job, manual = false) {
    if (schedulerRunning || uiBusy || client.busy) throw Error(OMI18n.t("设备正在操作，任务等待"));
    if (!client.ready || client.device.id !== job.device) throw Error(OMI18n.t("请先连接此任务绑定的设备"));
    const target = client.device;
    schedulerRunning = true; update();
    try {
      const canvas = newCanvas(), settings = F.clone(store.data.settings);
      if (job.kind === "weather") throw Error("天气任务已停用；股票更新请在股票日历设置。");
      else if (job.kind === "template") {
        const spec = store.data.templates.find(t => t.id === job.templateId); if (!spec) throw Error(OMI18n.t("任务模板已删除"));
        await OMRender.template(canvas, spec, {...context(), title: job.title, content: job.text});
      } else OMRender.todos(canvas, [{title: job.title, description: job.text, done: false, due: job.at}], job.title, settings, true);
      const image = frameFrom(canvas, settings, client.config.model);
      if (!client.ready || client.device !== target || client.device.id !== job.device)
        throw Error(OMI18n.t("任务准备期间设备连接或身份改变，已停止发送"));
      // Persist before submitting; uncertain delivery must never auto-repeat after a restart.
      change(data => { const current = data.jobs.find(j => j.id === job.id); if (current) { current.enabled = false; current.status = OMI18n.t("已提交，显示待确认"); } });
      await client.publish(image, progress);
      change(data => { const i = data.jobs.findIndex(j => j.id === job.id); if (i >= 0) data.jobs[i] = {...(manual ? data.jobs[i] : F.nextJob(job)), status: OMI18n.t("已发送，实物待确认")}; });
    } catch (error) {
      change(data => { const current = data.jobs.find(j => j.id === job.id); if (current) { current.enabled = false; current.status = job.kind === "weather" ? error.message : OMI18n.t("失败或结果不确定，请检查后手动重试"); } }); throw error;
    } finally { schedulerRunning = false; update(); }
  }
  async function tick() {
    if (schedulerRunning || uiBusy || client.busy || !client.ready) return;
    const due = F.dueJobs(store.data.jobs, new Date(), client.device.id);
    for (const job of due) {
      if (job.missed) { change(data => { const j = data.jobs.find(j => j.id === job.id); j.enabled = false; j.status = OMI18n.t("已错过，等待手动发送"); }); continue; }
      await action(() => runJob(job)); break;
    }
  }
  bind("scheduler-start", async () => {
    if (scheduler) return;
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { log(OMI18n.t("浏览器未授予屏幕唤醒锁，请手动保持电脑唤醒")); }
    scheduler = setInterval(tick, 5000); $("scheduler-state").textContent = OMI18n.t("本页定时器运行中。关闭、休眠或断线会停止发送；超过 5 分钟的任务不自动补发。"); await tick();
  }, OMI18n.t("本页定时器已开启。"));
  bind("scheduler-stop", async () => { clearInterval(scheduler); scheduler = null; client.armIdleDisconnect(); await wakeLock?.release(); wakeLock = null; $("scheduler-state").textContent = OMI18n.t("本页定时器已停止。"); }, OMI18n.t("本页定时器已停止。"));
  function applySettings() {
    for (const [id, key] of Object.entries(settingsMap)) $(id).value = String(store.data.settings[key]);
    document.documentElement.dataset.theme = store.data.settings.theme;
    $("calendar-layout").value=String(store.data.settings.calendarCountry);$("calendar-language").value=store.data.settings.calendarLanguage;$("image-target").value=store.data.settings.imageTarget;
    if (client.transferPayload !== store.data.settings.packetBytes || client.packetDelay !== store.data.settings.packetDelay)
      client.setTransfer(store.data.settings.packetBytes, store.data.settings.packetDelay);
  }
  for (const [id, key] of Object.entries(settingsMap)) $(id).addEventListener("input", () => action(() => {
    const value = ["theme", "dither"].includes(key) ? $(id).value : Number($(id).value);
    change(data => { data.settings[key] = value; }); applySettings();
  }, ""));
  bind("render-reset", () => { change(data => { data.settings = F.defaults().settings; }); applySettings(); }, OMI18n.t("渲染默认值已恢复。"));
  bind("workspace-export",()=>OMScreen.exportPlan(),"完整屏幕方案已导出，含课程、考试、布局和已备份背景。");
  $("workspace-import").addEventListener("change",e=>action(async()=>{
    if(client.busy || uiBusy || schedulerRunning || scheduler)throw Error("请等待设备操作结束再导入方案");
    try{await OMScreen.importPlan(e.target.files[0]);applySettings();refreshLists();loadDraft(store.data.templates[0]||F.defaultTemplates()[0]);}
    finally{e.target.value="";}
  },""));
  bind("log-export", () => download("om6626-web-log.txt", new Blob([lines.join("\n")], {type: "text/plain"})), OMI18n.t("已导出日志。"));
  $("nfc-state").textContent = "NDEFReader" in window ? OMI18n.t("支持 Web NFC；需要 NFC 硬件和浏览器权限。标签是本网页独立格式。") : OMI18n.t("此浏览器不提供 Web NFC（Windows Edge 不支持）；当前不可读写 NFC。");
  bind("nfc-write", async () => {
    if (!client.ready || !("NDEFReader" in window)) throw Error(OMI18n.t("先连接设备并使用支持 Web NFC 的浏览器"));
    const reader = new NDEFReader(); await reader.write({records: [{recordType: "mime", mediaType: "application/json", data: new TextEncoder().encode(JSON.stringify({format: "om6626-web-device", id: client.device.id, name: client.device.name || "OM6626"}))}]});
  }, OMI18n.t("网页设备标签已写入。"));
  let nfcAbort;
  bind("nfc-read", async () => {
    if (!("NDEFReader" in window)) throw Error(OMI18n.t("浏览器不支持 Web NFC"));
    nfcAbort?.abort(); nfcAbort = new AbortController(); const reader = new NDEFReader();
    reader.onreading = event => action(() => {
      const record = [...event.message.records].find(r => r.recordType === "mime" && r.mediaType === "application/json");
      if (!record) throw Error(OMI18n.t("标签不含网页设备信息")); const value = JSON.parse(new TextDecoder().decode(record.data));
      if (value.format !== "om6626-web-device" || !store.data.devices.some(d => d.id === value.id)) throw Error(OMI18n.t("此标签设备尚未绑定，先使用蓝牙选择器连接"));
      $("saved-device").value = value.id; nfcAbort.abort(); update();
    }, OMI18n.t("已选中标签设备，点击连接所选设备完成连接。"));
    reader.onreadingerror = () => result(OMI18n.t("NFC 标签读取失败"), true); await reader.scan({signal: nfcAbort.signal});
  }, OMI18n.t("请靠近 NFC 标签。"));
  // Canvas dragging changes only editor coordinates; transmission uses an immutable frame snapshot.
  let drag;
  $("preview").addEventListener("pointerdown", e => {
    if (e.pointerType==="touch" || !["image", "template"].includes(tab)) return;
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
  $("compatibility").textContent = supported ? OMI18n.t("浏览器支持蓝牙，连接由你点击发起。") : OMI18n.t("此浏览器不支持网页蓝牙，仍可选图和预览。连接设备请使用支持 Web Bluetooth 的浏览器。");
  async function refreshStocks({automatic=false,generation=stockGeneration}={}){
    if(stockFetching)return;
    if(automatic&&(!F.stockSession(new Date()).open||generation!==stockGeneration))return;
    const symbols=F.stockSymbols($("stock-text").value),key=symbols.join(",");stockFetching=true;$("stock-save").disabled=true;$("stock-state").textContent="正在获取行情…";
    try{
      const local=["127.0.0.1","localhost"].includes(location.hostname);
      const url=local?(stockProxy?"http://127.0.0.1:8290":"")+"/api/stock/quote?symbols="+encodeURIComponent(key):"https://qt.gtimg.cn/q="+encodeURIComponent(key);
      const request={signal:AbortSignal.timeout(15000),credentials:"omit",redirect:"error",referrerPolicy:"no-referrer"};
      let response=await fetch(url,request);
      if(local&&!stockProxy&&location.port==="8289"&&response.status===404){response=await fetch("http://127.0.0.1:8290/api/stock/quote?symbols="+encodeURIComponent(key),request);if(response.ok)stockProxy=true;}
      if(!response.ok)throw Error(local&&response.status===404?"当前是静态预览服务，无法获取行情；请启动配套本地控制端":local&&response.status===502?"本地控制端暂时无法取得行情，请稍后重试":"行情服务返回 HTTP "+response.status);
      const bytes=await response.arrayBuffer();if(bytes.byteLength>32000)throw Error("行情响应过大");
      const next=F.stockTencent(new TextDecoder("gbk",{fatal:true}).decode(bytes),symbols);
      if(F.stockSymbols($("stock-text").value).join(",")!==key)throw Error("代码已修改，本次结果未保存，请重新获取。");
      if(automatic&&(generation!==stockGeneration||!F.stockSession(new Date()).open)){$("stock-state").textContent="自动更新已暂停，本次结果未替换上次行情。";return;}
      change(data=>{data.stocks=next;});
      if(F.stockSession(new Date()).open&&$("stock-auto-send").checked&&stockTarget&&tab==="stock"&&client.ready&&client.device.id===stockTarget&&!client.busy&&!uiBusy&&!next.stale){
        await locked(async()=>{if(tab!=="stock"||client.device?.id!==stockTarget)throw Error("股票同步目标已改变");await applyScreen(OMScreen.capture(),true);});
      }
    }catch(error){
      const message=error.name==="TypeError"&&/fetch/i.test(error.message)?(["127.0.0.1","localhost"].includes(location.hostname)?"无法连接本地行情接口，请确认本地控制端正在运行":"行情请求被浏览器或网络拦截，请在配套本地控制端获取行情"):error.name==="TimeoutError"?"行情服务响应超时，请稍后重新获取":error.message;
      $("stock-state").textContent="获取或同步失败："+message+"。上次行情保留，时间见预览。";throw Error(message);
    }
    finally{stockFetching=false;update();}
  }
  bind("stock-save",refreshStocks,"");
  bind("stock-start",async()=>{
    if($("stock-auto-send").checked&&!client.ready)throw Error("自动同步前请连接目标屏幕");
    if(stockTimer)clearInterval(stockTimer);stockTimer=null;const generation=++stockGeneration;
    stockTarget=$("stock-auto-send").checked?client.device.id:null;
    const minutes=Number($("stock-interval").value);if(![5,15,30,60].includes(minutes))throw Error("刷新间隔无效");
    let nextRefresh=0;
    const tick=async()=>{
      if(generation!==stockGeneration)return;
      const session=F.stockSession(new Date());
      $("stock-timer-state").textContent=session.open?`${session.phase} · 每${minutes}分钟更新；自动推送限当前股票页和所选屏幕。`:`${session.phase} · 自动获取与推送已暂停，${session.known?"开市后":"更新交易日历后"}恢复。`;
      if(!session.open){nextRefresh=0;return;}
      if(client.busy||uiBusy||stockFetching||Date.now()<nextRefresh)return;
      nextRefresh=Date.now()+minutes*60000;await refreshStocks({automatic:true,generation});
    };
    stockTimer=setInterval(()=>action(tick,""),30000);await tick();
  },"");
  bind("stock-stop",()=>{stockGeneration++;if(stockTimer)clearInterval(stockTimer);stockTimer=null;stockTarget=null;$("stock-timer-state").textContent="自动更新已停止。";},"");
  for(const id of ["stock-interval","stock-auto-send"])$(id).addEventListener("change",()=>{stockGeneration++;if(stockTimer)clearInterval(stockTimer);stockTimer=null;stockTarget=null;$("stock-timer-state").textContent="设置已更改，点击开始自动更新后生效。";client.armIdleDisconnect();});
  setupShell();applySettings(); refreshLists(); loadDraft(store.data.templates[0] || F.defaultTemplates()[0]);
  OMI18n.onChange=()=>{
    for(const id of ["compatibility","nfc-state","result","photo-state","scheduler-state","ota-package","ota-kind","ota-service","gallery-state"])$(id).textContent=OMI18n.t($(id).textContent);
    update();refreshLists();calendarInfo();renderLibrary();preview();
  };
  $("ui-language").addEventListener("change",()=>OMI18n.setLanguage($("ui-language").value));
  OMI18n.apply();syncCalendar(false,false);
  renderLibrary();
  OMScreen.init({read:screenData,save:data=>store.commit(data),show:type=>{
    $("school-view").value=type==="day"?"day":"week";
    selectTab($(type==="photo"?"tab-photo-calendar":type==="reminder"?"tab-todo":type==="stock"?"tab-stock":["day","week"].includes(type)?"tab-course":"tab-calendar"));
  },preview,deviceSettings:()=>selectTab($("tab-settings")),download:jsonDownload,refresh:()=>{if(!uiBusy&&!client.busy){screenData();refreshLists();}},apply:p=>action(()=>locked(()=>applyScreen(p)),"")});
})();
