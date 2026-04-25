/* Zing — JSON Viewer */
'use strict';

// ── State ──────────────────────────────────────────────────────────────────────
let _data     = null;
let _raw      = '';
let _isTree   = true;
let _allNodes = []; // { expand, collapse, get expanded }

// ── Utilities ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ copied';
    btn.style.color = '#22c55e';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1400);
  }).catch(() => {});
}

// ── Toggle arrow SVG ───────────────────────────────────────────────────────────

function makeToggle() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 10 10');
  s.setAttribute('width', '10');
  s.setAttribute('height', '10');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M2 3 L5 7 L8 3');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.8');
  p.setAttribute('stroke-linecap', 'round');
  s.appendChild(p);
  return s;
}

// ── Value span ─────────────────────────────────────────────────────────────────

function makeValueSpan(value, type) {
  const s = document.createElement('span');
  switch (type) {
    case 'string':
      s.className = 'vs';
      s.dataset.raw = `"${value}"`;
      s.textContent = `"${value}"`;
      break;
    case 'number':
      s.className = 'vn';
      s.dataset.raw = String(value);
      s.textContent = String(value);
      break;
    case 'boolean':
      s.className = 'vb';
      s.dataset.raw = String(value);
      s.textContent = String(value);
      break;
    case 'null':
      s.className = 'vz';
      s.dataset.raw = 'null';
      s.textContent = 'null';
      break;
  }
  return s;
}

// ── Action buttons (copy value / copy path) ────────────────────────────────────

function makeActions(copyVal, copyPath) {
  const wrap = document.createElement('span');
  wrap.className = 'nact';

  const valBtn = document.createElement('button');
  valBtn.className = 'na-btn';
  valBtn.textContent = '⧉ value';
  valBtn.title = 'Copy value';
  valBtn.addEventListener('click', (e) => { e.stopPropagation(); copyText(copyVal, valBtn); });

  const pathBtn = document.createElement('button');
  pathBtn.className = 'na-btn';
  pathBtn.textContent = '$ path';
  pathBtn.title = 'Copy JSON path';
  pathBtn.addEventListener('click', (e) => { e.stopPropagation(); copyText(copyPath, pathBtn); });

  wrap.appendChild(valBtn);
  wrap.appendChild(pathBtn);
  return wrap;
}

// ── Key span ───────────────────────────────────────────────────────────────────

function makeKey(key) {
  const frag = document.createDocumentFragment();
  const k = document.createElement('span');
  k.className = 'nk';
  k.dataset.raw = `"${key}"`;
  k.textContent = `"${key}"`;
  const p = document.createElement('span');
  p.className = 'np';
  p.textContent = ': ';
  frag.appendChild(k);
  frag.appendChild(p);
  return frag;
}

// ── Core: create a tree node DOM element ───────────────────────────────────────

function createNode(key, value, path, depth, isLast) {
  const type = getType(value);
  const wrap = document.createElement('div');

  if (type === 'object' || type === 'array') {
    const isArr = type === 'array';
    const keys  = isArr ? null : Object.keys(value);
    const count = isArr ? value.length : keys.length;
    const open  = isArr ? '[' : '{';
    const close = isArr ? ']' : '}';
    const comma = !isLast ? ',' : '';
    const isEmpty = count === 0;

    // ── Head line ────────────────────────────────────────────────────────────
    const head = document.createElement('div');
    head.className = 'nl';

    let tog = null; // toggle element for expand/collapse

    if (!isEmpty) {
      tog = document.createElement('span');
      tog.className = 'nt';
      tog.title = 'Toggle';
      tog.appendChild(makeToggle());
      head.appendChild(tog);
    } else {
      const sp = document.createElement('span');
      sp.className = 'nsp';
      head.appendChild(sp);
    }

    if (key !== null) head.appendChild(makeKey(String(key)));

    const openBr = document.createElement('span');
    openBr.className = 'nb';
    openBr.textContent = open;
    head.appendChild(openBr);

    if (isEmpty) {
      const closeBr = document.createElement('span');
      closeBr.className = 'nb';
      closeBr.textContent = close + comma;
      head.appendChild(closeBr);
    } else {
      // Summary shown when collapsed
      const summary = document.createElement('span');
      summary.className = 'ns';
      summary.textContent = isArr ? `${count} items` : `${count} keys`;

      // Closing bracket shown when collapsed
      const collapsedClose = document.createElement('span');
      collapsedClose.className = 'ncb';
      collapsedClose.textContent = close + comma;

      head.appendChild(summary);
      head.appendChild(collapsedClose);

      // ── Children ──────────────────────────────────────────────────────────
      const children = document.createElement('div');
      children.className = 'nch';

      // ── Close bracket line ─────────────────────────────────────────────────
      const closeLine = document.createElement('div');
      closeLine.className = 'nl';
      const sp2 = document.createElement('span');
      sp2.className = 'nsp';
      closeLine.appendChild(sp2);
      const closeBr2 = document.createElement('span');
      closeBr2.className = 'nb';
      closeBr2.textContent = close + comma;
      closeLine.appendChild(closeBr2);

      // Lazy rendering
      let rendered = false;

      function renderChildren() {
        if (rendered) return;
        rendered = true;
        if (isArr) {
          renderArrayChunk(children, value, path, depth, 0);
        } else {
          keys.forEach((k, i) => {
            children.appendChild(
              createNode(k, value[k], `${path}["${k}"]`, depth + 1, i === keys.length - 1)
            );
          });
        }
      }

      // Auto-expand top 2 levels
      let expanded = depth < 2;

      function doExpand() {
        renderChildren();
        children.style.display   = '';
        closeLine.style.display  = '';
        summary.style.display    = 'none';
        collapsedClose.style.display = 'none';
        tog.classList.add('te');
        expanded = true;
      }

      function doCollapse() {
        children.style.display   = 'none';
        closeLine.style.display  = 'none';
        summary.style.display    = '';
        collapsedClose.style.display = '';
        tog.classList.remove('te');
        expanded = false;
      }

      tog.addEventListener('click', () => expanded ? doCollapse() : doExpand());

      // Register for expand-all / collapse-all
      _allNodes.push({
        expand:   doExpand,
        collapse: doCollapse,
        get expanded() { return expanded; },
      });

      if (expanded) {
        doExpand();
      } else {
        children.style.display  = 'none';
        closeLine.style.display = 'none';
      }

      wrap.appendChild(head);
      wrap.appendChild(children);
      wrap.appendChild(closeLine);
      return wrap;
    }

    wrap.appendChild(head);
    return wrap;
  }

  // ── Primitive ────────────────────────────────────────────────────────────────
  const line = document.createElement('div');
  line.className = 'nl';

  const sp = document.createElement('span');
  sp.className = 'nsp';
  line.appendChild(sp);

  if (key !== null) line.appendChild(makeKey(String(key)));

  const valSpan = makeValueSpan(value, type);
  line.appendChild(valSpan);

  if (!isLast) {
    const c = document.createElement('span');
    c.className = 'nc';
    c.textContent = ',';
    line.appendChild(c);
  }

  line.appendChild(
    makeActions(JSON.stringify(value), path)
  );

  wrap.appendChild(line);
  return wrap;
}

// ── Chunked array rendering (prevents freeze on huge arrays) ───────────────────

const CHUNK = 200;

function renderArrayChunk(container, arr, path, depth, start) {
  const end = Math.min(start + CHUNK, arr.length);
  for (let i = start; i < end; i++) {
    container.appendChild(
      createNode(i, arr[i], `${path}[${i}]`, depth + 1, i === arr.length - 1)
    );
  }
  if (end < arr.length) {
    const remaining = arr.length - end;
    const more = document.createElement('div');
    more.className = 'n-more';
    more.textContent = `▸ Load ${Math.min(CHUNK, remaining)} more  (${remaining} remaining)`;
    more.addEventListener('click', () => {
      more.remove();
      renderArrayChunk(container, arr, path, depth, end);
    });
    container.appendChild(more);
  }
}

// ── Search (highlight matching text in data spans) ─────────────────────────────

let _searchTimer;

// ── Raw JSON syntax highlighting ───────────────────────────────────────────────
function highlightRawJson(json) {
  return json
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Keys (quoted strings followed by colon)
    .replace(/"([^"\\]|\\.)*"(?=\s*:)/g, '<span class="nk">$&</span>')
    // String values
    .replace(/: "([^"\\]|\\.)*"(?=[,\s\n\r\]}])/g, (m) => m.replace(/("([^"\\]|\\.)*")/g, '<span class="vs">$1</span>'))
    // Numbers
    .replace(/:\s*(-?\d+\.?\d*([eE][+-]?\d+)?)/g, (m) => m.replace(/(-?\d+\.?\d*([eE][+-]?\d+)?)/g, '<span class="vn">$1</span>'))
    // Booleans
    .replace(/:\s*(true|false)/g, (m) => m.replace(/\b(true|false)\b/g, '<span class="vb">$1</span>'))
    // Null
    .replace(/:\s*(null)/g, (m) => m.replace(/\b(null)\b/g, '<span class="vz">$1</span>'))
    // Brackets and braces
    .replace(/([{}\[\]])/g, '<span class="nb">$1</span>');
}

function clearHighlights() {
  document.querySelectorAll('mark.sh').forEach(m => {
    const t = document.createTextNode(m.textContent);
    m.replaceWith(t);
  });
}

function highlightSpan(span, term) {
  const raw = span.dataset.raw || span.textContent;
  span.dataset.raw = raw; // ensure preserved
  const lo = raw.toLowerCase();
  const lt = term.toLowerCase();
  let idx = lo.indexOf(lt);
  if (idx < 0) return 0;

  let count = 0;
  let last  = 0;
  const frag = document.createDocumentFragment();

  while (idx >= 0) {
    if (idx > last) frag.appendChild(document.createTextNode(raw.slice(last, idx)));
    const mk = document.createElement('mark');
    mk.className = 'sh';
    mk.textContent = raw.slice(idx, idx + term.length);
    frag.appendChild(mk);
    count++;
    last = idx + term.length;
    idx  = lo.indexOf(lt, last);
  }
  if (last < raw.length) frag.appendChild(document.createTextNode(raw.slice(last)));
  span.textContent = '';
  span.appendChild(frag);
  return count;
}

function doSearch(term) {
  clearHighlights();
  const countEl = document.getElementById('search-count');
  if (!term) { countEl.textContent = ''; return; }

  let total = 0;
  // Highlight keys and values that match
  document.querySelectorAll('.nk, .vs, .vn, .vb, .vz').forEach(span => {
    total += highlightSpan(span, term);
  });

  countEl.textContent = total > 0 ? `${total} match${total === 1 ? '' : 'es'}` : 'No matches';

  // Scroll to first match
  const first = document.querySelector('mark.sh');
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
  const treeView = document.getElementById('tree-view');
  const rawView  = document.getElementById('raw-view');

  try {
    const result = await chrome.storage.local.get(['zingJsonData', 'zingJsonUrl']);
    _raw = result.zingJsonData;

    if (!_raw) {
      treeView.innerHTML =
        '<div class="viewer-err">No JSON data. Navigate to a URL that returns JSON.</div>';
      return;
    }

    // Clean up storage immediately
    chrome.storage.local.remove(['zingJsonData', 'zingJsonUrl']);

    _data = JSON.parse(_raw);

    // Status bar
    const type  = getType(_data);
    const bytes = new TextEncoder().encode(_raw).length;
    const count = type === 'array'
      ? _data.length
      : type === 'object'
        ? Object.keys(_data).length
        : 1;

    document.getElementById('status-type').textContent =
      type === 'array'  ? `Array [${count}]`  :
      type === 'object' ? `Object {${count}}` : type;
    document.getElementById('status-size').textContent = fmtSize(bytes);

    const urlInfo = result.zingJsonUrl
      ? (() => { try { return new URL(result.zingJsonUrl).hostname; } catch { return result.zingJsonUrl; } })()
      : (document.referrer ? (() => { try { return new URL(document.referrer).hostname; } catch { return ''; } })() : '');
    document.getElementById('status-url').textContent = urlInfo;
    document.getElementById('status-url').title = result.zingJsonUrl || '';

    // Raw view (formatted) with syntax highlighting
    const rawText = JSON.stringify(_data, null, 2);
    rawView.innerHTML = highlightRawJson(rawText);

    // Tree view
    _allNodes = [];
    const root = createNode(null, _data, '$', 0, true);

    // Root has no key — adjust its head line spacer
    treeView.appendChild(root);

  } catch (err) {
    treeView.innerHTML = `<div class="viewer-err">Parse error: ${esc(err.message)}</div>`;
  }
}

// ── Toolbar events ──────────────────────────────────────────────────────────────

document.getElementById('btn-expand').addEventListener('click', () => {
  _allNodes.forEach(n => n.expand());
});

document.getElementById('btn-collapse').addEventListener('click', () => {
  _allNodes.forEach(n => n.collapse());
});

document.getElementById('btn-copy-all').addEventListener('click', () => {
  if (_data === null && !_raw) return;
  const btn = document.getElementById('btn-copy-all');
  copyText(JSON.stringify(_data, null, 2), btn);
});

document.getElementById('btn-raw').addEventListener('click', () => {
  _isTree = !_isTree;
  document.getElementById('tree-view').style.display = _isTree ? '' : 'none';
  document.getElementById('raw-view').style.display  = _isTree ? 'none' : '';
  const btn = document.getElementById('btn-raw');
  btn.textContent = _isTree ? 'Tree' : 'Raw';
  btn.classList.toggle('tb-active', !_isTree);
});

document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => doSearch(e.target.value.trim()), 180);
});

document.getElementById('search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.target.value = ''; doSearch(''); }
});

// Start
init();
