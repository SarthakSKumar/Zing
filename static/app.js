/* URL Manager — SPA v3 */
"use strict";

// ─── STATE ───────────────────────────────────────────────────────────────────

const state = {
  collections: [],
  activeId: null,
  view: "list",
  openedIds: new Set(),
  privateMode: true,
  selectedCards: new Set(),
  selectedColIds: new Set(), // for global random picker (empty = all)
  // filter/sort per collection (keyed by colId)
  sortBy: "latest", // 'latest' | 'oldest' | 'most-opened'
  filterSites: new Set(), // domains to show (empty = all)
};

let pollTimer = null;
let softRefreshTimer = null;

// ─── DOM REFS ─────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const dom = {
  sidebar: $("collection-list"),
  emptyState: $("empty-state"),
  collectionView: $("collection-view"),
  colTitle: $("col-title"),
  colCount: $("col-count"),
  urlContainer: $("url-container"),
  btnOpenRandom: $("btn-open-random"),
  btnResetSession: $("btn-reset-session"),
  btnPrivate: $("btn-private-toggle"),
  btnGrid: $("btn-grid"),
  btnList: $("btn-list"),
  btnNewCol: $("btn-new-collection"),
  btnEmptyNew: $("btn-empty-new"),
  btnEditName: $("btn-edit-name"),
  btnDeleteCol: $("btn-delete-col"),
  btnCreateCol: $("btn-create-col"),
  inputNewColName: $("input-new-col-name"),
  inputNewColPin: $("input-new-col-pin"),
  modalNewCol: $("modal-new-col"),
  modalUnlock: $("modal-unlock"),
  unlockColName: $("unlock-col-name"),
  inputUnlockPin: $("input-unlock-pin"),
  unlockError: $("unlock-error"),
  btnConfirmUnlock: $("btn-confirm-unlock"),
  btnConfirmDelete: $("btn-confirm-delete"),
  inputDeletePin: $("input-delete-pin"),
  deletePinError: $("delete-pin-error"),
  deletePinWrap: $("delete-pin-wrap"),
  btnConfirmBulkDel: $("btn-confirm-bulk-delete"),
  bulkDelCount: $("bulk-del-count"),
  toastContainer: $("toast-container"),
  loadingOverlay: $("loading-overlay"),
  loadingText: $("loading-text"),
  selectionBar: $("selection-bar"),
  selectionCount: $("selection-count"),
  btnDeleteSelected: $("btn-delete-selected"),
  btnClearSelection: $("btn-clear-selection"),
  // random panel
  colPickerBtn: $("btn-col-picker"),
  colPickerLabel: $("col-picker-label"),
  colPickerDropdown: $("col-picker-dropdown"),
  // filter bar
  btnSort: $("btn-sort"),
  sortLabel: $("sort-label"),
  sortPopover: $("sort-popover"),
  sortPopoverWrap: $("sort-popover-wrap"),
  btnSiteFilter: $("btn-site-filter"),
  siteFilterLabel: $("site-filter-label"),
  siteFilterPopover: $("site-filter-popover"),
  siteFilterWrap: $("site-filter-wrap"),
  activeFiltersRow: $("active-filters-row"),
  btnClearFilters: $("btn-clear-filters"),
};

// ─── API ─────────────────────────────────────────────────────────────────────

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const e = await res.text().catch(() => res.statusText);
    throw new Error(e || `HTTP ${res.status}`);
  }
  return res.json();
}
const GET = (p) => api(p);
const POST = (p, b) => api(p, { method: "POST", body: JSON.stringify(b) });
const PATCH = (p, b) => api(p, { method: "PATCH", body: JSON.stringify(b) });
const DEL = (p, b) => api(p, { method: "DELETE", ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });

// ─── TOAST ───────────────────────────────────────────────────────────────────

function toast(msg, type = "info", duration = 3200) {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  dom.toastContainer.appendChild(t);
  setTimeout(() => {
    t.style.animation = "toast-out 0.15s ease forwards";
    setTimeout(() => t.remove(), 150);
  }, duration);
}
function showLoading(text = "Please wait…") {
  dom.loadingText.textContent = text;
  dom.loadingOverlay.classList.remove("hidden");
}
function hideLoading() {
  dom.loadingOverlay.classList.add("hidden");
}

// ─── MODALS ───────────────────────────────────────────────────────────────────

function openModal(id) {
  $(id)?.classList.remove("hidden");
}
function closeModal(id) {
  $(id)?.classList.add("hidden");
}
document
  .querySelectorAll(".modal-close")
  .forEach((btn) =>
    btn.addEventListener("click", () => closeModal(btn.dataset.modal)),
  );
document.querySelectorAll(".modal-backdrop").forEach((bd) =>
  bd.addEventListener("click", (e) => {
    if (e.target === bd) bd.classList.add("hidden");
  }),
);

// ─── OG POLL ─────────────────────────────────────────────────────────────────

function startOgPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const cols = await GET("/api/collections");
      state.collections = cols;
      const col = cols.find((c) => c.id === state.activeId);
      if (!col) {
        stopOgPoll();
        return;
      }
      renderCollectionContent(col);
      if (!col.urls.some((u) => u.og_fetched === false)) stopOgPoll();
    } catch {
      stopOgPoll();
    }
  }, 2000);
}
function stopOgPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ─── SOFT REFRESH — auto-detects lock state changes & new collections ─────────

function collectionsChanged(oldCols, newCols) {
  if (!oldCols || oldCols.length !== newCols.length) return true;
  for (let i = 0; i < newCols.length; i++) {
    const o = oldCols.find(c => c.id === newCols[i].id);
    if (!o) return true;
    // Check lock state change (the important one for the 2-minute lock countdown)
    if (o.locked !== newCols[i].locked) return true;
    if (o.unlocked !== newCols[i].unlocked) return true;
    // Check name / URL count changes
    if (o.name !== newCols[i].name) return true;
    if (o.urls.length !== newCols[i].urls.length) return true;
  }
  return false;
}

async function startSoftRefresh() {
  if (softRefreshTimer) clearInterval(softRefreshTimer);
  // Read interval from settings (default 30s)
  let intervalMs = 30_000;
  try {
    const s = await GET("/api/settings");
    if (s?.softRefreshInterval) intervalMs = s.softRefreshInterval * 1000;
  } catch {}
  softRefreshTimer = setInterval(async () => {
    try {
      const cols = await GET("/api/collections");
      if (collectionsChanged(state.collections, cols)) {
        state.collections = cols;
        renderSidebar();
        renderColPickerDropdown();
        if (state.activeId) {
          const col = cols.find(c => c.id === state.activeId);
          if (col && !col.locked) {
            renderCollectionContent(col);
          } else if (!col) {
            state.activeId = null;
            showView("empty");
          }
        }
      }
    } catch {}
  }, intervalMs);
}

// ─── DATA LOAD ────────────────────────────────────────────────────────────────

async function loadAll() {
  const [cols, sess] = await Promise.all([
    GET("/api/collections"),
    GET("/api/session/status"),
  ]);
  state.collections = cols;
  state.openedIds = new Set(sess.opened_ids || []);
  renderSidebar();
  renderColPickerDropdown();
  if (state.activeId) {
    const col = state.collections.find((c) => c.id === state.activeId);
    if (col) renderCollectionContent(col);
    else {
      state.activeId = null;
      showView("empty");
    }
  }
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────

function renderSidebar() {
  dom.sidebar.innerHTML = "";
  if (!state.collections.length) {
    dom.sidebar.innerHTML =
      '<p style="padding:8px 14px;font-size:0.75rem;color:var(--text-xs);">No collections yet</p>';
    return;
  }
  const urlMap = new Map();
  state.collections.forEach((c) =>
    c.urls.forEach((u) => {
      if (!urlMap.has(u.url)) urlMap.set(u.url, []);
      urlMap.get(u.url).push(c.id);
    }),
  );
  state.collections.forEach((col) => {
    const dupCount = col.urls.filter(
      (u) => (urlMap.get(u.url) || []).length > 1,
    ).length;
    const isLocked = col.locked && !col.unlocked;
    const item = document.createElement("div");
    item.className =
      "col-item" +
      (col.id === state.activeId ? " active" : "") +
      (isLocked ? " col-locked" : "");
    item.dataset.id = col.id;
    const lockIcon = isLocked
      ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.5;flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
      : "";
    item.innerHTML = `
      ${lockIcon}
      <span class="col-item-name">${escHtml(col.name)}</span>
      ${!isLocked ? `<span class="col-item-badges">
        ${dupCount > 0 ? `<span class="col-badge-dup" title="${dupCount} dup">${dupCount}</span>` : ""}
        <span class="col-item-badge">${col.urls.length}</span>
      </span>` : ""}`;
    item.addEventListener("click", () => {
      if (isLocked) {
        promptUnlock(col);
        return;
      }
      selectCollection(col.id);
    });
    dom.sidebar.appendChild(item);
  });
  // update global random button state
  updateGlobalRandomBtn();
}

// ─── COLLECTION PICKER DROPDOWN ──────────────────────────────────────────────

function renderColPickerDropdown() {
  if (!dom.colPickerDropdown) return;
  dom.colPickerDropdown.innerHTML = "";

  // "All" option at top
  const allOpt = document.createElement("div");
  allOpt.className = "picker-option";
  allOpt.innerHTML = `
    <input type="checkbox" id="picker-all" ${state.selectedColIds.size === 0 ? "checked" : ""} />
    <span class="picker-option-name">All collections</span>
    <span class="picker-option-count">${state.collections.reduce((s, c) => s + c.urls.length, 0)}</span>`;
  allOpt.querySelector("input").addEventListener("change", (e) => {
    if (e.target.checked) {
      state.selectedColIds.clear();
      renderColPickerDropdown();
    }
  });
  dom.colPickerDropdown.appendChild(allOpt);

  state.collections.forEach((col) => {
    // Only show unlocked or unlockable collections in picker
    const isLocked = col.locked && !col.unlocked;
    if (isLocked) return; // skip locked collections in random picker
    const opt = document.createElement("div");
    opt.className = "picker-option";
    const checked = state.selectedColIds.has(col.id);
    opt.innerHTML = `
      <input type="checkbox" ${checked ? "checked" : ""} />
      <span class="picker-option-name">${escHtml(col.name)}</span>
      <span class="picker-option-count">${col.urls.length}</span>`;
    opt.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) state.selectedColIds.add(col.id);
      else state.selectedColIds.delete(col.id);
      // if none checked → treat as all
      renderColPickerDropdown();
      updateColPickerLabel();
    });
    dom.colPickerDropdown.appendChild(opt);
  });
  updateColPickerLabel();
}

function updateColPickerLabel() {
  if (!dom.colPickerLabel) return;
  if (state.selectedColIds.size === 0) {
    dom.colPickerLabel.textContent = "All collections";
  } else if (state.selectedColIds.size === 1) {
    const col = state.collections.find(
      (c) => c.id === [...state.selectedColIds][0],
    );
    dom.colPickerLabel.textContent = col ? col.name : "1 collection";
  } else {
    dom.colPickerLabel.textContent = `${state.selectedColIds.size} collections`;
  }
  updateGlobalRandomBtn();
}

function updateGlobalRandomBtn() {
  if (!dom.btnOpenRandom) return;
  const eligible = state.collections
    .filter(
      (c) => state.selectedColIds.size === 0 || state.selectedColIds.has(c.id),
    )
    .flatMap((c) => c.urls.filter((u) => !state.openedIds.has(u.id)));
  dom.btnOpenRandom.disabled = eligible.length === 0;
}

// Picker toggle
dom.colPickerBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  dom.colPickerDropdown?.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (
    !dom.colPickerDropdown?.contains(e.target) &&
    e.target !== dom.colPickerBtn
  ) {
    dom.colPickerDropdown?.classList.remove("open");
  }
});

// ─── COLLECTION SELECT ────────────────────────────────────────────────────────

function selectCollection(id) {
  state.activeId = id;
  state.selectedCards.clear();
  state.filterSites.clear();
  updateSelectionBar();
  stopOgPoll();
  const col = state.collections.find((c) => c.id === id);
  if (!col) return;
  showView("collection");
  renderCollection(col);
  renderSidebar();
  renderSiteFilterPopover(col);
  if (col.urls.some((u) => u.og_fetched === false)) startOgPoll();
}

function showView(which) {
  dom.emptyState.classList.toggle("hidden", which !== "empty");
  dom.collectionView.classList.toggle("hidden", which === "empty");
}

// ─── COLLECTION RENDER ───────────────────────────────────────────────────────

function renderCollection(col) {
  dom.colTitle.textContent = col.name;
  dom.colTitle.dataset.id = col.id;
  dom.btnOpenRandom.disabled = false; // global btn; per-col disabled by updateGlobalRandomBtn
  renderCollectionContent(col);
}

function renderCollectionContent(col) {
  const count = col.urls.length;
  dom.colCount.textContent = `${count} URL${count !== 1 ? "s" : ""}`;
  const sorted = applySortFilter(col.urls);
  const dupMap = buildDupMap();
  if (state.view === "grid") renderGrid(col, sorted, dupMap);
  else renderList(col, sorted, dupMap);
  renderActiveFilterPills();
}

// ─── SORT / FILTER ───────────────────────────────────────────────────────────

const SORT_LABELS = {
  latest: "Latest",
  oldest: "Oldest",
  "most-opened": "Most opened",
};

function applySortFilter(urls) {
  let list = [...urls];

  // Site filter
  if (state.filterSites.size > 0) {
    list = list.filter((u) => state.filterSites.has(getDomain(u.url)));
  }

  // Sort (preserve opened-at-end grouping for 'latest'/'oldest')
  if (state.sortBy === "most-opened") {
    list.sort((a, b) => (b.open_count || 0) - (a.open_count || 0));
  } else if (state.sortBy === "oldest") {
    list.sort((a, b) => (a.added_at || "").localeCompare(b.added_at || ""));
  } else {
    // latest = newest added first (but opened ones still float to end)
    const notOpened = list
      .filter((u) => !u.last_opened_at)
      .sort((a, b) => (b.added_at || "").localeCompare(a.added_at || ""));
    const opened = list
      .filter((u) => u.last_opened_at)
      .sort((a, b) =>
        (a.last_opened_at || "").localeCompare(b.last_opened_at || ""),
      );
    return [...notOpened, ...opened];
  }
  return list;
}

// Sort popover
dom.btnSort?.addEventListener("click", (e) => {
  e.stopPropagation();
  dom.sortPopover?.classList.toggle("open");
});
document.querySelectorAll(".sort-option").forEach((opt) => {
  opt.addEventListener("click", () => {
    state.sortBy = opt.dataset.sort;
    document
      .querySelectorAll(".sort-option")
      .forEach((o) =>
        o.classList.toggle("selected", o.dataset.sort === state.sortBy),
      );
    dom.sortLabel.textContent = SORT_LABELS[state.sortBy];
    dom.sortPopover?.classList.remove("open");
    const col = state.collections.find((c) => c.id === state.activeId);
    if (col) renderCollectionContent(col);
  });
});
document.addEventListener("click", (e) => {
  if (!dom.sortPopoverWrap?.contains(e.target))
    dom.sortPopover?.classList.remove("open");
  if (!dom.siteFilterWrap?.contains(e.target))
    dom.siteFilterPopover?.classList.remove("open");
});

// Site filter popover
dom.btnSiteFilter?.addEventListener("click", (e) => {
  e.stopPropagation();
  dom.siteFilterPopover?.classList.toggle("open");
});

function renderSiteFilterPopover(col) {
  if (!dom.siteFilterPopover) return;
  dom.siteFilterPopover.innerHTML = "";

  const domainCounts = new Map();
  col.urls.forEach((u) => {
    const d = getDomain(u.url);
    domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
  });

  const domains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
  domains.forEach(([domain, count]) => {
    const favicon =
      col.urls.find((u) => getDomain(u.url) === domain)?.favicon || "";
    const checked = state.filterSites.has(domain);
    const item = document.createElement("div");
    item.className = "popover-item";
    const faviconHtml = favicon
      ? `<img class="popover-favicon" src="${escAttr(favicon)}" loading="lazy" alt="" onerror="this.style.display='none'" />`
      : `<div class="popover-favicon-placeholder">${escHtml(domain.charAt(0).toUpperCase())}</div>`;
    item.innerHTML = `
      <input type="checkbox" ${checked ? "checked" : ""} />
      ${faviconHtml}
      <span class="popover-domain">${escHtml(domain)}</span>
      <span class="popover-count">${count}</span>`;
    item.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) state.filterSites.add(domain);
      else state.filterSites.delete(domain);
      const col = state.collections.find((c) => c.id === state.activeId);
      if (col) renderCollectionContent(col);
    });
    dom.siteFilterPopover.appendChild(item);
  });
}

function renderActiveFilterPills() {
  if (!dom.activeFiltersRow) return;
  dom.activeFiltersRow.innerHTML = "";
  state.filterSites.forEach((domain) => {
    const pill = document.createElement("div");
    pill.className = "active-filter-pill";
    pill.innerHTML = `${escHtml(domain)}<button title="Remove">&times;</button>`;
    pill.querySelector("button").addEventListener("click", () => {
      state.filterSites.delete(domain);
      const col = state.collections.find((c) => c.id === state.activeId);
      if (col) {
        renderSiteFilterPopover(col);
        renderCollectionContent(col);
      }
    });
    dom.activeFiltersRow.appendChild(pill);
  });
  dom.btnClearFilters?.classList.toggle("hidden", state.filterSites.size === 0);
  dom.btnSiteFilter?.classList.toggle(
    "active-filter",
    state.filterSites.size > 0,
  );
}

dom.btnClearFilters?.addEventListener("click", () => {
  state.filterSites.clear();
  const col = state.collections.find((c) => c.id === state.activeId);
  if (col) {
    renderSiteFilterPopover(col);
    renderCollectionContent(col);
  }
});

// ─── DUP MAP ─────────────────────────────────────────────────────────────────

function buildDupMap() {
  const map = new Map();
  state.collections.forEach((col) =>
    col.urls.forEach((u) => {
      if (!map.has(u.url)) map.set(u.url, []);
      map.get(u.url).push(col.name);
    }),
  );
  return map;
}

// ─── GRID ─────────────────────────────────────────────────────────────────────

function renderGrid(col, urls, dupMap) {
  dom.urlContainer.innerHTML = "";
  if (!urls.length) {
    dom.urlContainer.appendChild(emptyColState());
    return;
  }
  const grid = document.createElement("div");
  grid.className = "url-grid";
  urls.forEach((u) => {
    const isSession = state.openedIds.has(u.id);
    const isEver = isSession || !!u.last_opened_at;
    const isPending = u.og_fetched === false;
    const dupNames = (dupMap.get(u.url) || []).filter((n) => n !== col.name);
    const isDup = dupNames.length > 0;
    const isSelected = state.selectedCards.has(u.id);
    const domain = getDomain(u.url);
    const initial = domain.charAt(0).toUpperCase();

    const card = document.createElement("div");
    card.className = [
      "url-card",
      isDup ? "is-duplicate" : "",
      isSelected ? "is-selected" : "",
      isEver ? "is-opened" : "",
    ]
      .filter(Boolean)
      .join(" ");
    card.dataset.id = u.id;
    card.title = u.url;

    const fallbackInner = u.favicon
      ? `<img class="favicon-lg" src="${escAttr(u.favicon)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
      : `<div class="domain-initial">${escHtml(initial)}</div>`;
    const ogImg = u.og_image
      ? `<img class="card-og-img" src="${escAttr(u.og_image)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
      : "";
    const faviconFloat = u.favicon
      ? `<div class="card-favicon-float"><img src="${escAttr(u.favicon)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'" /></div>`
      : "";
    const openedOverlay = isSession
      ? `<div class="card-opened-overlay"><div class="card-check"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div></div>`
      : isEver
        ? `<div class="card-opened-overlay dim"></div>`
        : "";
    const shimmer =
      isPending && !u.og_image ? `<div class="card-shimmer"></div>` : "";
    const lastOpenedHtml = u.last_opened_at
      ? `<div class="card-last-opened">Opened ${timeAgo(u.last_opened_at)}</div>`
      : "";
    const openCountHtml =
      u.open_count > 0
        ? `<div class="card-open-count" title="${u.open_count} opens"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>${u.open_count}</div>`
        : "";
    const dupBadge = isDup
      ? `<div class="tooltip-wrap"><span class="badge badge-duplicate">Dup</span><div class="tooltip-box">Also in: ${dupNames.map(escHtml).join(", ")}</div></div>`
      : "";

    card.innerHTML = `
      <button class="card-delete" title="Remove"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div class="card-image-wrap">
        <div class="card-image-placeholder">${fallbackInner}</div>
        ${ogImg}${faviconFloat}${openedOverlay}${shimmer}
      </div>
      <div class="card-body">
        <div class="card-title">${escHtml(u.title || domain)}</div>
        ${lastOpenedHtml}
        <div class="card-bottom-row">${openCountHtml}${dupBadge}</div>
      </div>`;

    const selOverlay = document.createElement("div");
    selOverlay.className = "card-select-overlay";
    selOverlay.innerHTML = `<div class="card-select-check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`;
    card.appendChild(selOverlay);

    card.addEventListener("contextmenu", (e) => showContextMenu(e, u, col));
    card.addEventListener("click", (e) => {
      if (e.target.closest(".card-delete")) return;
      // Ctrl/Meta + click while selection active = toggle select
      if (
        state.selectedCards.size > 0 ||
        ((e.ctrlKey || e.metaKey) && state.selectedCards.size > 0)
      ) {
        toggleSelect(u.id);
        renderCollectionContent(col);
        return;
      }
      // Ctrl/Meta click = open URL
      if (e.ctrlKey || e.metaKey) {
        handleOpen(u, col);
        return;
      }
      // Plain click = copy URL to clipboard
      copyToClipboard(u.url, "URL copied to clipboard.");
    });
    card.querySelector(".card-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSingle(col.id, u.id);
    });
    grid.appendChild(card);
  });
  dom.urlContainer.appendChild(grid);
}

// ─── LIST ─────────────────────────────────────────────────────────────────────

function renderList(col, urls, dupMap) {
  dom.urlContainer.innerHTML = "";
  if (!urls.length) {
    dom.urlContainer.appendChild(emptyColState());
    return;
  }
  const list = document.createElement("div");
  list.className = "url-list";
  urls.forEach((u) => {
    const isEver = state.openedIds.has(u.id) || !!u.last_opened_at;
    const dupNames = (dupMap.get(u.url) || []).filter((n) => n !== col.name);
    const isDup = dupNames.length > 0;
    const isSelected = state.selectedCards.has(u.id);
    const domain = getDomain(u.url);

    const row = document.createElement("div");
    row.className = [
      "url-list-item",
      isEver ? "is-opened" : "",
      isDup ? "is-duplicate" : "",
      isSelected ? "is-selected" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const faviconHtml = u.favicon
      ? `<img class="list-favicon" src="${escAttr(u.favicon)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'list-favicon-placeholder\\'>${escHtml(domain.charAt(0).toUpperCase())}</div>'" />`
      : `<div class="list-favicon-placeholder">${escHtml(domain.charAt(0).toUpperCase())}</div>`;

    const addedDate = u.added_at
      ? new Date(u.added_at).toLocaleDateString()
      : "";
    const lastOpenedStr = u.last_opened_at
      ? `Opened ${timeAgo(u.last_opened_at)}`
      : "";
    const eyeHtml =
      u.open_count > 0
        ? `<span class="list-eye-count" title="${u.open_count} opens"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>${u.open_count}</span>`
        : "";
    const dupHtml = isDup
      ? `<div class="tooltip-wrap"><span class="badge badge-duplicate">Dup</span><div class="tooltip-box">Also in: ${dupNames.map(escHtml).join(", ")}</div></div>`
      : "";

    row.innerHTML = `
      ${faviconHtml}
      <div class="list-title-col">
        <span class="list-title">${escHtml(u.title || domain)}</span>
        <span class="list-url">${escHtml(u.url)}</span>
      </div>
      <div class="list-badges">${dupHtml}</div>
      <div class="list-meta">
        ${eyeHtml}
        <span class="list-date">${addedDate}</span>
        ${lastOpenedStr ? `<span class="list-opened-text">${escHtml(lastOpenedStr)}</span>` : ""}
      </div>
      <button class="list-delete-btn" title="Remove"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;

    row.addEventListener("contextmenu", (e) => showContextMenu(e, u, col));
    row.addEventListener("click", (e) => {
      if (e.target.closest(".list-delete-btn")) return;
      if (
        state.selectedCards.size > 0 ||
        ((e.ctrlKey || e.metaKey) && state.selectedCards.size > 0)
      ) {
        toggleSelect(u.id);
        renderCollectionContent(col);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        handleOpen(u, col);
        return;
      }
      copyToClipboard(u.url, "URL copied.");
    });
    row.querySelector(".list-delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSingle(col.id, u.id);
    });
    list.appendChild(row);
  });
  dom.urlContainer.appendChild(list);
}

function emptyColState() {
  const div = document.createElement("div");
  div.className = "col-empty-state";
  div.innerHTML = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg><p>No URLs — paste with <kbd style="font-family:monospace;background:var(--bg-4);border:1px solid var(--border-2);border-radius:3px;padding:0 4px">Ctrl+V</kbd></p>`;
  return div;
}

// ─── OPEN URL ─────────────────────────────────────────────────────────────────

async function handleOpen(u, col) {
  if (state.privateMode) {
    try {
      const res = await POST("/api/open-url", {
        url: u.url,
        collection_id: col.id,
        url_id: u.id,
      });
      if (res.error === "brave_not_found") {
        toast(res.message, "error", 6000);
        return;
      }
      state.openedIds.add(u.id);
      await loadAll();
      const fresh = state.collections.find((c) => c.id === state.activeId);
      if (fresh) renderCollection(fresh);
    } catch (err) {
      toast(`Error: ${err.message}`, "error");
    }
  } else {
    window.open(u.url, "_blank", "noopener,noreferrer");
  }
}

// ─── GLOBAL RANDOM ───────────────────────────────────────────────────────────

dom.btnOpenRandom?.addEventListener("click", async () => {
  dom.btnOpenRandom.disabled = true;
  const cids = [...state.selectedColIds];
  try {
    const res = await POST("/api/open-random-global", {
      collection_ids: cids,
      count: 7,
      private: state.privateMode,
    });
    if (!res.opened.length) {
      toast(res.message, "warning");
    } else {
      res.opened.forEach((id) => state.openedIds.add(id));
      if (res.error === "brave_not_found") toast(res.message, "error", 6000);
      else toast(res.message, "success");
      // Reset selected collections after opening
      state.selectedColIds.clear();
      await loadAll();
      const col = state.collections.find((c) => c.id === state.activeId);
      if (col) renderCollection(col);
    }
  } catch (err) {
    toast(`Error: ${err.message}`, "error");
  } finally {
    dom.btnOpenRandom.disabled = false;
    updateGlobalRandomBtn();
  }
});

// ─── RESET SESSION ────────────────────────────────────────────────────────────

dom.btnResetSession?.addEventListener("click", async () => {
  try {
    await POST("/api/session/reset", {});
    state.openedIds.clear();
    await loadAll();
    const col = state.collections.find((c) => c.id === state.activeId);
    if (col) renderCollection(col);
    toast("Session reset.", "success");
  } catch (err) {
    toast(`Error: ${err.message}`, "error");
  }
});

// ─── PRIVATE TOGGLE ──────────────────────────────────────────────────────────

dom.btnPrivate?.addEventListener("click", () => {
  state.privateMode = !state.privateMode;
  syncPrivateBtn();
});
function syncPrivateBtn() {
  if (!dom.btnPrivate) return;
  dom.btnPrivate.classList.toggle("active", state.privateMode);
  dom.btnPrivate.title = state.privateMode ? "Private ON" : "Private OFF";
  const lbl = dom.btnPrivate.querySelector(".private-label");
  if (lbl) lbl.textContent = state.privateMode ? "Private" : "Public";
}

// ─── VIEW TOGGLE ─────────────────────────────────────────────────────────────

dom.btnGrid?.addEventListener("click", () => {
  if (state.view === "grid") return;
  state.view = "grid";
  dom.btnGrid.classList.add("active");
  dom.btnList.classList.remove("active");
  const col = state.collections.find((c) => c.id === state.activeId);
  if (col) renderCollectionContent(col);
});
dom.btnList?.addEventListener("click", () => {
  if (state.view === "list") return;
  state.view = "list";
  dom.btnList.classList.add("active");
  dom.btnGrid.classList.remove("active");
  const col = state.collections.find((c) => c.id === state.activeId);
  if (col) renderCollectionContent(col);
});

// ─── NEW COLLECTION ───────────────────────────────────────────────────────────

function openNewColModal() {
  dom.inputNewColName.value = "";
  if (dom.inputNewColPin) dom.inputNewColPin.value = "";
  openModal("modal-new-col");
  setTimeout(() => dom.inputNewColName.focus(), 50);
}
dom.btnNewCol?.addEventListener("click", openNewColModal);
dom.btnEmptyNew?.addEventListener("click", openNewColModal);
dom.btnCreateCol?.addEventListener("click", createCollection);
dom.inputNewColName?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createCollection();
});
dom.inputNewColPin?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createCollection();
});

async function createCollection() {
  const name = dom.inputNewColName.value.trim();
  if (!name) {
    dom.inputNewColName.focus();
    return;
  }
  const pin = dom.inputNewColPin ? dom.inputNewColPin.value.trim() : "";
  if (pin && !/^\d{6}$/.test(pin)) {
    toast("PIN must be exactly 6 digits.", "warning");
    dom.inputNewColPin.focus();
    return;
  }
  try {
    const col = await POST("/api/collections", { name, pin: pin || null });
    state.collections.push(col);
    closeModal("modal-new-col");
    selectCollection(col.id);
    renderSidebar();
    renderColPickerDropdown();
    toast(`"${name}" created${pin ? " (locked)" : ""}.`, "success");
  } catch (err) {
    toast(`Error: ${err.message}`, "error");
  }
}

// ─── UNLOCK ───────────────────────────────────────────────────────────────────

let _pendingUnlockColId = null;

function promptUnlock(col) {
  _pendingUnlockColId = col.id;
  if (dom.unlockColName) dom.unlockColName.textContent = col.name;
  if (dom.inputUnlockPin) dom.inputUnlockPin.value = "";
  if (dom.unlockError) dom.unlockError.style.display = "none";
  openModal("modal-unlock");
  setTimeout(() => dom.inputUnlockPin?.focus(), 50);
}

dom.inputUnlockPin?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doUnlock();
});
dom.btnConfirmUnlock?.addEventListener("click", doUnlock);

async function doUnlock() {
  const pin = dom.inputUnlockPin?.value.trim();
  if (!pin || !_pendingUnlockColId) return;
  try {
    const res = await POST(`/api/collections/${_pendingUnlockColId}/unlock`, {
      pin,
    });
    if (!res.ok) {
      if (dom.unlockError) dom.unlockError.style.display = "block";
      dom.inputUnlockPin?.select();
      return;
    }
    // Update local state
    const col = state.collections.find((c) => c.id === _pendingUnlockColId);
    if (col) {
      col.unlocked = true;
    }
    closeModal("modal-unlock");
    _pendingUnlockColId = null;
    renderSidebar();
    renderColPickerDropdown();
    if (col) selectCollection(col.id);
  } catch (err) {
    toast(`Error: ${err.message}`, "error");
  }
}

// ─── RENAME ───────────────────────────────────────────────────────────────────

dom.btnEditName?.addEventListener("click", () => {
  const col = state.collections.find((c) => c.id === state.activeId);
  if (col?.locked && !col?.unlocked) {
    promptUnlock(col);
    return;
  }
  dom.colTitle.contentEditable = "true";
  dom.colTitle.focus();
  const r = document.createRange();
  r.selectNodeContents(dom.colTitle);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
});
dom.colTitle?.addEventListener("blur", async () => {
  dom.colTitle.contentEditable = "false";
  const newName = dom.colTitle.textContent.trim();
  const col = state.collections.find((c) => c.id === state.activeId);
  if (!col || newName === col.name || !newName) {
    dom.colTitle.textContent = col?.name || "";
    return;
  }
  try {
    await PATCH(`/api/collections/${state.activeId}`, { name: newName });
    col.name = newName;
    renderSidebar();
    renderColPickerDropdown();
    toast("Renamed.", "success");
  } catch (err) {
    dom.colTitle.textContent = col.name;
    let errData;
    try { errData = JSON.parse(err.message); } catch {}
    if (errData?.error === "locked") {
      col.unlocked = false;
      renderSidebar();
      promptUnlock(col);
      return;
    }
    toast(`Error: ${err.message}`, "error");
  }
});
dom.colTitle?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    dom.colTitle.blur();
  }
  if (e.key === "Escape") {
    const col = state.collections.find((c) => c.id === state.activeId);
    dom.colTitle.textContent = col?.name || "";
    dom.colTitle.contentEditable = "false";
  }
});

// ─── DELETE COLLECTION ───────────────────────────────────────────────────────

dom.btnDeleteCol?.addEventListener("click", () => {
  const col = state.collections.find((c) => c.id === state.activeId);
  if (dom.deletePinWrap) dom.deletePinWrap.classList.toggle("hidden", !col?.locked);
  if (dom.inputDeletePin) dom.inputDeletePin.value = "";
  if (dom.deletePinError) dom.deletePinError.style.display = "none";
  openModal("modal-confirm-delete");
  if (col?.locked && dom.inputDeletePin) setTimeout(() => dom.inputDeletePin.focus(), 50);
});
dom.btnConfirmDelete?.addEventListener("click", async () => {
  if (!state.activeId) return;
  const col = state.collections.find((c) => c.id === state.activeId);
  const pin = dom.inputDeletePin?.value.trim();
  if (col?.locked && !pin) {
    if (dom.deletePinError) { dom.deletePinError.textContent = "PIN required."; dom.deletePinError.style.display = "block"; }
    dom.inputDeletePin?.focus();
    return;
  }
  try {
    await DEL(`/api/collections/${state.activeId}`, pin ? { pin } : undefined);
    state.collections = state.collections.filter(
      (c) => c.id !== state.activeId,
    );
    state.activeId = null;
    closeModal("modal-confirm-delete");
    showView("empty");
    renderSidebar();
    renderColPickerDropdown();
    toast(`"${col?.name}" deleted.`, "success");
  } catch (err) {
    let errData;
    try { errData = JSON.parse(err.message); } catch {}
    if (errData?.error === "wrong_pin" || errData?.error === "pin_required") {
      if (dom.deletePinError) { dom.deletePinError.textContent = errData.message || "Incorrect PIN."; dom.deletePinError.style.display = "block"; }
      dom.inputDeletePin?.select();
      return;
    }
    toast(`Error: ${err.message}`, "error");
  }
});

// ─── MULTI-SELECT ─────────────────────────────────────────────────────────────

function toggleSelect(urlId) {
  if (state.selectedCards.has(urlId)) state.selectedCards.delete(urlId);
  else state.selectedCards.add(urlId);
  updateSelectionBar();
}
function updateSelectionBar() {
  const n = state.selectedCards.size;
  dom.selectionBar.classList.toggle("hidden", n === 0);
  if (n > 0) dom.selectionCount.textContent = `${n} selected`;
}
dom.btnClearSelection?.addEventListener("click", () => {
  state.selectedCards.clear();
  updateSelectionBar();
  const col = state.collections.find((c) => c.id === state.activeId);
  if (col) renderCollectionContent(col);
});
dom.btnDeleteSelected?.addEventListener("click", () => {
  if (!state.selectedCards.size) return;
  dom.bulkDelCount.textContent = state.selectedCards.size;
  openModal("modal-bulk-delete");
});
dom.btnConfirmBulkDel?.addEventListener("click", async () => {
  if (!state.activeId || !state.selectedCards.size) return;
  const ids = [...state.selectedCards];
  try {
    await POST(`/api/collections/${state.activeId}/urls/batch-delete`, {
      url_ids: ids,
    });
    const col = state.collections.find((c) => c.id === state.activeId);
    if (col) {
      col.urls = col.urls.filter((u) => !ids.includes(u.id));
      ids.forEach((id) => state.openedIds.delete(id));
    }
    state.selectedCards.clear();
    updateSelectionBar();
    closeModal("modal-bulk-delete");
    renderSidebar();
    if (col) renderCollection(col);
    toast(`Deleted ${ids.length} URL${ids.length > 1 ? "s" : ""}.`, "success");
  } catch (err) {
    toast(`Error: ${err.message}`, "error");
  }
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  const editing =
    tag === "input" ||
    tag === "textarea" ||
    document.activeElement?.isContentEditable;

  if ((e.ctrlKey || e.metaKey) && e.key === "a" && state.activeId && !editing) {
    e.preventDefault();
    const col = state.collections.find((c) => c.id === state.activeId);
    if (col) {
      col.urls.forEach((u) => state.selectedCards.add(u.id));
      updateSelectionBar();
      renderCollectionContent(col);
    }
    return;
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key === "c" &&
    state.selectedCards.size > 0 &&
    !editing
  ) {
    e.preventDefault();
    const col = state.collections.find((c) => c.id === state.activeId);
    if (!col) return;
    const sorted = applySortFilter(col.urls);
    const selectedUrls = sorted
      .filter((u) => state.selectedCards.has(u.id))
      .map((u) => u.url)
      .join("\n");
    navigator.clipboard
      .writeText(selectedUrls)
      .then(() =>
        toast(`Copied ${state.selectedCards.size} URL(s).`, "success", 2000),
      )
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = selectedUrls;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        toast(`Copied ${state.selectedCards.size} URL(s).`, "success", 2000);
      });
    return;
  }
  if (e.key === "Delete" && state.selectedCards.size > 0 && !editing) {
    e.preventDefault();
    dom.bulkDelCount.textContent = state.selectedCards.size;
    openModal("modal-bulk-delete");
    return;
  }
  if (e.key === "Escape" && state.selectedCards.size > 0) {
    state.selectedCards.clear();
    updateSelectionBar();
    const col = state.collections.find((c) => c.id === state.activeId);
    if (col) renderCollectionContent(col);
  }
});

// ─── PASTE ───────────────────────────────────────────────────────────────────

document.addEventListener("paste", async (e) => {
  if (!state.activeId) return;
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (
    tag === "input" ||
    tag === "textarea" ||
    document.activeElement?.isContentEditable
  )
    return;
  e.preventDefault();
  const text = e.clipboardData.getData("text");
  if (!text) return;
  const urls = extractUrls(text);
  if (!urls.length) {
    toast("No URLs found.", "warning");
    return;
  }
  showLoading(`Adding ${urls.length} URL${urls.length > 1 ? "s" : ""}…`);
  try {
    const result = await POST(`/api/collections/${state.activeId}/urls`, {
      urls,
    });
    const added = result.added?.length || 0;
    const skipped = result.skipped?.length || 0;
    const col = state.collections.find((c) => c.id === state.activeId);
    if (col && result.added?.length) {
      col.urls.push(...result.added);
      renderSidebar();
      renderColPickerDropdown();
      renderCollection(col);
      if (result.added.some((u) => u.og_fetched === false)) startOgPoll();
    }
    if (added > 0)
      toast(
        `Added ${added}${skipped > 0 ? ` · ${skipped} exist` : ""}.`,
        "success",
      );
    else toast("All URLs already exist in this collection.", "info");
  } catch (err) {
    toast(`Error: ${err.message}`, "error");
  } finally {
    hideLoading();
  }
});

// ─── DELETE SINGLE ────────────────────────────────────────────────────────────

async function deleteSingle(colId, urlId) {
  try {
    await DEL(`/api/collections/${colId}/urls/${urlId}`);
    const col = state.collections.find((c) => c.id === colId);
    if (col) {
      col.urls = col.urls.filter((u) => u.id !== urlId);
      state.openedIds.delete(urlId);
      state.selectedCards.delete(urlId);
      updateSelectionBar();
      renderSidebar();
      renderColPickerDropdown();
      renderCollection(col);
      renderSiteFilterPopover(col);
    }
    toast("URL removed.", "success");
  } catch (err) {
    toast(`Error: ${err.message}`, "error");
  }
}

// ─── CONTEXT MENU ─────────────────────────────────────────────────────────────

let _ctxMenu = null;
function closeContextMenu() {
  if (_ctxMenu) {
    _ctxMenu.remove();
    _ctxMenu = null;
  }
}
document.addEventListener("click", closeContextMenu);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeContextMenu();
});

function showContextMenu(e, urlEntry, col) {
  e.preventDefault();
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";

  const otherCols = state.collections.filter((c) => c.id !== col.id);
  if (otherCols.length) {
    const moveItem = document.createElement("div");
    moveItem.className = "ctx-item ctx-has-sub";
    moveItem.innerHTML = `<span>Move to</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;
    const sub = document.createElement("div");
    sub.className = "ctx-submenu";
    otherCols.forEach((dest) => {
      const si = document.createElement("div");
      si.className = "ctx-item";
      si.textContent = dest.name;
      si.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        closeContextMenu();
        await moveUrl(col.id, urlEntry.id, dest.id);
      });
      sub.appendChild(si);
    });
    moveItem.appendChild(sub);
    menu.appendChild(moveItem);
  }

  const copyItem = document.createElement("div");
  copyItem.className = "ctx-item";
  copyItem.textContent = "Copy URL";
  copyItem.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeContextMenu();
    navigator.clipboard
      .writeText(urlEntry.url)
      .then(() => toast("Copied.", "success", 2000))
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = urlEntry.url;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        toast("Copied.", "success", 2000);
      });
  });
  menu.appendChild(copyItem);

  const delItem = document.createElement("div");
  delItem.className = "ctx-item ctx-danger";
  delItem.textContent = "Delete URL";
  delItem.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    closeContextMenu();
    await deleteSingle(col.id, urlEntry.id);
  });
  menu.appendChild(delItem);

  document.body.appendChild(menu);
  _ctxMenu = menu;
  const mx = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8);
  const my = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = mx + "px";
  menu.style.top = my + "px";
  menu.style.opacity = "1";
}

async function moveUrl(fromColId, urlId, toColId) {
  try {
    await POST(`/api/collections/${fromColId}/urls/${urlId}/move`, {
      to_collection_id: toColId,
    });
    await loadAll();
    const col = state.collections.find((c) => c.id === state.activeId);
    if (col) renderCollection(col);
    toast("URL moved.", "success");
  } catch (err) {
    toast(`Error: ${err.message}`, "error");
  }
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

function extractUrls(text) {
  return [...new Set(text.match(/https?:\/\/[^\s"'<>]+/g) || [])];
}
function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
function timeAgo(iso) {
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z"),
      diff = Date.now() - d.getTime(),
      m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch {
    return "";
  }
}
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function copyToClipboard(text, msg = "Copied.") {
  navigator.clipboard
    .writeText(text)
    .then(() => toast(msg, "success", 1800))
    .catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast(msg, "success", 1800);
    });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function init() {
  dom.btnList?.classList.add("active");
  dom.btnGrid?.classList.remove("active");
  syncPrivateBtn();
  try {
    await loadAll();
    if (state.collections.length && !state.activeId) {
      const first = state.collections.find((c) => !c.locked || c.unlocked);
      if (first) selectCollection(first.id);
    }
    if (
      state.collections.some((c) => c.urls.some((u) => u.og_fetched === false))
    )
      startOgPoll();
    startSoftRefresh();
  } catch (err) {
    toast(`Failed to load: ${err.message}`, "error");
  }
}

init();
