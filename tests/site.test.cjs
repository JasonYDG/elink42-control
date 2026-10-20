"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),site=path.join(root,"build/elink42-control");
test("Pages deploys only the control client with relative paths and exact hashes",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(site,"site-manifest.json")));
  assert.equal(manifest.pages_url,"https://jasonydg.github.io/elink42-control/");
  assert.equal(manifest.content,"web-control-only");assert.equal(Object.keys(manifest.assets).length,11);
  assert.deepEqual(fs.readdirSync(site).sort(),[...Object.keys(manifest.assets),"site-manifest.json"].sort());
  for(const [name,hash] of Object.entries(manifest.assets)){
    assert.ok(!name.includes("/")&&!/\.(bin|hex|zip|elf|c|h|S|ld)$/i.test(name),name);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(site,name))).digest("hex"),hash);
  }
  for(const name of ["index.html"]){
    const html=fs.readFileSync(path.join(site,name),"utf8");
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
    assert.ok(!html.includes("downloads.html")&&!html.includes('href="firmware/'));
    for(const [,url] of html.matchAll(/(?:href|src)="([^"]+)"/g)){
      if(url.startsWith("https://")){assert.equal(new URL(url).hostname,"github.com");continue;}
      assert.ok(!url.startsWith("/"),url);assert.ok(fs.existsSync(path.join(site,url)),url);
    }
  }
});
test("weather private-key input remains disabled and no firmware is present in public source",()=>{
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
  assert.match(html,/<input id="weather-key" disabled/);assert.match(html,/<button id="weather-fetch" disabled/);
  assert.match(html,/data-hosting="github-pages"/);assert.match(html,/connect-src 'self' data: https:\/\/uapis.cn/);
  for(const p of fs.readdirSync(root,{recursive:true})){
    if(p.split(path.sep).some(part=>[".git","build"].includes(part)))continue;
    assert.ok(!/\.(bin|hex|zip|elf|c|h|S|ld)$/i.test(p),p);
    assert.ok(!p.split(path.sep).some(part=>["firmware","local-project","SDK"].includes(part)),p);
  }
});
