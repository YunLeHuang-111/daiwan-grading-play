const browserGame = (() => {
  const names = ["林小宇", "陳羽安", "黃子晴", "張品睿", "李宥希", "王禹彤", "吳冠廷", "劉予樂", "蔡以恩", "許芷寧"];
  const questionsPerType = 5;
  const perfectPaperCount = 12;
  let banks;

  async function loadBanks() {
    if (banks) return banks;
    const response = await fetch("./questions.tsv?v=subject-bank");
    if (!response.ok) throw new Error("題庫載入失敗，請再試一次。");
    const grouped = new Map();
    for (const line of (await response.text()).split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [subject, answer, prompt, extra] = line.split("\t");
      if (!subject || !/^[ABCDOX]$/.test(answer) || !prompt || extra !== undefined) {
        throw new Error("題庫格式錯誤。");
      }
      if (!grouped.has(subject)) grouped.set(subject, { subject, choice: [], trueFalse: [] });
      const bank = grouped.get(subject);
      const group = "ABCD".includes(answer) ? bank.choice : bank.trueFalse;
      group.push([prompt, answer]);
    }
    const loaded = [...grouped.values()];
    if (!loaded.length || loaded.some(bank =>
      bank.choice.length < questionsPerType || bank.trueFalse.length < questionsPerType)) {
      throw new Error("題庫題目不足。");
    }
    banks = loaded;
    return banks;
  }

  function sampleQuestions(bank) {
    const pool = [...bank];
    for (let i = 0; i < questionsPerType; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, questionsPerType);
  }

  const pick = items => items[Math.floor(Math.random() * items.length)];
  let round;

  function nextPaper() {
    const probability = .35 + Math.random() * .62;
    const answers = round.key.map((answer, index) => {
      const choices = index < questionsPerType ? "ABCD" : "OX";
      return Math.random() < probability ? answer : pick(choices.replace(answer, ""));
    });
    const number = round.grades.length + 1;
    return { number, name: names[(number - 1) % names.length], answers };
  }

  function results() {
    const grades = round.grades.slice();
    const count = grades.length;
    const correct = grades.filter(({ entered, expected }) => entered === expected).length;
    const accuracy = count ? correct / count : 0;
    const pace = Math.min(count / perfectPaperCount, 1);
    const ceiling = count >= perfectPaperCount && correct === count ? 100 : 99;
    const score = Math.min(ceiling, Math.round(100 * accuracy * accuracy * (.25 + .75 * pace)));
    const title = score >= 95 ? "教務處傳說" : score >= 80 ? "紅筆神手" :
      score >= 60 ? "資深導師" : score >= 30 ? "實習老師" : "改卷見習生";
    return { score, title, count, correct, accuracy: Math.round(accuracy * 100), grades };
  }

  return async (path, method, body) => {
    if (path === "start" && method === "POST") {
      if (body && !["timed", "practice"].includes(body)) throw new Error("找不到此遊玩模式");
      const practice = body === "practice";
      const { subject, choice, trueFalse } = pick(await loadBanks());
      const questions = [...sampleQuestions(choice), ...sampleQuestions(trueFalse)];
      round = {
        id: crypto.randomUUID(),
        end: practice ? null : performance.now() + 60000,
        practice,
        finished: false,
        key: questions.map(([, answer]) => answer),
        grades: [],
      };
      round.paper = nextPaper();
      return { id: round.id, subject, key: round.key,
        prompts: questions.map(([prompt]) => prompt), remainingMs: practice ? null : 60000, practice, paper: round.paper };
    }
    const [id, action] = path.split("/");
    if (id !== round?.id) throw new Error("找不到這一局，請重新開始。");
    const remainingMs = round.practice ? null : Math.max(0, round.end - performance.now());
    if (round.practice && action === "finish" && method === "POST") {
      round.finished = true;
      return results();
    }
    if (action === "results") {
      if (round.finished || remainingMs === 0) return results();
      if (round.practice) throw new Error("請先結束練習");
      return { remainingMs };
    }
    if (action !== "submit" || method !== "POST") throw new Error("找不到此操作。");
    if (!/^[1-9][0-9]*,(?:100|[0-9]{1,2})$/.test(body)) throw new Error("請填入 0 到 100 的整數。");
    if (round.finished || remainingMs === 0) return { finished: true, result: results() };
    const [number, entered] = body.split(",").map(Number);
    if (number !== round.paper.number) throw new Error("這張考卷已交件，請重新開始。");
    const expected = 10 * round.paper.answers.filter((answer, index) => answer === round.key[index]).length;
    round.grades.push({ number, entered, expected });
    round.paper = nextPaper();
    return { remainingMs, count: round.grades.length, paper: round.paper };
  };
})();
