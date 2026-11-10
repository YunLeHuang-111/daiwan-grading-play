"use strict";

const achievementBook = (() => {
  const categories = [
    { key: "rounds", title: "教室日常", goal: "完成遊戲", unit: "局", tiers: [1, 2, 3, 5, 8, 12, 16, 20, 25, 35, 50, 70, 100, 150, 200] },
    { key: "papers", title: "考卷山", goal: "累計交件", unit: "張", tiers: [1, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 450, 600, 800, 1000] },
    { key: "correct", title: "紅筆準星", goal: "累計給對分數", unit: "張", tiers: [1, 3, 8, 15, 25, 40, 60, 90, 125, 175, 250, 350, 500, 700, 900] },
    { key: "points", title: "榮譽集點", goal: "累計取得遊戲分數", unit: "分", tiers: [25, 75, 150, 250, 400, 600, 850, 1200, 1600, 2200, 3000, 4200, 6000, 8000, 10000] },
    { key: "perfect", title: "一分不差", goal: "至少交兩張且全對", unit: "局", tiers: [1, 2, 3, 4, 6, 8, 10, 15, 20, 25, 35, 50, 70, 100, 150] },
    { key: "honors", title: "教務處榜單", goal: "取得 80 分以上", unit: "局", tiers: [1, 2, 3, 4, 5, 7, 10, 14, 19, 25, 35, 50, 70, 90, 120] },
    { key: "streak", title: "連續命中", goal: "單局連續給對分數", unit: "張", tiers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] },
    { key: "國文", title: "國文小老師", goal: "國文卷累計給對分數", unit: "張", tiers: [1, 3, 5, 8, 12, 18, 25, 35, 50, 70, 95, 125, 160, 200, 250] },
    { key: "英文", title: "英文小老師", goal: "英文卷累計給對分數", unit: "張", tiers: [1, 3, 5, 8, 12, 18, 25, 35, 50, 70, 95, 125, 160, 200, 250] },
    { key: "數學", title: "數學小老師", goal: "數學卷累計給對分數", unit: "張", tiers: [1, 3, 5, 8, 12, 18, 25, 35, 50, 70, 95, 125, 160, 200, 250] },
  ];
  const ranks = ["初登場", "熱身", "起跑", "熟手", "亮眼", "進階", "好身手", "銅星", "銀星", "金星", "白金", "翡翠", "鑽石", "明星", "傳說"];
  const storageKey = "daiwan-grading-collection-v1";
  const stats = Object.fromEntries(categories.map(({ key }) => [key, 0]));
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    for (const key of Object.keys(stats)) {
      if (Number.isSafeInteger(saved?.[key]) && saved[key] >= 0) stats[key] = saved[key];
    }
  } catch {
    // Progress remains available in memory when browser storage is unavailable.
  }

  const dialog = document.getElementById("achievement-dialog");
  const filter = document.getElementById("achievement-category");
  const total = categories.reduce((sum, { tiers }) => sum + tiers.length, 0);
  const count = () => categories.reduce((sum, { key, tiers }) =>
    sum + tiers.filter(goal => stats[key] >= goal).length, 0);

  filter.add(new Option("全部成就", "all"));
  for (const { key, title } of categories) filter.add(new Option(title, key));

  function updateTotal() {
    document.getElementById("achievement-total").textContent = `${count()} / ${total}`;
  }

  function render() {
    document.getElementById("collection-summary").textContent = `已解鎖 ${count()} / ${total} 項・進度保存在此瀏覽器`;
    const list = document.getElementById("achievement-list");
    list.replaceChildren();
    for (const { key, title, goal, unit, tiers } of categories) {
      if (filter.value !== "all" && filter.value !== key) continue;
      tiers.forEach((target, index) => {
        const unlocked = stats[key] >= target;
        const item = document.createElement("li");
        item.classList.toggle("unlocked", unlocked);
        const name = document.createElement("strong");
        name.textContent = `${title}・${ranks[index]}`;
        const progress = document.createElement("span");
        progress.textContent = `${goal} ${target} ${unit}　${unlocked ? "✓ 已解鎖" : `${stats[key]} / ${target}`}`;
        item.append(name, progress);
        list.append(item);
      });
    }
  }

  filter.addEventListener("change", render);
  for (const button of document.querySelectorAll("[data-open-achievements]")) {
    button.addEventListener("click", () => {
      render();
      dialog.showModal();
    });
  }
  updateTotal();

  return {
    record(data, subject) {
      const before = count();
      stats.rounds += 1;
      stats.papers += data.count;
      stats.correct += data.correct;
      stats.points += data.score;
      if (data.count >= 2 && data.correct === data.count) stats.perfect += 1;
      if (data.score >= 80) stats.honors += 1;
      if (Object.hasOwn(stats, subject)) stats[subject] += data.correct;
      let streak = 0;
      for (const { entered, expected } of data.grades) {
        streak = entered === expected ? streak + 1 : 0;
        stats.streak = Math.max(stats.streak, streak);
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify(stats));
      } catch {
        // The collection can still be viewed during this session.
      }
      updateTotal();
      if (dialog.open) render();
      const gained = count() - before;
      return gained ? `解鎖 ${gained} 項新成就・共 ${count()} / ${total}` : `成就進度 ${count()} / ${total}`;
    },
  };
})();
