"use strict";

const get = id => document.getElementById(id);
const ink = get("ink");
const ctx = ink.getContext("2d");
for (const id of ["key-heading", "student-heading"]) {
  get(id).append(get("exam-heading").content.cloneNode(true));
}
const field = (heading, name) => get(heading).querySelector(`[data-field="${name}"]`);
let selectedScore = null;
const keypad = get("keypad");
const scoreButtons = keypad.querySelectorAll("[data-score]");
const modeButtons = document.querySelectorAll(".mode-buttons button");
const layoutButtons = document.querySelectorAll(".layout-buttons button");
let phoneLayout;
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
let stylusTouchId = null;
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

function renderExam(container, marks, prompts, compactKey = false) {
  container.replaceChildren();
  answerTypes.forEach((title, index) => {
    const prefix = index === 0 ? "一" : "二";
    const { section, list } = questionGroup(compactKey ? title : `${prefix}、${title}：每題 10 分，共 50 分`);
    for (let i = index * 5; i < index * 5 + 5; i++) {
      const item = document.createElement("li");
      const slot = document.createElement("span");
      const mark = document.createElement("span");
      const number = document.createElement("span");
      slot.className = "answer-slot";
      mark.className = index === 1 ? "written-answer true-false-mark" : "written-answer";
      number.className = "q-number";
      slot.append("(", mark, ")");
      mark.textContent = displayMark(marks[i] || "");
      number.textContent = `${i + 1}. `;
      list.append(item);
      const question = document.createElement("div");
      question.className = "question-text";
      const prompt = document.createElement("span");
      const [stem, ...choices] = (prompts[i] || "").split("　");
      prompt.textContent = stem;
      const stemText = document.createElement("span");
      stemText.append(number, prompt);
      question.append(stemText);
      if (choices.length && !compactKey) {
        const options = document.createElement("span");
        options.className = "options";
        options.textContent = choices.join("　").replaceAll("／", " ");
        question.append(options);
      }
      item.append(slot, question);
    }
    container.append(section);
  });
}

function renderQuickAnswers(marks = []) {
  const items = Array.from({ length: 10 }, (_, index) => {
    const item = document.createElement("li");
    const number = document.createElement("span");
    const answer = document.createElement("strong");
    number.textContent = index + 1;
    answer.textContent = displayMark(marks[index] || "–");
    item.append(number, answer);
    return item;
  });
  get("quick-answers").replaceChildren(...items);
}

function renderKey() {
  field("key-heading", "subject").textContent = round.subject;
  field("key-heading", "name").textContent = "標準答案";
  if (phoneLayout) renderQuickAnswers(round.key);
  renderExam(get("answer-key"), round.key, round.prompts, phoneLayout);
}

function renderStudent() {
  const seat = String(paper.number).padStart(2, "0");
  field("student-heading", "subject").textContent = round.subject;
  field("student-heading", "seat").textContent = seat;
  field("student-heading", "name").textContent = paper.name;
  renderExam(get("student-answers"), paper.answers, round.prompts);
}

function setLayout(usePhoneLayout) {
  phoneLayout = usePhoneLayout;
  get("game-page").classList.toggle("phone-layout", phoneLayout);
  get("key-sheet").querySelector(".paper").classList.toggle("answer-paper", phoneLayout);
  get("student-sheet").querySelector(".paper").classList.toggle("compact-student-paper", phoneLayout);
  for (const button of layoutButtons) {
    button.setAttribute("aria-pressed", String((button.dataset.layout === "phone") === phoneLayout));
  }
  get("key-title").textContent = phoneLayout ? "標準答案紙" : "答案卷";
  if (round && paper) {
    renderKey();
    renderStudent();
  } else {
    if (phoneLayout) renderQuickAnswers();
    renderExam(get("answer-key"), [], [], phoneLayout);
    renderExam(get("student-answers"), [], []);
  }
}

function setGrade(value) {
  selectedScore = value;
  get("score-preview").textContent = value ?? "—";
  for (const button of scoreButtons) {
    button.setAttribute("aria-pressed", String(value === Number(button.dataset.score)));
  }
}

function renderPaper(nextPaper) {
  paper = nextPaper;
  renderStudent();
  setGrade(null);
  clearInk();
  fitPhonePaper();
  resizeInk();
}

function updateControls() {
  const editable = phase === "playing";
  document.body.classList.toggle("grading-in-progress", editable || phase === "submitting" || phase === "finishing");
  clearPageSelection();
  const canChoose = phase === "ready" || phase === "finished";
  for (const button of [...modeButtons, ...layoutButtons]) button.disabled = !canChoose;
  get("restart").disabled = start.disabled = !canChoose;
  get("pen-tool").disabled = get("eraser-tool").disabled = !editable;
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
  const score = selectedScore;
  if (score === null) {
    message("請先選擇這張考卷的送出分數。");
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
  const canvas = copy.querySelector("canvas");
  if (strokes.length) {
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

function fitPhonePaper() {
  if (!phoneLayout || gamePage.hidden) return;
  const workspace = get("workspace");
  const sheet = get("student-sheet");
  const studentPaper = sheet.querySelector(".paper");
  const reference = get("key-sheet");
  const prompts = get("answer-key");
  const workspaceTop = workspace.getBoundingClientRect().top + window.scrollY;
  const gap = parseFloat(getComputedStyle(workspace).rowGap);
  const collapsedKeyHeight = reference.offsetHeight - (prompts.offsetHeight ? prompts.offsetHeight + 6 : 0);
  const available = document.documentElement.clientHeight - workspaceTop - collapsedKeyHeight - gap - 8;
  // Measure the paper before its visual transform so fitting cannot change line wraps.
  const paperHeight = studentPaper.offsetHeight;
  if (!paperHeight) return;
  const scale = Math.min(1, Math.max(.4, available / paperHeight));
  sheet.style.setProperty("--phone-paper-height", `${Math.ceil(paperHeight * scale)}px`);
  if (sheet.style.getPropertyValue("--phone-paper-scale") !== String(scale)) {
    sheet.style.setProperty("--phone-paper-scale", scale);
    if (!ink.hidden) resizeInk();
  }
}

function resizeInk() {
  const box = ink.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  ink.width = Math.round(box.width * ratio);
  ink.height = Math.round(box.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redrawInk();
}

function paintInk(stroke, { width, height }, from = 0) {
  const { points, tool: strokeTool } = stroke;
  ctx.strokeStyle = ctx.fillStyle = "#bb3028";
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.globalCompositeOperation = strokeTool === "eraser" ? "destination-out" : "source-over";
  ctx.lineWidth = strokeTool === "eraser" ? 22 : 2.7;
  ctx.beginPath();
  const [x, y] = points[from];
  if (points.length === 1) {
    ctx.arc(x * width, y * height, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(x * width, y * height);
    for (let i = from + 1; i < points.length; i++) {
      const [px, py] = points[i];
      ctx.lineTo(px * width, py * height);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}

function redrawInk() {
  const box = ink.getBoundingClientRect();
  ctx.clearRect(0, 0, box.width, box.height);
  for (const stroke of strokes) paintInk(stroke, box);
}

function point(event, box = ink.getBoundingClientRect()) {
  return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height];
}

function clearInk() {
  strokes = [];
  activeStroke = undefined;
  activePointer = undefined;
  stylusTouchId = null;
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
gamePage.addEventListener("gesturestart", event => {
  // Keep the grading surface stable during Safari's native zoom gesture.
  if (phoneLayout && document.body.classList.contains("grading-in-progress") && !gamePage.classList.contains("viewport-zoomed")) {
    event.preventDefault();
  }
}, { passive: false });

if (viewport) {
  const allowPinchRecovery = () => {
    const zoomed = viewport.scale > 1.01;
    gamePage.classList.toggle("viewport-zoomed", zoomed);
    ink.classList.toggle("viewport-zoomed", zoomed);
  };
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
  const [lastX, lastY] = activeStroke.points[activeStroke.points.length - 1];
  if (x !== lastX || y !== lastY) activeStroke.points.push([x, y]);
}

function beginStroke(event, capture = true) {
  const isPen = event.pointerType === "pen";
  let removedTouch = false;
  if (activeStroke) {
    const penReplacesTouch = isPen && activeStroke.pointerType === "touch";
    const newPenStroke = isPen && activeStroke.pointerType === "pen";
    if (event.pointerId !== activePointer && !penReplacesTouch && !newPenStroke) return;
    if (event.pointerId !== activePointer && ink.hasPointerCapture(activePointer)) {
      ink.releasePointerCapture(activePointer);
    }
    // A new pen-down also ends a stroke whose lift was missed by the browser.
    if (penReplacesTouch) {
      strokes.pop();
      removedTouch = true;
    }
  }
  activePointer = event.pointerId;
  activeStroke = { points: [point(event)], tool, pointerType: event.pointerType };
  strokes.push(activeStroke);
  if (capture) {
    try {
      ink.setPointerCapture(event.pointerId);
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
    }
  }
  if (removedTouch) redrawInk();
  else paintInk(activeStroke, ink.getBoundingClientRect());
  updateControls();
}

ink.addEventListener("pointerdown", event => {
  event.preventDefault();
  if (phase === "playing" && stylusTouchId === null && event.button === 0) beginStroke(event);
});

function penInContact(event) {
  return (event.buttons & 1) !== 0 || event.pressure > 0;
}

window.addEventListener("pointermove", event => {
  if (phase !== "playing" || stylusTouchId !== null ||
      (event.target !== ink && event.pointerId !== activePointer)) return;
  const samples = [...(event.getCoalescedEvents?.() || []), event];
  const points = event.pointerType === "pen" ? samples.filter(penInContact) : samples;
  if (event.pointerType === "pen" && points.length && event.pointerId !== activePointer) {
    beginStroke(points[0]);
  }
  if (event.pointerId !== activePointer) return;
  const box = ink.getBoundingClientRect();
  const start = activeStroke.points.length - 1;
  for (const sample of points) appendInkPoint(sample, box);
  if (activeStroke.points.length > start + 1) paintInk(activeStroke, box, start);
  if (event.pointerType === "pen" && !penInContact(event)) finishStroke(event);
}, true);

function finishStroke(event) {
  if (stylusTouchId !== null || event.pointerId !== activePointer) return;
  if (event.type === "pointerup" && phase === "playing") {
    const box = ink.getBoundingClientRect();
    const start = activeStroke.points.length - 1;
    appendInkPoint(event, box);
    if (activeStroke.points.length > start + 1) paintInk(activeStroke, box, start);
  }
  activeStroke = undefined;
  activePointer = undefined;
}

window.addEventListener("pointerup", finishStroke, true);
window.addEventListener("pointercancel", finishStroke, true);
ink.addEventListener("lostpointercapture", event => {
  if (activeStroke?.pointerType !== "pen" && !ink.hasPointerCapture(event.pointerId)) finishStroke(event);
});
// Safari can report Apple Pencil contact through Touch Events as well as Pointer Events.
ink.addEventListener("touchstart", event => {
  if (phase !== "playing") return;
  const touch = Array.from(event.changedTouches).find(contact => contact.touchType === "stylus");
  if (!touch) return;
  event.preventDefault();
  stylusTouchId = touch.identifier;
  const box = ink.getBoundingClientRect();
  const [x, y] = point(touch, box);
  const previous = activeStroke?.points[0];
  const alreadyStarted = activeStroke?.pointerType === "pen" && activeStroke.points.length === 1 &&
    Math.hypot((x - previous[0]) * box.width, (y - previous[1]) * box.height) < 3;
  if (!alreadyStarted) {
    beginStroke({ pointerType: "pen", pointerId: -1, clientX: touch.clientX, clientY: touch.clientY }, false);
  }
}, { passive: false });

function updateStylusTouch(event) {
  if (stylusTouchId === null) return;
  const touch = Array.from(event.changedTouches).find(contact => contact.identifier === stylusTouchId);
  if (!touch) return;
  if (event.cancelable) event.preventDefault();
  if (activeStroke && phase === "playing" && event.type !== "touchcancel") {
    const box = ink.getBoundingClientRect();
    const start = activeStroke.points.length - 1;
    appendInkPoint(touch, box);
    if (activeStroke.points.length > start + 1) paintInk(activeStroke, box, start);
  }
  if (event.type !== "touchmove") {
    stylusTouchId = null;
    activeStroke = undefined;
    activePointer = undefined;
  }
}

for (const type of ["touchmove", "touchend", "touchcancel"]) {
  ink.addEventListener(type, updateStylusTouch, { passive: false });
}

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
  stylusTouchId = null;
  strokes.pop();
  redrawInk();
  updateControls();
});
get("clear").addEventListener("click", clearInk);
new ResizeObserver(resizeInk).observe(ink);
const phonePaperResize = new ResizeObserver(fitPhonePaper);
for (const element of gamePage.querySelectorAll(".intro, .lobby-tools, #grading-tools, #key-sheet, #student-sheet .paper")) {
  phonePaperResize.observe(element);
}
window.addEventListener("resize", fitPhonePaper);
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
    get("selected-mode").textContent = button.querySelector(".full-mode-label").textContent;
  });
}
get("toggle-key-prompts").addEventListener("click", event => {
  const button = event.currentTarget;
  const expanded = button.getAttribute("aria-expanded") === "false";
  button.setAttribute("aria-expanded", String(expanded));
  button.textContent = expanded ? "收合題幹" : "展開題幹";
});
get("open-tutorial").addEventListener("click", () => {
  get("tutorial-credit").hidden = true;
  tutorial.showModal();
});
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

for (const button of layoutButtons) {
  button.addEventListener("click", () => setLayout(button.dataset.layout === "phone"));
}
setLayout(matchMedia("(max-width: 680px), (max-height: 500px) and (pointer: coarse)").matches);
keypad.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button || phase !== "playing") return;
  setGrade(button.dataset.score === undefined ? null : Number(button.dataset.score));
  message();
});

tutorial.showModal();
