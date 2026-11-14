"use strict";
const OMOTA = (() => {
  const SERVICE = "0000fe59-0000-1000-8000-00805f9b34fb";
  const CONTROL = "8ec90001-f315-4f60-9fb8-838830daea50", DATA = "8ec90002-f315-4f60-9fb8-838830daea50";
  // The retained native table uses a 16-bit 0x0003 UUID for its version characteristic.
  const VERSION = "00000003-0000-1000-8000-00805f9b34fb";
  const SIZE = 238532, FOUNDATION = {"2": "92388266519726d537fe51e5e40a607badf4460d16ea63fe8250ea3fde59a037", "5": "685a36d764bddd7dd8e735f7833b6553a513b21eb46ddd1e23c778756527a986"};
  const REPAIRED_FOUNDATION={"2":"caff106e401ac13b75e22acf0556ee8fb15f7a99132e71990698308e8a86ca48","5":"046dc44e400252e93bc1bd5f33ce7e0a847dc9990b11f2c2b1d001c955b928dc"};
  const LIFECYCLE_FOUNDATION={"2":"a8b16a7d501fd4ff24f7894593c7583694dce9fc84cd846583c4393e69576047","5":"4d7239366ef403cbf7c2b862d2f6685dc2218dcc55761903638a3e51fc99c592"};
  const HARDENED_FOUNDATION={"2":"7ecbfb55245e38986c4375222781233e7a461d90ae7b1621929256771dd827bd","5":"1003eb0e108c4706fd8da1771e9a2d66373b29deab80b01ea4256650672d9630"};
  const BOOT_FOUNDATION={"2":"c9d75ebe2b67ab7a214d3286c17beca498e93987a8267259f9a538b697b30dc0","5":"2508d0af47844252b0f48ea46e84eceb9a66a87fcf16caae616cc5f405bf76d6"};
  const TWO_STAGE_IMAGES = {"2":{"legacy":"02ca8f71f7b428f6f2e233c1f158d4f8a8d51954bb0e0459033c97966afd61ba","repaired":"cc6cbbcb6ecedb9a661aa128a2f7cf4690403fedc51d7fd660387b1ca77f9419","stable":"80fb31858b2e8427cf2ca45aa7e71545782367f83fee815134b309ab7fccf798","hardened":"25f057aa63fa2db912a212a9c251a8982cc58e18718defdac28cbc963471eafc","boot":"ca6ef84238c69dfbe2d81f006a2efede972ac8f354a9ca70e8d4a922b9426813","target":"94b3cda43b98b9c2601d8bf260a5d98e7d190cdcf44cdcb1f590b86fe129f043"},"5":{"legacy":"b88c776246aa5dbab22ae8db118c3535f36760812a38a600b2c583f9fa62ed1b","repaired":"d1da30f3d31991c5242273ceb913624f808bab6604c98451a94b0437cd22d6e5","stable":"1ef53d54de359f078204437b9e62f89265d16a090c12086f572caa85d8169de4","hardened":"f77e044cc58d1c7c0de95d2825fed87894a1ba5f9343b7c595a07d31d5dcbe2a","boot":"f2db138c05622f0f50782be6e6ecd5d54445277a5ec1adbea785ed0d9fe7618d","target":"595ead5e33da141d30845c7009f87906f4ec5493054f41e189a2bc68ca2d28fb"}};
  const TRANSITION_IMAGES={
    2:["bb8f90fe8980d3ba9d2e9cca65d463e9b6dce7722474a0d7da219fb93c83b4ac","f721222b51c7584937e716066b6dc9f02eabc9d476f761e94160e7a07b312c28"],
    5:["689d7946abfa01eb069c983b28d4cfda3b9af76558e4ecae19b5c58888e872da","5d0a3f0dc488bbe32deb876a55a09d716a1b0d10540f7f2b94cf45ba408c2835"]
  };
  // Only reviewed C/OTA application functions vary; activation-removal hooks stay pinned.
  const APP = [[3600,13424],[21962,22122],[23616,23720],[23928,24196],[24684,25008],[26992,27046],[27048,27380],[54456,54756],[75280,75708],[77136,77248],[77556,80068],[116076,116796],[120388,120992],[121176,121564],[121808,121872],[124092,124104],[124324,124780],[138024,138188],[138512,139176],[139728,139892],[140216,140856],[143488,143530],[182340,182572],[182580,182832],[182868,183448],[183800,183936]];
  const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  const sha = async bytes => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const number = bytes => BigInt("0x" + hex(bytes));
  const little = bytes => number(bytes.slice().reverse());
  const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFFFFn;
  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFF99DEF836146BC9B1B4D22831n;
  const G = [0x188DA80EB03090F67CBF20EB43A18800F4FF0AFD82FF1012n, 0x07192B95FFC8DA78631011ED6B24CDD573F977A11E794811n];
  const KEY = "ad1c33024edd53cfc7a8380e418dd7c949a3d10aed9519d270b8c7cd45a09efafa4180fc7c9db6c8f7d8ce05a0d66ef1";
  const key = Uint8Array.from(KEY.match(/../g), b => parseInt(b, 16)), Q = [little(key.slice(0, 24)), little(key.slice(24))];
  const mod = (x, m) => (x % m + m) % m;
  function inverse(x, m) {
    let a = mod(x, m), b = m, u = 1n, v = 0n;
    while (a) { const q = b / a; [a, b] = [b % a, a]; [u, v] = [v - q * u, u]; }
    if (b !== 1n) throw Error(OMI18n.t("OTA 签名数值无效")); return mod(v, m);
  }
  function add(a, b) {
    if (!a) return b; if (!b) return a;
    const [x, y] = a, [u, v] = b;
    if (x === u && mod(y + v, P) === 0n) return null;
    const slope = mod((x === u ? 3n * x * x - 3n : v - y) * inverse(x === u ? 2n * y : u - x, P), P);
    const z = mod(slope * slope - x - u, P); return [z, mod(slope * (x - z) - y, P)];
  }
  function multiply(k, point) {
    let result = null;
    while (k) { if (k & 1n) result = add(result, point); point = add(point, point); k >>= 1n; }
    return result;
  }
  async function signature(dat) {
    const r = little(dat.slice(56, 80)), s = little(dat.slice(80, 104));
    if (r <= 0n || r >= N || s <= 0n || s >= N) return false;
    // The preserved uECC implementation consumes the low 192 bits of its little-endian SHA output.
    const h = number((await sha(dat.slice(0, 56))).slice(8)), w = inverse(s, N);
    const point = add(multiply(mod(h * w, N), G), multiply(mod(r * w, N), Q));
    return !!point && point[0] % N === r;
  }
  async function validate(datInput, binInput) {
    if (!(datInput instanceof Uint8Array) || !(binInput instanceof Uint8Array)) throw Error(OMI18n.t("OTA 包数据类型无效"));
    const dat = datInput.slice(), bin = binInput.slice();
    if (dat.length !== 104) throw Error(OMI18n.t("firmware.dat 必须为 104 字节；HEX/BIN 不能代替独立签名 OTA 包"));
    if (bin.length !== SIZE) throw Error(OMI18n.t("固件长度不符合已核验的 OM6626 4.2 寸布局；其他屏型或版本需先核验"));
    const view = new DataView(dat.buffer);
    const model = (view.getUint32(12, true) >>> 8) & 255, revision = view.getUint32(16, true);
    if (view.getUint32(0, true) !== 0x5A4B4446 || view.getUint32(4, true) !== 1 ||
        view.getUint16(8, true) !== 1 || view.getUint16(10, true) !== 1 || view.getUint32(12, true) !== (0x5A4B0000 | (model << 8)) ||
        ![2, 5].includes(model) || !revision || view.getUint32(20, true) !== bin.length)
      throw Error(OMI18n.t("只接受本项目独立签名 OTA 包；原版、未签名或其他屏型包已拒绝"));
    const digest = await sha(bin), imageHash=hex(digest);
    if (hex(digest.slice().reverse()) !== hex(dat.slice(24, 56))) throw Error(OMI18n.t("firmware.bin 的 SHA-256 与签名包不符"));
    if (!await signature(dat)) throw Error(OMI18n.t("OTA 项目签名无效；不接受作者或其他项目的签名"));
    // Both signed bench fixtures claim v34 but their actual boot notifications report v33.
    if (imageHash==="8ce8178011b5cac2eb25394694f265d90fbd281c0a080390a5f5be6f9cebb909" ||
        imageHash==="4fbd1d2bd04de1e6595d763261e8431b13b051d8af2aa2818a4b1703ecda50f9") {
      const error=Error(OMI18n.t("这是测试镜像，重启后仍是 v33，不能迁移到 SDK 6。没有开始擦写。"));
      error.code="OTA_PRECHECK";throw error;
    }
    const protectedBytes = bin.slice(); for (const [start, end] of APP) protectedBytes.fill(0, start, end);
    const foundation=hex((await sha(protectedBytes)).reverse());
    const boot=revision>=30 && foundation===BOOT_FOUNDATION[model];
    const hardened=boot || (revision>=28 && foundation===HARDENED_FOUNDATION[model]);
    const lifecycle=hardened || (revision>=19 && foundation===LIFECYCLE_FOUNDATION[model]);
    if (foundation!==FOUNDATION[model] && !(revision>=16 && foundation===REPAIRED_FOUNDATION[model]) && !lifecycle) throw Error(OMI18n.t("OTA 包改变了已保护的启动、驱动、波形、激活移除或身份区域，已停止"));
    if (new TextDecoder().decode(bin.slice(208405, 208416)) !== OMProtocol.OTA_MARKER || bin[51172] !== model ||
        new DataView(bin.buffer).getUint32(79984,true) !== revision || hex(bin.slice(79988,80036)) !== KEY || hex(bin.slice(80036,80068)) !== foundation)
      throw Error(OMI18n.t("固件中的独立 OTA 信任、屏型或标识不符"));
    return {dat, bin, size: bin.length, version: String(revision), revision, model, sha256:imageHash, independent: true,repaired:lifecycle || foundation===REPAIRED_FOUNDATION[model],lifecycle,hardened,boot};
  }
  async function single(files) {
    if (files.size !== 3 || !["manifest.json", "firmware.dat", "firmware.bin"].every(n => files.has(n)))
      throw Error(OMI18n.t("OTA ZIP 只接受 manifest.json、firmware.dat、firmware.bin 三个文件"));
    const manifest = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(files.get("manifest.json")));
    const app = manifest?.manifest?.application;
    if (!app || app.bin_file !== "firmware.bin" || app.dat_file !== "firmware.dat" ||
        Object.keys(manifest.manifest).some(k => k !== "application")) throw Error(OMI18n.t("OTA manifest 不是单一应用镜像"));
    return validate(files.get("firmware.dat"), files.get("firmware.bin"));
  }
  async function parse(buffer) {
    const source=new Uint8Array(buffer).slice(),files=await OMArchive.unzip(source);
    const manifest=files.has("manifest.json")?JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(files.get("manifest.json"))):null;
    if(manifest?.format!=="elink42-ota-bundle") return single(files);
    if(manifest.version!==7 && manifest.version!==1)
      throw Error(OMI18n.t("旧整合包已停用，请载入内置 v32 两阶段升级包"));
    if(manifest.version===7) {
      if(manifest.target_revision!==32 || files.size!==14 || !files.has("LICENSES.txt") || Object.keys(manifest.models||{}).sort().join()!=="2,5")
        throw Error(OMI18n.t("整合 OTA 包结构无效"));
      const models={};
      for(const model of [2,5]) {
        const routes=manifest.models[model];
        if(Object.keys(routes||{}).sort().join()!=="boot,hardened,legacy,repaired,stable") throw Error(OMI18n.t("整合 OTA 阶段不完整"));
        models[model]={};
        for(const family of ["legacy","repaired","stable","hardened","boot"]) {
          const rows=routes[family];
          if(!Array.isArray(rows)||rows.length!==2) throw Error(OMI18n.t("整合 OTA 阶段不完整"));
          const stages=[];
          for(let i=0;i<2;i++) {
            const revision=i?32:family==="boot"?30:31,name=i || family==="boot"?`model${model}-v${revision}.zip`:`model${model}-${family}-v31.zip`,row=rows[i];
            if(row?.file!==name || row.revision!==revision || !files.has(name)) throw Error(OMI18n.t("整合 OTA 阶段不完整"));
            const pack=await single(await OMArchive.unzip(files.get(name)));
            if(pack.model!==model || pack.revision!==revision || pack.sha256!==row.sha256 ||
               pack.sha256!==TWO_STAGE_IMAGES[model]?.[i?"target":family] ||
               (!i && family!=="boot" && (pack.boot || pack.hardened!==(family==="hardened") || pack.lifecycle!==(["stable","hardened"].includes(family)) || pack.repaired!==(family!=="legacy"))) || ((i || family==="boot") && !pack.boot))
              throw Error(OMI18n.t("整合 OTA 屏型、版本或过渡配对不符"));
            stages.push(pack);
          }
          models[model][family]=stages;
        }
      }
      return {bundle:true,bundleVersion:7,models,revision:32,version:"31 → 32 / 30 → 32",size:source.length,sha256:hex(await sha(source)),independent:true,source};
    }
    if(manifest.version!==1 || manifest.target_revision!==17 || files.size!==8 || !files.has("LICENSES.txt") || Object.keys(manifest.models||{}).sort().join()!=="2,5")
      throw Error(OMI18n.t("整合 OTA 包结构无效"));
    const models={};
    for(const model of [2,5]) {
      const rows=manifest.models[model];if(!Array.isArray(rows)||rows.length!==3) throw Error(OMI18n.t("整合 OTA 阶段不完整"));
      const stages=[];
      for(let i=0;i<3;i++) {
        const row=rows[i],revision=15+i,name=`model${model}-v${revision}.zip`;
        if(row?.file!==name || row.revision!==revision || !files.has(name)) throw Error(OMI18n.t("整合 OTA 阶段不完整"));
        const pack=await single(await OMArchive.unzip(files.get(name)));
        if(pack.model!==model || pack.revision!==revision || pack.sha256!==row.sha256 ||
           (i<2 && pack.sha256!==TRANSITION_IMAGES[model][i]) || (i===2 && !pack.repaired))
          throw Error(OMI18n.t("整合 OTA 屏型、版本或过渡配对不符"));
        stages.push(pack);
      }
      models[model]=stages;
    }
    return {bundle:true,models,revision:17,version:"15 → 16 → 17",size:source.length,sha256:hex(await sha(source)),source};
  }
  function target(client) {
    if (!client.ready || !client.device?.gatt.connected || ![2, 5].includes(client.config?.model) ||
        client.board?.id !== 1 || client.board?.name !== OMProtocol.OTA_MARKER) throw Error(OMI18n.t("当前设备尚未接入独立 OTA；首次需有线刷入对应屏型的独立 OTA 引导 HEX"));
  }
  async function inspect(client) {
    target(client);
    try {
      const service = await client.bounded(client.device.gatt.getPrimaryService(SERVICE), OMI18n.t("读取 OTA 服务"));
      const control = await client.bounded(service.getCharacteristic(CONTROL), OMI18n.t("读取 DFU 控制接口"));
      const data = await client.bounded(service.getCharacteristic(DATA), OMI18n.t("读取 DFU 数据接口"));
      if (!control.properties.write || !control.properties.notify || !data.properties.writeWithoutResponse)
        throw Error(OMI18n.t("DFU 特征属性与 OM6626 原协议不符"));
      return {control, data};
    } catch (error) {
      if (error.name === "SecurityError") throw Error(OMI18n.t("当前蓝牙授权不含 OTA 服务；请断开后点连接屏幕，重新选择同一设备授权"));
      throw error;
    }
  }
  function checkReply(bytes, opcode) {
    const length = opcode === 3 ? 11 : opcode === 6 ? 15 : 3;
    if (bytes.length !== length || bytes[0] !== 0x60 || bytes[1] !== opcode || bytes[2] !== 1) {
      const reason = bytes[2] === 4 ? (opcode === 1 ? OMI18n.t("旧 v1 的启动记录检查不兼容；需有线刷入 v1-fixed，不能靠网页跳过固件检查") :
        OMI18n.t("设备读写或提交读回失败，升级未确认；不会自动重写")) : {
        129: OMI18n.t("启动记录读取失败，尚未擦除暂存区"), 130: OMI18n.t("启动记录仍指向待完成升级的暂存区，已停止"),
        131: OMI18n.t("当前应用位置或长度超出已核验范围，尚未擦除暂存区"), 132: OMI18n.t("暂存区擦除失败")}[bytes[2]];
      const error=Error(OMI18n.msg`DFU 命令 0x${opcode.toString(16)} 被拒绝或回包无效（状态 ${bytes[2] ?? OMI18n.t("未知")}）${reason ? "：" + reason : ""}`);
      if(bytes.length===3 && bytes[0]===0x60 && bytes[1]===opcode && [4,8,129,130,131,132].includes(bytes[2])) error.code="OTA_PRECHECK";
      throw error;
    }
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  function checkRevision(current, pack) {
    let message;
    if(current===18 && pack.revision!==19) message="v18 仅接受原配 v19；请使用新版整合包继续升级";
    else if(current===20 && pack.revision!==21) message="v20 仅接受原配 v21；请使用新版整合包继续升级";
    else if(current===23 && pack.revision!==24) message="v23 仅接受配套 v24；请使用新版整合包继续升级";
    else if(current===27 && pack.revision!==28) message="v27 仅接受配套 v28；没有发送升级命令";
    else if(current===29 && pack.revision!==30) message="v29 仅接受配套 v30；没有发送升级命令";
    else if(current===31 && pack.revision!==32) message="v31 仅接受配套 v32；没有发送升级命令";
    else if(pack.boot && current!==29 && current!==31 && current<30) message="本修复包需要配套过渡接收器；请使用内置整合包，没有发送升级命令";
    else if(current>=30 && !pack.boot) message="当前版本不接受旧底层固件回退；没有发送升级命令";
    else if([29,31].includes(pack.revision) && (pack.boot || pack.hardened!==(current===28) || pack.lifecycle!==[19,21,24,28].includes(current) || pack.repaired!==(current>=16))) message="过渡包与当前底层不匹配；没有发送升级命令";
    else if(pack.hardened && !pack.boot && ![29,31].includes(pack.revision) && current!==27 && current<28) message="本修复包需要配套 v27 接收器；请使用新版两阶段整合包，没有发送升级命令";
    else if(current>=28 && !pack.hardened) message="当前版本不接受旧底层固件回退；没有发送升级命令";
    else if(pack.lifecycle && current<18) message="本修复包需要过渡接收器；请使用新版两阶段整合包，没有发送升级命令";
    else if(pack.repaired && current<15) message="请先升级 v15 过渡包并读回版本，再升级 v16 修复包；没有发送升级命令";
    else if(current===15 && pack.revision!==16) message="v15 过渡固件只接受配套的 v16 修复包";
    else if(current>=16 && !pack.repaired) message="当前修复版不接受旧驱动基线的回退包；没有发送升级命令";
    if(message) { const error=Error(OMI18n.t(message));error.code="OTA_PRECHECK";throw error; }
  }
  function bundleRoute(revision) {
    if(revision>=3 && revision<=14) return "legacy";
    if(revision===16 || revision===17) return "repaired";
    if([19,21,24].includes(revision)) return "stable";
    if(revision===28) return "hardened";
    return revision===29 ? "boot" : revision===30 || revision===31 ? "target" : null;
  }
  function pairedRevision(current) {
    return [15,18,20,23,27].includes(current) ? current+1 : null;
  }
  async function transfer(client, input, consent, progress = () => {}) {
    target(client); const device = client.device;
    if (consent?.deviceId !== device.id || consent.eraseImages !== true) throw Error(OMI18n.t("请确认目标设备、备份图片并明确同意清空图库"));
    const pack = await validate(input.dat, input.bin);
    if (pack.model !== client.config.model) throw Error(OMI18n.t("OTA 包与当前设备屏型不匹配；没有发送升级命令"));
    if(client.firmwareRevision) checkRevision(client.firmwareRevision,pack);
    if(pack.revision>=15 || pack.repaired || client.firmwareRevision>=15) {
      const current=await readRevision(client);
      checkRevision(current,pack);
    }
    if (client.device !== device) throw Error(OMI18n.t("校验期间目标设备发生变化，未发送 OTA 命令"));
    target(client);
    if (client.deviceInfoSupported) {
      const info = await client.readDeviceInfo();
      if (info?.millivolts == null || info.millivolts < 2900) {
        const error = Error(OMI18n.t("OTA 需要实测电压至少 2.90 V；未开始擦写，请更换电池后重试。") + (info?.millivolts == null ? "" : ` (${info.millivolts} mV)`));
        error.code = "OTA_PRECHECK"; throw error;
      }
    }
    const {control, data} = await inspect(client);
    const connected = () => { if (client.device !== device || !device.gatt.connected) throw Error(OMI18n.t("OTA 蓝牙断开，结果未确认；不会自动重发")); };
    connected();
    // Keep the panel quiescent across an MCU-only OTA reboot; older OTA clients lack queue ACKs.
    const quietUpdate=pack.revision>=18;
    if(quietUpdate && !client.refreshStatus) { const error=Error(OMI18n.t("当前固件无法确认暂停刷新，未发送升级命令"));error.code="OTA_PRECHECK";throw error; }
    if (client.refreshStatus && quietUpdate) {
      // Never enter the legacy display driver while installing the receiver or its pinned target.
      await client.command(OMProtocol.time(new Date(0),0,0));
      connected();
      // Released v3-v8 acknowledge pause but lack timing flags; never enter their panel driver.
      if(!(client.firmwareRevision>=3 && client.firmwareRevision<=8)) await client.waitForDisplay();
      connected();
    } else if (client.refreshStatus) {
      const now=new Date(),region=client.calendarProtocol===2?OMCalendar.byId(client.config.layout):null,country=region?.code||"CN";
      await client.command(OMProtocol.time(now,0,OMCalendar.zone(country,now)));
      connected();
      // Legacy receivers must be upgradable without repeating their unsafe initialization.
      if (client.lifecycleSupported && client.timingSupported) {
        await client.initialize();
        connected();
      }
      await client.command(Uint8Array.of(6));
      connected();
    }
    if (client.timingSupported && pack.revision < 9) {
      if (client.calendarProtocol !== 2 || client.config.raw?.length !== 15)
        throw Error(OMI18n.t("旧版回退缺少完整日历配置，尚未擦除固件"));
      const legacy=client.config.raw.slice();
      legacy[11]=0;legacy[12]=pack.revision<6?0:client.config.layout;legacy[14]&=1;
      await client.write(Uint8Array.of(0x90,...legacy));
      if (!await client.readCalendar() || client.config.mode!==0 || client.config.layout!==legacy[12] || client.config.alternate!==0)
        throw Error(OMI18n.t("旧版日历配置转换未核对，尚未擦除固件"));
      connected();
    }
    const notify = event => {
      if (event.target !== control) return;
      const value = event.target.value, bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
      if (bytes[0] !== 0x60) return;
      for (const waiter of [...client.pending]) if (waiter.match(bytes)) waiter.resolve(bytes);
    };
    const response = opcode => client.wait(b => b[0] === 0x60 && b[1] === opcode, OMI18n.t("OTA 设备回执（结果未确认）"), 45000);
    async function command(bytes) {
      connected(); const reply = response(bytes[0]);
      try {
        await client.bounded(control.writeValueWithResponse(bytes), OMI18n.t("OTA 控制写入"), 45000);
        return checkReply(await reply.promise, bytes[0]);
      } catch (error) { reply.cancel(error); throw error; }
    }
    function checksum(reply, offset, crc) {
      const view = checkReply(reply, 3);
      if (view.getUint32(3, true) !== offset || view.getUint32(7, true) !== crc)
        throw Error(OMI18n.t("OTA 设备确认的偏移或 CRC32 不符，已停止且不自动重发"));
    }
    async function send(bytes, label, start, span) {
      let offset = 0, crc = 0;
      while (offset < bytes.length) {
        const count = Math.min(16, Math.ceil((bytes.length - offset) / 20));
        const receipt = count === 16 ? response(3) : null;
        try {
          for (let i = 0; i < count; i++) {
            connected(); const part = bytes.slice(offset, offset + 20);
            await client.bounded(data.writeValueWithoutResponse(part), OMI18n.t("OTA 数据写入"));
            offset += part.length; crc = OMArchive.crc32(part, crc);
          }
          if (receipt) checksum(await receipt.promise, offset, crc);
        } catch (error) { receipt?.cancel(error); throw error; }
        progress(start + Math.floor(offset / bytes.length * span), OMI18n.msg`${label} ${offset.toLocaleString()} / ${bytes.length.toLocaleString()} 字节`);
      }
      const result = await command(Uint8Array.of(3));
      if (result.getUint32(3, true) !== offset || result.getUint32(7, true) !== crc) throw Error(OMI18n.t("OTA 最终传输偏移或 CRC32 不符"));
    }
    control.addEventListener("characteristicvaluechanged", notify);
    try {
      await client.bounded(control.startNotifications(), OMI18n.t("启用 OTA 回执"));
      for (const [type, bytes, label] of [[1, pack.dat, OMI18n.t("签名命令包")], [2, pack.bin, OMI18n.t("固件")]]) {
        const selected = await command(Uint8Array.of(6, type));
        if (selected.getUint32(3, true) < bytes.length) throw Error(OMI18n.t("设备 OTA 容量不足"));
        const create = new Uint8Array(6); create.set([1, type]); new DataView(create.buffer).setUint32(2, bytes.length, true);
        await command(create); await command(Uint8Array.of(2, 16, 0));
        await send(bytes, label, type === 1 ? 0 : 2, type === 1 ? 2 : 96);
        if (type === 2) progress(99, OMI18n.t("设备正在重新读取固件并校验 SHA-256，等待最终执行回执"));
        await command(Uint8Array.of(4));
      }
      progress(99, OMI18n.t("固件已校验并提交，等待重启后核对版本"));
      client.disconnect();
      return {status: "device-verified-reboot-pending", device, independent: pack.independent, revision:pack.revision, model:pack.model};
    } finally { control.removeEventListener("characteristicvaluechanged", notify); }
  }
  async function confirmBoot(client, pack, progress) {
    const device = pack.device, deadline = Date.now() + 120000;
    if (client.device !== device) throw Error(OMI18n.t("升级期间目标设备发生变化，已停止"));
    client.connectCancelled = false;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (client.device !== device || client.connectCancelled) throw Error(OMI18n.t("OTA 已提交，重连被取消；启动结果未确认"));
      try { await client.openConnection(); }
      catch (error) {
        const retry = error.name === "NetworkError" || !device.gatt.connected;
        device.gatt.disconnect();
        client.control?.removeEventListener("characteristicvaluechanged", client.notify);
        device.removeEventListener?.("gattserverdisconnected", client.disconnected);
        if (client.connectCancelled || !retry) throw error;
        continue;
      }
      if (client.device !== device) throw Error(OMI18n.t("升级期间目标设备发生变化，已停止"));
      const revision = await readRevision(client);
      client.log(OMI18n.t("重启读回：")+(client.config.model===2?"SSD1619":"JD79668")+" · v"+revision);
      if (Date.now() >= deadline || revision !== pack.revision || client.config.model !== pack.model)
        throw Error(OMI18n.t("重启后的屏型或固件版本不匹配，OTA 结果未确认"));
      progress(100, OMI18n.msg`升级完成，已重连并确认 ELINK 固件版本 ${pack.revision}；请核对实屏`);
      return {status:"boot-verified", revision:pack.revision, model:pack.model};
    }
    throw Error(OMI18n.t("OTA 已提交，但未在两分钟内确认新版本启动；不会重新擦写，请保留供电并核对设备"));
  }
  async function upgradeBundle(client,input,consent,progress=()=>{}) {
    target(client);const device=client.device,model=client.config.model;
    if(consent?.deviceId!==device.id || consent.eraseImages!==true) throw Error(OMI18n.t("请确认目标设备、备份图片并明确同意清空图库"));
    const bundle=await parse(input.source);
    if(!bundle.bundle) throw Error(OMI18n.t("整合 OTA 包结构无效"));
    if(bundle.bundleVersion!==7) { const error=Error(OMI18n.t("旧整合包已停用，请载入内置 v32 两阶段升级包"));error.code="OTA_PRECHECK";throw error; }
    const current=await readRevision(client);
    if(current>=bundle.revision) {
      const error=Error(OMI18n.t("设备已达到整合包版本，无需升级"));error.code="OTA_PRECHECK";throw error;
    }
    const route=bundleRoute(current);
    if(!route) { const error=Error(pairedRevision(current)?OMI18n.t("请先载入原配无线升级包：")+"v"+pairedRevision(current):OMI18n.t("当前版本不兼容本两阶段包，未发送升级命令"));error.code="OTA_PRECHECK";throw error; }
    const stages=route==="target" ? [bundle.models[model].legacy[1]] : bundle.models[model][route];
    if(stages.length>2) { const error=Error(OMI18n.t("旧整合包需要超过两次刷写，已停止；请使用新版两阶段包"));error.code="OTA_PRECHECK";throw error; }
    const quietReceiver=async()=>{
      if(!await client.readCalendar() || client.config.mode!==0) {
        const error=Error(OMI18n.t("过渡接收器未确认静默状态，已停止；不会自动重发"));error.code="DISPLAY_NOT_READY";throw error;
      }
    };
    if(current===29 || current===31) await quietReceiver();
    let result;
    for(let i=0;i<stages.length;i++) {
      if(client.device!==device || client.config.model!==model) throw Error(OMI18n.t("升级期间目标设备发生变化，已停止"));
      const pack=stages[i],label=OMI18n.msg`阶段 ${i+1}/${stages.length} · v${pack.revision}`;
      client.log(label);
      const stageProgress=(value,text)=>progress(Math.floor((i*100+value)/stages.length),label+" · "+text);
      try {
        const verified=await transfer(client,pack,consent,stageProgress);
        result=await confirmBoot(client,verified,stageProgress);
        if(pack.revision===31) await quietReceiver();
      } catch(error) { client.log(label+" · "+OMI18n.t("阶段未确认，已停止；不会自动重发"));throw error; }
    }
    return result;
  }
  async function versionReply(client, version, query, matches) {
    const device = client.device;
    if (!version.properties.write || !version.properties.notify) throw Error(OMI18n.t("固件版本接口不符，无法核对版本"));
    let versionBytes;
    const notify = event => {
      if (event.target !== version) return;
      const v = event.target.value, bytes = new Uint8Array(v.buffer,v.byteOffset,v.byteLength).slice();
      versionBytes=bytes;
      for (const waiter of [...client.pending]) if (waiter.match(bytes)) waiter.resolve(bytes);
    };
    version.addEventListener("characteristicvaluechanged", notify);
    let receipt;
    try {
      await client.bounded(version.startNotifications(), OMI18n.t("启用版本回执"));
      if(client.device!==device || !device.gatt.connected || !client.ready || client.connectCancelled)
        throw Error(OMI18n.t("固件版本核对已中断，版本未确认"));
      receipt = client.wait(b=>b===versionBytes && matches(b), OMI18n.t("固件版本回执"), 15000);
      await client.bounded(version.writeValueWithResponse(query), OMI18n.t("只读查询固件版本"));
      const bytes = await receipt.promise, view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      if (client.device !== device || !device.gatt.connected || !client.ready || client.connectCancelled)
        throw Error(OMI18n.t("固件版本核对已中断，版本未确认"));
      target(client);
      return view;
    } catch (error) { receipt?.cancel(error); throw error; }
    finally { version.removeEventListener("characteristicvaluechanged", notify); }
  }
  async function readRevision(client) {
    target(client);
    const device=client.device;
    const service=await client.bounded(device.gatt.getPrimaryService(SERVICE), OMI18n.t("读取 OTA 服务"));
    const version=await client.bounded(service.getCharacteristic(VERSION), OMI18n.t("读取固件版本接口"));
    if(client.device!==device)throw Error(OMI18n.t("升级期间目标设备发生变化，已停止"));
    const view=await versionReply(client,version,Uint8Array.of(0),
      b=>b.length===12 && new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(0,true)===0x5A4B4F54);
    if(view.getUint32(4,true)!==client.config.model || !view.getUint32(8,true))
      throw Error(OMI18n.t("屏型或固件版本不匹配，版本未确认"));
    client.firmwareRevision=view.getUint32(8,true);
    return client.firmwareRevision;
  }
  async function probeOnMicroDfu(client) {
    target(client);
    if(client.firmwareRevision!==34)throw Error(OMI18n.t("请先核对过渡版 v34。"));
    const device=client.device, model=client.config.model;
    const current=()=>client.device===device && device.gatt.connected && client.ready && !client.connectCancelled &&
      client.config?.model===model && client.firmwareRevision===34;
    let service;
    try {
      service=await client.bounded(device.gatt.getPrimaryService(OMProtocol.ONMICRO_DFU_SERVICE), OMI18n.t("读取 OTA 服务"));
    } catch(error) {
      if(current() && error.name==="NotFoundError")return "absent";
      if(current() && error.name==="SecurityError")return "permission";
      throw error;
    }
    const version=await client.bounded(service.getCharacteristic("000001bf-5f03-0000-0000-4f4d2d4f5441"),OMI18n.t("读取固件版本接口"));
    if(!current())throw Error(OMI18n.t("升级期间目标设备发生变化，已停止"));
    // VERN is the Rev4316 version-only query on the vendor characteristic.
    const view=await versionReply(client,version,new TextEncoder().encode("VERN"),b=>b.length===12);
    if(!current())throw Error(OMI18n.t("升级期间目标设备发生变化，已停止"));
    return view.getUint32(0,true)===0x20211229 && view.getUint32(4,true)===15 && view.getUint32(8,true)===3?"protocol-3":"unrecognized";
  }
  return {SERVICE, CONTROL, DATA, VERSION, parse, validate, inspect, transfer, confirmBoot, readRevision,probeOnMicroDfu,upgradeBundle,bundleRoute,pairedRevision};
})();
