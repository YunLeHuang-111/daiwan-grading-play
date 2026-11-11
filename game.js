"use strict";

const get = id => document.getElementById(id);
const ink = get("ink");
const ctx = ink.getContext("2d");
for (const id of ["key-heading", "student-heading"]) {
  get(id).append(get("exam-heading").content.cloneNode(true));
}
const field = (heading, name) => get(heading).querySelector(`[data-field="${name}"]`);
const grade = document.createElement("input");
grade.id = "grade";
grade.type = "text";
grade.inputMode = "numeric";
grade.pattern = "[0-9]{1,3}";
grade.maxLength = 3;
grade.autocomplete = "off";
grade.required = true;
grade.disabled = true;
grade.setAttribute("aria-label", "考卷得分，滿分 100");
field("student-heading", "score").append(grade);
const keypad = get("keypad");
const scoreButtons = keypad.querySelectorAll("[data-score]");
const modeButtons = document.querySelectorAll(".mode-buttons button");
const start = get("start");
let selectedMode = "timed";
const submit = get("submit");
const results = get("results");
const tutorial = get("tutorial");
const answerTypes = ["選擇題", "是非題"];
let round;
let paper;
let deadline;
let timer;
let phase = "ready";
let strokes = [];
let activeStroke;
let activePointer;
let inkFrame = 0;
let tool = "pen";
const practiceFinish = get("finish-practice");
const reviewedPapers = new Map();
const submittedPapers = new Map();
const reviewResize = new ResizeObserver(entries => {
  for (const { target } of entries) fitReviewPaper(target);
});
const clockDigits = get("clock-digits");
const segmentPaths = ["M5 3h12", "M19 5v11", "M19 22v11", "M5 35h12", "M3 22v11", "M3 5v11", "M5 19h12"];
const digitSegments = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"];
const digitGroups = [0, 25, 69, 94].map(offset => {
  const group = document.createElementNS(clockDigits.namespaceURI, "g");
  group.setAttribute("transform", `translate(${offset} 0)`);
  clockDigits.append(group);
  return segmentPaths.map(path => {
    const segment = document.createElementNS(clockDigits.namespaceURI, "path");
    segment.setAttribute("d", path);
    group.append(segment);
    return segment;
  });
});
const clockColon = document.createElementNS(clockDigits.namespaceURI, "path");
clockColon.setAttribute("d", "M57 12h2m-2 14h2");
clockDigits.append(clockColon);

function message(text = "") {
  const status = get("message");
  status.textContent = text;
  status.hidden = !text;
}

const api = browserGame;

function questionGroup(title) {
  const section = document.createElement("section");
  section.className = "sheet-group";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("ol");
  section.append(heading, list);
  return { section, list };
}

function displayMark(mark) {
  return mark === "O" ? "○" : mark === "X" ? "×" : mark;
}

function renderExam(container, marks, prompts) {
  container.replaceChildren();
  answerTypes.forEach((title, index) => {
    const prefix = index === 0 ? "一" : "二";
    const { section, list } = questionGroup(`${prefix}、${title}：每題 10 分，共 50 分`);
    for (let i = index * 5; i < index * 5 + 5; i++) {
      const item = document.createElement("li");
      const slot = document.createElement("span");
      const mark = document.createElement("span");
      const question = document.createElement("div");
      const number = document.createElement("span");
      const prompt = document.createElement("span");
      slot.className = "answer-slot";
      mark.className = index === 1 ? "written-answer true-false-mark" : "written-answer";
      question.className = "question-text";
      number.className = "q-number";
      slot.append("(", mark, ")");
      mark.textContent = displayMark(marks[i] || "");
      number.textContent = `${i + 1}. `;
      const [stem, ...choices] = (prompts[i] || "").split("　");
      prompt.textContent = stem;
      const stemText = document.createElement("span");
      stemText.append(number, prompt);
      question.append(stemText);
      if (choices.length) {
        const options = document.createElement("span");
        options.className = "options";
        options.textContent = choices.join("　").replaceAll("／", " ");
        question.append(options);
      }
      item.append(slot, question);
      list.append(item);
    }
    container.append(section);
  });
}

function renderKey() {
  field("key-heading", "subject").textContent = round.subject;
  field("key-heading", "name").textContent = "標準答案";
  renderExam(get("answer-key"), round.key, round.prompts);
}

function setGrade(value) {
  grade.value = value;
  get("score-preview").textContent = value || "—";
  for (const button of scoreButtons) {
    button.setAttribute("aria-pressed", String(value !== "" && Number(value) === Number(button.dataset.score)));
  }
}

function renderPaper(nextPaper) {
  paper = nextPaper;
  field("student-heading", "subject").textContent = round.subject;
  field("student-heading", "seat").textContent = String(paper.number).padStart(2, "0");
  field("student-heading", "name").textContent = paper.name;
  renderExam(get("student-answers"), paper.answers, round.prompts);
  setGrade("");
  clearInk();
  resizeInk();
}

function updateControls() {
  const editable = phase === "playing";
  document.body.classList.toggle("grading-in-progress", editable || phase === "submitting" || phase === "finishing");
  clearPageSelection();
  const canChoose = phase === "ready" || phase === "finished";
  for (const button of modeButtons) button.disabled = !canChoose;
  get("restart").disabled = start.disabled = !canChoose;
  get("pen-tool").disabled = get("eraser-tool").disabled = !editable;
  grade.disabled = !editable;
  submit.disabled = !editable;
  keypad.disabled = !editable;
  practiceFinish.disabled = !editable;
  get("undo").disabled = !editable || strokes.length === 0;
  get("clear").disabled = !editable || strokes.length === 0;
}

function updateClock(ms) {
  const seconds = Math.ceil(ms / 1000);
  const digits = String(Math.floor(seconds / 60)).padStart(2, "0") + String(seconds % 60).padStart(2, "0");
  const clock = get("clock");
  const time = `${digits.slice(0, 2)}:${digits.slice(2)}`;
  if (clock.textContent !== time || !digitGroups[0][0].hasAttribute("class")) {
    clock.textContent = time;
    digitGroups.forEach((segments, digit) => {
      segments.forEach((segment, index) => {
        segment.setAttribute("class", digitSegments[Number(digits[digit])].includes("abcdefg"[index]) ? "lit" : "unlit");
      });
    });
  }
  get("time-bar").value = ms;
  get("clock-card").classList.toggle("urgent", seconds <= 10);
}

function tick() {
  if (round.practice) return;
  const left = Math.max(0, deadline - performance.now());
  updateClock(left);
  if (left === 0 && phase === "playing") finish();
}

async function startRound(mode) {
  if (phase !== "ready" && phase !== "finished") return;
  phase = "starting";
  updateControls();
  message();
  try {
    round = await api("start", "POST", mode);
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    renderRoute();
    get("clock-digits").toggleAttribute("hidden", round.practice);
    get("time-bar").hidden = get("clock").hidden = round.practice;
    get("practice-clock").hidden = practiceFinish.hidden = !round.practice;
    get("time-bar").max = round.mode === "multi" ? 120000 : 60000;
    get("clock-card").classList.remove("urgent");
    submittedPapers.clear();
    deadline = round.practice ? null : performance.now() + round.remainingMs;
    get("start-panel").hidden = true;
    ink.hidden = false;
    get("count").textContent = "00";
    selectTool("pen");
    renderKey();
    renderPaper(round.paper);
    phase = "playing";
    updateControls();
    if (!round.practice) {
      tick();
      timer = setInterval(tick, 100);
    }
  } catch (error) {
    phase = "ready";
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    renderRoute();
    get("start-panel").hidden = false;
    ink.hidden = true;
    updateControls();
    message(error.name === "Error" ? error.message : "無法開始閱卷，請再試一次。");
  }
}

get("grade-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (phase !== "playing") return;
  if (deadline !== null && performance.now() >= deadline) {
    finish();
    return;
  }
  const score = Number(grade.value);
  if (!/^[0-9]{1,3}$/.test(grade.value) || score > 100) {
    message(grade.value ? "請填入 0 到 100 的整數。" : "請先填寫這張考卷的分數。");
    return;
  }

  phase = "submitting";
  updateControls();
  message();
  try {
    rememberPaper(score);
    const data = await api(`${round.id}/submit`, "POST", `${paper.number},${score}`);
    if (data.finished) {
      showResults(data.result);
      return;
    }
    if (!round.practice) deadline = performance.now() + data.remainingMs;
    get("count").textContent = String(data.count).padStart(2, "0");
    if (data.subject !== round.subject) {
      round.subject = data.subject;
      round.key = data.key;
      round.prompts = data.prompts;
      renderKey();
    }
    renderPaper(data.paper);
    const sheet = get("student-sheet");
    if (sheet.getBoundingClientRect().top < 0) {
      sheet.scrollIntoView({ block: "start" });
    }
  } catch (error) {
    message(error.name === "Error" ? error.message : "連線中斷，請再交件一次。");
  }
  phase = "playing";
  updateControls();
  tick();
});

async function finish() {
  phase = "finishing";
  updateControls();
  try {
    const data = round.practice ? await api(`${round.id}/finish`, "POST") : await api(`${round.id}/results`);
    if (data.remainingMs !== undefined) {
      deadline = performance.now() + data.remainingMs;
      phase = "playing";
      updateControls();
      return;
    }
    showResults(data);
  } catch {
    clearInterval(timer);
    message("連線中斷，請重試結算。");
    submit.disabled = false;
    submit.type = "button";
    submit.textContent = "重試結算";
  }
}

function rememberPaper(score) {
  const key = `${paper.number}:${score}`;
  if (submittedPapers.has(key)) return;
  const source = get("student-sheet");
  const original = source.querySelector(".paper");
  const copy = original.cloneNode(true);
  copy.querySelector(".start-panel").remove();
  copy.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
  const input = copy.querySelector("input");
  const scoreLabel = document.createElement("strong");
  scoreLabel.className = "review-score";
  scoreLabel.textContent = score;
  input.replaceWith(scoreLabel);
  const canvas = copy.querySelector("canvas");
  if (strokes.length) {
    if (inkFrame) redrawInk();
    const annotation = document.createElement("img");
    annotation.className = "review-ink";
    annotation.src = ink.toDataURL();
    annotation.alt = "閱卷筆跡";
    canvas.replaceWith(annotation);
  } else {
    canvas.remove();
  }
  submittedPapers.set(key, { copy, subject: round.subject, width: source.getBoundingClientRect().width });
}

function fitReviewPaper(frame) {
  const page = frame.firstElementChild;
  const scale = Math.min(1, frame.clientWidth / parseFloat(page.style.width));
  page.style.transform = `scale(${scale})`;
  frame.style.height = `${page.offsetHeight * scale}px`;
}

function reviewFrame(snapshot) {
  const frame = document.createElement("div");
  frame.className = "review-frame";
  frame.style.maxWidth = `${snapshot.width}px`;
  const page = document.createElement("div");
  page.className = "review-page";
  page.style.width = `${snapshot.width}px`;
  page.append(snapshot.copy.cloneNode(true));
  frame.append(page);
  reviewResize.observe(frame);
  return frame;
}

function renderReviewedPapers(grades) {
  reviewResize.disconnect();
  reviewedPapers.clear();
  const list = get("grade-list");
  list.replaceChildren();
  get("review-count").textContent = `${grades.length} 張`;
  get("review-note").textContent = grades.length ? "點選縮圖即可放大查看。" : "這一局還沒有交件。";
  for (const { number, entered, expected } of grades) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "review-card";
    link.href = `#paper-${number}`;
    const label = document.createElement("strong");
    const scores = document.createElement("span");
    const verdict = document.createElement("span");
    label.textContent = `第 ${number} 張`;
    scores.textContent = `你給 ${entered} 分 · 應得 ${expected} 分`;
    verdict.className = entered === expected ? "review-verdict correct" : "review-verdict";
    verdict.textContent = entered === expected ? "給分正確" : "給分有誤";
    const snapshot = submittedPapers.get(`${number}:${entered}`);
    if (snapshot) {
      label.textContent += ` · ${snapshot.subject}`;
      const preview = reviewFrame(snapshot);
      preview.setAttribute("aria-hidden", "true");
      link.append(preview);
    }
    link.append(label, scores, verdict);
    item.append(link);
    list.append(item);
    reviewedPapers.set(String(number), { snapshot, scores: scores.textContent });
  }
}

function renderRoute() {
  const hash = location.hash;
  const sheet = phase === "finished" && hash.startsWith("#paper-") && reviewedPapers.get(hash.slice(7));
  const showResultsPage = phase === "finished" && hash === "#results";
  get("game-page").hidden = Boolean(sheet || showResultsPage);
  results.hidden = !showResultsPage;
  get("paper-view").hidden = !sheet;
  const content = get("paper-view-content");
  if (content.firstElementChild) reviewResize.unobserve(content.firstElementChild);
  content.replaceChildren();
  if (sheet) {
    get("paper-view-title").textContent = `第 ${hash.slice(7)} 張考卷${sheet.snapshot ? ` · ${sheet.snapshot.subject}` : ""}`;
    get("paper-view-scores").textContent = sheet.scores;
    if (sheet.snapshot) content.append(reviewFrame(sheet.snapshot));
    get("paper-view-title").focus({ preventScroll: true });
  } else if (showResultsPage) {
    get("result-title").focus({ preventScroll: true });
  } else if (phase === "finished") {
    get("start-panel").hidden = false;
    ink.hidden = true;
  }
  if (sheet || showResultsPage) window.scrollTo(0, 0);
}

function showResults(data) {
  clearInterval(timer);
  phase = "finished";
  updateControls();
  if (!round.practice) updateClock(0);
  message();
  submit.type = "submit";
  submit.textContent = "下一張 →";
  get("count").textContent = String(data.count).padStart(2, "0");
  get("result-stats").textContent = `交件 ${data.count} 張・分數正確 ${data.correct} 張・正確率 ${data.accuracy}%`;
  get("result-mode").textContent = round.practice ? "練習模式 ／ 本局紀錄" :
    round.mode === "multi" ? "多科模式 ／ 本局成績單" : "單科模式 ／ 本局成績單";
  get("result-rating").hidden = get("achievement").hidden = round.practice;
  if (round.practice) {
    get("result-title").textContent = "練習完成";
  } else {
    get("rating").textContent = data.score;
    const { ending, isNew } = achievementBook.record(data, round.id);
    get("result-title").textContent = ending.title;
    get("achievement").classList.toggle("new-ending", isNew);
    get("ending-label").textContent = isNew ? "★ 新結局" : "本局結局・已收錄";
    get("ending-title").textContent = ending.label;
    get("ending-detail").textContent = `NO. ${ending.number} · ${round.mode === "multi" ? "多科模式" : round.subject}`;
  }
  renderReviewedPapers(data.grades);
  history.pushState(null, "", "#results");
  renderRoute();
}

function resizeInk() {
  const box = ink.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  ink.width = Math.round(box.width * ratio);
  ink.height = Math.round(box.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redrawInk();
}

function redrawInk() {
  if (inkFrame) cancelAnimationFrame(inkFrame);
  inkFrame = 0;
  const { width, height } = ink.getBoundingClientRect();
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = ctx.fillStyle = "#bb3028";
  ctx.lineCap = ctx.lineJoin = "round";
  for (const { points, tool: strokeTool } of strokes) {
    ctx.globalCompositeOperation = strokeTool === "eraser" ? "destination-out" : "source-over";
    ctx.lineWidth = strokeTool === "eraser" ? 22 : 2.7;
    ctx.beginPath();
    const [x, y] = points[0];
    if (points.length === 1) {
      ctx.arc(x * width, y * height, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.moveTo(x * width, y * height);
    for (const [px, py] of points.slice(1)) ctx.lineTo(px * width, py * height);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}

function point(event, box = ink.getBoundingClientRect()) {
  return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height];
}

function clearInk() {
  strokes = [];
  activeStroke = undefined;
  activePointer = undefined;
  redrawInk();
  updateControls();
}

const gamePage = get("game-page");
let tapStart;
let previousTap;

gamePage.addEventListener("touchstart", event => {
  if (event.target === ink || event.touches.length !== 1) {
    tapStart = previousTap = undefined;
    return;
  }
  tapStart = event.touches[0];
}, { passive: true });

gamePage.addEventListener("touchend", event => {
  const start = tapStart;
  tapStart = undefined;
  const touch = event.changedTouches[0];
  if (event.target === ink || !start || !touch || event.touches.length || touch.identifier !== start.identifier ||
      Math.hypot(touch.clientX - start.clientX, touch.clientY - start.clientY) > 10) {
    previousTap = undefined;
    return;
  }

  const now = performance.now();
  const isDoubleTap = previousTap && now - previousTap.time < 350 &&
    Math.hypot(touch.clientX - previousTap.x, touch.clientY - previousTap.y) < 24;
  previousTap = isDoubleTap ? undefined : { time: now, x: touch.clientX, y: touch.clientY };
  if (!isDoubleTap || !event.cancelable) return;

  event.preventDefault();
  // Keep the second keypress even when its native click is canceled with the zoom gesture.
  event.target.closest("button")?.click();
}, { passive: false });

gamePage.addEventListener("touchcancel", () => {
  tapStart = previousTap = undefined;
});

const viewport = window.visualViewport;
if (viewport) {
  const allowPinchRecovery = () => ink.classList.toggle("viewport-zoomed", viewport.scale > 1.01);
  viewport.addEventListener("resize", allowPinchRecovery);
  allowPinchRecovery();
}

function clearPageSelection() {
  if (!document.body.classList.contains("grading-in-progress")) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) selection.removeAllRanges();
}

function preventSelectionGesture(event) {
  if (document.body.classList.contains("grading-in-progress")) event.preventDefault();
}

document.addEventListener("selectstart", preventSelectionGesture);
document.addEventListener("contextmenu", preventSelectionGesture);
document.addEventListener("selectionchange", clearPageSelection);
function appendInkPoint(event, box) {
  const [x, y] = point(event, box);
  const [lastX, lastY] = activeStroke.points.at(-1);
  if (x !== lastX || y !== lastY) activeStroke.points.push([x, y]);
}

ink.addEventListener("pointerdown", event => {
  event.preventDefault();
  if (phase !== "playing" || event.button !== 0) return;
  const isPen = event.pointerType === "pen";
  if (!isPen && !event.isPrimary) return;
  if (activeStroke) {
    const penReplacesTouch = isPen && activeStroke.pointerType === "touch";
    const newPenStroke = isPen && activeStroke.pointerType === "pen";
    if (event.pointerId !== activePointer && !penReplacesTouch && !newPenStroke) return;
    if (event.pointerId !== activePointer && ink.hasPointerCapture(activePointer)) {
      ink.releasePointerCapture(activePointer);
    }
    // A new pen-down also ends a stroke whose lift was missed by the browser.
    if (penReplacesTouch) strokes.pop();
  }
  activePointer = event.pointerId;
  activeStroke = { points: [point(event)], tool, pointerType: event.pointerType };
  strokes.push(activeStroke);
  try {
    ink.setPointerCapture(event.pointerId);
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
  }
  redrawInk();
  updateControls();
});

ink.addEventListener("pointermove", event => {
  if (event.pointerId !== activePointer || phase !== "playing") return;
  const box = ink.getBoundingClientRect();
  for (const sample of event.getCoalescedEvents?.() || []) appendInkPoint(sample, box);
  appendInkPoint(event, box);
  if (!inkFrame) inkFrame = requestAnimationFrame(redrawInk);
});

function finishStroke(event) {
  if (event.pointerId !== activePointer) return;
  if (event.type === "pointerup" && phase === "playing") {
    appendInkPoint(event, ink.getBoundingClientRect());
  }
  activeStroke = undefined;
  activePointer = undefined;
  redrawInk();
}

window.addEventListener("pointerup", finishStroke, true);
window.addEventListener("pointercancel", finishStroke, true);
ink.addEventListener("lostpointercapture", event => {
  if (!ink.hasPointerCapture(event.pointerId)) finishStroke(event);
});
function selectTool(nextTool) {
  tool = nextTool;
  ink.classList.toggle("eraser-active", tool === "eraser");
  get("pen-tool").setAttribute("aria-pressed", String(tool === "pen"));
  get("eraser-tool").setAttribute("aria-pressed", String(tool === "eraser"));
}

get("pen-tool").addEventListener("click", () => selectTool("pen"));
get("eraser-tool").addEventListener("click", () => selectTool("eraser"));
updateClock(60000);
get("undo").addEventListener("click", () => {
  activeStroke = undefined;
  activePointer = undefined;
  strokes.pop();
  redrawInk();
  updateControls();
});
get("clear").addEventListener("click", clearInk);
new ResizeObserver(resizeInk).observe(ink);
new ResizeObserver(([entry]) => {
  const height = entry.target.offsetHeight;
  document.body.style.setProperty("--grading-height", `${height}px`);
}).observe(get("grading-tools"));
for (const button of modeButtons) {
  button.addEventListener("click", () => {
    selectedMode = button.dataset.mode;
    for (const option of modeButtons) {
      option.setAttribute("aria-pressed", String(option === button));
    }
    get("selected-mode").textContent = button.textContent;
  });
}
get("open-tutorial").addEventListener("click", () => tutorial.showModal());
start.addEventListener("click", () => startRound(selectedMode));
get("restart").addEventListener("click", () => {
  history.pushState(null, "", location.pathname + location.search);
  renderRoute();
  window.scrollTo(0, 0);
  document.querySelector('.mode-buttons [aria-pressed="true"]').focus({ preventScroll: true });
});
practiceFinish.addEventListener("click", () => {
  if (phase === "playing" && round.practice) finish();
});
window.addEventListener("hashchange", renderRoute);
if (location.hash === "#results" || location.hash.startsWith("#paper-")) {
  history.replaceState(null, "", location.pathname + location.search);
}
submit.addEventListener("click", () => {
  if (submit.type === "button") {
    submit.disabled = true;
    finish();
  }
});

for (const id of ["answer-key", "student-answers"]) renderExam(get(id), [], []);
grade.addEventListener("input", () => {
  const digits = grade.value.replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10));
  setGrade(digits.replace(/[^0-9]/g, "").slice(0, 3));
  message();
});
keypad.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button || phase !== "playing") return;
  setGrade(button.dataset.score ?? "");
  message();
});

tutorial.showModal();
