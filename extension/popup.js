/* Zing — Popup JS */
"use strict";

const API_BASE = "http://localhost:5000";

const dot = document.getElementById("dot");
const btnSave = document.getElementById("btn-save");
const btnShot = document.getElementById("btn-screenshot");
const btnOpen = document.getElementById("btn-open");
const btnBw = document.getElementById("btn-bw");
const togJson = document.getElementById("tog-json");
const togPest = document.getElementById("tog-pest");
const result = document.getElementById("result");
const bwPanel = document.getElementById("bw-panel");

// ── Calendar / Clock ──────────────────────────────────────────────────────────

const DAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function renderWeek() {
  const now = new Date();
  const today = now.getDate();
  const month = now.getMonth();
  const year = now.getFullYear();
  const dow = now.getDay();
  const mondayOffset = (dow + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);

  const grid = document.getElementById("cal-grid");
  grid.innerHTML = "";

  ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach((d) => {
    const el = document.createElement("div");
    el.className = "cal-day-label";
    el.textContent = d;
    grid.appendChild(el);
  });

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const isToday =
      d.getDate() === today &&
      d.getMonth() === month &&
      d.getFullYear() === year;
    const isWeekend = i >= 5;
    const el = document.createElement("div");
    el.className =
      "cal-day" + (isToday ? " today" : "") + (isWeekend ? " weekend" : "");
    el.textContent = d.getDate();
    grid.appendChild(el);
  }
}

function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  document.getElementById("cal-time").textContent = `${h}:${m}:${s}`;
  document.getElementById("cal-weekday").textContent = DAYS_LONG[now.getDay()];
  document.getElementById("cal-fulldate").textContent =
    `${now.getDate()} ${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;
}

(function initClock() {
  renderWeek();
  updateClock();
  setInterval(() => {
    const now = new Date();
    updateClock();
    if (
      now.getHours() === 0 &&
      now.getMinutes() === 0 &&
      now.getSeconds() === 0
    )
      renderWeek();
  }, 1000);
})();

// ── Server ping ───────────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: "PING" }, (resp) => {
  if (resp?.ok) {
    dot.classList.add("ok");
    btnSave.disabled = false;
  } else dot.classList.remove("ok");
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function showResult(msg, type) {
  result.textContent = msg;
  result.className = type;
  result.style.display = msg ? "block" : "none";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ── Save Tabs ─────────────────────────────────────────────────────────────────

btnSave.addEventListener("click", () => {
  btnSave.disabled = true;
  showResult("Saving tabs…", "info");
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const name = `Tabs ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  chrome.runtime.sendMessage(
    { type: "SAVE_TABS", collectionName: name },
    (resp) => {
      btnSave.disabled = false;
      if (resp?.ok) {
        const sk = resp.skipped > 0 ? ` · ${resp.skipped} skipped` : "";
        showResult(
          `✓ Saved ${resp.added} tabs into "${resp.collection}"${sk}`,
          "success",
        );
      } else {
        showResult(`✗ ${resp?.error || "Unknown error"}`, "error");
      }
    },
  );
});

// ── Screenshot ────────────────────────────────────────────────────────────────

btnShot.addEventListener("click", () => {
  btnShot.disabled = true;
  showResult("Capturing… (1 tile/sec, may take a moment)", "info");
  chrome.runtime.sendMessage({ type: "FULL_PAGE_SCREENSHOT" }, async (resp) => {
    btnShot.disabled = false;
    if (resp?.ok) {
      try {
        const r = await fetch(resp.dataUrl);
        const blob = await r.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        showResult(`✓ Saved as ${resp.filename} & copied.`, "success");
      } catch {
        showResult(`✓ Saved as ${resp.filename}.`, "success");
      }
    } else {
      showResult(`✗ ${resp?.error || "Screenshot failed"}`, "error");
    }
  });
});

// ── Open Zing ─────────────────────────────────────────────────────────────────

btnOpen.addEventListener("click", () => {
  chrome.tabs.create({ url: "http://localhost:5000" });
  window.close();
});

// ── JSON Prettify toggle (global preference) ──────────────────────────────────

chrome.storage.local.get(
  { jsonPrettifyEnabled: true },
  ({ jsonPrettifyEnabled }) => {
    togJson.checked = jsonPrettifyEnabled;
  },
);

togJson.addEventListener("change", () => {
  chrome.storage.local.set({ jsonPrettifyEnabled: togJson.checked });
});

// ── Pesticide (per-tab via chrome.storage.session) ────────────────────────────

const PESTICIDE_CSS = `
* , *::before , *::after {
  outline: 1px solid rgba(220,50,50,0.35) !important;
  outline-offset: -1px !important;
}
div, section, article, main, header, footer, aside, nav, figure {
  outline-color: rgba(220,50,50,0.5) !important;
}
span, p, h1, h2, h3, h4, h5, h6, label, li, td, th {
  outline-color: rgba(0,160,255,0.5) !important;
}
img, svg, video, canvas, picture, source {
  outline-color: rgba(255,165,0,0.7) !important;
}
a {
  outline-color: rgba(180,0,255,0.55) !important;
}
button, [role="button"], summary {
  outline-color: rgba(0,220,100,0.65) !important;
}
input, select, textarea, [contenteditable] {
  outline-color: rgba(0,220,220,0.65) !important;
}
*:hover {
  outline-width: 2px !important;
  outline-color: rgba(255,255,255,0.85) !important;
}
#__zing-pest-bar, #__zing-pest-bar *,
#__zing-font-tip, #__zing-font-tip * {
  outline: none !important;
}
`;

// This function is serialised and injected into the page via executeScript.
// It must be self-contained (no closure references).
function __zingInjectPesticideBar(iconUrl) {
  if (window.__zingPesticideStop) window.__zingPesticideStop();

  const bar = document.createElement("div");
  bar.id = "__zing-pest-bar";
  Object.assign(bar.style, {
    position: "fixed",
    bottom: "0",
    left: "0",
    right: "0",
    zIndex: "2147483646",
    background: "rgba(9,9,11,0.94)",
    borderTop: "1px solid #27272a",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 14px",
    fontFamily: '"Bricolage Grotesque", sans-serif',
    fontSize: "12px",
    fontWeight: "600",
    lineHeight: "1.4",
    color: "#52525b",
    boxSizing: "border-box",
    backdropFilter: "blur(8px)",
    minHeight: "32px",
  });

  const infoEl = document.createElement("span");
  infoEl.style.cssText =
    "color:#52525b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%;font:600 13px/1.4 inherit";
  infoEl.textContent = "Ctrl + click to inspect, hover to highlight";

  const rightEl = document.createElement("div");
  rightEl.style.cssText =
    "display:flex;align-items:center;gap:10px;flex-shrink:0";

  const legendEl = document.createElement("div");
  legendEl.style.cssText =
    "display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:500;color:#52525b";

  [
    ["rgba(220,50,50,0.8)", "div"],
    ["rgba(0,160,255,0.8)", "span"],
    ["rgba(255,165,0,0.9)", "img"],
    ["rgba(180,0,255,0.8)", "a"],
    ["rgba(0,220,100,0.8)", "btn"],
    ["rgba(0,220,220,0.8)", "input"],
  ].forEach(([color, label]) => {
    const item = document.createElement("span");
    item.style.cssText = "display:flex;align-items:center;gap:3px";
    const sw = document.createElement("span");
    sw.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};flex-shrink:0`;
    const tx = document.createElement("span");
    tx.textContent = label;
    item.appendChild(sw);
    item.appendChild(tx);
    legendEl.appendChild(item);
  });

  const brandEl = document.createElement("div");
  brandEl.style.cssText =
    "display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#3f3f46;letter-spacing:.04em;border-left:1px solid #27272a;padding-left:10px";

  const logoImg = document.createElement("img");
  logoImg.src = iconUrl;
  logoImg.style.cssText =
    "width:14px;height:14px;border-radius:3px;object-fit:contain";
  const brandTx = document.createElement("span");
  brandTx.textContent = "Zing";
  brandEl.appendChild(logoImg);
  brandEl.appendChild(brandTx);
  rightEl.appendChild(legendEl);
  rightEl.appendChild(brandEl);
  bar.appendChild(infoEl);
  bar.appendChild(rightEl);
  document.documentElement.appendChild(bar);

  function onMouseMove(e) {
    if (!e.ctrlKey) {
      infoEl.style.color = "#52525b";
      infoEl.textContent = "Ctrl + click to inspect, hover to highlight";
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === bar || bar.contains(el)) return;
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === "string" ? el.className.trim() : "";
    const id = el.id ? `#${el.id}` : "";
    const clsStr = cls ? `.${cls.split(/\s+/).filter(Boolean).join(".")}` : "";
    infoEl.style.color = "#fafafa";
    infoEl.textContent = `<${tag}${id}${clsStr}>`;
  }

  // Build a stable CSS selector for any element
  function getCssSelector(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.tagName && cur !== document.documentElement) {
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      let tag = cur.tagName.toLowerCase();
      const par = cur.parentElement;
      if (par) {
        const sibs = Array.from(par.children).filter(s => s.tagName === cur.tagName);
        if (sibs.length > 1) tag += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(tag);
      cur = cur.parentElement;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  function onCtrlClick(e) {
    if (!e.ctrlKey) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === bar || bar.contains(el)) return;
    e.preventDefault();
    e.stopPropagation();
    // Dispatch to isolated world (content.js) which relays to background → debugger
    const selector = getCssSelector(el);
    document.dispatchEvent(new CustomEvent('__zing-pest-inspect', { detail: { selector } }));
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onCtrlClick, true);

  window.__zingPesticideStop = () => {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onCtrlClick, true);
    bar.remove();
    delete window.__zingPesticideStop;
  };
}

// Read per-tab pesticide state on popup open
async function initPesticideToggle() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  const key = `pest_${tab.id}`;
  const data = await chrome.storage.session.get(key);
  togPest.checked = !!data[key];
}

togPest.addEventListener("change", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    togPest.checked = !togPest.checked;
    return;
  }

  const isOn = togPest.checked;
  const key = `pest_${tab.id}`;

  try {
    if (isOn) {
      await chrome.storage.session.set({ [key]: true });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        css: PESTICIDE_CSS,
      });
      const iconUrl = chrome.runtime.getURL("icon128.png");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: __zingInjectPesticideBar,
        args: [iconUrl],
      });
    } else {
      await chrome.storage.session.remove(key);
      await chrome.scripting.removeCSS({
        target: { tabId: tab.id },
        css: PESTICIDE_CSS,
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          window.__zingPesticideStop?.();
        },
      });
    }
  } catch (err) {
    togPest.checked = !isOn; // revert on error
    showResult(`✗ ${err.message}`, "error");
  }
});

initPesticideToggle();

// ── Info popover ──────────────────────────────────────────────────────────────

const btnInfo = document.getElementById("btn-info");
const infoPopover = document.getElementById("info-popover");

btnInfo?.addEventListener("click", (e) => {
  e.stopPropagation();
  infoPopover?.classList.toggle("hidden");
});
document.addEventListener("click", () => infoPopover?.classList.add("hidden"));

// ── Tech icon helpers ─────────────────────────────────────────────────────────

function devicon(name) {
  return `<img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${name}/${name}-original.svg" loading="lazy" onerror="this.style.display='none'" />`;
}
function iconSvg(path) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
function zingIcon() {
  return `<img src="icon128.png" style="width:14px;height:14px;border-radius:3px;object-fit:contain" />`;
}

const TECH_ICONS = {
  javascript: devicon("javascript"),
  typescript: devicon("typescript"),
  react: devicon("react"),
  vue: devicon("vuejs"),
  angular: devicon("angularjs"),
  svelte: devicon("svelte"),
  next: devicon("nextjs"),
  nuxt: devicon("nuxtjs"),
  node: devicon("nodejs"),
  express: devicon("express"),
  python: devicon("python"),
  django: devicon("django"),
  flask: devicon("flask"),
  php: devicon("php"),
  laravel: devicon("laravel"),
  ruby: devicon("ruby"),
  rails: devicon("rails"),
  java: devicon("java"),
  spring: devicon("spring"),
  graphql: devicon("graphql"),
  mysql: devicon("mysql"),
  postgres: devicon("postgresql"),
  mongodb: devicon("mongodb"),
  redis: devicon("redis"),
  docker: devicon("docker"),
  kubernetes: devicon("kubernetes"),
  nginx: devicon("nginx"),
  apache: devicon("apache"),
  cloudflare: devicon("cloudflare"),
  aws: devicon("amazonwebservices"),
  azure: devicon("azure"),
  "google cloud": devicon("googlecloud"),
  wordpress: devicon("wordpress"),
  shopify: devicon("shopify"),
  woocommerce: devicon("woocommerce"),
  magento: devicon("magento"),
  jquery: devicon("jquery"),
  bootstrap: devicon("bootstrap"),
  tailwind: devicon("tailwindcss"),
  sass: devicon("sass"),
  webpack: devicon("webpack"),
  vite: devicon("vitejs"),
  cdn: iconSvg(
    '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  ),
  analytic: iconSvg(
    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  ),
  hosting: iconSvg(
    '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  ),
  cms: iconSvg(
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  ),
  email: iconSvg(
    '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  ),
  ecommerce: iconSvg(
    '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  ),
  security: iconSvg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  social: iconSvg(
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  ),
  font: iconSvg(
    '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  ),
  widget: iconSvg(
    '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  ),
  map: iconSvg('<polygon points="3 11 22 2 13 21 11 13 3 11"/>'),
};

function getTechIcon(name) {
  const lower = (name || "").toLowerCase();
  for (const [key, icon] of Object.entries(TECH_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return zingIcon();
}

function formatEpoch(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── BuiltWith panel ───────────────────────────────────────────────────────────

const GROUP_NAMES = {
  analytics: "Analytics & Tracking",
  ads: "Advertising",
  ns: "Name Server",
  widgets: "Widgets",
  payment: "Payment",
  hosting: "Web Hosting",
  docinfo: "Document Standards",
  mx: "Email Hosting",
  shop: "eCommerce",
  mapping: "Mapping",
  link: "Verified Link",
  cms: "CMS",
};
const EXCLUDED_GROUPS = new Set(["ads", "link", "payment"]);

function buildBwPanel(data) {
  bwPanel.innerHTML = "";
  if (!data || data.error) {
    bwPanel.innerHTML = `<div class="bw-error">⚠ ${data?.error || "No data"}</div>`;
    return;
  }
  const root = data.free1 || data;
  const domain = root.domain || root.Domain || "";
  const groups = root.groups || root.Groups || [];
  const first = root.first || root.First;
  const last = root.last || root.Last;

  const visibleGroups = groups
    .filter((g) => {
      const gName = g.name || g.Name || "";
      const cats = g.categories || g.Categories || [];
      return !EXCLUDED_GROUPS.has(gName) && cats.length > 0;
    })
    .sort((a, b) => {
      const ac = (a.categories || a.Categories || []).length;
      const bc = (b.categories || b.Categories || []).length;
      return ac - bc;
    });

  if (!visibleGroups.length) {
    bwPanel.innerHTML =
      '<div class="bw-meta" style="padding:12px 14px">No technology details found.</div>';
    return;
  }

  const domainHtml = domain
    ? `<a href="https://${domain}" target="_blank" rel="noopener">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>${domain}</a>`
    : `<span style="color:#52525b">Unknown domain</span>`;

  const firstStr = formatEpoch(first);
  const lastStr = formatEpoch(last);
  const metaParts = [
    firstStr && `First: ${firstStr}`,
    lastStr && `Last: ${lastStr}`,
  ]
    .filter(Boolean)
    .join(" · ");

  bwPanel.innerHTML = `
    <div class="bw-domain-row">${domainHtml}</div>
    ${metaParts ? `<div class="bw-meta">${metaParts}</div>` : ""}
  `;

  visibleGroups.forEach((g) => {
    const gName = g.name || g.Name || "";
    const gLive = g.live ?? g.Live ?? 0;
    const gDead = g.dead ?? g.Dead ?? 0;
    const cats = g.categories || g.Categories || [];
    const displayName =
      GROUP_NAMES[gName] || gName.charAt(0).toUpperCase() + gName.slice(1);

    const groupEl = document.createElement("div");
    groupEl.className = "bw-group";
    groupEl.innerHTML = `
      <div class="bw-group-header">
        <div class="bw-cat-icon">${getTechIcon(displayName)}</div>
        <span>${displayName}</span>
        <div class="bw-live-dead">
          ${gLive > 0 ? `<span class="bw-pill bw-pill-live">${gLive} live</span>` : ""}
          ${gDead > 0 ? `<span class="bw-pill bw-pill-dead">${gDead} dead</span>` : ""}
          <svg class="bw-group-toggle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div class="bw-categories"></div>`;

    const catsContainer = groupEl.querySelector(".bw-categories");
    cats.forEach((cat) => {
      const cName = cat.name || cat.Name || "";
      const cLive = cat.live ?? cat.Live ?? 0;
      const cDead = cat.dead ?? cat.Dead ?? 0;
      const row = document.createElement("div");
      row.className = "bw-cat-row";
      row.innerHTML = `
        <div class="bw-cat-icon">${getTechIcon(cName)}</div>
        <span class="bw-cat-name">${cName}</span>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${cLive > 0 ? `<span class="bw-pill bw-pill-live">${cLive}</span>` : ""}
          ${cDead > 0 ? `<span class="bw-pill bw-pill-dead">${cDead}</span>` : ""}
        </div>`;
      catsContainer.appendChild(row);
    });

    groupEl.querySelector(".bw-group-header").addEventListener("click", () => {
      groupEl.classList.toggle("collapsed");
    });
    bwPanel.appendChild(groupEl);
  });
}

let bwOpen = false;

btnBw.addEventListener("click", async () => {
  if (bwOpen) {
    bwPanel.style.display = "none";
    bwOpen = false;
    btnBw.style.borderColor = "";
    return;
  }
  const tab = await getActiveTab();
  if (!tab?.url) {
    showResult("✗ Cannot determine page URL.", "error");
    return;
  }
  let domain;
  try {
    domain = new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {
    showResult("✗ Invalid URL.", "error");
    return;
  }

  bwPanel.innerHTML = `<div class="bw-loading"><div class="bw-spinner"></div>Analysing ${domain}…</div>`;
  bwPanel.style.display = "block";
  bwOpen = true;
  btnBw.style.borderColor = "#27272a";

  try {
    const resp = await fetch(
      `${API_BASE}/api/builtwith?domain=${encodeURIComponent(domain)}`,
    );
    const data = await resp.json();
    buildBwPanel(data);
  } catch (err) {
    bwPanel.innerHTML = `<div class="bw-error">⚠ ${err.message}</div>`;
  }
});
