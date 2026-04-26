/* Zing — Font Inspector (always-on content script)
   Shows a tooltip near the text selection with font details.
   Dismisses only when selection is cleared or user clicks outside.
*/
(function () {
  "use strict";
  if (window.__zingFontInspectorInit) return;
  window.__zingFontInspectorInit = true;

  const DELAY_MS = 1500;
  let _timer = null;
  let _tooltip = null;

  function removeTooltip() {
    if (_tooltip) {
      _tooltip.remove();
      _tooltip = null;
    }
  }

  function isRuntimeAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function getIconUrl() {
    if (!isRuntimeAlive()) return null;
    try {
      return chrome.runtime.getURL("icon128.png");
    } catch {
      return null;
    }
  }

  // ── rgb(r,g,b) → #rrggbb ────────────────────────────────────────────────────

  function rgbToHex(color) {
    const m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
    if (!m) return null;
    return (
      "#" +
      [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, "0")).join("")
    );
  }

  // ── Copy helper ─────────────────────────────────────────────────────────────

  function makeCopyBtn(text) {
    const btn = document.createElement("button");
    btn.textContent = "copy";
    btn.style.cssText =
      "background:#111113!important;border:1px solid #27272a!important;border-radius:5px!important;" +
      "color:#71717a!important;cursor:pointer!important;font:500 11px/1 'BG',-apple-system,system-ui,sans-serif!important;" +
      "padding:3px 8px!important;transition:color .12s,border-color .12s!important;flex-shrink:0!important;";
    btn.addEventListener("mouseenter", () => {
      btn.style.color = "#d4d4d8!important";
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = "✓";
        btn.style.color = "#22c55e!important";
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.color = "";
        }, 1200);
      });
    });
    return btn;
  }

  // ── Label/value rows ─────────────────────────────────────────────────────────

  const WEIGHT_NAMES = {
    100: "Thin",
    200: "ExtraLight",
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "SemiBold",
    700: "Bold",
    800: "ExtraBold",
    900: "Black",
  };

  function makeRow(label, val, copyVal) {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "display:flex!important;flex-direction:column!important;gap:2px!important";

    const lbl = document.createElement("span");
    lbl.style.cssText =
      "font-size:10px!important;text-transform:uppercase!important;letter-spacing:.08em!important;color:#3f3f46!important;font-weight:700!important";
    lbl.textContent = label;

    const row = document.createElement("div");
    row.style.cssText =
      "display:flex!important;align-items:center!important;gap:5px!important";

    const v = document.createElement("span");
    v.style.cssText =
      "font-size:12px!important;color:#a1a1aa!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;flex:1!important;min-width:0!important;font-family:'BG',-apple-system,sans-serif!important";
    v.textContent = val || "—";

    row.appendChild(v);
    if (copyVal) row.appendChild(makeCopyBtn(copyVal));

    wrap.appendChild(lbl);
    wrap.appendChild(row);
    return wrap;
  }

  // ── Tooltip creation ─────────────────────────────────────────────────────────

  function createTooltip(info, rect) {
    removeTooltip();

    const family = (info.family || "").replace(/"/g, "");
    const wLabel = WEIGHT_NAMES[info.weight]
      ? `${info.weight} · ${WEIGHT_NAMES[info.weight]}`
      : info.weight || "—";
    const lsLabel =
      !info.letterSpace || info.letterSpace === "0px"
        ? "normal"
        : info.letterSpace;
    const hex = rgbToHex(info.color);
    const colorLabel = hex || info.color;
    const iconUrl = getIconUrl();

    const t = document.createElement("div");
    t.id = "__zing-font-tip";
    t.style.cssText =
      "position:fixed!important;z-index:2147483647!important;" +
      "background:#0d0d0f!important;color:#a1a1aa!important;" +
      "font:400 13px/1.5 'BG',-apple-system,BlinkMacSystemFont,system-ui,sans-serif!important;" +
      "padding:13px 14px!important;border-radius:10px!important;" +
      "border:1px solid #27272a!important;box-shadow:0 12px 36px rgba(0,0,0,.75)!important;" +
      "min-width:224px!important;max-width:308px!important;" +
      "pointer-events:auto!important;user-select:none!important;box-sizing:border-box!important;";

    // ── Header ────────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.style.cssText =
      "display:flex!important;align-items:center!important;justify-content:space-between!important;" +
      "margin-bottom:10px!important;border-bottom:1px solid #18181b!important;padding-bottom:8px!important";

    const brandEl = document.createElement("div");
    brandEl.style.cssText =
      "display:flex!important;align-items:center!important;gap:5px!important;" +
      "font:700 11px/1 inherit!important;color:#52525b!important;text-transform:uppercase!important;letter-spacing:.08em!important";

    if (iconUrl) {
      const img = document.createElement("img");
      img.src = iconUrl;
      img.style.cssText =
        "width:14px!important;height:14px!important;border-radius:3px!important;object-fit:contain!important";
      brandEl.appendChild(img);
    }
    brandEl.appendChild(document.createTextNode("Zing · Font"));

    const closeBtn = document.createElement("span");
    closeBtn.textContent = "×";
    closeBtn.style.cssText =
      "cursor:pointer!important;color:#52525b!important;font-size:17px!important;" +
      "line-height:1!important;padding:0!important;pointer-events:auto!important;background:none!important;border:none!important;";
    closeBtn.addEventListener("click", removeTooltip);

    header.appendChild(brandEl);
    header.appendChild(closeBtn);
    t.appendChild(header);

    // ── Font family ───────────────────────────────────────────────────────────
    const familyRow = document.createElement("div");
    familyRow.style.cssText =
      "display:flex!important;align-items:center!important;gap:6px!important;margin-bottom:10px!important";

    const familyName = document.createElement("div");
    familyName.style.cssText =
      "color:#fafafa!important;font:700 15px/1 inherit!important;overflow:hidden!important;" +
      "text-overflow:ellipsis!important;white-space:nowrap!important;flex:1!important;min-width:0!important;letter-spacing:-.01em!important";
    familyName.title = family;
    familyName.textContent = family;

    familyRow.appendChild(familyName);
    familyRow.appendChild(makeCopyBtn(family));
    t.appendChild(familyRow);

    // ── Grid of properties ────────────────────────────────────────────────────
    const grid = document.createElement("div");
    grid.style.cssText =
      "display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px 14px!important";
    grid.appendChild(makeRow("Size", info.size));
    grid.appendChild(makeRow("Weight", wLabel));
    grid.appendChild(makeRow("Line Height", info.lineHeight));
    grid.appendChild(makeRow("Letter Spacing", lsLabel));
    grid.appendChild(makeRow("Style", info.style));
    grid.appendChild(makeRow("Align", info.textAlign));
    t.appendChild(grid);

    // ── Color row ─────────────────────────────────────────────────────────────
    const colorSection = document.createElement("div");
    colorSection.style.cssText =
      "margin-top:9px!important;border-top:1px solid #1a1a1e!important;padding-top:8px!important;" +
      "display:flex!important;align-items:center!important;gap:7px!important";

    const swatch = document.createElement("span");
    swatch.style.cssText =
      `width:14px!important;height:14px!important;border-radius:3px!important;flex-shrink:0!important;` +
      `background:${info.color}!important;border:1px solid rgba(255,255,255,.12)!important;display:inline-block!important`;

    const colorInfo = document.createElement("div");
    colorInfo.style.cssText =
      "flex:1!important;min-width:0!important;display:flex!important;flex-direction:column!important;gap:2px!important";

    if (hex) {
      const hexRow = document.createElement("div");
      hexRow.style.cssText =
        "display:flex!important;align-items:center!important;gap:5px!important";
      const hexVal = document.createElement("span");
      hexVal.style.cssText =
        "font-size:12px!important;color:#d4d4d8!important;font-weight:600!important;flex:1!important";
      hexVal.textContent = hex;
      hexRow.appendChild(hexVal);
      hexRow.appendChild(makeCopyBtn(hex));
      colorInfo.appendChild(hexRow);
    }

    const rgbRow = document.createElement("div");
    rgbRow.style.cssText =
      "display:flex!important;align-items:center!important;gap:5px!important";
    const rgbVal = document.createElement("span");
    rgbVal.style.cssText =
      "font-size:10.5px!important;color:#71717a!important;flex:1!important";
    rgbVal.textContent = info.color;
    rgbRow.appendChild(rgbVal);
    rgbRow.appendChild(makeCopyBtn(info.color));
    colorInfo.appendChild(rgbRow);

    colorSection.appendChild(swatch);
    colorSection.appendChild(colorInfo);
    t.appendChild(colorSection);

    // ── Position tooltip near selection ──────────────────────────────────────
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tipW = 260;
    const tipH = 260;

    let left = rect.right + 14;
    let top = rect.top;
    if (left + tipW > vw - 10) left = rect.left - tipW - 14;
    if (left < 10) left = 10;
    if (top + tipH > vh - 10) top = vh - tipH - 10;
    if (top < 10) top = 10;

    t.style.left = left + "px";
    t.style.top = top + "px";

    document.documentElement.appendChild(t);
    _tooltip = t;
  }

  // ── Compute font info ────────────────────────────────────────────────────────

  function getFontInfo(el) {
    const cs = window.getComputedStyle(el);
    return {
      family: cs.fontFamily,
      size: cs.fontSize,
      weight: cs.fontWeight,
      style: cs.fontStyle,
      lineHeight: cs.lineHeight,
      letterSpace: cs.letterSpacing,
      color: cs.color,
      textAlign: cs.textAlign,
    };
  }

  // ── Event listeners ──────────────────────────────────────────────────────────

  // Show tooltip after 2.5s of stable text selection
  document.addEventListener("mouseup", () => {
    clearTimeout(_timer);
    _timer = setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      const el =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
      if (!el) return;
      createTooltip(getFontInfo(el), rect);
    }, DELAY_MS);
  });

  // Dismiss tooltip when selection is cleared; ignore clicks inside tooltip
  document.addEventListener("mousedown", (e) => {
    clearTimeout(_timer);
    if (_tooltip && _tooltip.contains(e.target)) return;
    removeTooltip();
  });

  // Dismiss tooltip when text is deselected (keyboard Escape, click away, etc.)
  document.addEventListener("selectionchange", () => {
    if (!_tooltip) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      removeTooltip();
    }
  });
})();
