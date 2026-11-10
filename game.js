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
const start = get("start");
const submit = get("submit");
const results = get("results");
const answerTypes = ["選擇題", "是非題"];
let round;
let paper;
let deadline;
let timer;
let phase = "ready";
let strokes = [];
let activeStroke;
let activePointer;
let tool = "pen";
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
      mark.className = "written-answer";
      question.className = "question-text";
      number.className = "q-number";
      slot.append("(", mark, ")");
      mark.textContent = displayMark(marks[i] || "");
      number.textContent = `${i + 1}. `;
      const [stem, ...choices] = (prompts[i] || "").split("　");
      prompt.textContent = stem;
      question.append(number, prompt);
      if (choices.length) {
        const options = document.createElement("span");
        options.className = "options";
        options.textContent = choices.join("　").replaceAll("／", "　");
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
  get("pen-tool").disabled = get("eraser-tool").disabled = !editable;
  grade.disabled = !editable;
  submit.disabled = !editable;
  keypad.disabled = !editable;
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
  const left = Math.max(0, deadline - performance.now());
  updateClock(left);
  if (left === 0 && phase === "playing") finish();
}

async function startRound() {
  if (phase === "starting") return;
  phase = "starting";
  start.disabled = true;
  get("restart").disabled = true;
  if (results.open) results.close();
  message();
  try {
    round = await api("start", "POST");
    deadline = performance.now() + round.remainingMs;
    get("start-panel").hidden = true;
    ink.hidden = false;
    get("count").textContent = "00";
    selectTool("pen");
    renderKey();
    renderPaper(round.paper);
    phase = "playing";
    updateControls();
    tick();
    timer = setInterval(tick, 100);
  } catch {
    phase = "ready";
    get("start-panel").hidden = false;
    ink.hidden = true;
    updateControls();
    message("無法開始閱卷，請確認 Java 伺服器仍在執行，再試一次。");
  } finally {
    start.disabled = false;
    get("restart").disabled = false;
  }
}

get("grade-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (phase !== "playing") return;
  if (performance.now() >= deadline) {
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
    const data = await api(`${round.id}/submit`, "POST", `${paper.number},${score}`);
    if (data.finished) {
      showResults(data.result);
      return;
    }
    deadline = performance.now() + data.remainingMs;
    get("count").textContent = String(data.count).padStart(2, "0");
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
    const data = await api(`${round.id}/results`);
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

function showResults(data) {
  clearInterval(timer);
  phase = "finished";
  updateControls();
  updateClock(0);
  message();
  submit.type = "submit";
  submit.textContent = "下一張 →";
  get("count").textContent = String(data.count).padStart(2, "0");
  get("result-title").textContent = data.title;
  get("rating").textContent = data.score;
  get("result-stats").textContent = `交件 ${data.count} 張・分數正確 ${data.correct} 張・正確率 ${data.accuracy}%`;
  get("achievement").textContent = achievementBook.record(data, round.subject);
  const grades = get("grade-list");
  grades.replaceChildren();
  data.grades.forEach(({ number, entered, expected }) => {
    const row = document.createElement("li");
    row.textContent = `第 ${number} 張　給 ${entered} 分／應得 ${expected} 分`;
    grades.append(row);
  });
  get("review").hidden = data.count === 0;
  get("review").open = false;
  results.showModal();
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

function point(event) {
  const box = ink.getBoundingClientRect();
  return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height];
}

function clearInk() {
  strokes = [];
  activeStroke = undefined;
  activePointer = undefined;
  redrawInk();
  updateControls();
}

ink.addEventListener("pointerdown", event => {
  if (phase !== "playing" || activeStroke || event.button !== 0) return;
  event.preventDefault();
  ink.setPointerCapture(event.pointerId);
  activePointer = event.pointerId;
  activeStroke = { points: [point(event)], tool };
  strokes.push(activeStroke);
  redrawInk();
  updateControls();
});
ink.addEventListener("pointermove", event => {
  if (event.pointerId !== activePointer || phase !== "playing") return;
  const events = event.getCoalescedEvents?.();
  for (const sample of events?.length ? events : [event]) activeStroke.points.push(point(sample));
  redrawInk();
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
  ink.addEventListener(type, event => {
    if (event.pointerId !== activePointer) return;
    activeStroke = undefined;
    activePointer = undefined;
  });
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
start.addEventListener("click", startRound);
get("restart").addEventListener("click", startRound);
submit.addEventListener("click", () => {
  if (submit.type === "button") {
    submit.disabled = true;
    finish();
  }
});
results.addEventListener("cancel", event => event.preventDefault());

for (const id of ["answer-key", "student-answers"]) renderExam(get(id), [], []);
grade.addEventListener("input", () => {
  setGrade(grade.value.replace(/[^0-9]/g, "").slice(0, 3));
  message();
});
keypad.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button || phase !== "playing") return;
  if (button.dataset.edit === "clear") setGrade("");
  else if (button.dataset.edit === "back") setGrade(grade.value.slice(0, -1));
  else if (grade.value.length < 3) setGrade(grade.value + button.dataset.digit);
  message();
});
