/* Zing — Content Script */
"use strict";

const OVERLAY_ATTR = "data-zing-overlay";
const LINK_ATTR    = "data-zing-checked";
let bookmarkedSlugs = new Set();
let ready = false;

function slug(url) {
  try { const a=new URL(url,location.href); return (a.pathname.replace(/\/$/,"")+a.search).toLowerCase(); }
  catch { return (url||"").replace(/\/$/,"").toLowerCase(); }
}
function findCardDiv(link) {
  let el=link.parentElement;
  while(el&&el!==document.body){
    if(["DIV","LI","ARTICLE"].includes(el.tagName)){const r=el.getBoundingClientRect();if(r.width>60&&r.height>60)return el;}
    el=el.parentElement;
  }
  return link.closest("div");
}
function applyOverlays() {
  if(!ready||!bookmarkedSlugs.size)return;
  document.querySelectorAll(`a[href]:not([${LINK_ATTR}])`).forEach(link=>{
    const href=link.getAttribute("href");
    if(!href||href==="#"||href.startsWith("javascript"))return;
    link.setAttribute(LINK_ATTR,"1");
    if(!bookmarkedSlugs.has(slug(href)))return;
    const div=findCardDiv(link);
    if(!div||div.hasAttribute(OVERLAY_ATTR))return;
    div.setAttribute(OVERLAY_ATTR,"1");
    if(window.getComputedStyle(div).position==="static")div.style.position="relative";
    const ov=document.createElement("div");
    ov.style.cssText="position:absolute!important;inset:0!important;background:rgba(245,158,11,.2)!important;z-index:2147483640!important;pointer-events:none!important;border:1.5px solid rgba(245,158,11,.5)!important;border-radius:inherit!important;";
    const b=document.createElement("span");
    b.textContent="VIEWED";
    b.style.cssText="position:absolute!important;top:4px!important;right:6px!important;background:rgba(245,158,11,.95)!important;color:#000!important;font:700 9px/1 sans-serif!important;letter-spacing:.06em!important;padding:2px 5px!important;border-radius:3px!important;pointer-events:none!important;text-transform:uppercase!important;";
    ov.appendChild(b);div.appendChild(ov);
  });
}
function isRuntimeAlive(){try{return!!chrome.runtime?.id;}catch{return false;}}

function loadBookmarks(force=false){
  if(!isRuntimeAlive())return;
  try{chrome.runtime.sendMessage({type:"GET_BOOKMARK_URLS",forceRefresh:force},resp=>{
    if(chrome.runtime.lastError)return;
    if(resp?.urls){bookmarkedSlugs=new Set(resp.urls.map(slug));ready=true;applyOverlays();}
  });}catch{}
}

const observer=new MutationObserver(()=>applyOverlays());
function startObserver(){try{observer.observe(document.body,{childList:true,subtree:true});}catch{}}

// ── Domain-filtered init ──────────────────────────────────────────────────────
// Only apply VIEWED overlays on domains in the allow-list (empty = all sites)
function initOverlays() {
  if(!isRuntimeAlive()){loadBookmarks();if(document.readyState==="complete")startObserver();else window.addEventListener("load",startObserver);return;}
  try{
    chrome.storage.local.get({viewedOverlayDomains:[]},({viewedOverlayDomains})=>{
      const host = location.hostname.replace(/^www\./,"");
      const allowed = viewedOverlayDomains.length===0 || viewedOverlayDomains.some(d=>{
        const clean=(d||"").replace(/^(https?:\/\/)?(www\.)?/,"").replace(/\/.*$/,"").trim();
        return clean&&(host===clean||host.endsWith("."+clean));
      });
      if(!allowed)return;
      loadBookmarks();
      if(document.readyState==="complete")startObserver();
      else window.addEventListener("load",startObserver);
    });
  }catch{loadBookmarks();if(document.readyState==="complete")startObserver();else window.addEventListener("load",startObserver);}
}
initOverlays();

const _rt=setInterval(()=>{
  if(!isRuntimeAlive()){clearInterval(_rt);observer.disconnect();return;}
  loadBookmarks(true);
},60_000);

// ── ESC: stop active tools, notify background to clear storage + remove CSS ──
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  if(window.__zingPesticideStop){
    window.__zingPesticideStop();
    if(isRuntimeAlive())try{chrome.runtime.sendMessage({type:"CLEAR_PESTICIDE_STATE"});}catch{}
  }
  if(window.__zingColorPickerStop){
    window.__zingColorPickerStop();
    if(isRuntimeAlive())try{chrome.runtime.sendMessage({type:"CLEAR_COLOR_PICKER_STATE"});}catch{}
  }
},true);

// ── Color Picker ──────────────────────────────────────────────────────────────
function __zingInjectColorPicker(){
  if(window.__zingColorPickerActive){window.__zingColorPickerStop?.();return;}
  window.__zingColorPickerActive=true;

  function parseRgb(s){const m=s&&s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);return m?{r:+m[1],g:+m[2],b:+m[3]}:null;}
  function toHex(r,g,b){return"#"+[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase();}
  function toHsl(r,g,b){
    r/=255;g/=255;b/=255;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    let h=0,s=0,l=(mx+mn)/2;
    if(mx!==mn){const d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);
      if(mx===r)h=((g-b)/d+(g<b?6:0))/6;else if(mx===g)h=((b-r)/d+2)/6;else h=((r-g)/d+4)/6;}
    return`hsl(${Math.round(h*360)}, ${Math.round(s*100)}%, ${Math.round(l*100)}%)`;
  }
  function getColorAt(x,y){
    const els=document.elementsFromPoint(x,y);
    for(const el of els){
      if(el.id==="__zing-color-picker"||el.id==="__zing-color-popover")continue;
      if(el.closest?.("#__zing-color-picker")||el.closest?.("#__zing-color-popover"))continue;
      const bg=window.getComputedStyle(el).backgroundColor;
      if(bg&&bg!=="rgba(0, 0, 0, 0)"&&bg!=="transparent"){const c=parseRgb(bg);if(c)return c;}
    }
    return{r:255,g:255,b:255};
  }

  const picker=document.createElement("div");
  picker.id="__zing-color-picker";
  Object.assign(picker.style,{position:"fixed",zIndex:"2147483647",pointerEvents:"none",
    display:"flex",flexDirection:"column",alignItems:"center",gap:"6px",userSelect:"none",top:"0",left:"0"});
  const loupe=document.createElement("div");
  Object.assign(loupe.style,{width:"64px",height:"64px",borderRadius:"50%",
    border:"2.5px solid rgba(255,255,255,.7)",
    boxShadow:"0 4px 20px rgba(0,0,0,.7), inset 0 0 0 1px rgba(0,0,0,.2)",
    background:"#fff",position:"relative",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"});
  const ch=document.createElement("div");ch.style.cssText="position:absolute;width:100%;height:1px;background:rgba(255,255,255,.6);top:50%;transform:translateY(-50%);pointer-events:none";
  const cv=document.createElement("div");cv.style.cssText="position:absolute;width:1px;height:100%;background:rgba(255,255,255,.6);left:50%;transform:translateX(-50%);pointer-events:none";
  const cdot=document.createElement("div");cdot.style.cssText="width:9px;height:9px;border-radius:50%;border:1.5px solid rgba(255,255,255,.95);position:absolute;z-index:1;box-shadow:0 1px 4px rgba(0,0,0,.4)";
  loupe.append(ch,cv,cdot);
  const lbl=document.createElement("div");
  Object.assign(lbl.style,{background:"rgba(9,9,11,.95)",color:"#fafafa",fontSize:"12px",
    fontFamily:"'SF Mono','Fira Code',monospace",fontWeight:"600",padding:"4px 10px",borderRadius:"6px",
    border:"1px solid rgba(255,255,255,.1)",letterSpacing:".04em",whiteSpace:"nowrap",
    boxShadow:"0 2px 8px rgba(0,0,0,.5)"});
  lbl.textContent="#FFFFFF";
  picker.append(loupe,lbl);
  document.documentElement.appendChild(picker);
  document.documentElement.style.setProperty("cursor","crosshair","important");

  let cc={r:255,g:255,b:255};
  function onMove(e){
    if(picker.contains(e.target))return;
    let tx=e.clientX+24,ty=e.clientY+24;
    if(tx+96>window.innerWidth)tx=e.clientX-96;
    if(ty+100>window.innerHeight)ty=e.clientY-100;
    picker.style.left=tx+"px";picker.style.top=ty+"px";
    const c=getColorAt(e.clientX,e.clientY);cc=c;
    const hex=toHex(c.r,c.g,c.b);loupe.style.background=hex;lbl.textContent=hex;
  }
  function showPopover(e){
    const c=cc,hex=toHex(c.r,c.g,c.b),hsl=toHsl(c.r,c.g,c.b),rgb=`rgb(${c.r}, ${c.g}, ${c.b})`;
    document.getElementById("__zing-color-popover")?.remove();
    const pop=document.createElement("div");pop.id="__zing-color-popover";
    Object.assign(pop.style,{position:"fixed",zIndex:"2147483647",background:"#0d0d0f",
      border:"1px solid #27272a",borderRadius:"12px",padding:"14px",
      boxShadow:"0 12px 36px rgba(0,0,0,.75)",
      fontFamily:"'Bricolage Grotesque',-apple-system,sans-serif",width:"220px"});
    let px=e.clientX+14,py=e.clientY+14;
    if(px+235>window.innerWidth)px=e.clientX-235;
    if(py+185>window.innerHeight)py=e.clientY-185;
    pop.style.left=px+"px";pop.style.top=py+"px";
    const sw=document.createElement("div");
    Object.assign(sw.style,{width:"100%",height:"48px",borderRadius:"8px",background:hex,
      border:"1px solid rgba(255,255,255,.07)",marginBottom:"10px"});
    function row(fmt,val){
      const r=document.createElement("div");r.style.cssText="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-top:1px solid #1e1e21;gap:8px";
      const l=document.createElement("div");l.style.cssText="display:flex;flex-direction:column;gap:2px;min-width:0";
      const fe=document.createElement("span");fe.style.cssText="font-size:9px;font-weight:700;color:#3f3f46;text-transform:uppercase;letter-spacing:.08em";fe.textContent=fmt;
      const ve=document.createElement("span");ve.style.cssText="font-size:12px;font-weight:600;color:#d4d4d8;font-family:'SF Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";ve.textContent=val;
      l.append(fe,ve);
      const btn=document.createElement("button");btn.style.cssText="background:#1a1a1d;border:1px solid #27272a;border-radius:5px;color:#71717a;font-size:10px;padding:3px 8px;cursor:pointer;font-family:inherit;flex-shrink:0;transition:color .12s,border-color .12s";
      btn.textContent="Copy";btn.addEventListener("click",()=>{navigator.clipboard.writeText(val).catch(()=>{});btn.textContent="✓";btn.style.color="#22c55e";setTimeout(()=>{btn.textContent="Copy";btn.style.color="";},1400);});
      r.append(l,btn);return r;
    }
    const hdr=document.createElement("div");hdr.style.cssText="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px";
    const ttl=document.createElement("span");ttl.style.cssText="font-size:10px;font-weight:700;color:#52525b;text-transform:uppercase;letter-spacing:.07em";ttl.textContent="Picked Color";
    const xb=document.createElement("button");xb.style.cssText="background:none;border:none;color:#52525b;cursor:pointer;font-size:16px;padding:0;line-height:1";xb.textContent="×";xb.addEventListener("click",()=>pop.remove());
    hdr.append(ttl,xb);pop.append(hdr,sw,row("HEX",hex),row("RGB",rgb),row("HSL",hsl));
    document.documentElement.appendChild(pop);
    setTimeout(()=>{
      document.addEventListener("click",function dm(ev){if(!pop.contains(ev.target)){pop.remove();document.removeEventListener("click",dm,true);}},{capture:true});
    },80);
  }
  function onClick(e){
    if(picker.contains(e.target))return;
    showPopover(e);e.preventDefault();e.stopPropagation();
    cleanup();
  }
  function onKey(e){
    if(e.key!=="Escape")return;
    cleanup();
    if(isRuntimeAlive())try{chrome.runtime.sendMessage({type:"CLEAR_COLOR_PICKER_STATE"});}catch{}
  }
  function cleanup(){
    document.removeEventListener("mousemove",onMove,true);
    document.removeEventListener("click",onClick,true);
    document.removeEventListener("keydown",onKey,true);
    picker.remove();
    document.documentElement.style.removeProperty("cursor");
    window.__zingColorPickerActive=false;
    window.__zingColorPickerStop=null;
    if(isRuntimeAlive())try{chrome.runtime.sendMessage({type:"CLEAR_COLOR_PICKER_STATE"});}catch{}
  }
  document.addEventListener("mousemove",onMove,true);
  document.addEventListener("click",onClick,true);
  document.addEventListener("keydown",onKey,true);
  window.__zingColorPickerStop=cleanup;
}
window.__zingInjectColorPicker=__zingInjectColorPicker;
