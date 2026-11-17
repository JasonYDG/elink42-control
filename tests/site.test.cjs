"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),site=path.join(root,"build/elink42-control");
const migrationFile='firmware/elink42-v33-sdk19-migration.zip';
const latestMigrationFile='firmware/elink42-v33-sdk21-migration.zip';
const v33Files=['tricolor-ssd1619','fourcolor-jd79668'].map(panel=>'firmware/elink42-'+panel+'-v33-ota.zip');
const firmwareFiles=new Set(['firmware/LICENSES.txt',migrationFile,...['tricolor-ssd1619','fourcolor-jd79668'].map(panel=>'firmware/elink42-sdk-v7-'+panel+'.e42ota')]);
for(const revision of [6,8,9,10,12,14,15,16,17,18,19,20,21])for(const panel of ['tricolor-ssd1619','fourcolor-jd79668'])firmwareFiles.add('firmware/elink42-sdk-v'+revision+'-'+panel+'.e42ota');
firmwareFiles.add(latestMigrationFile);
for(const name of v33Files)firmwareFiles.add(name);
test("Pages deploys the control client and bundled OTA with relative paths and exact hashes",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(site,"site-manifest.json")));
  assert.equal(manifest.pages_url,"https://jasonydg.github.io/elink42-control/");
  assert.equal(manifest.content,"web-control-with-bundled-signed-ota");assert.equal(manifest.version,'0.8.18');assert.equal(manifest.firmware_revision,33);assert.equal(manifest.sdk_revision,21);assert.equal(Object.keys(manifest.assets).length,286);
  assert.deepEqual(Object.keys(manifest.firmware_images).sort(),['2','5']);
  for(const row of Object.values(manifest.firmware_images)){assert.equal(row.application_bytes,238532);assert.match(row.application_sha256,/^[0-9a-f]{64}$/);assert.match(row.bundle_sha256,/^[0-9a-f]{64}$/);}
  assert.ok(manifest.assets["firmware.js"]);
  assert.equal(manifest.assets[migrationFile],undefined);assert.equal(fs.existsSync(path.join(site,migrationFile)),false);
  assert.ok(manifest.assets[latestMigrationFile]);assert.match(fs.readFileSync(path.join(site,"index.html"),"utf8"),/id="migration-risk"[^>]*data-i18n="高风险/);
  const files=fs.readdirSync(site,{recursive:true,withFileTypes:true}).filter(p=>p.isFile()).map(p=>path.relative(site,path.join(p.parentPath,p.name)).split(path.sep).join('/')).sort();
  assert.deepEqual(files,[...Object.keys(manifest.assets),"site-manifest.json"].sort());
  for(const [name,hash] of Object.entries(manifest.assets)){
    assert.ok(!name.includes('..')&&(!/\.(bin|hex|zip|elf|c|h|S|ld)$/i.test(name)||firmwareFiles.has(name)),name);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(site,name))).digest("hex"),hash);
  }
  for(const name of ["index.html"]){
    const html=fs.readFileSync(path.join(site,name),"utf8");
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
    assert.ok(!html.includes("downloads.html")&&html.includes("sdk-ota-file"));
    assert.ok(html.includes('id="ota-bundled"')&&html.includes('id="ota-file"'));
    assert.ok(!/<script[^>]+src="firmware\.js/.test(html));
    assert.ok(html.includes(`data-firmware-src="firmware.js?v=${manifest.version}&h=${manifest.assets['firmware.js'].slice(0,12)}"`));
    for(const [,url] of html.matchAll(/(?:href|src)="([^"]+)"/g)){
      if(url==="data:,")continue;
      if(url.startsWith("https://")){assert.ok(["github.com","gu.qq.com"].includes(new URL(url).hostname),url);continue;}
      const [file,query]=url.split("?");
      assert.ok(!file.startsWith("/"),url);
      assert.equal(new URLSearchParams(query).get("v"),manifest.version,url);
      assert.equal(new URLSearchParams(query).get("h"),manifest.assets[file].slice(0,12),url);
      assert.ok(fs.existsSync(path.join(site,file)),url);
    }
  }
});
test("course-menu editor ships all local runtime files and the real Excel template",()=>{
  const html=fs.readFileSync(path.join(site,"timetable.html"),"utf8");
  const manifest=JSON.parse(fs.readFileSync(path.join(site,"site-manifest.json")));
  for(const [,url] of html.matchAll(/(?:src|href)="([^"]+)"/g)){
    if(url.startsWith("https://"))continue;
    assert.ok(!url.startsWith("/")&&!url.includes(".."),url);
    assert.ok(fs.existsSync(path.join(site,url.split("?")[0])),url);
    if(/\.(js|css)\?/.test(url)){
      const [name,query]=url.split('?'),params=new URLSearchParams(query);
      assert.equal(params.get('v'),manifest.version,url);assert.equal(params.get('h'),manifest.assets[name].slice(0,12),url);
    }
  }
  assert.ok(html.indexOf('src="calendar-font.js?')<html.indexOf('src="school-native.js?'));
  const workbench=fs.readFileSync(path.join(site,'screen-workbench.js'),'utf8');
  for(const [,version] of workbench.matchAll(/timetable\.html\?embedded=1&v=([\d.]+)/g))assert.equal(version,manifest.version);
  assert.match(html,/id="excel-file"/);assert.match(html,/id="excel-apply"/);
  assert.match(html,/href="timetable-template\.xlsx" download/);
  assert.equal(fs.readFileSync(path.join(site,"timetable-template.xlsx")).subarray(0,2).toString(),"PK");
});

test('the one-click SDK update pins the published package for each connected panel',()=>{
  const html=fs.readFileSync(path.join(site,'index.html'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(site,'site-manifest.json')));
  assert.ok(html.includes('id="sdk-ota-panel" data-revision="'+manifest.sdk_revision+'"'));
  const button=html.match(/<button id="sdk-ota-bundled"[^>]+>/)[0];
  assert.doesNotMatch(html,/<a\b[^>]*(?:\bdownload\b|\bhref="(?:\.\/)?firmware\/|\.(?:e42ota|hex|bin|zip)|\/releases\/download\/)/i);
  for(const [model,panel] of [[2,'tricolor-ssd1619'],[5,'fourcolor-jd79668']]){
    const [file,query]=button.match(new RegExp('data-src-'+model+'="([^"]+)"'))[1].split('?');
    assert.equal(file,'firmware/elink42-sdk-v'+manifest.sdk_revision+'-'+panel+'.e42ota');
    const bytes=fs.readFileSync(path.join(site,file));
    assert.equal(bytes.readUInt32LE(8),model);
    assert.equal(new URLSearchParams(query).get('v'),manifest.version);
    assert.equal(new URLSearchParams(query).get('h'),manifest.assets[file].slice(0,12));
    assert.equal(bytes.readUInt32LE(12),manifest.sdk_revision);
    assert.equal(button.match(new RegExp('data-integrity-'+model+'="([^"]+)"'))[1],'sha256-'+crypto.createHash('sha256').update(bytes).digest('base64'));
  }
});

test('the OTA page retains one-click updates without direct firmware download links',()=>{
  const html=fs.readFileSync(path.join(site,'index.html'),'utf8'),manifest=JSON.parse(fs.readFileSync(path.join(site,'site-manifest.json')));
  assert.doesNotMatch(html,/<a\b[^>]*(?:\bid="download-v33-|\bhref="(?:\.\/)?firmware\/|\.(?:e42ota|hex|bin|zip)|\/releases\/download\/)/i);
  for(const id of ['ota-bundled','sdk-ota-bundled','ota-migration'])assert.match(html,new RegExp('<button id="'+id+'"'));
  assert.match(html,/connect-src[^;]*https:\/\/web\.sqt\.gtimg\.cn/);
  assert.doesNotMatch(html,/script-src[^;]*(?:qt\.gtimg|sqt\.gtimg)/);
  assert.ok(html.indexOf('id="ota-bundled"')<html.indexOf('id="ota-migration"'));
  assert.match(html,/id="migration-risk"[^>]*data-i18n="高风险/);
  assert.match(html,/id="legacy-upgrade-route"[^>]*data-i18n="旧 V5、V6、V9 等版本的普通升级最高到安全版 V33；跨系列迁移单独提示高风险。"/);
  for(const [index,model] of [[0,2],[1,5]]){
    assert.equal(manifest.assets[v33Files[index]],manifest.firmware_images[model].bundle_sha256);
  }
});

test('startup keeps the firmware revision metadata consistent with the on-demand signed payload',()=>{
  const vm=require('node:vm'),firmware=vm.runInNewContext(fs.readFileSync(path.join(root,'firmware.js'),'utf8')+';OMFirmware');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.equal(Number(app.match(/const bundledFirmwareRevision=(\d+);/)[1]),firmware.revision);
});

test('only the named v33 and migration OTA ZIPs are public, with no raw firmware images',()=>{
  for(const folder of [root,site]){
    const names=fs.readdirSync(folder,{recursive:true}).filter(n=>!n.split(path.sep).some(p=>['.git','build'].includes(p)));
    assert.ok(!names.some(n=>/\.(hex|zip|bin)$/i.test(n)&&![migrationFile,latestMigrationFile,...v33Files].includes(n.split(path.sep).join('/'))));
  }
  assert.ok(!/\]\(firmware\//.test(fs.readFileSync(path.join(root,'README.md'),'utf8')));
});
test("weather controls are absent and no firmware source, private keys or raw images are public",()=>{
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
  assert.doesNotMatch(html,/id="(?:tab-weather|weather-editor|weather-key|weather-fetch)"/);
  assert.doesNotMatch(html.match(/<select id="job-kind">([\s\S]*?)<\/select>/)[1],/value="weather"/);
  assert.match(html,/id="nav-stock"[^>]*>股票日历/);
  assert.match(html,/data-hosting="github-pages"/);assert.match(html,/connect-src 'self' data: https:\/\/uapis.cn/);
  for(const p of fs.readdirSync(root,{recursive:true})){
    if(p.split(path.sep).some(part=>[".git","build"].includes(part)))continue;
    const name=p.split(path.sep).join('/');
    assert.ok(!/\.(bin|hex|zip|elf|c|h|S|ld|pem|key)$/i.test(p)||firmwareFiles.has(name),p);
    assert.ok(!p.split(path.sep).some(part=>["local-project","SDK"].includes(part)),p);
    if(name==='firmware'||name.startsWith('firmware/'))assert.ok(name==='firmware'||firmwareFiles.has(name),p);
  }
});
