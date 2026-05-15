# follow-twicelander Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform follow-twicelander from an AI builders tracker into a TWICE official accounts daily digest that fetches from RSSHub (X, Instagram, Facebook) and YouTube native Atom feeds, delivering a Traditional Chinese summary to Telegram + Email every morning at 7:00 AM Taipei time.

**Architecture:** GitHub Actions runs daily at UTC 23:00 (= Taipei 07:00), fetching content via RSSHub for X/Instagram/Facebook and YouTube native Atom feeds, writing to feed-x.json, feed-instagram.json, feed-youtube.json, feed-facebook.json. prepare-digest.js reads these feeds from the user's own GitHub repo and outputs a JSON blob the LLM uses to generate the digest. deliver.js sends the result to Telegram and Email.

**Tech Stack:** Node.js (ESM), RSSHub public instance (rsshub.app), YouTube Atom RSS, GitHub Actions, Telegram Bot API, Resend (email), dotenv

---

### Task 1: Update config/default-sources.json

**Files:**
- Modify: `config/default-sources.json`

- [ ] **Step 1: Replace with TWICE sources**

Replace entire content of `config/default-sources.json` with:

```json
{
  "x_accounts": [
    { "name": "TWICE", "handle": "JYPETWICE" },
    { "name": "TWICE JAPAN", "handle": "JYPETWICE_JAPAN" }
  ],
  "instagram_accounts": [
    { "name": "TWICE Official", "handle": "twicetagram" },
    { "name": "TWICE Japan", "handle": "jypetwice_japan" },
    { "name": "娜璉 Nayeon", "handle": "nayeonyny" },
    { "name": "定延 Jeongyeon", "handle": "jy_pieces" },
    { "name": "Momo", "handle": "momo" },
    { "name": "Sana", "handle": "m.by__sana" },
    { "name": "志效 Jihyo", "handle": "_zyozyozy" },
    { "name": "Mina", "handle": "mina_sr_my" },
    { "name": "多賢 Dahyun", "handle": "dahhyunnee" },
    { "name": "彩瑛 Chaeyoung", "handle": "chaeyo.0" },
    { "name": "子瑜 Tzuyu", "handle": "thinkaboutzu" }
  ],
  "youtube_channels": [
    { "name": "TWICE", "url": "https://www.youtube.com/@TWICE" },
    { "name": "TWICE JAPAN", "url": "https://www.youtube.com/@TWICEJapan" }
  ],
  "facebook_pages": [
    { "name": "TWICE Official", "pageId": "JYPETWICE" }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add config/default-sources.json
git commit -m "config: replace AI builder sources with TWICE official accounts"
```

---

### Task 2: Rewrite scripts/generate-feed.js

**Files:**
- Modify: `scripts/generate-feed.js`

Replace the entire file. The new version removes X API + podcast + blog fetching and replaces it with RSSHub-based fetching for X, Instagram, Facebook, plus YouTube native Atom feeds. Deduplication via `state-feed.json` is preserved.

- [ ] **Step 1: Replace generate-feed.js**

Overwrite `scripts/generate-feed.js` with:

```javascript
#!/usr/bin/env node

// ============================================================================
// follow-twicelander — Feed Generator
// ============================================================================
// Runs on GitHub Actions (daily at UTC 23:00 = Taipei 07:00).
// Fetches via RSSHub (X, Instagram, Facebook) and YouTube native Atom feeds.
// Outputs: feed-x.json, feed-instagram.json, feed-youtube.json, feed-facebook.json
// No API keys required.
// ============================================================================

import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const RSSHUB_BASE = "https://rsshub.app";
const LOOKBACK_HOURS = 24;
const MAX_POSTS_PER_ACCOUNT = 5;
const RSS_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SCRIPT_DIR = decodeURIComponent(new URL(".", import.meta.url).pathname);
const STATE_PATH = join(SCRIPT_DIR, "..", "state-feed.json");

// -- State -------------------------------------------------------------------

async function loadState() {
  if (!existsSync(STATE_PATH)) return { seenPosts: {} };
  try {
    const s = JSON.parse(await readFile(STATE_PATH, "utf-8"));
    if (!s.seenPosts) s.seenPosts = {};
    return s;
  } catch {
    return { seenPosts: {} };
  }
}

async function saveState(state) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(state.seenPosts)) {
    if (ts < cutoff) delete state.seenPosts[id];
  }
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

// -- Sources -----------------------------------------------------------------

async function loadSources() {
  const p = join(SCRIPT_DIR, "..", "config", "default-sources.json");
  return JSON.parse(await readFile(p, "utf-8"));
}

// -- RSS Fetch ---------------------------------------------------------------

async function fetchRSS(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": RSS_USER_AGENT },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.warn(`RSS fetch failed: ${url} → ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.warn(`RSS fetch error: ${url} → ${e.message}`);
    return null;
  }
}

// -- RSS Parser --------------------------------------------------------------

// Parses RSS 2.0 or Atom feeds into { id, title, content, publishedAt, url, imageUrl }
function parseRSSItems(xml) {
  if (!xml) return [];
  const items = [];
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  // Try RSS 2.0 <item> blocks
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];

    const titleM =
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
      block.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleM ? titleM[1].trim() : "";

    const linkM = block.match(/<link>([\s\S]*?)<\/link>/);
    const url = linkM ? linkM[1].trim() : null;

    const guidM =
      block.match(/<guid[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/guid>/) ||
      block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/);
    const id = guidM ? guidM[1].trim() : url;

    const pubM = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const publishedAt = pubM ? new Date(pubM[1].trim()) : null;

    const descM =
      block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
      block.match(/<description>([\s\S]*?)<\/description>/);
    const content = descM ? descM[1].replace(/<[^>]+>/g, " ").trim() : "";

    const imgM =
      block.match(/<media:content[^>]+url="([^"]+)"/) ||
      block.match(/<enclosure[^>]+url="([^"]+)"/);
    const imageUrl = imgM ? imgM[1] : null;

    if (!id || !url) continue;
    if (publishedAt && publishedAt < cutoff) continue;

    items.push({
      id,
      title,
      content,
      publishedAt: publishedAt?.toISOString() || null,
      url,
      imageUrl,
    });
  }

  // Fall back to Atom <entry> blocks
  if (items.length === 0) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    while ((m = entryRegex.exec(xml)) !== null) {
      const block = m[1];

      const titleM = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      const title = titleM
        ? titleM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim()
        : "";

      const linkM = block.match(/<link[^>]+href="([^"]+)"/);
      const url = linkM ? linkM[1] : null;

      const idM = block.match(/<id>([\s\S]*?)<\/id>/);
      const id = idM ? idM[1].trim() : url;

      const pubM =
        block.match(/<published>([\s\S]*?)<\/published>/) ||
        block.match(/<updated>([\s\S]*?)<\/updated>/);
      const publishedAt = pubM ? new Date(pubM[1].trim()) : null;

      const contentM = block.match(/<content[^>]*>([\s\S]*?)<\/content>/);
      const content = contentM
        ? contentM[1].replace(/<[^>]+>/g, " ").trim()
        : "";

      if (!id || !url) continue;
      if (publishedAt && publishedAt < cutoff) continue;

      items.push({
        id,
        title,
        content,
        publishedAt: publishedAt?.toISOString() || null,
        url,
        imageUrl: null,
      });
    }
  }

  return items;
}

// -- Platform Fetchers -------------------------------------------------------

async function fetchXFeed(state) {
  const sources = await loadSources();
  const results = [];

  for (const account of sources.x_accounts) {
    const url = `${RSSHUB_BASE}/twitter/user/${account.handle}`;
    const xml = await fetchRSS(url);
    const items = parseRSSItems(xml)
      .filter((item) => !state.seenPosts[item.id])
      .slice(0, MAX_POSTS_PER_ACCOUNT);

    for (const item of items) state.seenPosts[item.id] = Date.now();

    if (items.length > 0) {
      results.push({ source: "x", name: account.name, handle: account.handle, posts: items });
    }
  }

  return { generatedAt: new Date().toISOString(), lookbackHours: LOOKBACK_HOURS, x: results };
}

async function fetchInstagramFeed(state) {
  const sources = await loadSources();
  const results = [];

  for (const account of sources.instagram_accounts) {
    const url = `${RSSHUB_BASE}/instagram/user/${account.handle}`;
    const xml = await fetchRSS(url);
    const items = parseRSSItems(xml)
      .filter((item) => !state.seenPosts[item.id])
      .slice(0, MAX_POSTS_PER_ACCOUNT);

    for (const item of items) state.seenPosts[item.id] = Date.now();

    if (items.length > 0) {
      results.push({ source: "instagram", name: account.name, handle: account.handle, posts: items });
    }
  }

  return { generatedAt: new Date().toISOString(), lookbackHours: LOOKBACK_HOURS, instagram: results };
}

async function fetchFacebookFeed(state) {
  const sources = await loadSources();
  const results = [];

  for (const page of sources.facebook_pages) {
    const url = `${RSSHUB_BASE}/facebook/page/${page.pageId}`;
    const xml = await fetchRSS(url);
    const items = parseRSSItems(xml)
      .filter((item) => !state.seenPosts[item.id])
      .slice(0, MAX_POSTS_PER_ACCOUNT);

    for (const item of items) state.seenPosts[item.id] = Date.now();

    if (items.length > 0) {
      results.push({ source: "facebook", name: page.name, pageId: page.pageId, posts: items });
    }
  }

  return { generatedAt: new Date().toISOString(), lookbackHours: LOOKBACK_HOURS, facebook: results };
}

async function resolveYouTubeFeedUrl(channelUrl) {
  if (!channelUrl?.includes("youtube.com")) return null;

  const playlistM = channelUrl.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (playlistM)
    return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistM[1]}`;

  const channelIdM = channelUrl.match(/\/channel\/(UC[A-Za-z0-9_-]+)/);
  if (channelIdM)
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelIdM[1]}`;

  if (channelUrl.match(/\/@[A-Za-z0-9_.-]+/)) {
    try {
      const res = await fetch(channelUrl, {
        headers: { "User-Agent": RSS_USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const html = await res.text();
      const idM =
        html.match(/"channelId":"(UC[A-Za-z0-9_-]{20,})"/) ||
        html.match(/<meta\s+itemprop="(?:identifier|channelId)"\s+content="(UC[A-Za-z0-9_-]{20,})"/);
      if (idM) return `https://www.youtube.com/feeds/videos.xml?channel_id=${idM[1]}`;
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchYouTubeFeed(state) {
  const sources = await loadSources();
  const results = [];

  for (const channel of sources.youtube_channels) {
    const feedUrl = await resolveYouTubeFeedUrl(channel.url);
    if (!feedUrl) {
      console.warn(`Could not resolve YouTube feed URL for ${channel.name}`);
      continue;
    }

    const xml = await fetchRSS(feedUrl);
    const items = parseRSSItems(xml)
      .filter((item) => !state.seenPosts[item.id])
      .slice(0, MAX_POSTS_PER_ACCOUNT);

    for (const item of items) state.seenPosts[item.id] = Date.now();

    if (items.length > 0) {
      results.push({ source: "youtube", name: channel.name, channelUrl: channel.url, videos: items });
    }
  }

  return { generatedAt: new Date().toISOString(), lookbackHours: LOOKBACK_HOURS, youtube: results };
}

// -- Main --------------------------------------------------------------------

const args = process.argv.slice(2);
const onlyX = args.includes("--x-only");
const onlyInstagram = args.includes("--instagram-only");
const onlyYouTube = args.includes("--youtube-only");
const onlyFacebook = args.includes("--facebook-only");
const runAll = !onlyX && !onlyInstagram && !onlyYouTube && !onlyFacebook;

const state = await loadState();
const OUTPUT_DIR = join(SCRIPT_DIR, "..");

if (runAll || onlyX) {
  const feed = await fetchXFeed(state);
  await writeFile(join(OUTPUT_DIR, "feed-x.json"), JSON.stringify(feed, null, 2));
  console.log(`X: ${feed.x.length} accounts with new posts`);
}

if (runAll || onlyInstagram) {
  const feed = await fetchInstagramFeed(state);
  await writeFile(join(OUTPUT_DIR, "feed-instagram.json"), JSON.stringify(feed, null, 2));
  console.log(`Instagram: ${feed.instagram.length} accounts with new posts`);
}

if (runAll || onlyYouTube) {
  const feed = await fetchYouTubeFeed(state);
  await writeFile(join(OUTPUT_DIR, "feed-youtube.json"), JSON.stringify(feed, null, 2));
  console.log(`YouTube: ${feed.youtube.length} channels with new videos`);
}

if (runAll || onlyFacebook) {
  const feed = await fetchFacebookFeed(state);
  await writeFile(join(OUTPUT_DIR, "feed-facebook.json"), JSON.stringify(feed, null, 2));
  console.log(`Facebook: ${feed.facebook.length} pages with new posts`);
}

await saveState(state);
console.log("Done.");
```

- [ ] **Step 2: Test locally**

```bash
cd /Users/roywang/Documents/AI/follow-twicelander/scripts
node generate-feed.js --youtube-only 2>&1
```

Expected output: `YouTube: N channels with new videos` and `Done.`
Check that `../feed-youtube.json` was created and contains video entries.

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-feed.js
git commit -m "feat: rewrite feed generator for TWICE — RSSHub + YouTube Atom"
```

---

### Task 3: Update scripts/prepare-digest.js

**Files:**
- Modify: `scripts/prepare-digest.js`

Change the GitHub raw feed URLs to your own repo, update the feed list, update the prompt file list, and update the output structure.

- [ ] **Step 1: Find your GitHub username**

```bash
git remote get-url origin
```

Note the username (e.g. `https://github.com/USERNAME/follow-twicelander.git` → `USERNAME`).

- [ ] **Step 2: Replace constants block**

In `scripts/prepare-digest.js`, replace lines 29–40 (the URL and prompt constants) with:

```javascript
// Replace USERNAME with your actual GitHub username
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/USERNAME/follow-twicelander/main';

const FEED_X_URL = `${GITHUB_RAW_BASE}/feed-x.json`;
const FEED_INSTAGRAM_URL = `${GITHUB_RAW_BASE}/feed-instagram.json`;
const FEED_YOUTUBE_URL = `${GITHUB_RAW_BASE}/feed-youtube.json`;
const FEED_FACEBOOK_URL = `${GITHUB_RAW_BASE}/feed-facebook.json`;

const PROMPTS_BASE = `${GITHUB_RAW_BASE}/prompts`;
const PROMPT_FILES = [
  'summarize-tweets.md',
  'summarize-instagram.md',
  'summarize-youtube.md',
  'digest-intro.md',
];
```

- [ ] **Step 3: Replace the fetch block**

Replace the `const [feedX, feedPodcasts, feedBlogs]` block with:

```javascript
const [feedX, feedInstagram, feedYouTube, feedFacebook] = await Promise.all([
  fetchJSON(FEED_X_URL),
  fetchJSON(FEED_INSTAGRAM_URL),
  fetchJSON(FEED_YOUTUBE_URL),
  fetchJSON(FEED_FACEBOOK_URL),
]);

if (!feedX) errors.push('Could not fetch X feed');
if (!feedInstagram) errors.push('Could not fetch Instagram feed');
if (!feedYouTube) errors.push('Could not fetch YouTube feed');
if (!feedFacebook) errors.push('Could not fetch Facebook feed');
```

- [ ] **Step 4: Replace the output object**

Replace the `const output = { ... }` block with:

```javascript
const output = {
  status: 'ok',
  generatedAt: new Date().toISOString(),
  config: {
    language: config.language || 'zh',
    frequency: config.frequency || 'daily',
    delivery: config.delivery || { method: 'stdout' }
  },
  x: feedX?.x || [],
  instagram: feedInstagram?.instagram || [],
  youtube: feedYouTube?.youtube || [],
  facebook: feedFacebook?.facebook || [],
  stats: {
    xAccounts: feedX?.x?.length || 0,
    instagramAccounts: feedInstagram?.instagram?.length || 0,
    youtubeChannels: feedYouTube?.youtube?.length || 0,
    facebookPages: feedFacebook?.facebook?.length || 0,
  },
  prompts,
  errors: errors.length > 0 ? errors : undefined
};
```

- [ ] **Step 5: Commit**

```bash
git add scripts/prepare-digest.js
git commit -m "feat: update prepare-digest to use TWICE feeds from own repo"
```

---

### Task 4: Update prompts

**Files:**
- Modify: `prompts/digest-intro.md`
- Modify: `prompts/summarize-tweets.md`
- Create: `prompts/summarize-instagram.md`
- Create: `prompts/summarize-youtube.md`
- Delete: `prompts/summarize-blogs.md`, `prompts/summarize-podcast.md`, `prompts/translate.md`

- [ ] **Step 1: Overwrite digest-intro.md**

Replace entire content of `prompts/digest-intro.md`:

```markdown
# TWICE 每日動態摘要 Prompt

你是整合所有平台動態的摘要助手，負責將 TWICE 官方帳號的最新動態整理成每日簡報。

## 輸出格式

開頭標題（替換 [日期] 為今天的日期）：

TWICE 每日動態 — [日期]

接著按以下順序呈現**有新內容的**平台：

1. 📺 YouTube — 新影片（MV、官方影片優先）
2. 📸 Instagram — 官方群組帳號 + 成員個人貼文
3. 🐦 X — 官方推文
4. 📘 Facebook — 官方粉絲頁貼文

## 規則

- 只顯示有新內容的平台，無新動態直接跳過
- 每則內容必須附上原始連結，沒有連結就不要列出
- 語言：繁體中文摘要，原文連結保留
- 不捏造任何內容，只摘要 feed 中實際存在的貼文
- 格式保持乾淨易讀，適合在手機螢幕閱讀

## 結尾

最後一行加上：
「由 follow-twicelander 自動生成」
```

- [ ] **Step 2: Overwrite summarize-tweets.md**

Replace entire content of `prompts/summarize-tweets.md`:

```markdown
# X (Twitter) 貼文摘要 Prompt

你在摘要 TWICE 官方 X 帳號的最新推文，給想掌握最新動態的粉絲閱讀。

## 規則

- 先標明帳號名稱（例如：「TWICE 官方」、「TWICE JAPAN 官方」）
- 只摘要有實質內容的推文：活動公告、回歸消息、互動貼文、影片/照片推文
- 略過：純轉推（無評論）、空洞的互動推文
- 每個帳號 2-3 句摘要
- 有回歸或活動公告時，放在最前面強調
- 每則推文附上原始連結
- 若無值得摘要的內容，寫「今日無新推文」
```

- [ ] **Step 3: Create summarize-instagram.md**

Create `prompts/summarize-instagram.md`:

```markdown
# Instagram 貼文摘要 Prompt

你在摘要 TWICE 官方群組帳號和成員個人 Instagram 的最新貼文。

## 規則

- 先標明帳號（官方帳號：「TWICE 官方 IG」；成員：「[中文名] ([handle])」）
- 描述貼文類型：照片、影片、Reels、回歸宣傳、生日貼文等
- 若有說明文字，簡短摘要重點（1-2 句）
- 特別標注值得關注的互動：成員直播、特殊合照、回歸相關
- 每個帳號 1-2 句，簡潔為主
- 每則貼文附上原始連結
- 若該帳號無新貼文，直接跳過（不寫「今日無貼文」）
```

- [ ] **Step 4: Create summarize-youtube.md**

Create `prompts/summarize-youtube.md`:

```markdown
# YouTube 影片摘要 Prompt

你在摘要 TWICE 官方 YouTube 頻道的最新影片。

## 規則

- 影片重要性排序：MV > 官方舞台影片 > 綜藝片段 > Vlog / 日常影片
- 寫出影片完整標題（保留原文）
- 一句話描述影片內容
- 若為 MV 或回歸相關影片，標注「🆕 新歌！」
- 附上直接的 YouTube 影片連結（非頻道首頁）
- 每個頻道最多列出 3 支影片
- 若無新影片，直接跳過該頻道
```

- [ ] **Step 5: Delete unused prompts**

```bash
rm /Users/roywang/Documents/AI/follow-twicelander/prompts/summarize-blogs.md
rm /Users/roywang/Documents/AI/follow-twicelander/prompts/summarize-podcast.md
rm /Users/roywang/Documents/AI/follow-twicelander/prompts/translate.md
```

- [ ] **Step 6: Commit**

```bash
git add prompts/
git commit -m "feat: update prompts for TWICE daily digest in Traditional Chinese"
```

---

### Task 5: Update scripts/deliver.js

**Files:**
- Modify: `scripts/deliver.js`

Change email sender name and subject line from "AI Builders Digest" to "TWICE 每日動態".

- [ ] **Step 1: Update sendEmail function**

In `scripts/deliver.js`, find the `body: JSON.stringify({...})` inside `sendEmail` and replace it with:

```javascript
body: JSON.stringify({
  from: 'TWICE 每日動態 <digest@resend.dev>',
  to: [toEmail],
  subject: `TWICE 每日動態 — ${new Date().toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  })}`,
  text: text
})
```

- [ ] **Step 2: Add "both" delivery method**

In `scripts/deliver.js`, find the `switch (delivery.method)` block and add a `'both'` case before the `'stdout'` default:

```javascript
case 'both': {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = delivery.chatId;
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = delivery.email;
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not found in .env');
  if (!chatId) throw new Error('delivery.chatId not found in config.json');
  if (!apiKey) throw new Error('RESEND_API_KEY not found in .env');
  if (!toEmail) throw new Error('delivery.email not found in config.json');
  await sendTelegram(digestText, botToken, chatId);
  await sendEmail(digestText, apiKey, toEmail);
  console.log(JSON.stringify({
    status: 'ok',
    method: 'both',
    message: `Digest sent to Telegram and ${toEmail}`
  }));
  break;
}
```

Then in `~/.follow-builders/config.json`, set `"method": "both"` (instead of `"telegram"`).

- [ ] **Step 3: Commit**

```bash
git add scripts/deliver.js
git commit -m "feat: add 'both' delivery method for Telegram + Email; update branding"
```

---

### Task 6: Update GitHub Actions workflow

**Files:**
- Modify: `.github/workflows/generate-feed.yml`

- [ ] **Step 1: Replace workflow file**

Replace entire content of `.github/workflows/generate-feed.yml` with:

```yaml
name: Generate TWICE Feeds

on:
  schedule:
    # Daily at UTC 23:00 = Taipei 07:00
    - cron: '0 23 * * *'
  workflow_dispatch:
    inputs:
      mode:
        description: 'What to fetch'
        required: false
        default: 'all'
        type: choice
        options:
          - all
          - x-only
          - instagram-only
          - youtube-only
          - facebook-only

jobs:
  generate:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: cd scripts && npm install

      - name: Generate feeds
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ] && [ "${{ inputs.mode }}" != "all" ]; then
            cd scripts && node generate-feed.js --${{ inputs.mode }}
          else
            cd scripts && node generate-feed.js
          fi

      - name: Commit and push feeds
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add feed-x.json feed-instagram.json feed-youtube.json feed-facebook.json state-feed.json
          git diff --cached --quiet || git commit -m "chore: update feeds [skip ci]"
          git push
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/generate-feed.yml
git commit -m "ci: update GitHub Actions for TWICE feeds, cron UTC 23:00"
```

---

### Task 7: Local setup — Telegram + Email config

These files live on your machine only and are NOT committed to the repo.

- [ ] **Step 1: Create config directory**

```bash
mkdir -p ~/.follow-builders
```

- [ ] **Step 2: Create ~/.follow-builders/config.json**

```bash
cat > ~/.follow-builders/config.json << 'EOF'
{
  "language": "zh",
  "frequency": "daily",
  "deliveryTime": "07:00",
  "timezone": "Asia/Taipei",
  "delivery": {
    "method": "telegram",
    "chatId": "YOUR_TELEGRAM_CHAT_ID",
    "email": "YOUR_EMAIL_ADDRESS"
  },
  "onboardingComplete": true
}
EOF
```

Replace `YOUR_TELEGRAM_CHAT_ID` and `YOUR_EMAIL_ADDRESS` with real values.

- [ ] **Step 3: Create ~/.follow-builders/.env**

```bash
cat > ~/.follow-builders/.env << 'EOF'
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
RESEND_API_KEY=your_resend_api_key_here
EOF
```

- [ ] **Step 4: Get Telegram bot token + chat ID**

1. Open Telegram → search `@BotFather` → send `/newbot` → follow prompts → copy the token
2. Send any message to your new bot
3. Open in browser (replace TOKEN): `https://api.telegram.org/botTOKEN/getUpdates`
4. Find `"chat":{"id":XXXXXXX}` — that number is your chat ID
5. Fill token into `.env` and chat ID into `config.json`

- [ ] **Step 5: Get Resend API key**

1. Sign up at https://resend.com (free: 100 emails/day)
2. Dashboard → API Keys → Create API Key
3. Fill into `~/.follow-builders/.env`

- [ ] **Step 6: Test Telegram delivery**

```bash
cd /Users/roywang/Documents/AI/follow-twicelander/scripts
echo "TWICE 每日動態測試 — 設定成功！" | node deliver.js
```

Expected: Telegram 收到測試訊息，output 為 `{"status":"ok","method":"telegram",...}`

---

### Task 8: Push and first run

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

- [ ] **Step 2: Trigger manual workflow run**

Go to: GitHub repo → Actions tab → "Generate TWICE Feeds" → "Run workflow" → Run

Watch the logs. Expected: feed JSON files get generated and committed.

- [ ] **Step 3: Test prepare-digest locally after feeds are pushed**

```bash
cd /Users/roywang/Documents/AI/follow-twicelander/scripts
node prepare-digest.js 2>&1 | head -50
```

Expected: JSON output with `x`, `instagram`, `youtube`, `facebook` keys populated (some may be empty arrays if no new posts in last 24h).

---

## Known Limitations

**Instagram + Facebook via public RSSHub:**
Public `rsshub.app` may return empty feeds for Instagram and Facebook without authentication cookies. If this happens:
- Option A: Self-host RSSHub with IG cookies → https://docs.rsshub.app/deploy/
- Option B: Use a trusted community RSSHub instance
- Option C: The feeds will be empty until auth is configured; X and YouTube will still work fine

**X via RSSHub:**
Public instance may have rate limits. When your X Bearer Token is ready:
1. Add `X_BEARER_TOKEN` to GitHub repo Secrets
2. Replace the `fetchXFeed` function in `generate-feed.js` to call X API v2 instead of RSSHub
3. No other files need changing
