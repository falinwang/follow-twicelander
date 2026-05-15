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
