"use strict";

(function createScoreRecognizer(root) {
  const MODEL_URL = "./models/score-recognition/mnist-12.onnx";
  const ORT_VERSION = "1.20.1";
  const ORT_WASM_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  let sessionPromise;

  async function createSession() {
    if (!root.ort) throw new Error("ONNX Runtime Web 未載入");
    root.ort.env.wasm.wasmPaths = ORT_WASM_URL;
    root.ort.env.wasm.numThreads = 1;
    return root.ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
  }

  function init() {
    if (!sessionPromise) sessionPromise = createSession();
    return sessionPromise;
  }

  function capture({ inkCanvas, scoreZone }) {
    const extracted = root.ScoreRoi.extractScoreInk({ inkCanvas, scoreZone });
    return extracted.status === "ok" ? extracted : { status: "empty", bounds: extracted.bounds, mask: null };
  }

  async function recognizeCapture(captured) {
    let session;
    try {
      session = await init();
    } catch (error) {
      return { status: "model_unavailable", score: null, rawText: "", confidence: 0, error: error.message };
    }
    if (captured.status !== "ok" || !captured.mask) return { status: "empty", score: null, rawText: "", confidence: 0 };
    const segmented = root.ScoreRoi.segmentDigits(captured.mask);
    if (segmented.status !== "ok") return { status: segmented.status, score: null, rawText: "", confidence: 0 };

    const probabilitySets = [];
    for (const digit of segmented.digits.slice(0, 2)) {
      const variants = root.ScoreRoi.normalizeDigitVariants(segmented.mask, digit);
      const probabilities = new Float32Array(10);
      for (const values of variants) {
        const tensor = new root.ort.Tensor("float32", values, [1, 1, 28, 28]);
        const output = await session.run({ [session.inputNames[0]]: tensor });
        const variantProbabilities = root.ScoreRoi.softmax(output[session.outputNames[0]].data);
        variantProbabilities.forEach((value, index) => { probabilities[index] += value / variants.length; });
      }
      probabilitySets.push(probabilities);
    }
    return {
      ...root.ScoreRoi.decodeRoundedScore(probabilitySets, segmented.digits.length, {
        confidenceThreshold: .65,
        marginThreshold: .12,
      }),
      bounds: captured.bounds,
    };
  }

  async function recognize(input) {
    return recognizeCapture(capture(input));
  }

  root.scoreRecognizer = { init, capture, recognize, recognizeCapture, MODEL_URL, ORT_VERSION };
})(globalThis);
