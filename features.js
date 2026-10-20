"use strict";
const OMFeatures = (() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const bounded = (v, min, max, label) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw Error(label + "超出范围");
    return v;
  };
  const string = (v, max, label) => {
    if (typeof v !== "string" || v.length > max) throw Error(label + "无效或过长"); return v;
  };
  const defaults = () => ({version: 1, todos: [], courses: Array.from({length: 7}, () => ""), templates: [], jobs: [],
    devices: [], settings: {fontSize: 16, urgentHours: 24, theme: "system", dither: "none", strength: 1,
      brightness: 0, contrast: 1, gamma: 1, redThreshold: 1.35, packetBytes: 180, packetDelay: 0}, weather: null});
  function validate(data) {
    if (!data || data.version !== 1) throw Error("备份版本不支持");
    if (!Array.isArray(data.todos) || data.todos.length > 200 || !Array.isArray(data.templates) || data.templates.length > 60 ||
        !Array.isArray(data.jobs) || data.jobs.length > 200 || !Array.isArray(data.devices) || data.devices.length > 100 ||
        !Array.isArray(data.courses) || data.courses.length !== 7) throw Error("备份条目数量或结构无效");
    data.courses.forEach(v => string(v, 3000, "课表"));
    for (const todo of data.todos) {
      string(todo.id, 80, "待办编号"); string(todo.title, 100, "待办标题"); string(todo.description, 1000, "待办内容");
      if (typeof todo.done !== "boolean" || (todo.due && !Number.isFinite(Date.parse(todo.due)))) throw Error("待办日期或状态无效");
    }
    data.templates.forEach(template);
    for (const job of data.jobs) {
      string(job.id, 80, "任务编号"); string(job.device, 200, "目标设备"); string(job.title, 100, "任务标题");
      string(job.text, 3000, "任务内容");
      if (!["todo", "weather", "template"].includes(job.kind) || !Number.isFinite(Date.parse(job.at)) || typeof job.enabled !== "boolean" ||
          !["once", "daily", "weekly"].includes(job.repeat)) throw Error("定时任务配置无效");
      if (job.kind === "template") string(job.templateId, 80, "模板编号");
    }
    for (const device of data.devices) { string(device.id, 200, "设备编号"); string(device.name, 100, "设备名称"); }
    const s = data.settings;
    if (!s || !["system", "light", "dark"].includes(s.theme) || !["none", "floyd", "atkinson", "bayer"].includes(s.dither)) throw Error("外观或抖动配置无效");
    bounded(s.fontSize, 8, 32, "字号"); bounded(s.urgentHours, 0, 8760, "紧急时限"); bounded(s.strength, 0, 1, "抖动强度");
    bounded(s.brightness, -128, 128, "亮度"); bounded(s.contrast, .1, 3, "对比度"); bounded(s.gamma, .1, 4, "Gamma");
    bounded(s.redThreshold, 1, 3, "红色阈值");
    bounded(s.packetBytes ?? 180, 20, 180, "传输上限"); bounded(s.packetDelay ?? 0, 0, 100, "包间隔");
    if (!Number.isInteger(s.packetBytes ?? 180) || !Number.isInteger(s.packetDelay ?? 0)) throw Error("传输设置必须是整数");
    if (data.weather !== null) weather(data.weather);
    return clone({...data, settings: {...s, packetBytes: s.packetBytes ?? 180, packetDelay: s.packetDelay ?? 0}});
  }
  function template(value) {
    if (!value || value.width !== 400 || value.height !== 300 || !Array.isArray(value.elements) || value.elements.length > 100)
      throw Error("模板需要 400 × 300 画布和最多 100 个元素");
    string(value.id, 80, "模板编号"); string(value.name, 100, "模板名称");
    for (const element of value.elements) {
      if (!["text", "rect", "line", "image", "weather"].includes(element.type)) throw Error("模板包含不支持的元素类型");
      bounded(element.x, -400, 800, "横坐标"); bounded(element.y, -300, 600, "纵坐标");
      bounded(element.width, 1, 800, "宽度"); bounded(element.height, 1, 600, "高度");
      if (!["black", "white", "red", "yellow"].includes(element.color)) throw Error("模板颜色无效");
      if (element.type === "text") { string(element.text, 2000, "模板文字"); bounded(element.fontSize, 8, 100, "模板字号"); }
      if (element.type === "image") {
        string(element.src, 1500000, "模板图片");
        if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(element.src)) throw Error("模板只接受内嵌 PNG/JPEG/WebP 图片");
      }
    }
    return clone(value);
  }
  class Store {
    constructor(storage) {
      this.storage = storage;
      const raw = storage.getItem("om6626-workspace-v1");
      this.data = raw ? validate(JSON.parse(raw)) : defaults();
      if (!raw) {
        const old = JSON.parse(storage.getItem("om6626-web-editor-v1") || "{}");
        if (typeof old["todo-text"] === "string") this.data.todos = old["todo-text"].split(/\r?\n/).map(t => t.trim()).filter(Boolean).slice(0, 200).map((text, i) =>
          ({id: "migrated-" + i, title: text.replace(/^\[(x| )\]\s*/i, "").slice(0, 100), description: "", due: "", done: /^\[x\]/i.test(text)}));
      }
    }
    commit(next) {
      const data = validate(next), text = JSON.stringify(data);
      if (text.length > 4500000) throw Error("工作区超过 4.5 MB，请先导出备份并减少模板图片");
      this.storage.setItem("om6626-workspace-v1", text); this.data = data;
    }
    change(callback) { const next = clone(this.data); callback(next); this.commit(next); }
  }
  function weather(data) {
    if (!data || typeof data.city !== "string" || data.city.length > 100 || !Array.isArray(data.days) || data.days.length > 16 ||
        !Number.isFinite(Date.parse(data.updated))) throw Error("天气数据格式无效");
    for (const day of [data.current, ...data.days].filter(Boolean)) {
      string(day.text, 100, "天气现象");
      for (const field of ["temperature", "low", "high"]) if (day[field] !== undefined && day[field] !== null) bounded(Number(day[field]), -100, 100, "温度");
    }
    return clone(data);
  }
  function seniverse(now, daily) {
    const current = now?.results?.[0], forecast = daily?.results?.[0];
    if (!current?.now || !current.location?.name || !Array.isArray(forecast?.daily)) throw Error("心知天气响应无效，请核对产品权限及城市");
    return weather({city: current.location.name, updated: current.last_update,
      current: {text: current.now.text, temperature: Number(current.now.temperature), code: String(current.now.code),
        humidity: current.now.humidity || "", wind: current.now.wind_speed || ""},
      days: forecast.daily.map(day => ({date: day.date, text: day.text_day, night: day.text_night,
        low: Number(day.low), high: Number(day.high), code: String(day.code_day)}))});
  }
  function nextJob(job, now = new Date()) {
    if (job.repeat === "once") return {...job, enabled: false};
    const at = new Date(job.at), days = job.repeat === "weekly" ? 7 : 1;
    do { at.setDate(at.getDate() + days); } while (at <= now);
    return {...job, at: at.toISOString()};
  }
  function dueJobs(jobs, now, device) {
    return jobs.filter(job => job.enabled && job.device === device && Date.parse(job.at) <= +now)
      .map(job => ({...job, missed: +now - Date.parse(job.at) > 5 * 60000}));
  }
  function placeholders(text, context = {}) {
    const date = context.date || new Date(), weather = context.weather;
    const vars = {date: date.toLocaleDateString("zh-CN"), time: date.toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"}),
      weekday: date.toLocaleDateString("zh-CN", {weekday: "long"}), title: context.title || "", content: context.content || "",
      city: weather?.city || "", temperature: weather?.current?.temperature ?? "", weather: weather?.current?.text || "",
      humidity: weather?.current?.humidity || "", wind: weather?.current?.wind || "", saying: context.saying || "",
      todo: (context.todos || []).filter(t => !t.done).map(t => t.title).join("\n")};
    return String(text).replace(/\{\{([a-z]+)\}\}/g, (_, key) => Object.hasOwn(vars, key) ? vars[key] : "");
  }
  function process(rgba, model, settings) {
    if (!(rgba instanceof Uint8ClampedArray) || rgba.length !== 480000) throw Error("处理输入必须为 400 × 300 RGBA");
    validate({...defaults(), settings});
    const palette = model === 5 ? OMProtocol.FOUR_COLORS : [[0, 0, 0], [255, 255, 255], [184, 25, 40]];
    if (![2, 5].includes(model)) throw Error("不支持的屏型");
    const pixels = new Float32Array(360000), out = new Uint8ClampedArray(480000);
    for (let p = 0; p < 120000; p++) for (let c = 0; c < 3; c++) {
      const alpha = rgba[p * 4 + 3] / 255, value = rgba[p * 4 + c] * alpha + 255 * (1 - alpha);
      pixels[p * 3 + c] = Math.max(0, Math.min(255, ((255 * (value / 255) ** (1 / settings.gamma) - 128) * settings.contrast) + 128 + settings.brightness));
    }
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) {
      const p = y * 400 + x, offset = p * 3;
      const rgb = [0, 1, 2].map(c => Math.max(0, Math.min(255, pixels[offset + c] + (settings.dither === "bayer" ? (bayer[(y % 4) * 4 + x % 4] - 7.5) * 12 * settings.strength : 0))));
      let color;
      if (model === 2 && settings.dither === "none") {
        color = rgb[0] > 105 && rgb[0] > rgb[1] * settings.redThreshold && rgb[0] > rgb[2] * settings.redThreshold ? palette[2] :
          rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 160 ? palette[0] : palette[1];
      } else {
        color = palette.reduce((best, v) => v.reduce((s, c, i) => s + (rgb[i] - c) ** 2, 0) <
          best.reduce((s, c, i) => s + (rgb[i] - c) ** 2, 0) ? v : best, palette[0]);
      }
      out.set([...color, 255], p * 4);
      const weights = settings.dither === "floyd" ? [[1, 0, 7/16], [-1, 1, 3/16], [0, 1, 5/16], [1, 1, 1/16]] :
        settings.dither === "atkinson" ? [[1, 0, 1/8], [2, 0, 1/8], [-1, 1, 1/8], [0, 1, 1/8], [1, 1, 1/8], [0, 2, 1/8]] : [];
      for (const [dx, dy, weight] of weights) if (x + dx >= 0 && x + dx < 400 && y + dy < 300)
        for (let c = 0; c < 3; c++) pixels[((y + dy) * 400 + x + dx) * 3 + c] += (rgb[c] - color[c]) * weight * settings.strength;
    }
    return out;
  }
  function defaultTemplates() {
    const text = (x, y, width, height, fontSize, content, color = "black") =>
      ({type: "text", x, y, width, height, fontSize, text: content, color});
    return [{id: "default-note", name: "便笺 / 待办", width: 400, height: 300, elements: [
      text(20, 16, 360, 34, 24, "{{title}}", "red"), {type: "line", x: 20, y: 55, width: 360, height: 1, color: "red"},
      text(20, 70, 360, 190, 18, "{{content}}\n{{todo}}"), text(20, 278, 360, 20, 12, "{{date}}  {{weekday}}") ]},
    {id: "default-weather", name: "天气", width: 400, height: 300, elements: [
      text(20, 15, 360, 35, 24, "{{city}}  {{date}}", "red"), {type: "weather", x: 260, y: 70, width: 110, height: 100, color: "yellow"},
      text(20, 78, 230, 90, 48, "{{temperature}}°"), text(20, 178, 360, 40, 24, "{{weather}}"),
      text(20, 245, 360, 35, 14, "{{content}}") ]}];
  }
  const matrix = [
    ["连接、绑定、切换设备、日志", "已实现；系统蓝牙选择器授权，一次连接一台"],
    ["设备日历、7 种版式、V1/V2 布局、校时", "已实现；设备自主更新，没有静态月历发送"],
    ["时钟模式", "SSD1619 沿用原局刷；JD79668 原驱动无局刷，仅显式开启原版全刷"],
    ["图片裁切、缩放、90°/180°旋转、抖动", "已实现；Floyd–Steinberg / Atkinson / Bayer、亮度、对比度、Gamma、红阈值"],
    ["待办列表、单项、截止时间、紧急颜色、导入导出", "已实现；渲染后直接发送或保存到设备槽位"],
    ["模板编辑、元素、占位符、导入导出", "已实现网页格式；原 APK .epdtpl 完整 schema 尚未恢复，未宣称双向兼容"],
    ["周日程 / 课程表", "已实现；七天渲染并保存至七个空槽，设备离线按周切换"],
    ["自由日程 / 天气定时推送", "页面开启且目标设备已连接时执行；关闭网页后的 Android 后台服务无法等价迁移"],
    ["天气实况、三日预报、一言", "在线版保留天气缓存/模板；实时私钥天气需本地版，一言直接连接 uapis.cn"],
    ["内部 / 外置图库、备注、显示、删除、背景、轮播", "已接入原生命令和元数据/CRC 核对；有外置存储的设备才可使用外置图库"],
    ["调休日历", "已实现读取、编辑、保存及读回；不自动替换用户原调休表"],
    ["LED 关闭 / 恢复正常", "JD79668 原生命令已实现；全彩 LED 调色不在当前 OM6626 接收协议中"],
    ["NFC 标签", "支持 Web NFC 的浏览器可读写网页设备标签；当前 Windows Edge 不提供 NFC"],
    ["外观、字体、渲染、传输设置、备份", "已实现；传输保持带响应、串行、边界校验"],
    ["OTA 固件升级", "独立 C OTA 应用、本项目签名与保护区校验，拒绝原版包；首次有线引导后可用独立 ZIP 更新。会清空图库，实机待验收"],
    ["时钟字体擦除、晶振校准、驱动/引脚/波形切换", "保留限制：不发送这些硬件配置或擦除命令"],
    ["其他主控和屏型、激活", "当前只绑定本项目 OM6626 三色/四色独立固件；不接入授权或改写身份数据"],
  ];
  return {Store, defaults, validate, template, clone, weather, seniverse, nextJob, dueJobs, placeholders, process, defaultTemplates, matrix};
})();
