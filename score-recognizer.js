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

  async function recognize({ inkCanvas, scoreZone }) {
    let session;
    try {
      session = await init();
    } catch (error) {
      return { status: "model_unavailable", score: null, rawText: "", confidence: 0, error: error.message };
    }
    const extracted = root.ScoreRoi.extractScoreInk({ inkCanvas, scoreZone });
    if (extracted.status !== "ok") return { status: "empty", score: null, rawText: "", confidence: 0 };
    const segmented = root.ScoreRoi.segmentDigits(extracted.mask);
    if (segmented.status !== "ok") return { status: segmented.status, score: null, rawText: "", confidence: 0 };

    const probabilities = [];
    for (const box of segmented.digits) {
      const values = root.ScoreRoi.normalizeDigit28(segmented.mask, box);
      const tensor = new root.ort.Tensor("float32", values, [1, 1, 28, 28]);
      const output = await session.run({ [session.inputNames[0]]: tensor });
      probabilities.push(root.ScoreRoi.softmax(output[session.outputNames[0]].data));
    }
    return { ...root.ScoreRoi.decodeAllowedScore(probabilities), bounds: extracted.bounds };
  }

  root.scoreRecognizer = { init, recognize, MODEL_URL, ORT_VERSION };
})(globalThis);
