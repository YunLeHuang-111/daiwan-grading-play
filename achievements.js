"use strict";

const achievementBook = (() => {
  const storageKey = "daiwan-grading-titles-v1";
  const categories = [
    { id: "first", label: "初到教室", titles: [
      "見習老師", "眼花撩亂", "鐘響才開筆", "迷路的紅筆", "教室新面孔", "閱卷冒險家",
      "答案卷偵探", "遲到的批改員", "粉筆灰同學", "分數格迷航", "值日生代班", "重整書桌",
      "空白卷守門員", "橡皮擦救兵", "紅圈練習生", "眼鏡找不到", "試卷雪崩", "手忙腳亂代課員",
      "鐘聲突襲", "閱卷大冒險", "答案翻反了", "講桌迷路王", "分數格留白", "筆帽失蹤事件",
      "鐘樓旁的菜鳥", "考卷方向感", "走廊見習生", "座號追蹤員", "亂中找題號", "教室慢半拍",
      "筆尖打結", "下課鐘驚醒", "教室找北王", "得分格失憶", "第一排小迷糊",
      "白紙研究員", "忘記換卷", "講桌緩衝中", "改卷開場白", "粉筆盒旁的菜鳥",
    ] },
    { id: "training", label: "紅筆練習", titles: [
      "實習老師", "改卷新星", "紅筆起手式", "分數捕手", "講台助教", "清晨備課人",
      "雙欄探險家", "是非辨識員", "下一張學徒", "下課前補位", "段考新幹部", "分數小郵差",
      "桌角的紅圈", "閱卷簿實習生", "補救行動派", "鋼筆班長", "小考守望者", "考卷整隊員",
      "黑板角落高手", "抄表不慌張", "紅筆加速中", "答案卷搭檔", "午後小助教", "十分十分數",
      "題號點名員", "實習課代表", "走廊巡卷員", "整點閱卷員", "橡皮擦副手", "換卷節奏感",
      "墨水點點名", "書桌實戰派", "對卷新兵", "課後練筆生", "考卷搬運員",
      "得分欄初探", "紅筆觀察員", "文具室小幫手", "翻頁練習生", "短鐘接力員",
    ] },
    { id: "skilled", label: "熟練教師", titles: [
      "資深教師", "班級定心丸", "改卷熟面孔", "紅筆領班", "段考班導", "得分欄管家",
      "題號導航員", "書桌整理師", "筆尖指揮官", "教室調度員", "答案簿編輯", "分數鑑定員",
      "卷堆降落傘", "不慌的導師", "週會紅筆長", "作業回收隊長", "講台定海針", "分數格守護者",
      "對答案節拍器", "墨水紀錄員", "半堂課救星", "教室秩序官", "下課前好手", "閱卷老同學",
      "桌面文具長", "小考總管", "藍字翻譯官", "定期評量管家", "評分尺規師", "卷面整備長",
      "雙欄帶隊官", "校鐘節拍師", "批卷領航員", "八科熟路人", "評量定盤星",
      "課堂收卷手", "改卷副總管", "墨水守備員", "卷面調音官", "教案旁的老手",
    ] },
    { id: "ace", label: "閱卷高手", titles: [
      "改卷神手", "紅筆狙擊手", "一眼看穿", "分數神準", "筆尖疾風", "考卷拆彈員",
      "紅圈達人", "講桌上的快手", "鐘聲前的逆襲", "段考尖兵", "答案風向標", "二欄閃電",
      "分數調音師", "筆跡識讀王", "閱卷飛毛腿", "速批藝術家", "走廊風雲人物", "考卷分流師",
      "紅筆接力王", "得分欄獵人", "藍墨透視眼", "紙堆穿梭者", "末秒補位王", "評分節奏王",
      "判分神投手", "教室紅筆隊長", "閱卷短跑選手", "錯題捕風人", "評量擂台主", "鐘前交卷王",
      "疾速判分官", "考卷轉場王", "八科快譯員", "題號瞬讀者", "紅筆進攻隊",
      "下課鐘對手", "卷面破風手", "得分即時通", "準度優等生", "答卷巡迴高手",
    ] },
    { id: "legend", label: "校園傳奇", titles: [
      "教務處傳說", "校園紅筆冠軍", "滿分鑑定師", "閱卷界大前輩", "鐘聲也追不上", "紅筆天花板",
      "段考殿堂會員", "分數封印師", "教室無影手", "改卷宇宙第一排", "教務處金章", "考卷山頂的人",
      "筆尖大宗師", "閱卷大滿貫", "分數守門神", "班導名人堂", "答案預言家", "筆跡鑑識傳人",
      "校鐘對決優勝", "分數無差錯", "閱卷白金手套", "講台的紅色閃電", "段考傳奇裁判", "紅筆不敗金牌",
      "卷首王者", "教室的最後王牌", "教務處榮譽顧問", "紙堆征服者", "紅筆榮譽校友", "全校老師都知道",
      "八科金牌教練", "紅筆至尊裁判", "校鐘終結者", "段考零失誤", "課桌首席評審",
      "墨水紀錄保持者", "卷面名人錄", "教務處王牌導師", "筆尖永動機", "跨科閱卷宗師",
    ] },
  ];

  const endings = categories.flatMap((category, group) =>
    category.titles.map((title, index) => ({
      id: `${category.id}:${index}`,
      title, category: category.id, label: category.label,
      number: String(group * category.titles.length + index + 1).padStart(3, "0"),
    })));

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

  filter.add(new Option("全部稱號", "all"));
  for (const { id, label } of categories) filter.add(new Option(label, id));

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
      if (filter.value !== "all" && filter.value !== ending.category) continue;
      const seen = unlocked.has(ending.id);
      const item = document.createElement("li");
      item.classList.toggle("unlocked", seen);
      const label = document.createElement("span");
      label.className = "ending-code";
      label.textContent = `NO. ${ending.number} · ${ending.label}`;
      const title = document.createElement("strong");
      title.textContent = ending.title;
      const status = document.createElement("span");
      status.className = "ending-status";
      status.textContent = seen ? "已收錄" : "待解鎖";
      item.append(label, title, status);
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
    record({ score }, roundId) {
      const group = score >= 95 ? 4 : score >= 80 ? 3 : score >= 60 ? 2 : score >= 30 ? 1 : 0;
      // A round keeps the same title if its results are requested again.
      let hash = 0;
      for (const character of roundId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
      const category = categories[group];
      const ending = catalog.get(`${category.id}:${hash % category.titles.length}`);
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
