"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

test("red honeycomb retains the approved 31 dates and maps retired plans to red", async () => {
  const wasm = fs.readFileSync(path.join(__dirname, "../sdk-preview.wasm"));
  const {instance: {exports: device}} = await WebAssembly.instantiate(wasm);
  // Hash every complete panel frame from the approved red design for December.
  const expected = {
    2: "d1bc2b45e680b471cf6bd6b0d7299e02576ff189d79e5f88dc3c277f10521e91",
    5: "69df8bc3db46cc256adc994012d3f44864d1ac240f28db150c30c7ef5cee65f3"
  };
  for (const model of [2, 5]) {
    const month = createHash("sha256");
    function frame(day, style) {
      const ptr = device.preview_render(2026, 12, day, 0, style * 8 + 2, model, 0);
      assert.ok(ptr);
      return Buffer.from(new Uint8Array(device.memory.buffer, ptr, 30000));
    }
    for (let day = 1; day <= 31; day++) {
      const red = frame(day, 14);
      assert.deepEqual(frame(day, 13), red);
      month.update(red);
    }
    assert.equal(month.digest("hex"), expected[model]);
  }
});
