"use strict";

(function exposeScoreRoi(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ScoreRoi = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  const allowedScoreTexts = new Set(["0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100"]);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function getScoreRoiBounds(canvasRect, zoneRect, canvasWidth, canvasHeight, paddingCss = 3) {
    if (!canvasRect || !zoneRect || canvasRect.width <= 0 || canvasRect.height <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const scaleX = canvasWidth / canvasRect.width;
    const scaleY = canvasHeight / canvasRect.height;
    const left = Math.floor((zoneRect.left - paddingCss - canvasRect.left) * scaleX);
    const top = Math.floor((zoneRect.top - paddingCss - canvasRect.top) * scaleY);
    const right = Math.ceil((zoneRect.right + paddingCss - canvasRect.left) * scaleX);
    const bottom = Math.ceil((zoneRect.bottom + paddingCss - canvasRect.top) * scaleY);
    const x = clamp(left, 0, canvasWidth);
    const y = clamp(top, 0, canvasHeight);
    return {
      x,
      y,
      width: Math.max(0, clamp(right, 0, canvasWidth) - x),
      height: Math.max(0, clamp(bottom, 0, canvasHeight) - y),
    };
  }

  function maskFromRgba(rgba, width, height, alphaThreshold = 18) {
    const data = new Uint8Array(width * height);
    const intensity = new Float32Array(width * height);
    let foregroundPixels = 0;
    for (let index = 0; index < data.length; index++) {
      const alpha = rgba[index * 4 + 3];
      if (alpha >= alphaThreshold) {
        data[index] = 1;
        intensity[index] = alpha / 255;
        foregroundPixels++;
      }
    }
    return { data, intensity, width, height, foregroundPixels };
  }

  function extractScoreInk({ inkCanvas, scoreZone, paddingCss = 3, alphaThreshold = 18 }) {
    const bounds = getScoreRoiBounds(
      inkCanvas.getBoundingClientRect(),
      scoreZone.getBoundingClientRect(),
      inkCanvas.width,
      inkCanvas.height,
      paddingCss,
    );
    if (!bounds.width || !bounds.height) return { status: "empty", bounds, mask: null };
    const pixels = inkCanvas.getContext("2d").getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
    const mask = maskFromRgba(pixels.data, bounds.width, bounds.height, alphaThreshold);
    return { status: mask.foregroundPixels ? "ok" : "empty", bounds, mask };
  }

  function foregroundBox(mask) {
    let left = mask.width;
    let top = mask.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        if (!mask.data[y * mask.width + x]) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    return right < left ? null : { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
  }

  function connectedComponents(mask) {
    const visited = new Uint8Array(mask.data.length);
    const queue = new Int32Array(mask.data.length);
    const components = [];
    for (let origin = 0; origin < mask.data.length; origin++) {
      if (!mask.data[origin] || visited[origin]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = origin;
      visited[origin] = 1;
      const indices = [];
      let left = mask.width;
      let top = mask.height;
      let right = -1;
      let bottom = -1;
      while (head < tail) {
        const index = queue[head++];
        indices.push(index);
        const x = index % mask.width;
        const y = Math.floor(index / mask.width);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= mask.width || ny < 0 || ny >= mask.height) continue;
            const neighbor = ny * mask.width + nx;
            if (mask.data[neighbor] && !visited[neighbor]) {
              visited[neighbor] = 1;
              queue[tail++] = neighbor;
            }
          }
        }
      }
      components.push({ indices, pixels: indices.length, left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 });
    }
    return components;
  }

  function removeComponentNoise(mask, minimumPixels) {
    const data = new Uint8Array(mask.data.length);
    const intensity = mask.intensity ? new Float32Array(mask.data.length) : null;
    let foregroundPixels = 0;
    const components = connectedComponents(mask).filter(component => component.pixels >= minimumPixels);
    for (const component of components) {
      for (const index of component.indices) {
        data[index] = 1;
        if (intensity) intensity[index] = mask.intensity[index];
      }
      foregroundPixels += component.pixels;
    }
    return { data, intensity, width: mask.width, height: mask.height, foregroundPixels, components };
  }

  function projectionRuns(mask, box) {
    const counts = [];
    for (let x = box.left; x <= box.right; x++) {
      let count = 0;
      for (let y = box.top; y <= box.bottom; y++) count += mask.data[y * mask.width + x];
      counts.push(count);
    }
    const runs = [];
    let start = -1;
    counts.forEach((count, index) => {
      if (count && start < 0) start = index;
      if ((!count || index === counts.length - 1) && start >= 0) {
        const end = count && index === counts.length - 1 ? index : index - 1;
        runs.push({ left: box.left + start, right: box.left + end });
        start = -1;
      }
    });
    return { counts, runs };
  }

  function boxForColumns(mask, left, right) {
    let top = mask.height;
    let bottom = -1;
    let pixels = 0;
    for (let y = 0; y < mask.height; y++) {
      for (let x = left; x <= right; x++) {
        if (!mask.data[y * mask.width + x]) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        pixels++;
      }
    }
    return bottom < top ? null : { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1, pixels };
  }

  function splitWideRun(mask, run, overallHeight, options = {}, depth = 0) {
    const splitWidthRatio = options.splitWidthRatio ?? .82;
    const valleyRatio = options.valleyRatio ?? .45;
    const maxSplitDepth = options.maxSplitDepth ?? 2;
    const width = run.right - run.left + 1;
    if (depth >= maxSplitDepth || width < overallHeight * splitWidthRatio) return [run];
    const columnCounts = [];
    for (let x = run.left; x <= run.right; x++) {
      let count = 0;
      for (let y = 0; y < mask.height; y++) count += mask.data[y * mask.width + x];
      columnCounts.push(count);
    }
    const edge = Math.max(2, Math.floor(width * .16));
    let best = -1;
    let bestCount = Infinity;
    for (let index = edge; index < width - edge; index++) {
      const count = columnCounts[index];
      if (count < bestCount || (count === bestCount && Math.abs(index - width / 2) < Math.abs(best - width / 2))) {
        best = index;
        bestCount = count;
      }
    }
    const peak = Math.max(...columnCounts, 1);
    if (best < 0 || bestCount > peak * valleyRatio) return [run];
    const parts = [
      { left: run.left, right: run.left + best - 1 },
      { left: run.left + best + 1, right: run.right },
    ].filter(part => part.right >= part.left);
    return parts.flatMap(part => splitWideRun(mask, part, overallHeight, options, depth + 1));
  }

  function segmentDigits(mask, options = {}) {
    const minimumPixels = options.minimumPixels ?? Math.max(8, Math.round(mask.width * mask.height * .0008));
    const cleaned = removeComponentNoise(mask, Math.max(2, Math.floor(minimumPixels * .25)));
    const box = foregroundBox(cleaned);
    if (!box || (mask.foregroundPixels ?? box.width * box.height) < minimumPixels) return { status: "empty", digits: [] };
    const { runs } = projectionRuns(cleaned, box);
    if (!runs.length) return { status: "empty", digits: [] };

    const mergeGapRatio = options.mergeGapRatio ?? .07;
    const mergeNarrowRatio = options.mergeNarrowRatio ?? .32;
    const mergeGap = Math.max(0, Math.round(box.height * mergeGapRatio));
    const merged = [];
    for (const run of runs) {
      const previous = merged.at(-1);
      const previousBox = previous && boxForColumns(cleaned, previous.left, previous.right);
      const currentBox = boxForColumns(cleaned, run.left, run.right);
      const fullHeightPair = previousBox && currentBox &&
        previousBox.height >= box.height * .55 && currentBox.height >= box.height * .55;
      if (previous && !fullHeightPair && run.left - previous.right - 1 <= mergeGap && previous.right - previous.left + 1 < box.height * mergeNarrowRatio) {
        previous.right = run.right;
      } else {
        merged.push({ ...run });
      }
    }
    const split = merged.flatMap(run => splitWideRun(cleaned, run, box.height, options));
    const digits = split.map(run => boxForColumns(cleaned, run.left, run.right)).filter(Boolean);
    const substantial = digits.filter(digit => digit.pixels >= minimumPixels && digit.height >= Math.max(4, box.height * .35));
    if (!substantial.length) return { status: "empty", digits: [] };
    const accepted = new Set(substantial);
    const ignoredPixels = digits.reduce((total, digit) => total + (accepted.has(digit) ? 0 : digit.pixels), 0);
    const ignoredPixelLimit = Math.max(minimumPixels, Math.round(cleaned.foregroundPixels * .08));
    if (substantial.length > 3 || ignoredPixels > ignoredPixelLimit) {
      return { status: "low_confidence", digits: substantial, ignoredPixels };
    }
    return { status: "ok", digits: substantial.sort((a, b) => a.left - b.left), box, mask: cleaned, ignoredPixels };
  }

  function segmentDigitCandidates(mask) {
    const presets = [
      { strategy: "default" },
      { strategy: "no-merge", mergeGapRatio: 0 },
      { strategy: "aggressive-split", mergeGapRatio: .04, splitWidthRatio: .68, valleyRatio: .58 },
      { strategy: "conservative-split", mergeGapRatio: .03, splitWidthRatio: .96, valleyRatio: .32, maxSplitDepth: 1 },
    ];
    const candidates = [];
    const signatures = new Set();
    for (const preset of presets) {
      const result = segmentDigits(mask, preset);
      if (result.status !== "ok" || result.digits.length < 1 || result.digits.length > 3) continue;
      const signature = result.digits.map(digit => `${digit.left}:${digit.right}:${digit.top}:${digit.bottom}`).join("|");
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      candidates.push({ ...result, strategy: preset.strategy });
    }
    return candidates;
  }

  function leadingDigitGeometryHint(mask, box) {
    if (!mask?.data || !box?.width || !box?.height) return null;
    const topBottom = Math.min(box.bottom, box.top + Math.max(1, Math.round(box.height * .25)) - 1);
    let topLeft = box.right + 1;
    let topRight = box.left - 1;
    let topPixels = 0;
    for (let y = box.top; y <= topBottom; y++) {
      for (let x = box.left; x <= box.right; x++) {
        if (!mask.data[y * mask.width + x]) continue;
        topLeft = Math.min(topLeft, x);
        topRight = Math.max(topRight, x);
        topPixels++;
      }
    }
    const aspectRatio = box.width / box.height;
    const topSpanRatio = topRight >= topLeft ? (topRight - topLeft + 1) / box.width : 0;
    if (aspectRatio >= .42 && topSpanRatio >= .72 && topPixels >= Math.max(3, box.width * .6)) {
      return { digit: 7, aspectRatio, topSpanRatio, topPixels };
    }
    return null;
  }

  function normalizeDigit28(mask, box) {
    const scale = Math.min(20 / box.width, 20 / box.height);
    const targetWidth = Math.max(1, Math.round(box.width * scale));
    const targetHeight = Math.max(1, Math.round(box.height * scale));
    const resized = new Float32Array(targetWidth * targetHeight);
    const source = mask.intensity || mask.data;
    const sourceValue = (x, y) => source[y * mask.width + x] || 0;
    for (let ty = 0; ty < targetHeight; ty++) {
      for (let tx = 0; tx < targetWidth; tx++) {
        const sx = box.left + (tx + .5) * box.width / targetWidth - .5;
        const sy = box.top + (ty + .5) * box.height / targetHeight - .5;
        const x0 = clamp(Math.floor(sx), box.left, box.right);
        const y0 = clamp(Math.floor(sy), box.top, box.bottom);
        const x1 = clamp(x0 + 1, box.left, box.right);
        const y1 = clamp(y0 + 1, box.top, box.bottom);
        const fx = clamp(sx - Math.floor(sx), 0, 1);
        const fy = clamp(sy - Math.floor(sy), 0, 1);
        const top = sourceValue(x0, y0) * (1 - fx) + sourceValue(x1, y0) * fx;
        const bottom = sourceValue(x0, y1) * (1 - fx) + sourceValue(x1, y1) * fx;
        resized[ty * targetWidth + tx] = top * (1 - fy) + bottom * fy;
      }
    }
    let mass = 0;
    let massX = 0;
    let massY = 0;
    resized.forEach((value, index) => {
      if (!value) return;
      mass += value;
      massX += (index % targetWidth) * value;
      massY += Math.floor(index / targetWidth) * value;
    });
    const left = Math.round(13.5 - (mass ? massX / mass : (targetWidth - 1) / 2));
    const top = Math.round(13.5 - (mass ? massY / mass : (targetHeight - 1) / 2));
    const output = new Float32Array(28 * 28);
    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        const ox = left + x;
        const oy = top + y;
        if (ox >= 0 && ox < 28 && oy >= 0 && oy < 28) output[oy * 28 + ox] = resized[y * targetWidth + x];
      }
    }
    return output;
  }

  function transformDigit28(values, { dx = 0, dy = 0, dilate = false } = {}) {
    const output = new Float32Array(28 * 28);
    for (let y = 0; y < 28; y++) {
      for (let x = 0; x < 28; x++) {
        let value = 0;
        const sourceX = x - dx;
        const sourceY = y - dy;
        const radius = dilate ? 1 : 0;
        for (let oy = -radius; oy <= radius && !value; oy++) {
          for (let ox = -radius; ox <= radius; ox++) {
            const sx = sourceX + ox;
            const sy = sourceY + oy;
            if (sx >= 0 && sx < 28 && sy >= 0 && sy < 28 && values[sy * 28 + sx] > value) {
              value = values[sy * 28 + sx];
            }
          }
        }
        output[y * 28 + x] = value;
      }
    }
    return output;
  }

  function digitVariants(base) {
    return [
      base,
      transformDigit28(base, { dx: -1 }),
      transformDigit28(base, { dx: 1 }),
      transformDigit28(base, { dy: -1 }),
      transformDigit28(base, { dy: 1 }),
      transformDigit28(base, { dilate: true }),
    ];
  }

  function binarizeDigit28(values, threshold = .35) {
    return Float32Array.from(values, value => value + 1e-6 >= threshold ? 1 : 0);
  }

  function normalizeDigitVariantSets(mask, box) {
    const grayscale = normalizeDigit28(mask, box);
    const binary = binarizeDigit28(grayscale);
    return {
      grayscale: digitVariants(grayscale),
      binary: digitVariants(binary),
    };
  }

  function normalizeDigitVariants(mask, box) {
    return normalizeDigitVariantSets(mask, box).grayscale;
  }

  function softmax(logits) {
    const maximum = Math.max(...logits);
    const exponentials = Array.from(logits, value => Math.exp(value - maximum));
    const total = exponentials.reduce((sum, value) => sum + value, 0);
    return exponentials.map(value => value / total);
  }

  function classifyDigit(probabilitySet) {
    const probabilities = probabilitySet?.probabilities ?? probabilitySet;
    if (!probabilities || probabilities.length < 2) return null;
    const ranked = Array.from(probabilities, (probability, value) => ({ value, probability }))
      .sort((a, b) => b.probability - a.probability);
    const votes = probabilitySet?.votes;
    const variantCount = probabilitySet?.variantCount ?? (votes ? Array.from(votes).reduce((sum, vote) => sum + vote, 0) : 0);
    const rankedVotes = votes ? Array.from(votes, (vote, value) => ({ value, vote })).sort((a, b) => b.vote - a.vote) : [];
    const voteRatio = variantCount ? rankedVotes[0].vote / variantCount : 0;
    const voteMargin = variantCount ? (rankedVotes[0].vote - rankedVotes[1].vote) / variantCount : 0;
    const value = voteRatio >= .5 ? rankedVotes[0].value : ranked[0].value;
    const alternatives = ranked.filter(candidate => candidate.value !== value);
    return {
      value,
      confidence: probabilities[value],
      margin: probabilities[value] - alternatives[0].probability,
      voteRatio,
      voteMargin,
      probabilities: Array.from(probabilities),
      votes: votes ? Array.from(votes) : [],
    };
  }

  function decodeRoundedScore(probabilitySets, digitCount, options = {}) {
    const confidenceThreshold = options.confidenceThreshold ?? .6;
    const marginThreshold = options.marginThreshold ?? .08;
    const consensusThreshold = options.consensusThreshold ?? 2 / 3;
    const consensusConfidenceThreshold = options.consensusConfidenceThreshold ?? .25;
    const consensusVoteMarginThreshold = options.consensusVoteMarginThreshold ?? 1 / 3;
    const requiredDigits = Math.min(digitCount, 2);
    if (!Array.isArray(probabilitySets) || digitCount < 1 || digitCount > 3 || probabilitySets.length < requiredDigits) {
      return { status: "invalid", score: null, rawText: "", confidence: 0, digitCount };
    }
    const digits = probabilitySets.slice(0, requiredDigits).map(classifyDigit);
    if (digits.some(digit => !digit)) return { status: "invalid", score: null, rawText: "", confidence: 0, digitCount };

    const leadingDigit = digits[0].value;
    const confidence = digits[0].confidence;
    const margin = digits[0].margin;
    const rawText = digits.map(digit => digit.value).join("") + (digitCount > digits.length ? "…" : "");
    const recognizedNumber = Number(digits.map(digit => digit.value).join(""));
    let score = null;
    if (digitCount === 1 && leadingDigit === 0) score = 0;
    if (digitCount >= 2 && leadingDigit >= 1) score = Math.trunc(recognizedNumber / 10) * 10;
    if (digitCount === 3 && leadingDigit === 1) score = 100;
    if (score === null || !isAllowedScore(score)) {
      return { status: "invalid", score: null, rawText, confidence, digitCount, leadingDigit, recognizedNumber, digits };
    }
    const highConfidence = confidence >= confidenceThreshold && margin >= marginThreshold;
    const stableConsensus = digits[0].voteRatio >= consensusThreshold &&
      confidence >= consensusConfidenceThreshold && digits[0].voteMargin >= consensusVoteMarginThreshold;
    if (!highConfidence && !stableConsensus) {
      return { status: "low_confidence", score: null, suggestedScore: score, rawText, confidence, digitCount, leadingDigit, recognizedNumber, digits };
    }
    return { status: "ok", score, rawText, confidence, digitCount, leadingDigit, recognizedNumber, digits };
  }

  function isAllowedScore(value) {
    return Number.isInteger(value) && value >= 0 && value <= 100 && value % 10 === 0;
  }

  function isRecognitionCurrent(started, current) {
    return started.request === current.request && started.revision === current.revision &&
      started.paperNumber === current.paperNumber && current.phase === "playing";
  }

  return {
    allowedScoreTexts,
    getScoreRoiBounds,
    maskFromRgba,
    extractScoreInk,
    foregroundBox,
    connectedComponents,
    removeComponentNoise,
    segmentDigits,
    segmentDigitCandidates,
    leadingDigitGeometryHint,
    normalizeDigit28,
    normalizeDigitVariants,
    normalizeDigitVariantSets,
    binarizeDigit28,
    transformDigit28,
    softmax,
    decodeRoundedScore,
    isAllowedScore,
    isRecognitionCurrent,
  };
});
