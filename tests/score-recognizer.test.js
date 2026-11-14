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
    normalizeDigitVariants: (_mask, digit) => [Float32Array.of(digit.marker)],
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
  assert.equal(result.diagnostic.chosenStrategy, "no-merge");
  assert.deepEqual(result.diagnostic.candidateAttempts.map(attempt => attempt.status), ["low_confidence", "ok"]);
});
