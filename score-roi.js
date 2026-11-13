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
    let foregroundPixels = 0;
    for (let index = 0; index < data.length; index++) {
      if (rgba[index * 4 + 3] >= alphaThreshold) {
        data[index] = 1;
        foregroundPixels++;
      }
    }
    return { data, width, height, foregroundPixels };
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
    let foregroundPixels = 0;
    const components = connectedComponents(mask).filter(component => component.pixels >= minimumPixels);
    for (const component of components) {
      for (const index of component.indices) data[index] = 1;
      foregroundPixels += component.pixels;
    }
    return { data, width: mask.width, height: mask.height, foregroundPixels, components };
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

  function splitWideRun(mask, run, overallHeight) {
    const width = run.right - run.left + 1;
    if (width < overallHeight * 1.05) return [run];
    const columnCounts = [];
    for (let x = run.left; x <= run.right; x++) {
      let count = 0;
      for (let y = 0; y < mask.height; y++) count += mask.data[y * mask.width + x];
      columnCounts.push(count);
    }
    const edge = Math.max(2, Math.floor(width * .2));
    let best = -1;
    let bestCount = Infinity;
    for (let index = edge; index < width - edge; index++) {
      const count = columnCounts[index];
      if (count < bestCount) {
        best = index;
        bestCount = count;
      }
    }
    const peak = Math.max(...columnCounts, 1);
    if (best < 0 || bestCount > peak * .3) return [run];
    return [
      { left: run.left, right: run.left + best - 1 },
      { left: run.left + best + 1, right: run.right },
    ].filter(part => part.right >= part.left);
  }

  function segmentDigits(mask, options = {}) {
    const minimumPixels = options.minimumPixels ?? Math.max(8, Math.round(mask.width * mask.height * .0008));
    const cleaned = removeComponentNoise(mask, Math.max(2, Math.floor(minimumPixels * .25)));
    const box = foregroundBox(cleaned);
    if (!box || (mask.foregroundPixels ?? box.width * box.height) < minimumPixels) return { status: "empty", digits: [] };
    const { runs } = projectionRuns(cleaned, box);
    if (!runs.length) return { status: "empty", digits: [] };

    const mergeGap = Math.max(1, Math.round(box.height * .07));
    const merged = [];
    for (const run of runs) {
      const previous = merged.at(-1);
      if (previous && run.left - previous.right - 1 <= mergeGap && previous.right - previous.left + 1 < box.height * .32) {
        previous.right = run.right;
      } else {
        merged.push({ ...run });
      }
    }
    const split = merged.flatMap(run => splitWideRun(cleaned, run, box.height));
    const digits = split.map(run => boxForColumns(cleaned, run.left, run.right)).filter(Boolean);
    const substantial = digits.filter(digit => digit.pixels >= minimumPixels && digit.height >= Math.max(4, box.height * .35));
    if (!substantial.length) return { status: "empty", digits: [] };
    if (substantial.length > 3 || substantial.length !== digits.length) return { status: "low_confidence", digits: substantial };
    return { status: "ok", digits: substantial.sort((a, b) => a.left - b.left), box, mask: cleaned };
  }

  function normalizeDigit28(mask, box) {
    const output = new Float32Array(28 * 28);
    const scale = Math.min(20 / box.width, 20 / box.height);
    const targetWidth = Math.max(1, Math.round(box.width * scale));
    const targetHeight = Math.max(1, Math.round(box.height * scale));
    const left = Math.floor((28 - targetWidth) / 2);
    const top = Math.floor((28 - targetHeight) / 2);
    for (let ty = 0; ty < targetHeight; ty++) {
      const sy = box.top + Math.min(box.height - 1, Math.floor((ty + .5) * box.height / targetHeight));
      for (let tx = 0; tx < targetWidth; tx++) {
        const sx = box.left + Math.min(box.width - 1, Math.floor((tx + .5) * box.width / targetWidth));
        output[(top + ty) * 28 + left + tx] = mask.data[sy * mask.width + sx] ? 1 : 0;
      }
    }
    return output;
  }

  function softmax(logits) {
    const maximum = Math.max(...logits);
    const exponentials = Array.from(logits, value => Math.exp(value - maximum));
    const total = exponentials.reduce((sum, value) => sum + value, 0);
    return exponentials.map(value => value / total);
  }

  function decodeAllowedScore(digits, options = {}) {
    const confidenceThreshold = options.confidenceThreshold ?? .72;
    const marginThreshold = options.marginThreshold ?? .16;
    if (!digits.length || digits.length > 3) return { status: "invalid", score: null, rawText: "", confidence: 0 };
    const details = digits.map(probabilities => {
      const ranked = probabilities.map((probability, value) => ({ value, probability })).sort((a, b) => b.probability - a.probability);
      return { value: ranked[0].value, confidence: ranked[0].probability, margin: ranked[0].probability - ranked[1].probability, probabilities: Array.from(probabilities) };
    });
    const rawText = details.map(digit => digit.value).join("");
    const confidence = Math.pow(details.reduce((product, digit) => product * digit.confidence, 1), 1 / details.length);
    if (!allowedScoreTexts.has(rawText)) return { status: "invalid", score: null, rawText, confidence, digits: details };
    if (details.some(digit => digit.confidence < confidenceThreshold || digit.margin < marginThreshold)) {
      return { status: "low_confidence", score: null, rawText, confidence, digits: details };
    }
    return { status: "ok", score: Number(rawText), rawText, confidence, digits: details };
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
    normalizeDigit28,
    softmax,
    decodeAllowedScore,
    isAllowedScore,
    isRecognitionCurrent,
  };
});
