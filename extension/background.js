/* URL Manager — Background Service Worker */

const API = "http://localhost:5000";
const CACHE_TTL = 30_000; // 30 s

let _cachedUrls = null;
let _cacheTime = 0;

// ─── Fetch user settings from server ─────────────────────────────────────────

async function fetchSettings() {
  try {
    const resp = await fetch(`${API}/api/settings`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ─── History scrubbing (settings-driven) ─────────────────────────────────────

const FALLBACK_SCRUB_WORDS = [
  "porn", "desi", "xxx", "sex", "fuck", "milf",
  "pornhub", "xvideos", "missionary", "eporner", "hardcore",
];

async function scrubHistory() {
  try {
    const settings = await fetchSettings();
    const words = settings?.historyScrub?.words?.length
      ? settings.historyScrub.words
      : FALLBACK_SCRUB_WORDS;

    const startTime = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days back
    const items = await chrome.history.search({
      text: "",
      maxResults: 100000,
      startTime,
    });
    let deleted = 0;
    for (const item of items) {
      const haystack = (item.url + " " + (item.title || "")).toLowerCase();
      if (words.some((w) => haystack.includes(w.toLowerCase()))) {
        await chrome.history.deleteUrl({ url: item.url });
        deleted++;
      }
    }
    if (deleted > 0)
      console.log(`[Zing] Scrubbed ${deleted} history entries.`);
  } catch (err) {
    console.warn("[Zing] History scrub failed:", err);
  }
}

// ─── Schedule history scrub based on settings frequency ──────────────────────

const ALARM_NAME = "zing-history-scrub";
const FREQ_MAP = {
  "startup":  null,    // alarm-less — runs on startup/install only
  "1min":     1,
  "5min":     5,
  "15min":    15,
  "1hour":    60,
  "6hours":   360,
};

async function setupScrubAlarm() {
  const settings = await fetchSettings();
  const freq = settings?.historyScrub?.frequency || "startup";
  const minutes = FREQ_MAP[freq] ?? null;

  // Clear any existing alarm first
  await chrome.alarms.clear(ALARM_NAME).catch(() => {});

  if (minutes !== null) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) scrubHistory();
});

chrome.runtime.onStartup.addListener(() => {
  scrubHistory();
  setupScrubAlarm();
});

chrome.runtime.onInstalled.addListener(() => {
  scrubHistory();
  setupScrubAlarm();
});

// ─── Dark reader: CSS injected early on tab load ───────────────────────────────

const DARK_READER_CSS = `
html {
  filter: invert(1) hue-rotate(180deg) !important;
  background: #111 !important;
}
img, video, iframe, canvas, picture, svg image, embed, object,
[style*="background-image"] {
  filter: invert(1) hue-rotate(180deg) !important;
}
`;

// Re-apply dark reader CSS when a tab navigates (before page renders)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;

  // Clear pesticide state on reload
  chrome.storage.session.remove(`pest_${tabId}`).catch(() => {});

  // Re-inject dark reader if it was on for this tab
  try {
    const key = `darkReader_${tabId}`;
    const data = await chrome.storage.local.get(key);
    if (data[key]) {
      // Tab is navigating — inject CSS as early as possible
      chrome.scripting.insertCSS({
        target: { tabId },
        css: DARK_READER_CSS,
      }).catch(() => {}); // ignore if tab not ready yet
    }
  } catch {}
});

// Clean up dark reader state when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(`darkReader_${tabId}`).catch(() => {});
});

// ─── Bookmark URL cache ───────────────────────────────────────────────────────

async function fetchBookmarkUrls(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _cachedUrls && now - _cacheTime < CACHE_TTL) {
    return _cachedUrls;
  }
  try {
    const resp = await fetch(`${API}/api/collections`);
    if (!resp.ok) return _cachedUrls || [];
    const cols = await resp.json();
    const urls = [];
    cols.forEach((col) =>
      col.urls.forEach((u) => {
        if (u.url) urls.push(u.url);
      }),
    );
    _cachedUrls = urls;
    _cacheTime = now;
    return urls;
  } catch {
    return _cachedUrls || [];
  }
}

// ─── Save current window tabs to URL Manager ─────────────────────────────────

async function saveTabs(collectionName) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const items = tabs
    .filter((t) => {
      if (!t.url) return false;
      if (!t.url.startsWith("http://") && !t.url.startsWith("https://"))
        return false;
      try {
        const u = new URL(t.url);
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1")
          return false;
      } catch {
        return false;
      }
      return true;
    })
    .map((t) => ({ url: t.url, title: t.title || "" }));

  if (!items.length) return { error: "No HTTP tabs found in this window." };

  try {
    const colResp = await fetch(`${API}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: collectionName }),
    });
    if (!colResp.ok) throw new Error(`Server error ${colResp.status}`);
    const col = await colResp.json();

    const addResp = await fetch(`${API}/api/collections/${col.id}/urls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: items }),
    });
    if (!addResp.ok) throw new Error(`Server error ${addResp.status}`);
    const result = await addResp.json();

    _cachedUrls = null;

    return {
      ok: true,
      added: result.added?.length ?? 0,
      skipped: result.skipped?.length ?? 0,
      total: items.length,
      collection: col.name,
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_BOOKMARK_URLS") {
    fetchBookmarkUrls(msg.forceRefresh || false).then((urls) =>
      sendResponse({ urls }),
    );
    return true;
  }

  if (msg.type === "SAVE_TABS") {
    saveTabs(msg.collectionName).then((result) => sendResponse(result));
    return true;
  }

  if (msg.type === "PING") {
    fetch(`${API}/api/collections`)
      .then((r) => sendResponse({ ok: r.ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === "FULL_PAGE_SCREENSHOT") {
    captureFullPage().then((result) => sendResponse(result));
    return true;
  }

  if (msg.type === "INSPECT_ELEMENT") {
    inspectElement(sender.tab?.id, msg.selector);
    sendResponse({ ok: true });
    return false;
  }

  // ── Dark reader state management ──────────────────────────────────────────

  if (msg.type === "GET_DARK_READER_STATE") {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ enabled: false }); return false; }
    const key = `darkReader_${tabId}`;
    chrome.storage.local.get(key).then((data) => {
      sendResponse({ enabled: !!data[key] });
    });
    return true;
  }

  if (msg.type === "SET_DARK_READER_STATE") {
    const tabId = sender.tab?.id || msg.tabId;
    if (!tabId) { sendResponse({ ok: false }); return false; }
    const key = `darkReader_${tabId}`;
    if (msg.enabled) {
      chrome.storage.local.set({ [key]: true });
    } else {
      chrome.storage.local.remove(key);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "GET_SETTINGS") {
    fetchSettings().then((s) => sendResponse({ settings: s }));
    return true;
  }
});

// ─── DevTools element inspection via chrome.debugger ─────────────────────────

function inspectElement(tabId, selector) {
  if (!tabId || !selector) return;
  chrome.debugger.attach({ tabId }, '1.3', () => {
    if (chrome.runtime.lastError) {
      const m = chrome.runtime.lastError.message || '';
      if (!m.includes('already attached')) return;
    }
    chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `inspect(document.querySelector(${JSON.stringify(selector)}))`,
      includeCommandLineAPI: true,
      silent: true,
    }, () => {
      setTimeout(() => chrome.debugger.detach({ tabId }, () => {}), 3000);
    });
  });
}

// ─── Full-page screenshot via scroll + captureVisibleTab (rate-limit safe) ───

async function captureFullPage() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return { error: "No active tab" };
    const tabId = tab.id;
    const windowId = tab.windowId;

    const [{ result: dims }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        scrollW: Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth || 0,
        ),
        scrollH: Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight || 0,
        ),
        viewW: window.innerWidth,
        viewH: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      }),
    });

    const { scrollW, scrollH, viewW, viewH, dpr, scrollX, scrollY } = dims;

    const canvas = new OffscreenCanvas(
      Math.round(scrollW * dpr),
      Math.round(scrollH * dpr),
    );
    const ctx = canvas.getContext("2d");

    const rows = Math.ceil(scrollH / viewH);
    const cols = Math.ceil(scrollW / viewW);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sx = col * viewW;
        const sy = row * viewH;

        await chrome.scripting.executeScript({
          target: { tabId },
          func: (x, y) => window.scrollTo(x, y),
          args: [sx, sy],
        });

        await new Promise((r) => setTimeout(r, 1050));

        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
          format: "png",
        });
        const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
        const tileBlob = new Blob([bytes], { type: "image/png" });
        const img = await createImageBitmap(tileBlob);
        ctx.drawImage(img, Math.round(sx * dpr), Math.round(sy * dpr));
      }
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (x, y) => window.scrollTo(x, y),
      args: [scrollX, scrollY],
    });

    const finalBlob = await canvas.convertToBlob({ type: "image/png" });
    const fname = `zing-${Date.now()}.png`;

    const buffer = await finalBlob.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    const chunk = 8192;
    let binary = "";
    for (let i = 0; i < uint8.length; i += chunk) {
      binary += String.fromCharCode(...uint8.subarray(i, i + chunk));
    }
    const dataUrl64 = `data:image/png;base64,${btoa(binary)}`;

    await chrome.downloads.download({
      url: dataUrl64,
      filename: fname,
      saveAs: false,
    });

    return { ok: true, dataUrl: dataUrl64, filename: fname };
  } catch (err) {
    return { error: err.message };
  }
}
