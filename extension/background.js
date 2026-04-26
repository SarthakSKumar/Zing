/* Zing — Background Service Worker */

const API = "http://localhost:5000";
const CACHE_TTL = 30_000;

let _cachedUrls = null;
let _cacheTime  = 0;

// ── Dark reader CSS (must match exactly what popup.js injects) ────────────────
const DARK_READER_CSS = `
html { filter: invert(1) hue-rotate(180deg) !important; background: #111 !important; }
img, video, iframe, canvas, picture, svg image, embed, object,
[style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }
`;

// Pesticide CSS (must match popup.js exactly for removeCSS to work)
const PESTICIDE_CSS = `
*,*::before,*::after{outline:1px solid rgba(220,50,50,.35)!important;outline-offset:-1px!important;}
div,section,article,main,header,footer,aside,nav,figure{outline-color:rgba(220,50,50,.5)!important;}
span,p,h1,h2,h3,h4,h5,h6,label,li,td,th{outline-color:rgba(0,160,255,.5)!important;}
img,svg,video,canvas,picture,source{outline-color:rgba(255,165,0,.7)!important;}
a{outline-color:rgba(180,0,255,.55)!important;}
button,[role="button"],summary{outline-color:rgba(0,220,100,.65)!important;}
input,select,textarea,[contenteditable]{outline-color:rgba(0,220,220,.65)!important;}
*:hover{outline-width:2px!important;outline-color:rgba(255,255,255,.85)!important;}
#__zing-pest-bar,#__zing-pest-bar *,#__zing-font-tip,#__zing-font-tip *,
#__zing-color-picker,#__zing-color-picker *,#__zing-color-popover,#__zing-color-popover *{outline:none!important;}
`;

// ── Settings helpers ──────────────────────────────────────────────────────────
async function fetchSettings() {
  try {
    const r = await fetch(`${API}/api/settings`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// ── History scrub ─────────────────────────────────────────────────────────────
const FALLBACK_WORDS = ["porn","desi","xxx","sex","fuck","milf","pornhub",
                        "xvideos","missionary","eporner","hardcore"];

async function scrubHistory() {
  const s = await fetchSettings();
  if (s?.historyScrub?.enabled === false) return;           // scrub disabled
  const words = s?.historyScrub?.words?.length ? s.historyScrub.words : FALLBACK_WORDS;
  try {
    const items = await chrome.history.search({ text:"", maxResults:100000,
      startTime: Date.now() - 90*24*60*60*1000 });
    let n = 0;
    for (const item of items) {
      const hay = (item.url + " " + (item.title||"")).toLowerCase();
      if (words.some(w => hay.includes(w.toLowerCase()))) {
        await chrome.history.deleteUrl({ url: item.url });
        n++;
      }
    }
    if (n) console.log(`[Zing] Scrubbed ${n} entries.`);
  } catch (e) { console.warn("[Zing] Scrub failed:", e); }
}

// ── Alarm-based scrub scheduling ──────────────────────────────────────────────
const ALARM = "zing-scrub";
const FREQ  = { "1min":1,"5min":5,"15min":15,"1hour":60,"6hours":360 };

async function setupScrubAlarm() {
  const s = await fetchSettings();
  const freq = s?.historyScrub?.frequency || "startup";
  await chrome.alarms.clear(ALARM).catch(()=>{});
  if (FREQ[freq]) chrome.alarms.create(ALARM, { periodInMinutes: FREQ[freq] });
}

chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) scrubHistory(); });
async function syncViewedOverlayDomains() {
  const s = await fetchSettings();
  const domains = s?.viewedOverlay?.domains || [];
  chrome.storage.local.set({ viewedOverlayDomains: domains }).catch(()=>{});
}
chrome.runtime.onStartup.addListener(()=>{ scrubHistory(); setupScrubAlarm(); syncViewedOverlayDomains(); });
chrome.runtime.onInstalled.addListener(()=>{ scrubHistory(); setupScrubAlarm(); syncViewedOverlayDomains(); });

// ── Tab lifecycle ─────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    // clear pesticide session flag on navigate
    chrome.storage.session.remove(`pest_${tabId}`).catch(()=>{});
  }
  if (changeInfo.status === "complete") {
    // re-apply dark reader if it was on for this tab
    try {
      const d = await chrome.storage.local.get(`darkReader_${tabId}`);
      if (d[`darkReader_${tabId}`]) {
        chrome.scripting.insertCSS({ target:{tabId}, css: DARK_READER_CSS }).catch(()=>{});
      }
    } catch {}
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.local.remove(`darkReader_${tabId}`).catch(()=>{});
});

// ── Bookmark URL cache ────────────────────────────────────────────────────────
async function fetchBookmarkUrls(force=false) {
  const now = Date.now();
  if (!force && _cachedUrls && now-_cacheTime < CACHE_TTL) return _cachedUrls;
  try {
    const r = await fetch(`${API}/api/collections`);
    if (!r.ok) return _cachedUrls||[];
    const cols = await r.json();
    _cachedUrls = cols.flatMap(c => c.urls.map(u=>u.url).filter(Boolean));
    _cacheTime  = now;
    return _cachedUrls;
  } catch { return _cachedUrls||[]; }
}

// ── Save tabs ─────────────────────────────────────────────────────────────────
async function saveTabs(name) {
  const tabs = await chrome.tabs.query({ currentWindow:true });
  const items = tabs.filter(t => {
    if (!t.url?.startsWith("http")) return false;
    try { const u = new URL(t.url); return u.hostname!=="localhost"&&u.hostname!=="127.0.0.1"; }
    catch { return false; }
  }).map(t => ({ url:t.url, title:t.title||"" }));
  if (!items.length) return { error:"No HTTP tabs found." };
  try {
    const c = await (await fetch(`${API}/api/collections`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({name})
    })).json();
    const r = await (await fetch(`${API}/api/collections/${c.id}/urls`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({urls:items})
    })).json();
    _cachedUrls = null;
    return { ok:true, added:r.added?.length??0, skipped:r.skipped?.length??0, collection:c.name };
  } catch(e) { return { error:e.message }; }
}

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "GET_BOOKMARK_URLS") {
    fetchBookmarkUrls(msg.forceRefresh).then(urls => sendResponse({urls}));
    return true;
  }
  if (msg.type === "SAVE_TABS") {
    saveTabs(msg.collectionName).then(sendResponse);
    return true;
  }
  if (msg.type === "PING") {
    fetch(`${API}/api/collections`).then(r=>sendResponse({ok:r.ok})).catch(()=>sendResponse({ok:false}));
    return true;
  }
  if (msg.type === "FULL_PAGE_SCREENSHOT") {
    captureFullPage().then(sendResponse);
    return true;
  }

  // ── Dark reader ────────────────────────────────────────────────────────────
  if (msg.type === "GET_DARK_READER_STATE") {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({enabled:false}); return false; }
    chrome.storage.local.get(`darkReader_${tabId}`).then(d =>
      sendResponse({enabled:!!d[`darkReader_${tabId}`]}));
    return true;
  }
  if (msg.type === "DARK_READER_ESC") {
    // ESC pressed on page — remove CSS and clear storage
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ok:false}); return false; }
    chrome.storage.local.get(`darkReader_${tabId}`).then(d => {
      if (d[`darkReader_${tabId}`]) {
        chrome.storage.local.remove(`darkReader_${tabId}`);
        chrome.scripting.removeCSS({ target:{tabId}, css: DARK_READER_CSS }).catch(()=>{});
      }
    });
    sendResponse({ok:true});
    return false;
  }

  // ── Tool state clearing (from ESC in page) ─────────────────────────────────
  if (msg.type === "CLEAR_PESTICIDE_STATE") {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.storage.session.remove(`pest_${tabId}`).catch(()=>{});
      // Remove the injected CSS so outlines disappear when ESC is pressed
      chrome.scripting.removeCSS({ target:{tabId}, css: PESTICIDE_CSS }).catch(()=>{});
    }
    sendResponse({ok:true});
    return false;
  }
  if (msg.type === "CLEAR_COLOR_PICKER_STATE") {
    const tabId = sender.tab?.id;
    if (tabId) chrome.storage.session.remove(`colorPicker_${tabId}`).catch(()=>{});
    sendResponse({ok:true});
    return false;
  }

  if (msg.type === "SETTINGS_UPDATED") {
    setupScrubAlarm();
    syncViewedOverlayDomains();
    sendResponse({ok:true});
    return false;
  }
  if (msg.type === "GET_SETTINGS") {
    fetchSettings().then(s => sendResponse({settings:s}));
    return true;
  }
});

// ── Full-page screenshot ──────────────────────────────────────────────────────
async function captureFullPage() {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab) return {error:"No active tab"};
    const tabId=tab.id, windowId=tab.windowId;
    const [{result:dims}] = await chrome.scripting.executeScript({target:{tabId},func:()=>({
      scrollW:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0),
      scrollH:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),
      viewW:window.innerWidth, viewH:window.innerHeight,
      dpr:window.devicePixelRatio||1, scrollX:window.scrollX, scrollY:window.scrollY
    })});
    const {scrollW,scrollH,viewW,viewH,dpr,scrollX,scrollY}=dims;
    const canvas=new OffscreenCanvas(Math.round(scrollW*dpr),Math.round(scrollH*dpr));
    const ctx=canvas.getContext("2d");
    for(let row=0;row<Math.ceil(scrollH/viewH);row++){
      for(let col=0;col<Math.ceil(scrollW/viewW);col++){
        const sx=col*viewW,sy=row*viewH;
        await chrome.scripting.executeScript({target:{tabId},func:(x,y)=>window.scrollTo(x,y),args:[sx,sy]});
        await new Promise(r=>setTimeout(r,1050));
        const dataUrl=await chrome.tabs.captureVisibleTab(windowId,{format:"png"});
        const b64=dataUrl.slice(dataUrl.indexOf(",")+1);
        const bin=atob(b64),bytes=new Uint8Array(bin.length);
        for(let j=0;j<bin.length;j++)bytes[j]=bin.charCodeAt(j);
        const img=await createImageBitmap(new Blob([bytes],{type:"image/png"}));
        ctx.drawImage(img,Math.round(sx*dpr),Math.round(sy*dpr));
      }
    }
    await chrome.scripting.executeScript({target:{tabId},func:(x,y)=>window.scrollTo(x,y),args:[scrollX,scrollY]});
    const finalBlob=await canvas.convertToBlob({type:"image/png"});
    const fname=`zing-${Date.now()}.png`;
    const buf=await finalBlob.arrayBuffer(),u8=new Uint8Array(buf);
    let bin="";const chunk=8192;
    for(let i=0;i<u8.length;i+=chunk)bin+=String.fromCharCode(...u8.subarray(i,i+chunk));
    const dataUrl64=`data:image/png;base64,${btoa(bin)}`;
    await chrome.downloads.download({url:dataUrl64,filename:fname,saveAs:false});
    return {ok:true,dataUrl:dataUrl64,filename:fname};
  } catch(e){return {error:e.message};}
}
