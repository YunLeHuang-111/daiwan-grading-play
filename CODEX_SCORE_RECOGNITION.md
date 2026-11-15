# Codex 實作規格：〈老師，我幾分！〉手寫分數 CNN 辨識版

> **請 Codex 實際修改程式並完成測試，不只給建議或架構圖。** 這份文件是針對既有網頁遊戲的功能增量開發，不是重做一個新遊戲。
>
> 目標儲存庫：<https://github.com/YunLeHuang-111/daiwan-grading-play>  
> 查閱基準：`main`，commit `fce3c17184108be81021abf5ce4b82150ad75494`（2026-11-12）。實作前先確認最新程式與本文件的差異，以實際程式為準。  


## 0. 任務定義與不可變更的遊戲規則

玩家扮演老師，在網頁版考卷上用紅筆批改答案，並在**學生考卷右上角的分數書寫區**手寫總分。系統從**現有紅筆 Canvas 的指定 ROI（Region of Interest）**取得筆跡，用**真正的預訓練 CNN** 辨識數字，讓玩家確認後按「下一張」提交。

必須保留：單科／多科／練習模式、題庫 `questions.tsv`、每題 10 分、計時、紅筆／橡皮擦／復原／清除、答案卷、交卷換科、成績計算、成就系統、已批改考卷縮圖與放大、手機／平板佈局以及 GitHub Pages 靜態部署。不增加必須持續運作的 Python、Node、Flask、FastAPI 伺服器，不將整張考卷上傳外部 OCR API。

**合法分數**：`[0,10,20,30,40,50,60,70,80,90,100]`。雖然主要需求是 10～100，但現有遊戲可能出現全錯的 0 分，且按鍵版已支援 0，因此 0 也必須保留。不得預設玩家寫的分數就是標準答案；模型預測只能來自筆跡影像，不能偷看 `expected`。

## 1. 已確認的現有實作（請定位後再改）

| 檔案／位置 | 現況 | 應做的事 |
| --- | --- | --- |
| `index.html` 第 67–90 行附近 | `#score-preview`、0～100 的 `#keypad`、`#submit` | 改以手寫辨識為主要給分方式；舊按鍵藏在「改用按鈕輸入」備援中 |
| `index.html` 第 116–122 行附近 | `.paper.student`、`#student-heading`、`#ink` | 為**學生卷右上角**增設清楚、足夠大的手寫分數 ROI，與 `#ink` 對齊 |
| `index.html` 第 132–144 行附近 | `#exam-heading` 範本：`td[data-field="score"]` | 作為定位右上角得分欄的 DOM 錨點，答案卷同名元素不可被誤抓 |
| `game.js` 第 9–10、162–176 行附近 | `field(...)`、`selectedScore`、`setGrade()`、`renderPaper()` | 加入辨識候選值、玩家確認、換卷時清除舊結果 |
| `game.js` 第 257–299 行附近 | `#grade-form` submit → `rememberPaper(score)` → `browserGame(.../submit)` | 只有辨識且確認成功，或使用手動備援後，才能送出有效分數 |
| `game.js` 第 322–340、363–392 行附近 | 複製考卷 DOM、用 `ink.toDataURL()` 保存紅筆軌跡 | 保留手寫給分筆跡，確認成績單縮圖／放大頁不重疊、不消失 |
| `game.js` 第 471–519 行附近 | `resizeInk()`、`paintInk()`、`redrawInk()`、`clearInk()` | 優先重用 Canvas 畫筆與橡皮擦；正確裁切 ROI；更新筆跡時使舊辨識失效 |
| `game.js` 第 600–743 行附近 | Pointer / Touch / Apple Pencil 事件與復原／清除 | 不破壞原有多裝置筆跡輸入功能 |
| `style.css` 第 79–94 行附近 | `.paper`、`.exam-heading`，最右分數欄約 11.7% 寬、列高 33px | **現有格子太窄，尤其手機**；需設計足以寫 `100` 的可視書寫區 |
| `style.css` 第 358–420 行附近 | `.phone-layout`、考卷縮放 transform、手機工具列 | 修正 ROI 在 CSS 縮放、DPR、畫面變更時的幾何換算 |
| `browser-game.js` 第 111–117 行附近 | 接收 `${paper.number},${score}`，計算 `expected` | 保留 API 介面和結算邏輯；補強分數必須是 0～100、10 的倍數的驗證 |

`README.md` 明確指出此專案是原生 HTML/CSS/JS 的 GitHub Pages 遊戲，不能假設有 React、Vite、Python 後端或現成 npm 管理。請優先採**最小侵入式**實作。

## 2. 模型方案：確實使用開源預訓練 CNN

**首選模型：ONNX Model Zoo / `onnxmodelzoo/mnist-12`**，是已訓練好的手寫單字元 CNN，不是 OpenCV 形狀比對、Tesseract OCR、隨機權重，也不是假裝 AI 的規則。ONNX 模型約 26 KB，適合在瀏覽器用 ONNX Runtime Web（WebAssembly）推論。

- 模型頁：<https://huggingface.co/onnxmodelzoo/mnist-12>
- ONNX 檔案頁：<https://huggingface.co/onnxmodelzoo/mnist-12/blob/main/mnist-12.onnx>
- 可供 Codex 下載的模型連結：`https://huggingface.co/onnxmodelzoo/mnist-12/resolve/main/mnist-12.onnx`
- 上游模型說明：<https://github.com/onnx/models/blob/main/validated/vision/classification/mnist/README.md>
- ONNX Runtime Web 官方入門：<https://onnxruntime.ai/docs/get-started/with-javascript/web.html>
- Microsoft 無打包器 script-tag 範例：<https://github.com/microsoft/onnxruntime-inference-examples/blob/main/js/quick-start_onnxruntime-web-script-tag/index.html>
- Hugging Face 檔案頁顯示的 SHA-256：`5c688690f8bacf667d4c2074af5ad0646ca328d7ab03eccf944a65b320171bdd`。下載後比對 SHA；不符時不得直接部署。

**重要限制**：此模型只分類一個數字 `0`～`9`，**不是**直接辨識 10／20／100。必須自行做多字元分割、逐字分類、由左到右組合及合法分數檢查。原模型作者提供的約 1.1% top-1 error 是 MNIST 單字元基準，**不可宣稱本遊戲手寫多位數也達同樣準確率**。若初版切割不夠準，先顯示「無法確認」並讓玩家手動選分，不可假造辨識成功。

**開源授權查核**：上游 MNIST 模型 README 末尾註明 MIT，該檔 SPDX 也標 MIT；ONNX Model Zoo 倉庫根 LICENSE 為 Apache-2.0，Hugging Face 模型頁標示 Apache-2.0。Codex 在分發權重前應核對實際適用授權，保留權利聲明、原始來源與所需授權檔於 `third_party/` 或 `THIRD_PARTY_NOTICES.md`，不可把這幾種標示當作不存在的問題。ONNX Runtime Web 本身也需遵守其授權。

### 模型介面

- 預設檔案：`models/score-recognition/mnist-12.onnx`，與網站一起部署，**推論時不依賴從 Hugging Face 即時抓權重**。
- 使用 `onnxruntime-web`；選一個確認可用的固定版本，確保 JS 和 `.wasm` 同版；可以固定 CDN URL 或將 runtime 靜態檔一併放在 `vendor/`。不得使用無版本的 `latest`。
- 啟動時在瀏覽器非阻塞預載模型；失敗則友善提示，仍可用手動分數按鍵繼續遊戲。
- 模型輸入：`Float32`、shape `[1,1,28,28]`、灰階、黑底白字、值域 `[0,1]`。
- 模型輸出：10 個數字的 logits，需執行**數值穩定 softmax**，取得每字機率；輸入／輸出 tensor 名稱從 `session.inputNames`／`session.outputNames` 讀取，勿猜名稱。
- `InferenceSession` 初始化一次、重用整局；每次辨識分割出的 1～3 位數即可。避免每筆 PointerMove 都重新推論。

## 3. UI 與遊玩互動（主要流程）

1. 遊戲開始後，在學生考卷右上角清楚顯示「**請在此寫總分（紅筆）**」及可手寫的分數區。得分欄定位從 `#student-heading [data-field="score"]` 或其對應的專用 `#score-write-zone` 取得，**絕對不能硬寫「網頁右上角 15%」之類座標**。
2. 由於原本 `td[data-field="score"]` 桌面約 11.7% 欄寬、手機更小，不能只在舊狹小單元格加虛線便宣稱完成：請在**學生考卷頂部右側、緊鄰得分欄**提供真正足以寫 3 位數的**擴大書寫區**（桌面／平板建議至少約 96×60 CSS px；手機依空間自適應，必要時提供「放大書寫分數」的可返回輸入區）。不覆蓋姓名、題目，原紙面仍可批改。
3. 玩家照常用既有紅筆 `#ink` 寫，例如 `80` 或 `100`。圈選、打叉、其他批改註記不應算進分數區辨識。
4. 點「**辨識分數**」後才取樣 ROI；顯示「辨識中…」狀態。讀到高信心合法分數時顯示「辨識到 **80 分**」，並提供「**確認使用 80 分**」按鈕。不得自動直接交卷。
5. 玩家確認後才呼叫既有 `setGrade(80)`，更新 `#score-preview`，再按原本「下一張」走 `grade-form` 提交。
6. 空白、筆跡不明、非法數值（例如 85、110）、模型讀取失敗、字元切不開時顯示「無法確認分數，請重寫或手動選擇」，**不要強行將 85 變成 80，也不要猜標準答案**。
7. 「**重新寫分數**」只清除 ROI 內分數筆跡，不能擦掉整張考卷上其他批改；「清除全部」沿用原有語意。觸發 undo／eraser／clear 或重寫後，任何舊辨識結果與確認狀態必須失效，避免辨識 `70` 後改成 `80` 仍送出 `70`。
8. 保留原 `#keypad`，預設收合，只在「**辨識失敗／改用按鈕輸入**」時展開作為備援。使用時明確顯示來源「手動分數」。模型不可用也必須能完成一局。
9. 換下一張、重新開始、模式切換、時間到、交卷結算都要清除候選分數及非同步工作狀態。練習／手機／平板模式須一致。
10. 更新新手教學的「給分交卷」步驟，避免還告訴玩家一定要按數字鍵。

## 4. ROI 擷取與影像處理：只看紅筆，不能讀考卷底圖

**來源必須是 `#ink` 的透明紅筆層或從既有 `strokes` 還原出的獨立筆跡層**，不是對整張網頁截圖；因此表格黑框、姓名、藍色答案、黑字題幹都不會污染辨識。

### 4.1 DOM 定位與 Canvas 像素座標

用 `scoreZone.getBoundingClientRect()`、`ink.getBoundingClientRect()` **在同一時刻**量得實際視覺矩形（包含 CSS transform），再換成 canvas bitmap 像素：

```js
const inkRect = ink.getBoundingClientRect();
const zoneRect = scoreZone.getBoundingClientRect();
const sx = ink.width / inkRect.width;
const sy = ink.height / inkRect.height;
const x = Math.floor((zoneRect.left - inkRect.left) * sx);
const y = Math.floor((zoneRect.top - inkRect.top) * sy);
const width = Math.ceil(zoneRect.width * sx);
const height = Math.ceil(zoneRect.height * sy);
// 加入小幅 padding，並將 ROI 與 canvas bitmap 邊界交集 clamp 後才 getImageData。
```

考量 `#ink` 在 `resizeInk()` 會依 DPR 重建位圖，且 `.phone-layout` 的 `.paper` 會 `transform: scale(...)`，**禁止用固定 28、32、500、800 之類像素指定分數 ROI**；請實測 DPR=1/2/3、手機縮放、橫直切換，避免 crop 偏移或裁掉 100。

若另用放大手寫視窗，視窗筆跡需在確認前同步映射回考卷頂部 ROI 的繪圖層，使結果頁仍顯示玩家實際寫的紅字；不可只在視窗顯示分數而考卷上留白。需和 `strokes`、undo、橡皮擦的存取一致。

### 4.2 多位數影像前處理與切割

1. 讀取 ROI RGBA，以 alpha（或紅筆覆蓋）抽出前景。透明區＝黑底、紅筆軌跡＝白前景。橡皮擦已生效的像素不能再算前景。
2. 在前景 mask 中做噪音濾除、找非空 bounding box、加留白。若前景像素不足，回傳 `empty`，不推論。
3. 使用垂直投影與連通區域分群初步切割，依 X 方向左至右排序；勿把一個 `0` 切成左右兩半。對於小的分離筆畫（例如 `4`）做合理合併，對黏在一起的數字可用投影谷值／候選分割搜尋。**沒有可靠切割就回傳 low_confidence**，不可假裝辨識成功。
4. 每個字元保持長寬比，縮放至約 20×20 前景區，放置在 28×28 黑底中央（必要時以像素重心對齊），輸入 MNIST-12。
5. 依序組合成原始字串（例如 `"100"`）。只接受合法字串 `"0"`, `"10"`, ..., `"100"`，不接受 `"00"`, `"010"`, `"85"`, `"110"` 或空字串。可利用合法候選集輔助分割排序，但**不得無條件將非法原始輸入歸一到合法分數**。
6. 每字信心與整串信心、第一與第二候選差距應評估；先使用可設定門檻，建立測試集後校準，不要將神奇閾值寫死當成已驗證準確率。
7. 如需調整筆刷粗細／取樣品質，可只在 ROI 內的筆畫做離屏放大渲染；不得改壞其他考卷批改線條。

建議提供純函式以利測試：`getScoreRoiBounds()`、`extractScoreInk()`、`segmentDigits()`、`normalizeDigit28()`、`decodeAllowedScore()`。

## 5. 推論模組 API（建議，請依專案結構微調）

新增 `score-recognizer.js`（或拆成 `score-roi.js`、`score-recognizer.js`），公開一個小而明確的模組，例如：

```js
window.scoreRecognizer = {
  init: async () => { /* load exactly one pretrained ONNX session */ },
  recognize: async ({ inkCanvas, scoreZone }) => ({
    status: 'ok',          // ok | empty | low_confidence | invalid | model_unavailable
    score: 80,             // 其他狀態為 null
    rawText: '80',
    confidence: 0.91,      // 範例值，不是模型實測承諾
    digits: [/* 每個字元的候選／信心，供除錯 */]
  })
};
```

載入順序：`index.html` 中在 `game.js` 之前加上**已鎖版**的 `onnxruntime-web` 與自訂辨識模組；或改為不需新增建置系統的原生 ES module，確保實際瀏覽器能啟動。不要在頁面載入時因模型網路失敗而使整個 `game.js` 失效。

建議用 `phase` + `scoreInkRevision`/request token 管理非同步競態：玩家正在辨識卻又改筆畫、交卷、換紙或時間到時，晚回來的預測不可覆蓋新卷或自動送出。可以在模型 init 期間先開放遊戲，並顯示「CNN 載入中／可用／不可用」。

## 6. 實際建議修改／新增檔案

```text
daiwan-grading-play/
├─ index.html                # 書寫區、辨識/確認/重寫按鈕、隱藏式備援鍵盤、載入模型腳本
├─ style.css                 # 右上角可視 ROI、手機／平板適配、辨識狀態
├─ game.js                   # 沿用既有 canvas/strokes、ROI 裁切、辨識狀態與送出
├─ browser-game.js           # 僅補強合法分數檢查；保留遊戲與評分運算
├─ browser-game.js / achievements.js / questions.tsv  # 非必要不要改動遊戲核心內容
├─ score-recognizer.js       # 新增：ONNX Runtime Web session、逐字 CNN 預測、confidence
├─ score-roi.js              # 建議新增：動態 ROI、二值化、字元切割、28×28 正規化
├─ models/
│  └─ score-recognition/
│     └─ mnist-12.onnx       # 預訓練權重，直接部署 GitHub Pages
├─ THIRD_PARTY_NOTICES.md   # 模型與 runtime 來源、版本、授權、保留必要 notices
├─ tests/
│  ├─ score-recognizer.test.js  # 純函式邊界案例，可用 node:test 或同等工具
│  └─ score-recognition-manual.md # 手寫／手機／平板人工測試紀錄
└─ README.md                # 新玩法、開發方式、模型出處、靜態部署、備援
```

可以微調檔名，但禁止為了這個功能把專案整個重構成另一框架。新資源 URL 在 GitHub Pages 的子路徑 `/daiwan-grading-play/` 下必須正確；請統一用相對於 `index.html` 的 `./...` 路徑。若使用 CDN，固定版號、處理載入失敗及 WASM 同版資源路徑。記得更新 `index.html` 既有快取版本參數，避免 GitHub Pages 用戶載到舊 JS。

## 7. 異常情境／防作弊／可用性

- 未寫分數、只有小墨點、只圈答案、筆畫完全在 ROI 外：不得辨識出分數。
- 寫 `0`：可確認 0 分；寫 `100`：必須支援 3 位數，且不能因區域太窄裁成 `10`。
- 寫 `85`、`110`、負數、非數字：不可「矯正」成最近的十分數，要提示重寫／手動處理。
- 紅筆畫歪、不同筆刷長短、數字連在一起：有測試，無把握就拒辨，不要亂判。
- 旁邊正常批改（○／×／底線）不會進入分數 ROI；ROI 的分數筆跡會保留在紙張快照。
- 復原、橡皮擦、清除、重寫：不可提交過期的 `selectedScore`。
- 模型 404、CDN 失敗、無 WASM、行動裝置記憶體不足：不應阻斷遊戲；有手動備援。
- 倒數時間到時，取消／忽略尚未完成的非同步辨識；既有 `finish()`／結果統計正確。
- 手機單指、Apple Pencil、滑鼠、觸控筆；DPR 1/2/3；版面重排及 `.phone-layout` scale 後裁切座標正確。
- `review-card`、`#paper-view` 保留玩家寫的紅字，既有 `submittedPapers` 內容不因新增 ROI 元素而跑版。
- 做必要的鍵盤、狀態文字 `aria-live`、焦點可見性，讓使用者不靠紅色提示也能理解辨識狀態。

## 8. 必須執行的測試與驗收

### 8.1 單元測試

- `ROI`: 同一張畫布在 DPR 1/2、縮放比例 0.5/1、不同尺寸位置都能只裁到右上角區塊；空白／超出畫布不會拋錯。
- `Segmentation`: 0、10、20、…、90、100 至少有基本測資；單一 0 不拆半、100 不漏最後 0；無墨／噪音／橡皮擦之後回傳正確狀態。
- `Decoding`: 只接受 `[0,10,...,100]`、拒絕 01／85／110／NaN；logits 使用穩定 softmax；低信心不自動確認。
- `Race`: 在推論 pending 時重寫、提交、換卷、逾時不把舊結果套到新卷。

### 8.2 實機／瀏覽器驗收

1. 在 Chrome 桌面、手機版模擬尺寸、實際手機或平板可開始遊戲，題庫仍正常載入。
2. 用滑鼠或觸控筆於**右上角**寫 `10`、`50`、`100`，按「辨識分數」→顯示候選→確認→交卷，結果的 `entered` 值正確。
3. 只在其他題目畫圈，不應獲得辨識分數。
4. 擦掉 ROI 中的 `80` 並改寫 `90`，舊確認狀態失效；改完可重新辨識。
5. 多科、計時、練習模式皆能切卷；錯誤分數仍依原本 `entered === expected` 判斷，不能偷偷依 `expected` 改正。
6. 在 Network 阻擋模型／WASM，仍可用隱藏式按鍵手動完成一局。
7. 已批改考卷總覽與放大頁能看到玩家右上角紅筆分數，頁面不破版。
8. `python3 -m http.server 8080` 可本機運作；GitHub Pages 子路徑無 404。若新增自動化測試，提供可重現的執行指令與測試結果。

### 8.3 量化評估（不要假稱已達成）

建立測試樣本：不同書寫者與滑鼠／手寫筆各寫 0、10～100 的例子，分出未參與調參的測試集。記錄**完整分數字串正確率**、`100` 正確率、拒辨比例、誤判而被高信心確認的比例，以及首載時間／推論耗時。單字元 MNIST 指標不能替代這些結果；資料不足時如實註明。以「錯誤時寧可要求人工確認」優先於盲目提高辨識率。

## 9. Codex 執行順序（請照此順序落地）

1. 讀完整 `README.md`、`index.html`、`style.css`、`game.js`、`browser-game.js`、`achievements.js`；確認分支與原程式現況。
2. 建立功能分支；記錄原有測試／遊玩基線。先讓右上角書寫區**可見、可畫、可清除**，並確認不會破壞整頁紅筆。
3. 取得**真正的預訓練 MNIST-12 ONNX**、驗證檔案 SHA-256、補授權 notices；整合 ONNX Runtime Web，先用單一 28×28 範例驗證模型正確輸入輸出。
4. 實作 ROI 擷取 → 數字分割 → 28×28 前處理 → CNN → 合併分數 → 不確定性處理。
5. 串接辨識／確認／重寫 UI、`setGrade()`、`grade-form`、舊 keypad 備援；更新教學和 README。
6. 測試桌面、手機、瀏覽器縮放、模型載入失敗、時間到、畫筆／橡皮擦／復原與已批改考卷。
7. 整理 diff；回報「新增／修改檔案」「依賴／模型來源」「測試指令」「已實測結果」「尚存限制」。**不能只輸出計畫、不能留下空的 `predict()` stub、不能用固定分數假裝模型結果**。

## 10. 最終交付標準

Codex 應交付一個可以在既有 GitHub Pages 架構下執行的**功能分支／可審查 PR**，其中至少包含：實際 `.onnx` 權重或可重現的正式下載流程、前端 CNN 推論、DOM 定位 ROI、數字切割、使用者確認、可用備援、測試、README 與授權資訊。若模型在真實手寫體上效果不足，保留可工作的辨識＋拒辨＋手動備援 MVP，並提供真實量測與後續可選的「自建 11-class 多位數 CNN」改進路徑，而不是隱瞞模型限制。

---


Codex 應交付一個可以在既有 GitHub Pages 架構下執行的**功能分支／可審查 PR**，其中至少包含：實際 `.onnx` 權重或可重現的正式下載流程、前端 CNN 推論、DOM 定位 ROI、數字切割、使用者確認、可用備援、測試、README 與授權資訊。若模型在真實手寫體上效果不足，保留可工作的辨識＋拒辨＋手動備援 MVP，並提供真實量測與後續可選的「自建 11-class 多位數 CNN」改進路徑，而不是隱瞞模型限制。
