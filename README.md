# 老師，我幾分！

[直接遊玩](https://yunlehuang-111.github.io/daiwan-grading-play/)

這個儲存庫是《老師，我幾分！》的 GitHub Pages 網頁版。遊戲在瀏覽器內出卷、計時和結算。更新網頁時，修改這裡的 HTML、CSS 或 JavaScript，再推送到 `main`，GitHub Pages 會自動發布新版。

本機預覽可在儲存庫根目錄執行 `python3 -m http.server 8080`，再開啟 [http://localhost:8080/](http://localhost:8080/)。

題庫在 `questions.tsv`。每行依序為科目、答案、題目，欄位用 Tab 分隔。每局從抽中的科目各抽 5 題選擇題和是非題。
