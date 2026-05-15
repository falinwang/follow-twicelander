# follow-twicelander

每天早上自動彙整 TWICE 官方帳號在 X、Instagram、YouTube、Facebook 的最新動態，以繁體中文摘要推送到 Telegram 和 Email。

## 追蹤來源

### X (Twitter)
- [@JYPETWICE](https://x.com/JYPETWICE) — 全球官方
- [@JYPETWICE_JAPAN](https://x.com/JYPETWICE_JAPAN) — 日本官方

### Instagram
| 帳號 | 說明 |
|---|---|
| [@twicetagram](https://www.instagram.com/twicetagram) | 全球官方 |
| [@jypetwice_japan](https://www.instagram.com/jypetwice_japan) | 日本官方 |
| [@nayeonyny](https://www.instagram.com/nayeonyny) | 娜璉 Nayeon |
| [@jy_pieces](https://www.instagram.com/jy_pieces) | 定延 Jeongyeon |
| [@momo](https://www.instagram.com/momo) | Momo |
| [@m.by__sana](https://www.instagram.com/m.by__sana) | Sana |
| [@_zyozyozy](https://www.instagram.com/_zyozyozy) | 志效 Jihyo |
| [@mina_sr_my](https://www.instagram.com/mina_sr_my) | Mina |
| [@dahhyunnee](https://www.instagram.com/dahhyunnee) | 多賢 Dahyun |
| [@chaeyo.0](https://www.instagram.com/chaeyo.0) | 彩瑛 Chaeyoung |
| [@thinkaboutzu](https://www.instagram.com/thinkaboutzu) | 子瑜 Tzuyu |

### YouTube
- [TWICE](https://www.youtube.com/@TWICE) — 全球官方頻道
- [TWICE JAPAN](https://www.youtube.com/@TWICEJapan) — 日本官方頻道

### Facebook
- [TWICE](https://www.facebook.com/JYPETWICE) — 官方粉絲頁

## 每日摘要格式

```
TWICE 每日動態 — 2026-05-14

📺 YouTube
• [TW-DAY] #19 This moment with JIHYO feels so hvnly
  → https://www.youtube.com/watch?v=...

📸 Instagram
• TWICE 官方 IG：回歸宣傳照片貼文
• 子瑜 (thinkaboutzu)：日常自拍
  → 各自連結

🐦 X
• TWICE 官方：活動公告推文
  → 連結

由 follow-twicelander 自動生成
```

## 運作方式

1. GitHub Actions 每天台北時間早上 7:00 自動跑
2. 透過 RSSHub 抓取 X、Instagram、Facebook 的公開貼文
3. 透過 YouTube 原生 Atom RSS 抓取新影片
4. 結果寫入 `feed-*.json` 並 commit 進 repo
5. Agent 讀取 feed，生成繁體中文摘要，推送到 Telegram + Email

## 本機設定

**1. Clone 並安裝套件**
```bash
git clone https://github.com/falinwang/follow-twicelander.git
cd follow-twicelander/scripts && npm install
```

**2. 建立設定檔**
```bash
mkdir -p ~/.follow-builders

cat > ~/.follow-builders/config.json << 'EOF'
{
  "language": "zh",
  "frequency": "daily",
  "deliveryTime": "07:00",
  "timezone": "Asia/Taipei",
  "delivery": {
    "method": "both",
    "chatId": "YOUR_TELEGRAM_CHAT_ID",
    "email": "YOUR_EMAIL"
  },
  "onboardingComplete": true
}
EOF

cat > ~/.follow-builders/.env << 'EOF'
TELEGRAM_BOT_TOKEN=your_bot_token
RESEND_API_KEY=your_resend_key
EOF
```

**3. 取得 Telegram Bot Token 和 Chat ID**
1. Telegram 搜尋 `@BotFather` → `/newbot` → 取得 token
2. 傳訊息給你的 bot，然後開啟 `https://api.telegram.org/botTOKEN/getUpdates` 找 chat id

**4. 取得 Resend API Key**
前往 [resend.com](https://resend.com)（免費方案：100 封/天）

**5. 測試**
```bash
cd follow-twicelander/scripts
echo "測試訊息" | node deliver.js
```

## 升級：使用 X 官方 API

目前 X 貼文透過 RSSHub 抓取。若要更穩定的覆蓋率：
1. 申請 [X Developer 帳號](https://developer.x.com)（免費方案即可）
2. 取得 Bearer Token
3. 加入 GitHub repo Secrets：`X_BEARER_TOKEN`
4. 修改 `scripts/generate-feed.js` 的 `fetchXFeed` 函式改用 X API v2

## 技術架構

```
GitHub Actions (每日 UTC 23:00)
  ↓
RSSHub → feed-x.json, feed-instagram.json, feed-facebook.json
YouTube Atom RSS → feed-youtube.json
  ↓
prepare-digest.js → 讀取 feed，輸出 JSON blob
  ↓
Agent (Claude) → 生成繁體中文摘要
  ↓
deliver.js → Telegram + Email
```

**需要的工具：** Node.js、GitHub Actions、Telegram Bot、Resend

**不需要：** X API key（啟動階段）、任何付費服務

## License

MIT
