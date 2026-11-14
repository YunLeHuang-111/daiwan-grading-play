"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("recognizer retries alternative segmentation after the default candidate fails", async () => {
  const primary = {
    strategy: "default",
    digits: [{ marker: 0 }, { marker: 0 }],
    mask: { foregroundPixels: 20 },
    ignoredPixels: 0,
  };
  const alternative = {
    strategy: "no-merge",
    digits: [{ marker: 1 }, { marker: 1 }],
    mask: { foregroundPixels: 20 },
    ignoredPixels: 0,
  };

  global.ScoreRoi = {
    segmentDigits: () => primary,
    segmentDigitCandidates: () => [primary, alternative],
    normalizeDigitVariantSets: (_mask, digit) => ({
      grayscale: [Float32Array.of(digit.marker)],
      binary: [Float32Array.of(digit.marker)],
    }),
    softmax: values => values,
    decodeRoundedScore: probabilitySets => {
      const recovered = probabilitySets[0].probabilities[0] === 1;
      const digit = { value: 3, confidence: recovered ? .9 : .3, margin: recovered ? .8 : .01, voteRatio: 1, voteMargin: 1, votes: [1] };
      return recovered ?
        { status: "ok", score: 30, rawText: "30", confidence: .9, leadingDigit: 3, digits: [digit] } :
        { status: "low_confidence", score: null, rawText: "30", confidence: .3, leadingDigit: 3, digits: [digit] };
    },
  };
  global.ort = {
    env: { wasm: {} },
    Tensor: class Tensor {
      constructor(_type, data) { this.data = data; }
    },
    InferenceSession: {
      create: async () => ({
        inputNames: ["input"],
        outputNames: ["output"],
        run: async feeds => ({ output: { data: [feeds.input.data[0], 0, 0, 0, 0, 0, 0, 0, 0, 0] } }),
      }),
    },
  };

  delete require.cache[require.resolve("../score-recognizer.js")];
  require("../score-recognizer.js");
  const result = await global.scoreRecognizer.recognizeCapture({ status: "ok", mask: {}, bounds: { x: 0, y: 0, width: 10, height: 10 } });

  assert.equal(result.status, "ok");
  assert.equal(result.score, 30);
  assert.equal(result.diagnostic.candidateCount, 2);
  assert.equal(result.diagnostic.chosenStrategy, "no-merge/grayscale");
  assert.deepEqual(result.diagnostic.candidateAttempts.map(attempt => attempt.status), ["low_confidence", "low_confidence", "ok"]);
});

test("recognizer retries binary preprocessing after grayscale confidence is low", async () => {
  const candidate = {
    strategy: "default",
    digits: [{ marker: 0 }, { marker: 0 }],
    mask: { foregroundPixels: 20 },
    ignoredPixels: 0,
  };
  global.ScoreRoi = {
    segmentDigits: () => candidate,
    segmentDigitCandidates: () => [candidate],
    normalizeDigitVariantSets: () => ({
      grayscale: [Float32Array.of(0)],
      binary: [Float32Array.of(1)],
    }),
    softmax: values => values,
    decodeRoundedScore: probabilitySets => {
      const recovered = probabilitySets[0].probabilities[0] === 1;
      const digit = { value: 1, confidence: recovered ? .92 : .28, margin: recovered ? .85 : .01, voteRatio: 1, voteMargin: 1, votes: [1] };
      return recovered ?
        { status: "ok", score: 10, rawText: "10", confidence: .92, leadingDigit: 1, digits: [digit] } :
        { status: "low_confidence", score: null, rawText: "10", confidence: .28, leadingDigit: 1, digits: [digit] };
    },
  };
  global.ort = {
    env: { wasm: {} },
    Tensor: class Tensor {
      constructor(_type, data) { this.data = data; }
    },
    InferenceSession: {
      create: async () => ({
        inputNames: ["input"],
        outputNames: ["output"],
        run: async feeds => ({ output: { data: [feeds.input.data[0], 0, 0, 0, 0, 0, 0, 0, 0, 0] } }),
      }),
    },
  };

  delete require.cache[require.resolve("../score-recognizer.js")];
  require("../score-recognizer.js");
  const result = await global.scoreRecognizer.recognizeCapture({ status: "ok", mask: {}, bounds: { x: 0, y: 0, width: 10, height: 10 } });

  assert.equal(result.status, "ok");
  assert.equal(result.score, 10);
  assert.equal(result.diagnostic.chosenStrategy, "default/binary");
  assert.deepEqual(result.diagnostic.candidateAttempts.map(attempt => attempt.preprocessing), ["grayscale", "binary"]);
});

test("recognizer accepts matching low-confidence results from independent preprocessing paths", async () => {
  const candidate = {
    strategy: "default",
    digits: [{ marker: 1 }, { marker: 0 }],
    mask: { foregroundPixels: 20 },
    ignoredPixels: 0,
  };
  global.ScoreRoi = {
    segmentDigits: () => candidate,
    segmentDigitCandidates: () => [candidate],
    normalizeDigitVariantSets: (_mask, digit) => ({
      grayscale: [Float32Array.of(digit.marker)],
      binary: [Float32Array.of(digit.marker)],
    }),
    softmax: values => values,
    decodeRoundedScore: () => {
      const digit = { value: 1, confidence: .29, margin: .01, voteRatio: .5, voteMargin: 0, votes: [0, 3] };
      return { status: "low_confidence", score: null, suggestedScore: 10, rawText: "10", confidence: .29, leadingDigit: 1, digits: [digit] };
    },
  };
  global.ort = {
    env: { wasm: {} },
    Tensor: class Tensor {
      constructor(_type, data) { this.data = data; }
    },
    InferenceSession: {
      create: async () => ({
        inputNames: ["input"], outputNames: ["output"],
        run: async () => ({ output: { data: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }),
      }),
    },
  };

  delete require.cache[require.resolve("../score-recognizer.js")];
  require("../score-recognizer.js");
  const result = await global.scoreRecognizer.recognizeCapture({ status: "ok", mask: {}, bounds: { x: 0, y: 0, width: 10, height: 10 } });

  assert.equal(result.status, "ok");
  assert.equal(result.score, 10);
  assert.equal(result.recoveredByConsensus, true);
  assert.equal(result.diagnostic.consensusSupport, 2);
});

test("recognizer rejects tied low-confidence score groups", async () => {
  const candidates = [10, 20].map((score, index) => ({
    strategy: index ? "no-merge" : "default",
    digits: [{ marker: score }, { marker: 0 }],
    mask: { foregroundPixels: 20 },
    ignoredPixels: 0,
  }));
  global.ScoreRoi = {
    segmentDigits: () => candidates[0],
    segmentDigitCandidates: () => candidates,
    normalizeDigitVariantSets: (_mask, digit) => ({
      grayscale: [Float32Array.of(digit.marker)],
      binary: [Float32Array.of(digit.marker)],
    }),
    softmax: values => values,
    decodeRoundedScore: probabilitySets => {
      const suggestedScore = probabilitySets[0].probabilities[0];
      const digit = { value: suggestedScore / 10, confidence: .3, margin: .01, voteRatio: .5, voteMargin: 0, votes: [3] };
      return { status: "low_confidence", score: null, suggestedScore, rawText: String(suggestedScore), confidence: .3, leadingDigit: digit.value, digits: [digit] };
    },
  };
  global.ort = {
    env: { wasm: {} },
    Tensor: class Tensor {
      constructor(_type, data) { this.data = data; }
    },
    InferenceSession: {
      create: async () => ({
        inputNames: ["input"], outputNames: ["output"],
        run: async feeds => ({ output: { data: [feeds.input.data[0], 0, 0, 0, 0, 0, 0, 0, 0, 0] } }),
      }),
    },
  };

  delete require.cache[require.resolve("../score-recognizer.js")];
  require("../score-recognizer.js");
  const result = await global.scoreRecognizer.recognizeCapture({ status: "ok", mask: {}, bounds: { x: 0, y: 0, width: 10, height: 10 } });

  assert.equal(result.status, "low_confidence");
  assert.equal(result.diagnostic.recoveredByConsensus, false);
  assert.equal(result.diagnostic.candidateAttempts.length, 4);
});

test("recognizer checks three-segment candidates before accepting 10", async () => {
  const candidates = [
    { strategy: "default", digits: [{ marker: 1 }, { marker: 0 }], mask: { foregroundPixels: 20 }, ignoredPixels: 0 },
    { strategy: "no-merge", digits: [{ marker: 1 }, { marker: 0 }, { marker: 0 }], mask: { foregroundPixels: 20 }, ignoredPixels: 0 },
  ];
  global.ScoreRoi = {
    segmentDigits: () => candidates[0],
    segmentDigitCandidates: () => candidates,
    normalizeDigitVariantSets: (_mask, digit) => ({ grayscale: [Float32Array.of(digit.marker)], binary: [Float32Array.of(digit.marker)] }),
    softmax: values => values,
    decodeRoundedScore: (_probabilitySets, digitCount) => {
      const digit = { value: 1, confidence: .9, margin: .8, voteRatio: 1, voteMargin: 1, votes: [0, 1] };
      return { status: "ok", score: digitCount === 3 ? 100 : 10, rawText: digitCount === 3 ? "10…" : "10", confidence: .9, leadingDigit: 1, digits: [digit] };
    },
  };
  global.ort = {
    env: { wasm: {} },
    Tensor: class Tensor { constructor(_type, data) { this.data = data; } },
    InferenceSession: { create: async () => ({
      inputNames: ["input"], outputNames: ["output"],
      run: async feeds => ({ output: { data: [feeds.input.data[0], 0, 0, 0, 0, 0, 0, 0, 0, 0] } }),
    }) },
  };

  delete require.cache[require.resolve("../score-recognizer.js")];
  require("../score-recognizer.js");
  const result = await global.scoreRecognizer.recognizeCapture({ status: "ok", mask: {}, bounds: { x: 0, y: 0, width: 10, height: 10 } });

  assert.equal(result.status, "ok");
  assert.equal(result.score, 100);
  assert.equal(result.diagnostic.hundredDisambiguation, true);
  assert.equal(result.diagnostic.segmentCount, 3);
});

test("recognizer corrects a CNN 1 to 7 only for a wide-top shape", async () => {
  const candidate = { strategy: "default", digits: [{ marker: 1 }, { marker: 0 }], mask: { foregroundPixels: 20 }, ignoredPixels: 0 };
  global.ScoreRoi = {
    segmentDigits: () => candidate,
    segmentDigitCandidates: () => [candidate],
    leadingDigitGeometryHint: () => ({ digit: 7, aspectRatio: .55, topSpanRatio: .9, topPixels: 12 }),
    normalizeDigitVariantSets: (_mask, digit) => ({ grayscale: [Float32Array.of(digit.marker)], binary: [Float32Array.of(digit.marker)] }),
    softmax: values => values,
    decodeRoundedScore: () => {
      const digits = [{ value: 1, confidence: .9, margin: .8, voteRatio: 1, voteMargin: 1, votes: [0, 1] }, { value: 0 }];
      return { status: "ok", score: 10, rawText: "10", confidence: .9, leadingDigit: 1, recognizedNumber: 10, digits };
    },
  };
  global.ort = {
    env: { wasm: {} },
    Tensor: class Tensor { constructor(_type, data) { this.data = data; } },
    InferenceSession: { create: async () => ({
      inputNames: ["input"], outputNames: ["output"],
      run: async feeds => ({ output: { data: [feeds.input.data[0], 0, 0, 0, 0, 0, 0, 0, 0, 0] } }),
    }) },
  };

  delete require.cache[require.resolve("../score-recognizer.js")];
  require("../score-recognizer.js");
  const result = await global.scoreRecognizer.recognizeCapture({ status: "ok", mask: {}, bounds: { x: 0, y: 0, width: 10, height: 10 } });

  assert.equal(result.status, "ok");
  assert.equal(result.score, 70);
  assert.deepEqual(result.diagnostic.geometryCorrection.from, 1);
  assert.deepEqual(result.diagnostic.geometryCorrection.to, 7);
});
