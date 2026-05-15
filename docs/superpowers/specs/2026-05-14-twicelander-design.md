# follow-twicelander 設計文件

**日期：** 2026-05-14
**專案：** follow-twicelander — TWICE 官方帳號每日動態追蹤器

---

## 目標

將 follow-builders（AI 建造者追蹤器）改造為 TWICE 官方社群帳號的每日動態追蹤器。每天早上自動彙整前一天 TWICE 在 X、Instagram、YouTube、Facebook 的所有官方發文，以繁體中文摘要推送到 Telegram 和 Email。

---

## 追蹤來源（第一批）

### X (Twitter)
- @JYPETWICE（全球官方）
- @JYPETWICE_JAPAN（日本官方）

### Instagram
**群組帳號：**
- @twicetagram（全球官方）
- @jypetwice_japan（日本官方）

**成員個人帳號（9位）：**
| 成員 | Instagram handle |
|---|---|
| 娜璉 Nayeon | @nayeonyny |
| 定延 Jeongyeon | @jy_pieces |
| Momo | @momo |
| Sana | @m.by__sana |
| 志效 Jihyo | @_zyozyozy |
| Mina | @mina_sr_my |
| 多賢 Dahyun | @dahhyunnee |
| 彩瑛 Chaeyoung | @chaeyo.0 |
| 子瑜 Tzuyu | @thinkaboutzu |

### YouTube
- TWICE（全球官方頻道）
- TWICE JAPAN OFFICIAL

### Facebook
- TWICE 官方粉絲頁

---

## 第二批（之後擴充）
- TikTok：@twice_tiktok_official、@twice_tiktok_officialjp
- Weibo：TWICE-OFFICIAL

---

## 技術架構

### 資料抓取策略

**啟動階段（現在）：** 全部走 RSSHub，不需要任何 API key。
**之後升級：** X API Bearer Token 申請下來後，X 部分切換為官方 API（更穩定）。

### RSSHub 路由

| 平台 | RSSHub 路徑 |
|---|---|
| X | `/twitter/user/JYPETWICE`、`/twitter/user/JYPETWICE_JAPAN` |
| Instagram | `/instagram/user/:username`（每個帳號各一條）⚠️ 可能需要已登入的 RSSHub 實例或 cookie 設定 |
| Facebook | `/facebook/page/TWICE` |

### YouTube（原生 RSS）

YouTube 提供原生 RSS，不需要 RSSHub：
```
https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
```

**實作前需查詢的 channel ID：**
- TWICE 全球官方頻道（搜尋 @TWICE 確認）
- TWICE JAPAN OFFICIAL（搜尋 @TWICEJAPAN 確認）

### Feed 檔案結構

```
feed-x.json           ← X 貼文
feed-instagram.json   ← IG 貼文（群組 + 9 位成員）
feed-youtube.json     ← YouTube 影片
feed-facebook.json    ← FB 貼文
state-feed.json       ← 去重狀態（已處理的 ID）
```

### GitHub Actions

- **排程：** 每天 UTC 23:00（台北時間早上 7:00）
- **流程：** 抓取所有 RSS → 更新 feed JSON → commit 進 repo
- **環境變數：** 啟動階段不需要任何 API key（純 RSSHub）

---

## 需要修改的檔案

| 檔案 | 異動 |
|---|---|
| `config/default-sources.json` | 全部換成 TWICE 帳號和 RSS 路由 |
| `scripts/generate-feed.js` | 改成 RSSHub RSS 抓取，加入 YouTube 原生 RSS |
| `scripts/deliver.js` | 確認 Telegram + Email 雙通道正常 |
| `prompts/digest-intro.md` | 改成 TWICE 每日動態格式 |
| `prompts/summarize-tweets.md` | X 貼文摘要改為 K-pop 風格 |
| `prompts/summarize-instagram.md` | 新增：IG 貼文摘要 prompt |
| `prompts/summarize-youtube.md` | 新增：YouTube 影片摘要 prompt |
| `prompts/summarize-blogs.md` | 刪除（不需要） |
| `prompts/summarize-podcast.md` | 刪除（不需要） |
| `.github/workflows/update-feeds.yml` | 更新排程時間與環境變數 |

---

## 每日摘要輸出格式

```
TWICE 每日動態 — YYYY-MM-DD

📺 YouTube
• [影片標題]（發布時間）
  → [連結]

📸 Instagram
• twicetagram：[貼文摘要，1-2句]
• 娜璉 (nayeonyny)：[貼文摘要]
• （其他有發文的成員）
  → 各自連結

🐦 X
• @JYPETWICE：[推文摘要]
• @JYPETWICE_JAPAN：[推文摘要]
  → 各自連結

📘 Facebook
• [貼文摘要]
  → 連結
```

**規則：**
- 語言：繁體中文摘要，原文連結保留
- 沒有新動態的平台不顯示
- 每則摘要附原始連結
- 不捏造內容，只摘要 feed 中實際存在的貼文

---

## 推送設定

- **頻率：** 每日
- **時間：** 台北時間早上 7:00
- **通道：** Telegram bot + Email（同時推送）
- **語言：** 繁體中文

---

## 升級路徑（X API）

1. 申請 X Developer 帳號（免費方案）
2. 取得 Bearer Token
3. 在 GitHub repo Settings → Secrets 加入 `X_BEARER_TOKEN`
4. 修改 `generate-feed.js` 的 X 部分，從 RSSHub 切換為 X API v2
5. 其他平台不受影響
