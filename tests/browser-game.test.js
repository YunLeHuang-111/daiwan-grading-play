"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const questions = [
  ...Array.from({ length: 5 }, (_, index) => `測試科\tA\t選擇題 ${index + 1}`),
  ...Array.from({ length: 5 }, (_, index) => `測試科\tO\t是非題 ${index + 1}`),
].join("\n");

global.fetch = async () => ({ ok: true, text: async () => questions });
const browserGame = require("../browser-game.js");

test("timed mode defers papers and applies one batch of recognized scores", async () => {
  const started = await browserGame("start", "POST", "timed");
  assert.equal(started.paper.number, 1);

  const deferred = await browserGame(`${started.id}/defer`, "POST", "1");
  assert.equal(deferred.count, 1);
  assert.equal(deferred.paper.number, 2);

  const result = await browserGame(`${started.id}/recognize`, "POST", JSON.stringify([{ number: 1, score: 60 }]));
  assert.equal(result.count, 1);
  assert.equal(result.grades[0].entered, 60);
  assert.equal(result.grades[0].number, 1);
});

test("timed mode preserves the recognition failure reason for each paper", async () => {
  const started = await browserGame("start", "POST", "timed");
  await browserGame(`${started.id}/defer`, "POST", "1");
  const failureReason = "十位數候選 8 信心不足（平均 31%、TTA 3/6 票、機率差 2%）";
  const result = await browserGame(`${started.id}/recognize`, "POST", JSON.stringify([
    { number: 1, score: null, failureReason },
  ]));
  assert.equal(result.grades[0].entered, null);
  assert.equal(result.grades[0].failureReason, failureReason);
});

test("practice mode still recognizes and submits each paper immediately", async () => {
  const started = await browserGame("start", "POST", "practice");
  const submitted = await browserGame(`${started.id}/submit`, "POST", "1,100");
  assert.equal(submitted.count, 1);
  assert.equal(submitted.paper.number, 2);
});

test("both timed modes accept confirmed scores and settle without batch recognition", async () => {
  const clock = performance;
  let now = 0;
  global.performance = { now: () => now };
  try {
    for (const mode of ["timed", "multi"]) {
      const { id } = await browserGame("start", "POST", mode);
      await browserGame(`${id}/submit`, "POST", "1,0");
      await browserGame(`${id}/submit`, "POST", "2,80");
      now += 120000;
      const result = await browserGame(`${id}/results`, "GET");
      assert.deepEqual(result.grades.map(grade => grade.entered), [0, 80]);
    }
  } finally {
    global.performance = clock;
  }
});
