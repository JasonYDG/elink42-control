"use strict";

const OMSdkPreview = (() => {
  const script = new URL(document.currentScript.src);
  const engines = new Map();

  async function load(revision) {
    const asset = new URL(revision < 8 ? `sdk${revision}-preview.wasm` : "sdk-preview.wasm", script);
    asset.search = script.search || "?calendar=8";
    const response = await fetch(asset);
    if (!response.ok) throw Error(OMI18n.t("无法加载日历预览"));
    const {instance} = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    return instance.exports;
  }

  async function frame({date, country, flags, model, millivolts = 0, deviceName = "", revision = 8}) {
    const version = revision === 6 || revision === 7 ? revision : 8;
    if (!engines.has(version)) engines.set(version, load(version).catch(error => { engines.delete(version); throw error; }));
    const engine = await engines.get(version);
    const name = new Uint8Array(engine.memory.buffer, engine.preview_name(), 20);
    name.fill(0);
    new TextEncoder().encodeInto(deviceName || "--", name.subarray(0, 19));
    const address = engine.preview_render(date.getFullYear(), date.getMonth() + 1, date.getDate(),
      country, flags, model, millivolts || 0);
    if (!address) throw Error(OMI18n.t("日历预览参数无效"));
    return new Uint8Array(engine.memory.buffer, address, 30000).slice();
  }

  async function calendar(canvas, options) {
    const bytes = await frame(options);
    const planes = options.model === 5 ? {packed: bytes} :
      {black: bytes.subarray(0, 15000), red: bytes.subarray(15000)};
    canvas.getContext("2d").putImageData(new ImageData(OMProtocol.rgba(planes), 400, 300), 0, 0);
  }
  return {calendar, frame};
})();
