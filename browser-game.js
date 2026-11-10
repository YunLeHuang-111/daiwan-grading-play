const browserGame = (() => {
  const names = ["林小宇", "陳羽安", "黃子晴", "張品睿", "李宥希", "王禹彤", "吳冠廷", "劉予樂", "蔡以恩", "許芷寧"];
  const subjects = ["國文", "英文", "數學"];
  const banks = [[["「杞人憂天」形容什麼？　A 多慮／B 勤奮／C 誠實／D 大方", "A"], ["「鼎」有幾畫？　A 10／B 11／C 12／D 13", "C"], ["哪一個詞表示清晨？　A 黃昏／B 黎明／C 深夜／D 正午", "B"], ["「故鄉」的近義詞？　A 異地／B 旅店／C 校園／D 家鄉", "D"], ["疑問句句尾通常用？　A ！／B ？／C ，／D 。", "B"], ["「高」和「低」是一組反義詞。", "O"], ["「再見」的「再」可以寫成「在」。", "X"], ["「一舉兩得」指做一件事得到兩種好處。", "O"], ["「春眠不覺曉」出自〈靜夜思〉。", "X"], ["「因為……所以……」可以表達因果關係。", "O"]], [["Which word is a fruit?　A desk／B apple／C blue／D bird", "B"], ["I ___ a student.　A is／B be／C are／D am", "D"], ["Plural of child?　A children／B childs／C childes／D child", "A"], ["Opposite of hot?　A fast／B tall／C cold／D dry", "C"], ["She ___ books.　A read／B reading／C reads／D have read", "C"], ["Yesterday refers to the day before today.", "O"], ["The past tense of go is goed.", "X"], ["An hour is the correct phrase.", "O"], ["There are seven days in a week.", "O"], ["Their and there always mean the same thing.", "X"]], [["7 × 8 = ?　A 48／B 54／C 56／D 64", "C"], ["3² + 4² = ?　A 12／B 25／C 49／D 7", "B"], ["1/2 + 1/4 = ?　A 3/4／B 2/6／C 1/8／D 1/6", "A"], ["哪個是質數？　A 9／B 15／C 21／D 13", "D"], ["80 的 25% 是？　A 10／B 20／C 25／D 40", "B"], ["0 是偶數。", "O"], ["1 公尺等於 10 公分。", "X"], ["平面三角形的內角和是 180°。", "O"], ["所有偶數都是 4 的倍數。", "X"], ["正方形的四個角都是直角。", "O"]]];
  const pick = items => items[Math.floor(Math.random() * items.length)];
  let round;

  function nextPaper() {
    const probability = .35 + Math.random() * .62;
    const answers = round.key.map((answer, index) => {
      const choices = index < 5 ? "ABCD" : "OX";
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
    const score = Math.round(100 * accuracy * (.4 + .6 * Math.min(count / 6, 1)));
    const title = score >= 95 ? "教務處傳說" : score >= 80 ? "紅筆神手" :
      score >= 60 ? "資深導師" : score >= 30 ? "實習老師" : "改卷見習生";
    return { score, title, count, correct, accuracy: Math.round(accuracy * 100), grades };
  }

  return async (path, method, body) => {
    if (path === "start" && method === "POST") {
      if (body && !["timed", "practice"].includes(body)) throw new Error("找不到此遊玩模式");
      const practice = body === "practice";
      const subjectIndex = Math.floor(Math.random() * subjects.length);
      const questions = banks[subjectIndex];
      round = {
        id: crypto.randomUUID(),
        end: practice ? null : performance.now() + 60000,
        practice,
        finished: false,
        key: questions.map(([, answer]) => answer),
        grades: [],
      };
      round.paper = nextPaper();
      return { id: round.id, subject: subjects[subjectIndex], key: round.key,
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
