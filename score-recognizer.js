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

  function applyLeadingGeometryCorrection(decoded, segmented) {
    if (decoded.leadingDigit !== 1 || segmented.digits.length < 2 || !root.ScoreRoi.leadingDigitGeometryHint) return decoded;
    const hint = root.ScoreRoi.leadingDigitGeometryHint(segmented.mask, segmented.digits[0]);
    if (hint?.digit !== 7) return decoded;
    const ones = decoded.digits?.[1]?.value ?? 0;
    const rawText = `7${ones}${segmented.digits.length > 2 ? "…" : ""}`;
    const digits = decoded.digits?.length ? [{ ...decoded.digits[0], value: 7 }, ...decoded.digits.slice(1)] : decoded.digits;
    return {
      ...decoded,
      score: decoded.status === "ok" ? 70 : null,
      suggestedScore: decoded.status === "ok" ? decoded.suggestedScore : 70,
      rawText,
      leadingDigit: 7,
      recognizedNumber: 70 + ones,
      digits,
      geometryCorrection: { from: 1, to: 7, ...hint },
    };
  }

  async function inferSegmented(session, segmented, preprocessing = "grayscale") {
    const probabilitySets = [];
    for (const digit of segmented.digits.slice(0, 2)) {
      const variantSets = root.ScoreRoi.normalizeDigitVariantSets(segmented.mask, digit);
      const variants = variantSets[preprocessing];
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
    let decoded = root.ScoreRoi.decodeRoundedScore(probabilitySets, segmented.digits.length, {
      confidenceThreshold: .6,
      marginThreshold: .08,
      consensusThreshold: 2 / 3,
      consensusConfidenceThreshold: .25,
      consensusVoteMarginThreshold: 1 / 3,
    });
    decoded = applyLeadingGeometryCorrection(decoded, segmented);
    const leading = decoded.digits?.[0];
    const ignoredRatio = (segmented.ignoredPixels || 0) / Math.max(1, segmented.mask.foregroundPixels);
    const quality = (decoded.status === "ok" ? 2 : 0) + (decoded.confidence || 0) +
      (leading?.voteRatio || 0) * .25 + Math.max(0, leading?.margin || 0) * .1 - ignoredRatio -
      (preprocessing === "binary" ? .01 : 0);
    return { decoded, leading, quality };
  }

  function candidateSummary(segmented, evaluated, preprocessing) {
    return {
      strategy: segmented.strategy || "default",
      preprocessing,
      status: evaluated.decoded.status,
      score: evaluated.decoded.score,
      suggestedScore: evaluated.decoded.suggestedScore,
      rawText: evaluated.decoded.rawText,
      segmentCount: segmented.digits.length,
      leadingDigit: evaluated.decoded.leadingDigit,
      confidence: evaluated.decoded.confidence,
      voteRatio: evaluated.leading?.voteRatio || 0,
      quality: evaluated.quality,
      geometryCorrection: evaluated.decoded.geometryCorrection || null,
    };
  }

  function consensusRecovery(attempts) {
    const groups = new Map();
    for (const attempt of attempts) {
      const suggestedScore = attempt.evaluated.decoded.score ?? attempt.evaluated.decoded.suggestedScore;
      if (suggestedScore == null) continue;
      const group = groups.get(suggestedScore) || [];
      group.push(attempt);
      groups.set(suggestedScore, group);
    }
    const ranked = [...groups.entries()]
      .map(([score, supporting]) => ({
        score,
        supporting,
        averageConfidence: supporting.reduce((sum, attempt) => sum + (attempt.evaluated.decoded.confidence || 0), 0) / supporting.length,
        averageQuality: supporting.reduce((sum, attempt) => sum + attempt.evaluated.quality, 0) / supporting.length,
      }))
      .sort((a, b) => b.supporting.length - a.supporting.length || b.averageQuality - a.averageQuality);
    const winner = ranked[0];
    const runnerUp = ranked[1];
    if (!winner || winner.supporting.length < 2 || winner.averageConfidence < .18 ||
      (runnerUp && runnerUp.supporting.length >= winner.supporting.length)) return null;
    const chosen = winner.supporting.slice().sort((a, b) => b.evaluated.quality - a.evaluated.quality)[0];
    return {
      chosen,
      score: winner.score,
      support: winner.supporting.length,
      competingScore: runnerUp?.score ?? null,
      competingSupport: runnerUp?.supporting.length ?? 0,
      averageConfidence: winner.averageConfidence,
    };
  }

  async function recognizeCapture(captured) {
    if (captured.status !== "ok" || !captured.mask) {
      return {
        status: "empty", score: null, rawText: "", confidence: 0,
        diagnostic: diagnostic("capture", "empty_roi", { bounds: captured.bounds }),
      };
    }
    let segmented;
    let candidates;
    try {
      segmented = root.ScoreRoi.segmentDigits(captured.mask);
      candidates = root.ScoreRoi.segmentDigitCandidates(captured.mask);
    } catch (error) {
      return {
        status: "processing_error", score: null, rawText: "", confidence: 0, error: error.message,
        diagnostic: diagnostic("segmentation", "processing_error", { error: error.message }),
      };
    }
    if (!candidates.length) {
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
      const attempts = [];
      for (const preprocessing of ["grayscale", "binary"]) {
        const evaluated = await inferSegmented(session, candidates[0], preprocessing);
        attempts.push({ segmented: candidates[0], evaluated, preprocessing });
        if (evaluated.decoded.status === "ok") break;
      }
      const initialSuccessful = attempts.filter(attempt => attempt.evaluated.decoded.status === "ok");
      const needsHundredCheck = initialSuccessful.some(attempt => attempt.evaluated.decoded.score === 10) &&
        candidates.some(candidate => candidate.digits.length === 3);
      if (!initialSuccessful.length || needsHundredCheck) {
        const fallbackCandidates = needsHundredCheck ? candidates.slice(1).filter(candidate => candidate.digits.length === 3) : candidates.slice(1);
        for (const candidate of fallbackCandidates) {
          for (const preprocessing of ["grayscale", "binary"]) {
            const evaluated = await inferSegmented(session, candidate, preprocessing);
            attempts.push({ segmented: candidate, evaluated, preprocessing });
            if (evaluated.decoded.status === "ok") break;
          }
        }
      }
      const successful = attempts.filter(attempt => attempt.evaluated.decoded.status === "ok");
      const hundredAttempts = needsHundredCheck ? attempts.filter(attempt => attempt.segmented.digits.length === 3) : [];
      const hundredSuccessful = hundredAttempts.filter(attempt => attempt.evaluated.decoded.status === "ok" && attempt.evaluated.decoded.score === 100);
      const hundredRecovery = hundredSuccessful.length ? null : consensusRecovery(hundredAttempts);
      const recoveredHundred = hundredRecovery?.score === 100 ? hundredRecovery : null;
      const recovery = hundredSuccessful.length || recoveredHundred ? recoveredHundred : successful.length ? null : consensusRecovery(attempts);
      const preferred = hundredSuccessful.length ? hundredSuccessful : recoveredHundred ? [recoveredHundred.chosen] : successful.length ? successful : recovery ? [recovery.chosen] : attempts;
      const chosen = preferred
        .slice().sort((a, b) => b.evaluated.quality - a.evaluated.quality)[0];
      const originalDecoded = chosen.evaluated.decoded;
      const decoded = recovery ? {
        ...originalDecoded,
        status: "ok",
        score: recovery.score,
        recoveredByConsensus: true,
      } : originalDecoded;
      const { leading } = chosen.evaluated;
      return {
        ...decoded,
        bounds: captured.bounds,
        diagnostic: diagnostic("decoding", decoded.status, {
          segmentCount: chosen.segmented.digits.length,
          ignoredPixels: chosen.segmented.ignoredPixels ?? 0,
          rawText: decoded.rawText,
          leadingDigit: decoded.leadingDigit,
          confidence: decoded.confidence,
          margin: leading?.margin ?? 0,
          voteRatio: leading?.voteRatio ?? 0,
          voteMargin: leading?.voteMargin ?? 0,
          votes: leading?.votes ?? [],
          candidateCount: candidates.length,
          attemptCount: attempts.length,
          chosenStrategy: `${chosen.segmented.strategy || "default"}/${chosen.preprocessing}`,
          geometryCorrection: decoded.geometryCorrection || null,
          hundredDisambiguation: needsHundredCheck,
          recoveredByConsensus: Boolean(recovery),
          consensusSupport: recovery?.support ?? 0,
          competingScore: recovery?.competingScore ?? null,
          competingSupport: recovery?.competingSupport ?? 0,
          consensusAverageConfidence: recovery?.averageConfidence ?? 0,
          candidateAttempts: attempts.map(attempt => candidateSummary(attempt.segmented, attempt.evaluated, attempt.preprocessing)),
        }),
      };
    } catch (error) {
      return {
        status: "inference_error", score: null, rawText: "", confidence: 0, error: error.message,
        diagnostic: diagnostic("inference", "runtime_error", {
          segmentCount: candidates[0]?.digits.length ?? segmented.digits?.length ?? 0,
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
