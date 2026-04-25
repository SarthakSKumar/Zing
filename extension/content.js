/* Zing — Content Script
   Highlights page links already in your Zing bookmarks.
   Also handles: color picker tool, pesticide ESC, relay for debugger. */
"use strict";

const OVERLAY_ATTR = "data-zing-overlay";
const LINK_ATTR = "data-zing-checked";
let bookmarkedSlugs = new Set();
let ready = false;

// ─── Slug: pathname + search, no trailing slash, lowercase ───────────────────

function slug(url) {
  try {
    const abs = new URL(url, location.href);
    return (abs.pathname.replace(/\/$/, "") + abs.search).toLowerCase();
  } catch {
    return (url || "").replace(/\/$/, "").toLowerCase();
  }
}

// ─── Find best container div for the link ────────────────────────────────────

function findCardDiv(link) {
  let el = link.parentElement;
  while (el && el !== document.body) {
    if (
      el.tagName === "DIV" ||
      el.tagName === "LI" ||
      el.tagName === "ARTICLE"
    ) {
      const r = el.getBoundingClientRect();
      if (r.width > 60 && r.height > 60) return el;
    }
    el = el.parentElement;
  }
  return link.closest("div");
}

// ─── Apply overlays to all matching links ────────────────────────────────────

function applyOverlays() {
  if (!ready || !bookmarkedSlugs.size) return;

  document.querySelectorAll(`a[href]:not([${LINK_ATTR}])`).forEach((link) => {
    const href = link.getAttribute("href");
    if (!href || href === "#" || href.startsWith("javascript")) return;

    link.setAttribute(LINK_ATTR, "1");
    if (!bookmarkedSlugs.has(slug(href))) return;

    const div = findCardDiv(link);
    if (!div || div.hasAttribute(OVERLAY_ATTR)) return;
    div.setAttribute(OVERLAY_ATTR, "1");

    const pos = window.getComputedStyle(div).position;
    if (pos === "static") div.style.position = "relative";

    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: absolute !important;
      inset: 0 !important;
      background: rgba(245,158,11,0.20) !important;
      z-index: 2147483640 !important;
      pointer-events: none !important;
      border: 1.5px solid rgba(245,158,11,0.50) !important;
      border-radius: inherit !important;
    `;

    const badge = document.createElement("span");
    badge.textContent = "VIEWED";
    badge.style.cssText = `
      position: absolute !important;
      top: 4px !important;
      right: 6px !important;
      background: rgba(245,158,11,0.95) !important;
      color: #000 !important;
      font: 700 9px/1 sans-serif !important;
      letter-spacing: 0.06em !important;
      padding: 2px 5px !important;
      border-radius: 3px !important;
      pointer-events: none !important;
      text-transform: uppercase !important;
    `;
    overlay.appendChild(badge);
    div.appendChild(overlay);
  });
}

// ─── Safe chrome.runtime call ─────────────────────────────────────────────────

function isRuntimeAlive() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

// ─── Load bookmarks via background worker ────────────────────────────────────

function loadBookmarks(forceRefresh = false) {
  if (!isRuntimeAlive()) return;
  try {
    chrome.runtime.sendMessage(
      { type: "GET_BOOKMARK_URLS", forceRefresh },
      (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp?.urls) {
          bookmarkedSlugs = new Set(resp.urls.map(slug));
          ready = true;
          applyOverlays();
        }
      },
    );
  } catch {
    // Extension context invalidated — stop gracefully
  }
}

// ─── MutationObserver for dynamic content ────────────────────────────────────

const observer = new MutationObserver(() => applyOverlays());

function startObserver() {
  try {
    observer.observe(document.body, { childList: true, subtree: true });
  } catch {
    // body not ready
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

loadBookmarks();
if (document.readyState === "complete") {
  startObserver();
} else {
  window.addEventListener("load", startObserver);
}

const _refreshTimer = setInterval(() => {
  if (!isRuntimeAlive()) {
    clearInterval(_refreshTimer);
    observer.disconnect();
    return;
  }
  loadBookmarks(true);
}, 60_000);

// ─── Pesticide inspect bridge: relay MAIN-world event → background → debugger ──

document.addEventListener('__zing-pest-inspect', (e) => {
  if (!isRuntimeAlive()) return;
  try {
    chrome.runtime.sendMessage({ type: 'INSPECT_ELEMENT', selector: e.detail?.selector || '' });
  } catch {}
});

// ─── ESC key: disable any active Zing overlay tools ─────────────────────────

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;

  // Pesticide ESC
  if (window.__zingPesticideStop) {
    window.__zingPesticideStop();
    if (isRuntimeAlive()) {
      try {
        chrome.runtime.sendMessage({ type: 'DISABLE_PESTICIDE' });
      } catch {}
    }
  }

  // Color picker ESC
  if (window.__zingColorPickerStop) {
    window.__zingColorPickerStop();
    if (isRuntimeAlive()) {
      try {
        chrome.runtime.sendMessage({ type: 'DISABLE_COLOR_PICKER' });
      } catch {}
    }
  }
}, true);

// ─── Color Picker injection function (called via executeScript) ───────────────
// This is invoked via chrome.scripting.executeScript from popup.js

function __zingInjectColorPicker() {
  if (window.__zingColorPickerActive) {
    window.__zingColorPickerStop?.();
    return;
  }

  window.__zingColorPickerActive = true;

  // ── Utility: parse rgb/rgba string ────────────────────────────────────────
  function parseRgb(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  }

  function toHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function toHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  }

  // ── Get the effective background color at a point ─────────────────────────
  function getColorAtPoint(x, y) {
    // Get elements at point (from top)
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      if (el.id === '__zing-color-picker' || el.id === '__zing-color-popover') continue;
      if (el.closest('#__zing-color-picker') || el.closest('#__zing-color-popover')) continue;
      const st = window.getComputedStyle(el);
      // Check background color
      const bg = st.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        const c = parseRgb(bg);
        if (c) return { ...c, source: 'bg' };
      }
      // Check text color if we're on a text node
      const color = st.color;
      if (color && el.textContent.trim()) {
        const c = parseRgb(color);
        if (c) return { ...c, source: 'text' };
      }
    }
    // Default to white
    return { r: 255, g: 255, b: 255, source: 'default' };
  }

  // ── Build the magnifier UI ────────────────────────────────────────────────
  const picker = document.createElement('div');
  picker.id = '__zing-color-picker';
  Object.assign(picker.style, {
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    transform: 'translate(16px, 16px)',
    userSelect: 'none',
  });

  // Magnifier circle
  const loupe = document.createElement('div');
  Object.assign(loupe.style, {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.5)',
    boxShadow: '0 2px 12px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,0,0,0.3)',
    background: '#ffffff',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  // Crosshair inside loupe
  const crossH = document.createElement('div');
  Object.assign(crossH.style, {
    position: 'absolute',
    width: '100%',
    height: '1px',
    background: 'rgba(255,255,255,0.7)',
    top: '50%',
    left: '0',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
  });
  const crossV = document.createElement('div');
  Object.assign(crossV.style, {
    position: 'absolute',
    width: '1px',
    height: '100%',
    background: 'rgba(255,255,255,0.7)',
    left: '50%',
    top: '0',
    transform: 'translateX(-50%)',
    pointerEvents: 'none',
  });
  // Center dot
  const dot = document.createElement('div');
  Object.assign(dot.style, {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    border: '1.5px solid rgba(255,255,255,0.9)',
    position: 'absolute',
    zIndex: '1',
  });
  loupe.appendChild(crossH);
  loupe.appendChild(crossV);
  loupe.appendChild(dot);

  // Hex label
  const label = document.createElement('div');
  Object.assign(label.style, {
    background: 'rgba(9,9,11,0.92)',
    color: '#fafafa',
    fontSize: '11px',
    fontFamily: 'monospace',
    fontWeight: '600',
    padding: '3px 8px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.12)',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
    backdropFilter: 'blur(4px)',
  });
  label.textContent = '#FFFFFF';

  picker.appendChild(loupe);
  picker.appendChild(label);
  document.documentElement.appendChild(picker);

  // Change cursor
  document.documentElement.style.setProperty('cursor', 'crosshair', 'important');

  let currentColor = { r: 255, g: 255, b: 255 };

  function onMouseMove(e) {
    if (e.target === picker || picker.contains(e.target)) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    let tx = e.clientX + 20, ty = e.clientY + 20;
    if (tx + 100 > vw) tx = e.clientX - 100;
    if (ty + 100 > vh) ty = e.clientY - 100;
    picker.style.left = tx + 'px';
    picker.style.top = ty + 'px';
    picker.style.transform = 'none';

    const c = getColorAtPoint(e.clientX, e.clientY);
    currentColor = c;
    const hex = toHex(c.r, c.g, c.b);
    loupe.style.background = hex;
    label.textContent = hex;
  }

  function showPopover(e) {
    if (e.target === picker || picker.contains(e.target)) return;
    const c = currentColor;
    const hex = toHex(c.r, c.g, c.b);
    const hsl = toHsl(c.r, c.g, c.b);
    const rgb = `rgb(${c.r}, ${c.g}, ${c.b})`;

    // Build popover
    const pop = document.createElement('div');
    pop.id = '__zing-color-popover';
    Object.assign(pop.style, {
      position: 'fixed',
      zIndex: '2147483647',
      background: '#111113',
      border: '1px solid #27272a',
      borderRadius: '10px',
      padding: '12px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.7)',
      fontFamily: '"Bricolage Grotesque", -apple-system, sans-serif',
      width: '220px',
      userSelect: 'none',
    });

    // Position it
    let px = e.clientX + 10, py = e.clientY + 10;
    if (px + 240 > window.innerWidth) px = e.clientX - 240;
    if (py + 160 > window.innerHeight) py = e.clientY - 160;
    pop.style.left = px + 'px';
    pop.style.top = py + 'px';

    // Color swatch
    const swatch = document.createElement('div');
    Object.assign(swatch.style, {
      width: '100%',
      height: '48px',
      borderRadius: '6px',
      background: hex,
      border: '1px solid rgba(255,255,255,0.08)',
      marginBottom: '10px',
    });

    // Rows for each format
    function makeRow(fmt, val) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 0',
        borderTop: '1px solid #1e1e21',
      });
      const left = document.createElement('div');
      Object.assign(left.style, { display: 'flex', flexDirection: 'column', gap: '1px' });
      const fmtEl = document.createElement('span');
      fmtEl.style.cssText = 'font-size:9px;font-weight:700;color:#3f3f46;text-transform:uppercase;letter-spacing:.06em';
      fmtEl.textContent = fmt;
      const valEl = document.createElement('span');
      valEl.style.cssText = 'font-size:11.5px;font-weight:600;color:#d4d4d8;font-family:monospace';
      valEl.textContent = val;
      left.appendChild(fmtEl);
      left.appendChild(valEl);

      const copyBtn = document.createElement('button');
      Object.assign(copyBtn.style, {
        background: '#1e1e22',
        border: '1px solid #27272a',
        borderRadius: '5px',
        color: '#71717a',
        fontSize: '10px',
        padding: '3px 7px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'color 0.12s',
      });
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(val).catch(() => {});
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      });

      row.appendChild(left);
      row.appendChild(copyBtn);
      return row;
    }

    // Close button
    const closeRow = document.createElement('div');
    Object.assign(closeRow.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '8px',
    });
    const title = document.createElement('span');
    title.style.cssText = 'font-size:11px;font-weight:700;color:#52525b;text-transform:uppercase;letter-spacing:.05em';
    title.textContent = 'Picked Color';
    const closeBtn = document.createElement('button');
    Object.assign(closeBtn.style, {
      background: 'none',
      border: 'none',
      color: '#52525b',
      cursor: 'pointer',
      fontSize: '14px',
      padding: '0',
      lineHeight: '1',
    });
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => pop.remove());
    closeRow.appendChild(title);
    closeRow.appendChild(closeBtn);

    pop.appendChild(closeRow);
    pop.appendChild(swatch);
    pop.appendChild(makeRow('HEX', hex));
    pop.appendChild(makeRow('RGB', rgb));
    pop.appendChild(makeRow('HSL', hsl));

    // Remove any existing popover
    document.getElementById('__zing-color-popover')?.remove();
    document.documentElement.appendChild(pop);

    // Dismiss on outside click
    setTimeout(() => {
      document.addEventListener('click', function dismiss(ev) {
        if (!pop.contains(ev.target)) {
          pop.remove();
          document.removeEventListener('click', dismiss, true);
        }
      }, { capture: true, once: false });
    }, 50);
  }

  function onClick(e) {
    // Show popover at click position, then disable picker
    showPopover(e);
    e.preventDefault();
    e.stopPropagation();
    cleanup();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
      if (isRuntimeAlive()) {
        try {
          chrome.runtime.sendMessage({ type: 'DISABLE_COLOR_PICKER' });
        } catch {}
      }
    }
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    picker.remove();
    document.documentElement.style.removeProperty('cursor');
    window.__zingColorPickerActive = false;
    window.__zingColorPickerStop = null;
  }

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  window.__zingColorPickerStop = cleanup;
}

// Expose so popup can call it via executeScript
window.__zingInjectColorPicker = __zingInjectColorPicker;

// Also need isRuntimeAlive inside __zingInjectColorPicker — re-check
// (the outer isRuntimeAlive is in scope since it's the same script context)
