# 老師，我幾分！

[直接遊玩](https://yunlehuang-111.github.io/daiwan-grading-play/)

這是《老師，我幾分！》的 GitHub Pages 網頁版。玩家對照答案卷、用紅筆批改學生考卷，並在學生卷右上角手寫總分。遊戲保留單科、多科、練習、計時、交卷、結算、成就與已批改考卷檢視等原有機制。

## 手寫分數 CNN 辨識

1. 在學生考卷右上角「請在此寫總分」區域，用既有紅筆 Canvas 寫下 `0`、`10`、…、`100`。
2. 按「辨識分數」。系統只裁切透明紅筆層對應的 DOM ROI，不讀取考卷文字、表格或答案。
3. 系統切割 1～3 個數字，正規化成 28×28 黑底白字，交給 ONNX Model Zoo MNIST-12 CNN 逐字推論。
4. 合法且信心足夠時會顯示候選；按「確認使用」後才能按「下一張」交卷。
5. 空白、非法分數、切割不可靠、低信心或模型載入失敗時不會猜分。可重寫，或展開「改用按鈕輸入」完成遊戲。

合法分數只有 `[0, 10, 20, …, 100]`。辨識不會查看或修改該張考卷的標準答案。復原、橡皮擦、清除、新筆畫、換卷及時間到都會使舊 CNN 候選失效。「重新寫分數」只清除 ROI 內筆跡，題目區批改會保留。

## 技術結構

- `game.js`：原有遊戲／Canvas 流程，以及辨識、確認、手動備援和非同步競態保護。
- `score-roi.js`：動態 DOM→Canvas 座標換算、alpha mask、分割、28×28 正規化、穩定 softmax、合法分數解碼等純函式。
- `score-recognizer.js`：初始化一次並重用的 ONNX Runtime Web session；從 session 讀取實際 input/output 名稱。
- `models/score-recognition/mnist-12.onnx`：網站隨附的預訓練權重，推論時不向 Hugging Face 抓模型。
- `questions.tsv`：原有題庫；每行依序為科目、答案、題目，以 Tab 分隔。

ONNX Runtime Web 固定為 `1.20.1`，JS 與 WASM 都由同版 jsDelivr URL 載入。若 CDN 或 WebAssembly 不可用，遊戲仍可用按鈕分數完成。模型權重 SHA-256：

```text
5c688690f8bacf667d4c2074af5ad0646ca328d7ab03eccf944a65b320171bdd
```

## 本機執行與測試

不需要建置步驟或常駐後端。在儲存庫根目錄執行：

```sh
python -m http.server 8080
```

再開啟 <http://localhost:8080/>。請勿直接用 `file://` 開啟，瀏覽器通常會阻擋模型 fetch。

單元測試使用 Node.js 內建 test runner，不需安裝套件：

```sh
node --test tests/score-recognition.test.js
```

測試涵蓋 DPR／縮放 ROI 換算、裁切 clamp、alpha mask、0～100 分割、空白／噪音、28×28 正規化、穩定 softmax、合法分數與低信心拒辨，以及重寫／提交／換卷／逾時競態。人工驗收步驟見 [`tests/score-recognition-manual.md`](tests/score-recognition-manual.md)。

MNIST 上游公布的 1.1% top-1 error 是單一數字測試，不能代表本遊戲的多位數手寫正確率。本專案選擇在不確定時拒辨；要宣稱完整字串正確率前，仍需建立包含不同書寫者、滑鼠與手寫筆、且未參與調參的測試集。

## 靜態部署

所有專案資源均使用相對於 `index.html` 的 URL，可直接部署到 GitHub Pages 子路徑。發布前請確認 `.onnx` 未被忽略，並在 Network 面板驗證模型回傳 200；ONNX Runtime 的 CDN 失敗情境也應測試手動備援。

## 授權

本專案原始碼依 [MIT License](LICENSE) 授權。MNIST-12 模型、ONNX Model Zoo 與 ONNX Runtime Web 的來源、版本、授權標示及保留聲明見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 與 `third_party/`。
