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

  function diagnostic(stage, code, details = {}) {
    return { stage, code, ...details };
  }

  async function recognizeCapture(captured) {
    if (captured.status !== "ok" || !captured.mask) {
      return {
        status: "empty", score: null, rawText: "", confidence: 0,
        diagnostic: diagnostic("capture", "empty_roi", { bounds: captured.bounds }),
      };
    }
    let segmented;
    try {
      segmented = root.ScoreRoi.segmentDigits(captured.mask);
    } catch (error) {
      return {
        status: "processing_error", score: null, rawText: "", confidence: 0, error: error.message,
        diagnostic: diagnostic("segmentation", "processing_error", { error: error.message }),
      };
    }
    if (segmented.status !== "ok") {
      return {
        status: segmented.status, score: null, rawText: "", confidence: 0,
        diagnostic: diagnostic("segmentation", segmented.status === "empty" ? "no_valid_segments" : "unstable_segments", {
          segmentCount: segmented.digits?.length ?? 0,
          ignoredPixels: segmented.ignoredPixels ?? 0,
        }),
      };
    }
    let session;
    try {
      session = await init();
    } catch (error) {
      return {
        status: "model_unavailable", score: null, rawText: "", confidence: 0, error: error.message,
        diagnostic: diagnostic("model", "model_unavailable", { error: error.message }),
      };
    }

    try {
      const probabilitySets = [];
      for (const digit of segmented.digits.slice(0, 2)) {
        const variants = root.ScoreRoi.normalizeDigitVariants(segmented.mask, digit);
        const probabilities = new Float32Array(10);
        const votes = new Uint8Array(10);
        for (const values of variants) {
          const tensor = new root.ort.Tensor("float32", values, [1, 1, 28, 28]);
          const output = await session.run({ [session.inputNames[0]]: tensor });
          const variantProbabilities = root.ScoreRoi.softmax(output[session.outputNames[0]].data);
          variantProbabilities.forEach((value, index) => { probabilities[index] += value / variants.length; });
          let winner = 0;
          for (let index = 1; index < variantProbabilities.length; index++) {
            if (variantProbabilities[index] > variantProbabilities[winner]) winner = index;
          }
          votes[winner]++;
        }
        probabilitySets.push({ probabilities, votes, variantCount: variants.length });
      }
      const decoded = root.ScoreRoi.decodeRoundedScore(probabilitySets, segmented.digits.length, {
        confidenceThreshold: .6,
        marginThreshold: .08,
        consensusThreshold: 2 / 3,
        consensusConfidenceThreshold: .25,
        consensusVoteMarginThreshold: 1 / 3,
      });
      const leading = decoded.digits?.[0];
      return {
        ...decoded,
        bounds: captured.bounds,
        diagnostic: diagnostic("decoding", decoded.status, {
          segmentCount: segmented.digits.length,
          ignoredPixels: segmented.ignoredPixels ?? 0,
          rawText: decoded.rawText,
          leadingDigit: decoded.leadingDigit,
          confidence: decoded.confidence,
          margin: leading?.margin ?? 0,
          voteRatio: leading?.voteRatio ?? 0,
          voteMargin: leading?.voteMargin ?? 0,
          votes: leading?.votes ?? [],
        }),
      };
    } catch (error) {
      return {
        status: "inference_error", score: null, rawText: "", confidence: 0, error: error.message,
        diagnostic: diagnostic("inference", "runtime_error", {
          segmentCount: segmented.digits.length,
          error: error.message,
        }),
      };
    }
  }

  async function recognize(input) {
    return recognizeCapture(capture(input));
  }

  root.scoreRecognizer = { init, capture, recognize, recognizeCapture, MODEL_URL, ORT_VERSION };
})(globalThis);
