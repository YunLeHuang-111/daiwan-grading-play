"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getScoreRoiBounds,
  maskFromRgba,
  extractScoreInk,
  segmentDigits,
  segmentDigitCandidates,
  leadingDigitGeometryHint,
  normalizeDigit28,
  normalizeDigitVariants,
  normalizeDigitVariantSets,
  binarizeDigit28,
  deskewDigit28,
  softmax,
  decodeRoundedScore,
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

test("ROI is intersected with the paper even if the canvas box is larger", () => {
  assert.deepEqual(
    getScoreRoiBounds(rect(0, 0, 120, 120), rect(90, 0, 40, 30), 120, 120, 0, rect(10, 10, 100, 100)),
    { x: 90, y: 10, width: 20, height: 20 },
  );
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
  assert.equal(result.mask.intensity[0], 1);
});

test("mask preserves antialiased alpha intensity for CNN input", () => {
  const rgba = new Uint8ClampedArray(2 * 4);
  rgba[3] = 128;
  rgba[7] = 10;
  const mask = maskFromRgba(rgba, 2, 1);
  assert.equal(mask.foregroundPixels, 1);
  assert.ok(Math.abs(mask.intensity[0] - 128 / 255) < 1e-6);
  assert.equal(mask.intensity[1], 0);
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

test("segmentation recursively separates a touching 100", () => {
  const mask = scoreMask("100");
  const middleY = 18;
  for (let x = 9; x <= 24; x++) {
    const index = middleY * mask.width + x;
    if (!mask.data[index]) { mask.data[index] = 1; mask.foregroundPixels++; }
  }
  for (let x = 35; x <= 46; x++) {
    const index = middleY * mask.width + x;
    if (!mask.data[index]) { mask.data[index] = 1; mask.foregroundPixels++; }
  }
  const result = segmentDigits(mask);
  assert.equal(result.status, "ok");
  assert.equal(result.digits.length, 3);
});

test("segmentation keeps a tightly spaced 100 as three full-height digits", () => {
  const width = 42;
  const height = 36;
  const data = new Uint8Array(width * height);
  let foregroundPixels = 0;
  const set = (x, y) => {
    const index = y * width + x;
    if (!data[index]) { data[index] = 1; foregroundPixels++; }
  };
  for (let y = 3; y <= 32; y++) {
    for (let x = 4; x <= 7; x++) set(x, y);
    for (const [left, right] of [[9, 20], [22, 33]]) {
      for (let x = left; x <= right; x++) {
        if (y <= 5 || y >= 30 || x <= left + 1 || x >= right - 1) set(x, y);
      }
    }
  }
  const result = segmentDigits({ data, width, height, foregroundPixels });
  assert.equal(result.status, "ok");
  assert.equal(result.digits.length, 3);
});

test("segmentation ignores a small extra stroke after two valid digits", () => {
  const mask = scoreMask("20");
  for (let y = 10; y <= 12; y++) {
    const index = y * mask.width + mask.width - 1;
    mask.data[index] = 1;
    mask.foregroundPixels++;
  }
  const result = segmentDigits(mask);
  assert.equal(result.status, "ok");
  assert.equal(result.digits.length, 2);
  assert.equal(result.ignoredPixels, 3);
});

test("candidate segmentation recovers close digits that the default strategy merges", () => {
  const width = 28;
  const height = 36;
  const data = new Uint8Array(width * height);
  let foregroundPixels = 0;
  const set = (x, y) => {
    const index = y * width + x;
    if (!data[index]) { data[index] = 1; foregroundPixels++; }
  };
  for (let y = 18; y <= 32; y++) for (let x = 4; x <= 7; x++) set(x, y);
  for (let y = 3; y <= 32; y++) {
    for (let x = 9; x <= 20; x++) {
      if (y <= 5 || y >= 30 || x <= 10 || x >= 19) set(x, y);
    }
  }
  const mask = { data, width, height, foregroundPixels };
  assert.equal(segmentDigits(mask).digits.length, 1);
  const candidates = segmentDigitCandidates(mask);
  assert.ok(candidates.some(candidate => candidate.digits.length === 2 && candidate.strategy === "no-merge"));
});

test("fragment-tolerant segmentation recovers a short but substantial digit", () => {
  const width = 30;
  const height = 36;
  const data = new Uint8Array(width * height);
  let foregroundPixels = 0;
  const set = (x, y) => {
    const index = y * width + x;
    if (!data[index]) { data[index] = 1; foregroundPixels++; }
  };
  for (let y = 3; y <= 32; y++) {
    for (let x = 2; x <= 13; x++) {
      if (y <= 5 || y >= 30 || x <= 3 || x >= 12) set(x, y);
    }
  }
  for (let y = 25; y <= 32; y++) for (let x = 20; x <= 23; x++) set(x, y);
  const mask = { data, width, height, foregroundPixels };
  const strict = segmentDigits(mask);
  assert.equal(strict.status, "low_confidence");
  assert.equal(strict.digits.length, 1);
  assert.ok(strict.ignoredPixels > 0);
  const candidates = segmentDigitCandidates(mask);
  assert.ok(candidates.some(candidate => candidate.strategy === "fragment-tolerant" && candidate.digits.length === 2));
});

test("geometry distinguishes a wide-top 7 from a narrow 1", () => {
  const width = 20;
  const height = 30;
  const sevenData = new Uint8Array(width * height);
  for (let x = 2; x <= 17; x++) for (let y = 1; y <= 3; y++) sevenData[y * width + x] = 1;
  for (let y = 4; y <= 27; y++) {
    const x = Math.max(5, 16 - Math.floor((y - 4) * 10 / 23));
    sevenData[y * width + x] = 1;
    sevenData[y * width + Math.max(0, x - 1)] = 1;
  }
  const sevenBox = { left: 2, top: 1, right: 17, bottom: 27, width: 16, height: 27 };
  const hint = leadingDigitGeometryHint({ data: sevenData, width, height }, sevenBox);
  assert.equal(hint.digit, 7);

  const oneData = new Uint8Array(width * height);
  for (let y = 1; y <= 27; y++) for (let x = 8; x <= 10; x++) oneData[y * width + x] = 1;
  const oneBox = { left: 8, top: 1, right: 10, bottom: 27, width: 3, height: 27 };
  assert.equal(leadingDigitGeometryHint({ data: oneData, width, height }, oneBox), null);
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

test("normalization keeps grayscale stroke intensity", () => {
  const mask = scoreMask("0");
  mask.intensity = Float32Array.from(mask.data, value => value ? .5 : 0);
  const box = segmentDigits(mask).digits[0];
  const normalized = normalizeDigit28(mask, box);
  const maximum = Math.max(...normalized);
  assert.ok(maximum >= .49 && maximum <= .51);
  assert.ok(normalized.some(value => value > 0 && value < 1));
});

test("normalization provides translation and stroke-width TTA variants", () => {
  const mask = scoreMask("6");
  const box = segmentDigits(mask).digits[0];
  const variants = normalizeDigitVariants(mask, box);
  assert.equal(variants.length, 7);
  assert.ok(variants.every(values => values instanceof Float32Array && values.length === 784));
  assert.notDeepEqual(Array.from(variants[0]), Array.from(variants[1]));
  assert.ok(variants[5].reduce((sum, value) => sum + value, 0) > variants[0].reduce((sum, value) => sum + value, 0));
});

test("normalization provides grayscale and binary fallback ensembles", () => {
  const mask = scoreMask("8");
  mask.intensity = Float32Array.from(mask.data, value => value ? .55 : 0);
  const box = segmentDigits(mask).digits[0];
  const sets = normalizeDigitVariantSets(mask, box);
  assert.equal(sets.grayscale.length, 7);
  assert.equal(sets.binary.length, 7);
  assert.ok(sets.grayscale[0].some(value => value > 0 && value < 1));
  assert.ok(sets.binary[0].every(value => value === 0 || value === 1));
  assert.deepEqual(Array.from(binarizeDigit28(Float32Array.from([.2, .35, .8]))), [0, 1, 1]);
});

test("deskew adds a distinct normalized view for slanted strokes", () => {
  const values = new Float32Array(28 * 28);
  for (let y = 4; y <= 23; y++) {
    const x = 8 + Math.floor((y - 4) / 4);
    values[y * 28 + x] = 1;
    values[y * 28 + x + 1] = 1;
  }
  const deskewed = deskewDigit28(values);
  assert.equal(deskewed.length, 784);
  assert.notDeepEqual(Array.from(deskewed), Array.from(values));
  assert.ok(deskewed.some(value => value > 0 && value < 1));
});

function prediction(value, confidence = .9) {
  const probabilities = Array(10).fill((1 - confidence) / 9);
  probabilities[value] = confidence;
  return probabilities;
}

function ensemblePrediction(value, confidence = .42, agreeingVariants = 5) {
  const votes = Array(10).fill(0);
  votes[value] = agreeingVariants;
  votes[(value + 1) % 10] = 6 - agreeingVariants;
  return { probabilities: prediction(value, confidence), votes, variantCount: 6 };
}

function votePreferredPrediction(value, averageWinner) {
  const probabilities = Array(10).fill(.025);
  probabilities[value] = .35;
  probabilities[averageWinner] = .4;
  const votes = Array(10).fill(0);
  votes[value] = 5;
  votes[averageWinner] = 1;
  return { probabilities, votes, variantCount: 6 };
}

test("stable softmax handles very large logits", () => {
  const probabilities = softmax([10000, 10001, 9999]);
  assert.ok(probabilities.every(Number.isFinite));
  assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.equal(probabilities.indexOf(Math.max(...probabilities)), 1);
});

test("decoder recognizes two digits and rounds the result down to tens", () => {
  for (const text of ["0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100"]) {
    const result = decodeRoundedScore([...text].slice(0, 2).map(digit => prediction(Number(digit))), text.length);
    assert.equal(result.status, "ok", text);
    assert.equal(result.score, Number(text), text);
    assert.equal(result.digits.length, Math.min(text.length, 2), text);
  }
  const misreadOnes = decodeRoundedScore([prediction(2), prediction(6)], 2);
  assert.equal(misreadOnes.status, "ok");
  assert.equal(misreadOnes.recognizedNumber, 26);
  assert.equal(misreadOnes.score, 20);
  assert.equal(misreadOnes.rawText, "26");

  const extraSegment = decodeRoundedScore([prediction(2), prediction(6)], 3);
  assert.equal(extraSegment.status, "ok");
  assert.equal(extraSegment.score, 20);
  assert.equal(extraSegment.rawText, "26…");

  const misreadHundredsZero = decodeRoundedScore([prediction(1), prediction(6)], 3);
  assert.equal(misreadHundredsZero.status, "ok");
  assert.equal(misreadHundredsZero.score, 100);

  const noisyOnes = decodeRoundedScore([prediction(6), prediction(9, .3)], 2);
  assert.equal(noisyOnes.status, "ok");
  assert.equal(noisyOnes.score, 60);

  for (const leadingDigit of [3, 7, 8, 9]) {
    const consensus = decodeRoundedScore([ensemblePrediction(leadingDigit), prediction(0)], 2);
    assert.equal(consensus.status, "ok", String(leadingDigit));
    assert.equal(consensus.score, leadingDigit * 10, String(leadingDigit));
    assert.ok(consensus.digits[0].voteRatio >= 5 / 6);
  }

  const votePreferred = decodeRoundedScore([votePreferredPrediction(3, 8), prediction(0)], 2);
  assert.equal(votePreferred.status, "ok");
  assert.equal(votePreferred.leadingDigit, 3);
  assert.equal(votePreferred.score, 30);

  const dividedVote = decodeRoundedScore([ensemblePrediction(8, .42, 3), prediction(0)], 2);
  assert.equal(dividedVote.status, "low_confidence");

  assert.equal(decodeRoundedScore([prediction(6)], 1).status, "invalid");
  assert.equal(decodeRoundedScore([prediction(0), prediction(6)], 2).status, "invalid");
  assert.equal(decodeRoundedScore([prediction(8), prediction(0)], 4).status, "invalid");
  const lowConfidence = decodeRoundedScore([prediction(8, .45), prediction(0)], 2);
  assert.equal(lowConfidence.status, "low_confidence");
  assert.equal(lowConfidence.suggestedScore, 80);
  assert.equal(decodeRoundedScore([], 2).status, "invalid");
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
