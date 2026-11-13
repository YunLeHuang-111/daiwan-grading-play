"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getScoreRoiBounds,
  maskFromRgba,
  extractScoreInk,
  segmentDigits,
  normalizeDigit28,
  softmax,
  decodeLeadingDigitScore,
  isAllowedScore,
  isRecognitionCurrent,
} = require("../score-roi.js");

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

test("ROI maps CSS coordinates to DPR bitmap coordinates", () => {
  assert.deepEqual(getScoreRoiBounds(rect(10, 20, 200, 300), rect(150, 35, 50, 60), 400, 600, 0), {
    x: 280, y: 30, width: 100, height: 120,
  });
  assert.deepEqual(getScoreRoiBounds(rect(20, 30, 100, 150), rect(90, 37.5, 25, 30), 600, 900, 0), {
    x: 420, y: 45, width: 150, height: 180,
  });
});

test("ROI clamps partial and fully out-of-canvas zones", () => {
  assert.deepEqual(getScoreRoiBounds(rect(0, 0, 100, 100), rect(-10, -5, 30, 20), 200, 200, 0), {
    x: 0, y: 0, width: 40, height: 30,
  });
  assert.deepEqual(getScoreRoiBounds(rect(0, 0, 100, 100), rect(120, 120, 10, 10), 200, 200, 0), {
    x: 200, y: 200, width: 0, height: 0,
  });
});

test("extractScoreInk reads only alpha from the dynamic ROI", () => {
  const rgba = new Uint8ClampedArray(8 * 6 * 4);
  rgba[3] = 255;
  const calls = [];
  const inkCanvas = {
    width: 200, height: 100,
    getBoundingClientRect: () => rect(0, 0, 100, 50),
    getContext: () => ({ getImageData: (...args) => { calls.push(args); return { data: rgba }; } }),
  };
  const result = extractScoreInk({ inkCanvas, scoreZone: { getBoundingClientRect: () => rect(70, 5, 4, 3) }, paddingCss: 0 });
  assert.deepEqual(calls[0], [140, 10, 8, 6]);
  assert.equal(result.status, "ok");
  assert.equal(result.mask.foregroundPixels, 1);
});

function scoreMask(text) {
  const width = text.length * 16 + Math.max(0, text.length - 1) * 6;
  const height = 36;
  const data = new Uint8Array(width * height);
  let foregroundPixels = 0;
  const set = (x, y) => {
    const index = y * width + x;
    if (!data[index]) { data[index] = 1; foregroundPixels++; }
  };
  [...text].forEach((digit, index) => {
    const left = index * 22 + (digit === "1" ? 6 : 2);
    const right = index * 22 + (digit === "1" ? 9 : 13);
    for (let y = 3; y <= 32; y++) {
      for (let x = left; x <= right; x++) {
        if (digit === "1" || y <= 5 || y >= 30 || x <= left + 1 || x >= right - 1) set(x, y);
      }
    }
  });
  return { data, width, height, foregroundPixels };
}

test("segmentation preserves 0 and splits every legal multi-digit score", () => {
  for (const text of ["0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100"]) {
    const result = segmentDigits(scoreMask(text));
    assert.equal(result.status, "ok", text);
    assert.equal(result.digits.length, text.length, text);
  }
});

test("segmentation rejects empty ink and isolated noise", () => {
  assert.equal(segmentDigits({ data: new Uint8Array(100), width: 10, height: 10, foregroundPixels: 0 }).status, "empty");
  const rgba = new Uint8ClampedArray(10 * 10 * 4);
  rgba[3] = 255;
  const mask = maskFromRgba(rgba, 10, 10);
  assert.equal(segmentDigits(mask).status, "empty");
});

test("normalization creates centered 28x28 float input", () => {
  const mask = scoreMask("0");
  const box = segmentDigits(mask).digits[0];
  const normalized = normalizeDigit28(mask, box);
  assert.equal(normalized.constructor, Float32Array);
  assert.equal(normalized.length, 784);
  assert.ok(normalized.some(value => value === 1));
  for (let x = 0; x < 28; x++) assert.equal(normalized[x], 0);
});

function prediction(value, confidence = .9) {
  const probabilities = Array(10).fill((1 - confidence) / 9);
  probabilities[value] = confidence;
  return probabilities;
}

test("stable softmax handles very large logits", () => {
  const probabilities = softmax([10000, 10001, 9999]);
  assert.ok(probabilities.every(Number.isFinite));
  assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.equal(probabilities.indexOf(Math.max(...probabilities)), 1);
});

test("decoder classifies only the leading digit and uses segment count for trailing zeros", () => {
  for (const text of ["0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100"]) {
    const result = decodeLeadingDigitScore(prediction(Number(text[0])), text.length);
    assert.equal(result.status, "ok", text);
    assert.equal(result.score, Number(text), text);
    assert.equal(result.digits.length, 1, text);
  }
  assert.equal(decodeLeadingDigitScore(prediction(6), 1).status, "invalid");
  assert.equal(decodeLeadingDigitScore(prediction(0), 2).status, "invalid");
  assert.equal(decodeLeadingDigitScore(prediction(2), 3).status, "invalid");
  assert.equal(decodeLeadingDigitScore(prediction(8), 4).status, "invalid");
  assert.equal(decodeLeadingDigitScore(prediction(8, .45), 2).status, "low_confidence");
  assert.equal(decodeLeadingDigitScore([], 2).status, "invalid");
  assert.equal(isAllowedScore(NaN), false);
  assert.equal(isAllowedScore(85), false);
  assert.equal(isAllowedScore(100), true);
});

test("race guard rejects results after rewrite, submit, paper change, or timeout", () => {
  const started = { request: 4, revision: 9, paperNumber: 2 };
  assert.equal(isRecognitionCurrent(started, { ...started, phase: "playing" }), true);
  assert.equal(isRecognitionCurrent(started, { ...started, revision: 10, phase: "playing" }), false);
  assert.equal(isRecognitionCurrent(started, { ...started, request: 5, phase: "playing" }), false);
  assert.equal(isRecognitionCurrent(started, { ...started, paperNumber: 3, phase: "playing" }), false);
  assert.equal(isRecognitionCurrent(started, { ...started, phase: "submitting" }), false);
  assert.equal(isRecognitionCurrent(started, { ...started, phase: "finishing" }), false);
});
