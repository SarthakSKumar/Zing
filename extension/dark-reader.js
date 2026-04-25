/* Zing — Dark Reader content script
   Runs at document_start on every page.
   Checks if dark reader is enabled for this tab and applies smart dark mode.
*/
(function () {
  'use strict';

  if (window.__zingDarkReaderInit) return;
  window.__zingDarkReaderInit = true;

  const STYLE_ID = '__zing-dark-reader';

  // CSS applied to light pages — inverts colors then re-inverts media
  const DARK_CSS = `
html {
  filter: invert(1) hue-rotate(180deg) !important;
  background: #111 !important;
}
img, video, iframe, canvas, picture, svg image, embed, object,
[style*="background-image"] {
  filter: invert(1) hue-rotate(180deg) !important;
}
#__zing-pest-bar, #__zing-font-tip, #__zing-color-picker,
#__zing-color-popover {
  filter: none !important;
}
`;

  function isRuntimeAlive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  // Relative luminance (WCAG formula)
  function sRGBLuminance(r, g, b) {
    const c = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function parseRgb(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: str.includes('rgba') ? parseFloat(str.split(',')[3]) : 1 };
  }

  function getPageLuminance() {
    const els = [document.documentElement, document.body].filter(Boolean);
    for (const el of els) {
      const bg = window.getComputedStyle(el).backgroundColor;
      const c = parseRgb(bg);
      if (!c) continue;
      // Transparent or nearly transparent — not a real background
      if (c.a < 0.05) continue;
      // rgba(0,0,0,0) Chrome default — skip
      if (c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0) continue;
      return sRGBLuminance(c.r, c.g, c.b);
    }
    return 1; // assume light (white) if no background found
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = DARK_CSS;
    (document.head || document.documentElement).appendChild(style);
    window.__zingDarkReaderOn = true;
  }

  function removeStyle() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
    window.__zingDarkReaderOn = false;
  }

  function applyIfNeeded() {
    const lum = getPageLuminance();
    if (lum < 0.12) {
      // Page is already dark — don't invert; remove any pre-injected CSS
      removeStyle();
      window.__zingDarkReaderSkipped = true;
      return;
    }
    injectStyle();
    window.__zingDarkReaderSkipped = false;
  }

  // Called once when we confirm dark reader should be on
  function activate() {
    // Apply immediately (before DOM is rendered) — avoids flash of white
    injectStyle();
    // Then re-check at DOMContentLoaded: remove if page turned out to be dark
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyIfNeeded, { once: true });
    } else {
      applyIfNeeded();
    }
  }

  // Public API used by popup.js via executeScript
  window.__zingDarkReaderActivate = activate;
  window.__zingDarkReaderDeactivate = removeStyle;

  // ── ESC key: turn off dark reader on this tab ────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!window.__zingDarkReaderOn) return;
    removeStyle();
    // Tell background to clear state for this tab
    if (isRuntimeAlive()) {
      try {
        chrome.runtime.sendMessage({ type: 'SET_DARK_READER_STATE', enabled: false });
      } catch {}
    }
  }, true);

  // ── Check storage on load ────────────────────────────────────────────────
  function init() {
    if (!isRuntimeAlive()) return;
    try {
      chrome.runtime.sendMessage({ type: 'GET_DARK_READER_STATE' }, function (resp) {
        if (chrome.runtime.lastError) return;
        if (resp && resp.enabled) activate();
      });
    } catch {}
  }

  init();
})();
