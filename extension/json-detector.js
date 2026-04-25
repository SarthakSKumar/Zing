/* Zing — JSON Detector
   Runs at document_idle on every page. If the page is a raw JSON response:
   - If jsonPrettifyEnabled is TRUE  → auto-redirect to JSON viewer
   - If jsonPrettifyEnabled is FALSE → show a floating "Parse with Zing" button
*/
(function () {
  'use strict';

  if (window.__zingJsonDetected) return;

  let text = '';

  const isJsonContentType = document.contentType &&
    (document.contentType.includes('json') || document.contentType === 'application/javascript');

  const body = document.body;
  if (!body) return;

  if (isJsonContentType) {
    const pre = body.querySelector('pre');
    text = pre ? pre.textContent.trim() : body.textContent.trim();
  } else {
    const firstChild = body.firstElementChild;
    if (body.children.length === 1 && firstChild && firstChild.tagName === 'PRE') {
      text = firstChild.textContent.trim();
    } else if (body.children.length === 0) {
      text = body.textContent.trim();
    } else {
      return;
    }
  }

  if (!text || text.length < 2) return;
  if (text[0] !== '{' && text[0] !== '[') return;
  if (/<\/?html/i.test(text.slice(0, 300))) return;

  try {
    JSON.parse(text);
  } catch {
    return;
  }

  // Valid JSON page confirmed
  try {
    chrome.storage.local.get({ jsonPrettifyEnabled: true }, ({ jsonPrettifyEnabled }) => {
      if (jsonPrettifyEnabled) {
        // Auto-redirect to viewer
        window.__zingJsonDetected = true;
        chrome.storage.local.set({ zingJsonData: text, zingJsonUrl: location.href }, () => {
          try {
            window.location.href = chrome.runtime.getURL('viewer.html');
          } catch {}
        });
      } else {
        // Show floating parse button
        showParseButton(text);
      }
    });
  } catch {}

  function showParseButton(jsonText) {
    if (document.getElementById('__zing-parse-btn')) return;

    const btn = document.createElement('button');
    btn.id = '__zing-parse-btn';
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
      </svg>
      Parse with Zing JSON Prettify
    `;
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      gap: '7px',
      background: '#09090b',
      color: '#fafafa',
      border: '1px solid #27272a',
      borderRadius: '8px',
      padding: '9px 14px',
      fontSize: '12px',
      fontFamily: '"Bricolage Grotesque", -apple-system, system-ui, sans-serif',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      transition: 'background 0.12s, border-color 0.12s',
      letterSpacing: '0.01em',
      backdropFilter: 'blur(8px)',
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#1c1c1f';
      btn.style.borderColor = '#3f3f46';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#09090b';
      btn.style.borderColor = '#27272a';
    });

    // Dismiss button
    const close = document.createElement('span');
    Object.assign(close.style, {
      marginLeft: '6px',
      color: '#52525b',
      fontSize: '14px',
      lineHeight: '1',
      cursor: 'pointer',
      fontWeight: '400',
    });
    close.textContent = '×';
    close.title = 'Dismiss';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.remove();
    });
    btn.appendChild(close);

    btn.addEventListener('click', (e) => {
      if (e.target === close) return;
      try {
        window.__zingJsonDetected = true;
        chrome.storage.local.set({ zingJsonData: jsonText, zingJsonUrl: location.href }, () => {
          try {
            window.location.href = chrome.runtime.getURL('viewer.html');
          } catch {}
        });
      } catch {}
    });

    document.body.appendChild(btn);

    // Auto-hide after 8 seconds
    setTimeout(() => btn.remove(), 8000);
  }
})();
