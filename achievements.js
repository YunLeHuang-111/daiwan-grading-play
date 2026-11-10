"use strict";

const achievementBook = (() => {
  const subjects = ["國文", "英文", "數學"];
  const storageKey = "daiwan-grading-endings-v1";
  const profiles = [
    { id: "miss", title: "紅筆大迷航", rule: "給分全部錯誤" },
    { id: "rescue", title: "下課前補救", rule: "正確率高於 0%、未滿 50%" },
    { id: "steady", title: "漸入佳境", rule: "正確率至少 50%、未滿 80%" },
    { id: "close", title: "差一點封神", rule: "正確率至少 80%、未滿 100%" },
    { id: "perfect", title: "紅筆全中", rule: "給分全部正確" },
  ];

  function profileFor(count, correct) {
    if (correct === 0) return profiles[0];
    if (correct === count) return profiles[4];
    if (correct * 2 < count) return profiles[1];
    if (correct * 5 < count * 4) return profiles[2];
    return profiles[3];
  }

  const endings = subjects.flatMap((subject, subjectIndex) => {
    const book = [{ id: `${subject}:0:0`, title: "下課鐘比紅筆快", rule: "本局沒有交件" }];
    for (let count = 1; count <= 8; count++) {
      for (let correct = 0; correct <= count; correct++) {
        const profile = profileFor(count, correct);
        book.push({
          id: `${subject}:${count}:${correct}`,
          title: `${count} 張卷・${profile.title}${correct > 0 && correct < count ? `（對 ${correct}）` : ""}`,
          rule: `交件 ${count} 張，其中 ${correct} 張給分正確`,
        });
      }
    }
    for (const profile of profiles) {
      book.push({
        id: `${subject}:rush:${profile.id}`,
        title: `考卷山・${profile.title}`,
        rule: `交件至少 9 張，${profile.rule}`,
      });
    }
    return book.map((ending, index) => ({
      ...ending, subject, number: String(subjectIndex * book.length + index + 1).padStart(3, "0"),
    }));
  });

  const catalog = new Map(endings.map(ending => [ending.id, ending]));
  const unlocked = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved)) {
      for (const id of saved) if (catalog.has(id)) unlocked.add(id);
    }
  } catch {
    // The collection remains available in memory.
  }

  const dialog = document.getElementById("achievement-dialog");
  const filter = document.getElementById("achievement-category");
  const list = document.getElementById("achievement-list");

  filter.add(new Option("全部科目", "all"));
  for (const subject of subjects) filter.add(new Option(`${subject}結局`, subject));

  function updateTotal() {
    document.getElementById("achievement-total").textContent = `${unlocked.size} / ${catalog.size}`;
  }

  function render() {
    document.getElementById("collection-summary").textContent = `已收錄 ${unlocked.size} / ${catalog.size} 個結局`;
    const progress = document.getElementById("collection-progress");
    progress.max = catalog.size;
    progress.value = unlocked.size;
    list.replaceChildren();
    for (const ending of endings) {
      if (filter.value !== "all" && filter.value !== ending.subject) continue;
      const seen = unlocked.has(ending.id);
      const item = document.createElement("li");
      item.classList.toggle("unlocked", seen);
      const label = document.createElement("span");
      label.className = "ending-code";
      label.textContent = `NO. ${ending.number} · ${ending.subject}`;
      const title = document.createElement("strong");
      title.textContent = ending.title;
      const rule = document.createElement("span");
      rule.textContent = ending.rule;
      const status = document.createElement("span");
      status.className = "ending-status";
      status.textContent = seen ? "已收錄" : "待解鎖";
      item.append(label, title, rule, status);
      list.append(item);
    }
    list.scrollTop = 0;
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
    record({ count, correct }, subject) {
      const key = count <= 8 ? `${count}:${correct}` : `rush:${profileFor(count, correct).id}`;
      const ending = catalog.get(`${subject}:${key}`);
      const isNew = !unlocked.has(ending.id);
      if (isNew) {
        unlocked.add(ending.id);
        try {
          localStorage.setItem(storageKey, JSON.stringify([...unlocked]));
        } catch {
          // Keep the unlocked ending for the current session.
        }
      }
      updateTotal();
      if (dialog.open) render();
      return { ending, isNew };
    },
  };
})();
