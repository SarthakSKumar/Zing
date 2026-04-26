/* Zing — Popup JS */
"use strict";

const API = "http://localhost:5000";

// MUST match background.js and popup PESTICIDE_CSS exactly
const DARK_CSS = `
html { filter: invert(1) hue-rotate(180deg) !important; background: #111 !important; }
img, video, iframe, canvas, picture, svg image, embed, object,
[style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }
`;
const PEST_CSS = `
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

// DOM refs
const dot    = document.getElementById("dot");
const btnSave= document.getElementById("btn-save");
const btnShot= document.getElementById("btn-screenshot");
const btnOpen= document.getElementById("btn-open");
const btnDark= document.getElementById("btn-dark");
const btnPest= document.getElementById("btn-pest");
const btnClr = document.getElementById("btn-color");
const btnBw  = document.getElementById("btn-bw");
const bwPanel= document.getElementById("bw-panel");
const result = document.getElementById("result");
const greet  = document.getElementById("greeting");
const sPop   = document.getElementById("s-pop");
const infoPop= document.getElementById("info-pop");

// ── Settings ──────────────────────────────────────────────────────────────────
let S = null;
async function loadS() {
  try { const r=await fetch(`${API}/api/settings`); if(r.ok) S=await r.json(); } catch {}
  return S;
}

// ── Greeting ──────────────────────────────────────────────────────────────────
function mkGreeting() {
  const h=new Date().getHours();
  const t=h<5?"Good Night":h<12?"Good Morning":h<17?"Good Afternoon":h<21?"Good Evening":"Good Night";
  const n=(S?.profile?.username||"").trim();
  return n?`${t}, ${n}`:t;
}
function renderGreet(){ if(greet) greet.textContent=mkGreeting(); }

// ── Clock ─────────────────────────────────────────────────────────────────────
const DAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtTime(d,s){
  if(!s||s.dateTime?.useSystemSettings!==false) return d.toLocaleTimeString(undefined,{hour12:false});
  const tz=s.dateTime?.timezone||"UTC",h12=s.dateTime?.hourFormat==="12";
  return d.toLocaleTimeString("en-US",{timeZone:tz,hour12:h12,hour:"2-digit",minute:"2-digit",second:"2-digit"});
}
function fmtDate(d,s){
  if(!s||s.dateTime?.useSystemSettings!==false) return`${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
  const tz=s.dateTime?.timezone||"UTC";
  const pts=new Intl.DateTimeFormat("en-US",{timeZone:tz,day:"numeric",month:"short",year:"numeric"}).formatToParts(d);
  const day=pts.find(p=>p.type==="day")?.value||"", mon=pts.find(p=>p.type==="month")?.value||"", yr=pts.find(p=>p.type==="year")?.value||"";
  const fmt=s.dateTime?.dateFormat||"D MMM YYYY";
  const dp=day.padStart(2,"0"), nm=String([...MON].indexOf(mon)+1).padStart(2,"0");
  return fmt.replace("DD",dp).replace("D",day).replace("YYYY",yr).replace("MMM",mon).replace("MM",nm);
}
function fmtWday(d,s){
  if(!s||s.dateTime?.useSystemSettings!==false) return DAYS[d.getDay()];
  return d.toLocaleDateString("en-US",{timeZone:s.dateTime?.timezone||"UTC",weekday:"long"});
}

function renderWeek(){
  const n=new Date(), td=n.getDate(), tm=n.getMonth(), ty=n.getFullYear();
  const mo=(n.getDay()+6)%7, mon=new Date(n); mon.setDate(n.getDate()-mo);
  const g=document.getElementById("cal-grid"); g.innerHTML="";
  ["Mo","Tu","We","Th","Fr","Sa","Su"].forEach(l=>{const e=document.createElement("div");e.className="cal-dlbl";e.textContent=l;g.appendChild(e);});
  for(let i=0;i<7;i++){
    const d=new Date(mon);d.setDate(mon.getDate()+i);
    const isT=d.getDate()===td&&d.getMonth()===tm&&d.getFullYear()===ty,isW=i>=5;
    const e=document.createElement("div");e.className="cal-d"+(isT?" today":"")+(isW?" wend":"");
    e.textContent=d.getDate();g.appendChild(e);
  }
}
function renderClock(){
  const n=new Date();
  document.getElementById("cal-time").textContent=fmtTime(n,S);
  document.getElementById("cal-wday").textContent=fmtWday(n,S);
  document.getElementById("cal-fdate").textContent=fmtDate(n,S);
}
renderWeek(); renderClock();
setInterval(()=>{const n=new Date();renderClock();if(!n.getHours()&&!n.getMinutes()&&!n.getSeconds())renderWeek();},1000);

loadS().then(()=>{ renderGreet(); renderClock(); });

// ── Server ping ───────────────────────────────────────────────────────────────
chrome.runtime.sendMessage({type:"PING"},r=>{
  if(r?.ok){dot.classList.add("ok");btnSave.disabled=false;}
  else dot.classList.remove("ok");
});

// ── Utils ─────────────────────────────────────────────────────────────────────
function showR(msg,type){result.textContent=msg;result.className=type;result.style.display=msg?"block":"none";}
async function activeTab(){const[t]=await chrome.tabs.query({active:true,currentWindow:true});return t;}

// ── Save Tabs ─────────────────────────────────────────────────────────────────
btnSave.addEventListener("click",()=>{
  btnSave.disabled=true;showR("Saving tabs…","info");
  const n=new Date(),p=x=>String(x).padStart(2,"0");
  const name=`Tabs ${n.getFullYear()}-${p(n.getMonth()+1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`;
  chrome.runtime.sendMessage({type:"SAVE_TABS",collectionName:name},r=>{
    btnSave.disabled=false;
    if(r?.ok)showR(`✓ Saved ${r.added} tabs into "${r.collection}"${r.skipped>0?` · ${r.skipped} skipped`:""}`, "success");
    else showR(`✗ ${r?.error||"Unknown error"}`, "error");
  });
});

// ── Screenshot ────────────────────────────────────────────────────────────────
btnShot.addEventListener("click",()=>{
  btnShot.disabled=true;showR("Capturing…","info");
  chrome.runtime.sendMessage({type:"FULL_PAGE_SCREENSHOT"},async r=>{
    btnShot.disabled=false;
    if(r?.ok){
      try{const b=await(await fetch(r.dataUrl)).blob();await navigator.clipboard.write([new ClipboardItem({"image/png":b})]);showR(`✓ ${r.filename} saved & copied`,"success");}
      catch{showR(`✓ ${r.filename} saved`,"success");}
    }else showR(`✗ ${r?.error||"Failed"}`,"error");
  });
});

btnOpen.addEventListener("click",()=>{chrome.tabs.create({url:"http://localhost:5000"});window.close();});

// ── Dark Reader ───────────────────────────────────────────────────────────────
async function initDark(){
  const t=await activeTab(); if(!t?.id)return;
  const d=await chrome.storage.local.get(`darkReader_${t.id}`);
  btnDark.classList.toggle("on",!!d[`darkReader_${t.id}`]);
}
btnDark.addEventListener("click",async()=>{
  const t=await activeTab(); if(!t?.id)return;
  const key=`darkReader_${t.id}`;
  const d=await chrome.storage.local.get(key);
  if(!d[key]){
    // Check luminance first
    try{
      const [{result:lum}]=await chrome.scripting.executeScript({target:{tabId:t.id},func:()=>{
        const bg=window.getComputedStyle(document.documentElement).backgroundColor;
        const m=bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if(!m)return 1;
        const r=+m[1],g=+m[2],b=+m[3];
        if(r===0&&g===0&&b===0)return 1;
        const l=c=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4)};
        return .2126*l(r)+.7152*l(g)+.0722*l(b);
      }});
      if(lum<.12){showR("Page is already dark — skipping","info");return;}
    }catch{}
    await chrome.storage.local.set({[key]:true});
    try{await chrome.scripting.insertCSS({target:{tabId:t.id},css:DARK_CSS});btnDark.classList.add("on");}
    catch(e){await chrome.storage.local.remove(key);showR(`✗ ${e.message}`,"error");}
  }else{
    await chrome.storage.local.remove(key);
    try{await chrome.scripting.removeCSS({target:{tabId:t.id},css:DARK_CSS});}catch{}
    btnDark.classList.remove("on");
  }
});

// ── Pesticide ─────────────────────────────────────────────────────────────────
function __zingPestBar(iconUrl){
  if(window.__zingPesticideStop)window.__zingPesticideStop();
  const bar=document.createElement("div");
  bar.id="__zing-pest-bar";
  Object.assign(bar.style,{position:"fixed",bottom:"0",left:"0",right:"0",zIndex:"2147483646",
    background:"rgba(9,9,11,.95)",borderTop:"1px solid #27272a",
    display:"flex",alignItems:"center",justifyContent:"space-between",
    padding:"7px 14px",fontFamily:'"BG",-apple-system,sans-serif',
    fontSize:"12px",fontWeight:"600",lineHeight:"1.4",color:"#52525b",
    boxSizing:"border-box",backdropFilter:"blur(10px)",minHeight:"34px"});
  const info=document.createElement("span");
  info.style.cssText="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:65%;font:600 12px/1.4 inherit;color:#71717a";
  info.textContent="Hover to inspect · Ctrl+Click copies selector";
  const right=document.createElement("div");right.style.cssText="display:flex;align-items:center;gap:9px;flex-shrink:0";
  const leg=document.createElement("div");leg.style.cssText="display:flex;align-items:center;gap:6px;font-size:11px;color:#52525b";
  [["rgba(220,50,50,.8)","div"],["rgba(0,160,255,.8)","span"],["rgba(255,165,0,.9)","img"],
   ["rgba(180,0,255,.8)","a"],["rgba(0,220,100,.8)","btn"],["rgba(0,220,220,.8)","input"]].forEach(([c,l])=>{
    const s=document.createElement("span");s.style.cssText="display:flex;align-items:center;gap:3px";
    const sw=document.createElement("span");sw.style.cssText=`display:inline-block;width:7px;height:7px;border-radius:2px;background:${c};flex-shrink:0`;
    const tx=document.createElement("span");tx.textContent=l;s.append(sw,tx);leg.appendChild(s);
  });
  const br=document.createElement("div");br.style.cssText="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#3f3f46;letter-spacing:.04em;border-left:1px solid #27272a;padding-left:9px";
  const li=document.createElement("img");li.src=iconUrl;li.style.cssText="width:13px;height:13px;border-radius:3px";
  const bt=document.createElement("span");bt.textContent="Zing";
  br.append(li,bt);right.append(leg,br);bar.append(info,right);
  document.documentElement.appendChild(bar);

  function onMove(e){
    const el=document.elementFromPoint(e.clientX,e.clientY);
    if(!el||el===bar||bar.contains(el))return;
    const tag=el.tagName.toLowerCase();
    const cls=typeof el.className==="string"?el.className.trim():"";
    const id=el.id?`#${el.id}`:"";
    const cs=cls?`.${cls.split(/\s+/).filter(Boolean).join(".")}`:""
    info.textContent=`<${tag}${id}${cs}>`;
    info.style.color=e.ctrlKey?"#fafafa":"#a1a1aa";
  }
  function onCtrl(e){
    if(!e.ctrlKey)return;
    const el=document.elementFromPoint(e.clientX,e.clientY);
    if(!el||el===bar||bar.contains(el))return;
    e.preventDefault();e.stopPropagation();
    const txt=info.textContent.trim();if(!txt)return;
    try{navigator.clipboard.writeText(txt);}catch{
      const ta=document.createElement("textarea");ta.value=txt;ta.style.cssText="position:fixed;opacity:0";
      document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();
    }
    const prev=info.textContent;info.style.color="#22c55e";info.textContent="✓ Copied!";
    setTimeout(()=>{info.style.color="#a1a1aa";info.textContent=prev;},1400);
  }
  document.addEventListener("mousemove",onMove,true);
  document.addEventListener("click",onCtrl,true);
  window.__zingPesticideStop=()=>{
    document.removeEventListener("mousemove",onMove,true);
    document.removeEventListener("click",onCtrl,true);
    bar.remove();delete window.__zingPesticideStop;
  };
}

async function initPest(){
  const t=await activeTab();if(!t?.id)return;
  const d=await chrome.storage.session.get(`pest_${t.id}`);
  btnPest.classList.toggle("on",!!d[`pest_${t.id}`]);
}
btnPest.addEventListener("click",async()=>{
  const t=await activeTab();if(!t?.id)return;
  const key=`pest_${t.id}`;
  const d=await chrome.storage.session.get(key);
  try{
    if(!d[key]){
      await chrome.storage.session.set({[key]:true});
      await chrome.scripting.insertCSS({target:{tabId:t.id},css:PEST_CSS});
      await chrome.scripting.executeScript({target:{tabId:t.id},func:__zingPestBar,args:[chrome.runtime.getURL("icon128.png")]});
      btnPest.classList.add("on");
    }else{
      await chrome.storage.session.remove(key);
      await chrome.scripting.removeCSS({target:{tabId:t.id},css:PEST_CSS});
      await chrome.scripting.executeScript({target:{tabId:t.id},func:()=>window.__zingPesticideStop?.()});
      btnPest.classList.remove("on");
    }
  }catch(e){showR(`✗ ${e.message}`,"error");}
  window.close();
});

// ── Color Picker ──────────────────────────────────────────────────────────────
async function initClr(){
  const t=await activeTab();if(!t?.id)return;
  const d=await chrome.storage.session.get(`colorPicker_${t.id}`);
  btnClr.classList.toggle("on",!!d[`colorPicker_${t.id}`]);
}
btnClr.addEventListener("click",async()=>{
  const t=await activeTab();if(!t?.id)return;
  const key=`colorPicker_${t.id}`;
  const d=await chrome.storage.session.get(key);
  if(!d[key]){
    await chrome.storage.session.set({[key]:true});
    try{
      await chrome.scripting.executeScript({target:{tabId:t.id},func:()=>{if(typeof window.__zingInjectColorPicker==="function")window.__zingInjectColorPicker();}});
      btnClr.classList.add("on");
    }catch(e){await chrome.storage.session.remove(key);showR(`✗ ${e.message}`,"error");}
  }else{
    await chrome.storage.session.remove(key);
    try{await chrome.scripting.executeScript({target:{tabId:t.id},func:()=>window.__zingColorPickerStop?.()});}catch{}
    btnClr.classList.remove("on");
  }
  window.close();
});

initDark();initPest();initClr();

// ── BuiltWith slide panel ─────────────────────────────────────────────────────
const bwSlide = document.getElementById("bw-slide");
const bwBd    = document.getElementById("bw-bd");
const bwClose = document.getElementById("bw-close");
const bwPDom  = document.getElementById("bw-pdom");
let bwLoaded=false;

function closeBW() { bwSlide.classList.add("h"); btnBw.classList.remove("on"); }
bwClose?.addEventListener("click", closeBW);
bwBd?.addEventListener("click", closeBW);
function di(n){return`<img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${n}/${n}-original.svg" loading="lazy" onerror="this.style.display='none'"/>`;}
function sv(p){return`<svg viewBox="0 0 24 24" fill="none" stroke="#52525b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;}
const TI={javascript:di("javascript"),typescript:di("typescript"),react:di("react"),vue:di("vuejs"),angular:di("angularjs"),svelte:di("svelte"),next:di("nextjs"),nuxt:di("nuxtjs"),node:di("nodejs"),express:di("express"),python:di("python"),django:di("django"),flask:di("flask"),php:di("php"),laravel:di("laravel"),ruby:di("ruby"),rails:di("rails"),java:di("java"),spring:di("spring"),graphql:di("graphql"),mysql:di("mysql"),postgres:di("postgresql"),mongodb:di("mongodb"),redis:di("redis"),docker:di("docker"),kubernetes:di("kubernetes"),nginx:di("nginx"),apache:di("apache"),cloudflare:di("cloudflare"),aws:di("amazonwebservices"),azure:di("azure"),"google cloud":di("googlecloud"),wordpress:di("wordpress"),shopify:di("shopify"),jquery:di("jquery"),bootstrap:di("bootstrap"),tailwind:di("tailwindcss"),sass:di("sass"),webpack:di("webpack"),vite:di("vitejs"),cdn:sv('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>'),analytic:sv('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),hosting:sv('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>'),cms:sv('<path d="M14 2H6a2 2 0 0 0-2 2v16h16V8z"/>'),security:sv('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),};
function gti(n){const l=(n||"").toLowerCase();for(const[k,v]of Object.entries(TI))if(l.includes(k))return v;return`<img src="icon128.png" style="width:13px;height:13px;border-radius:3px"/>`;}
const GN={analytics:"Analytics",ns:"Name Server",widgets:"Widgets",hosting:"Hosting",docinfo:"Standards",mx:"Email",shop:"eCommerce",mapping:"Mapping",cms:"CMS"};
const EG=new Set(["ads","link","payment"]);
function ep(t){return t?new Date(t*1000).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}):""}

function buildBW(data){
  bwPanel.innerHTML="";
  if(!data||data.error){bwPanel.innerHTML=`<div class="bw-err">⚠ ${data?.error||"No data"}</div>`;return;}
  const root=data.free1||data, domain=root.domain||root.Domain||"", groups=root.groups||root.Groups||[];
  const vis=groups.filter(g=>{const n=g.name||g.Name||"";return!EG.has(n)&&(g.categories||g.Categories||[]).length;})
    .sort((a,b)=>(a.categories||a.Categories||[]).length-(b.categories||b.Categories||[]).length);
  if(!vis.length){bwPanel.innerHTML='<div class="bw-meta" style="padding:12px 13px">No tech details found.</div>';return;}
  const dh=domain?`<a href="https://${domain}" target="_blank" rel="noopener"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>${domain}</a>`:`<span style="color:#52525b">Unknown</span>`;
  const mp=[ep(root.first||root.First)&&`First: ${ep(root.first||root.First)}`,ep(root.last||root.Last)&&`Last: ${ep(root.last||root.Last)}`].filter(Boolean).join(" · ");
  bwPanel.innerHTML=`<div class="bw-dom">${dh}</div>${mp?`<div class="bw-meta">${mp}</div>`:""}`;
  vis.forEach(g=>{
    const gn=g.name||g.Name||"",gl=g.live??g.Live??0,gd=g.dead??g.Dead??0,cats=g.categories||g.Categories||[];
    const dn=GN[gn]||gn.charAt(0).toUpperCase()+gn.slice(1);
    const ge=document.createElement("div");ge.className="bw-grp";
    ge.innerHTML=`<div class="bw-gh"><div class="bw-ci">${gti(dn)}</div><span>${dn}</span><div class="bw-ld">${gl>0?`<span class="bw-pill bw-live">${gl}</span>`:""}${gd>0?`<span class="bw-pill bw-dead">${gd}</span>`:""}<svg class="bw-gt" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></div></div><div class="bw-cats"></div>`;
    const cc=ge.querySelector(".bw-cats");
    cats.forEach(c=>{const cn=c.name||c.Name||"",cl=c.live??c.Live??0,cd=c.dead??c.Dead??0;
      const re=document.createElement("div");re.className="bw-cat";
      re.innerHTML=`<div class="bw-ci">${gti(cn)}</div><span class="bw-cn">${cn}</span><div style="display:flex;gap:3px">${cl>0?`<span class="bw-pill bw-live">${cl}</span>`:""}${cd>0?`<span class="bw-pill bw-dead">${cd}</span>`:""}</div>`;
      cc.appendChild(re);
    });
    ge.querySelector(".bw-gh").addEventListener("click",()=>ge.classList.toggle("col"));
    bwPanel.appendChild(ge);
  });
}
btnBw.addEventListener("click",async()=>{
  // Toggle: if already open, close it
  if(!bwSlide.classList.contains("h")){closeBW();return;}
  const t=await activeTab();if(!t?.url){showR("✗ Cannot get page URL","error");return;}
  let dom;try{dom=new URL(t.url).hostname.replace(/^www\./,"");}catch{showR("✗ Invalid URL","error");return;}
  // Open slide panel
  if(bwPDom) bwPDom.textContent=dom;
  bwSlide.classList.remove("h");
  btnBw.classList.add("on");
  // Close settings/info if open
  sPop.classList.add("h");infoPop.classList.add("h");
  if(!bwLoaded){
    bwPanel.innerHTML=`<div class="bw-load"><div class="bw-spin"></div>Analysing ${dom}…</div>`;
    try{const r=await fetch(`${API}/api/builtwith?domain=${encodeURIComponent(dom)}`);buildBW(await r.json());bwLoaded=true;}
    catch(e){bwPanel.innerHTML=`<div class="bw-err">⚠ ${e.message}</div>`;}
  }
});

// ── Info popover ──────────────────────────────────────────────────────────────
document.getElementById("btn-info")?.addEventListener("click",e=>{
  e.stopPropagation();infoPop.classList.toggle("h");sPop.classList.add("h");
  if(bwSlide)bwSlide.classList.add("h");btnBw.classList.remove("on");
});
document.addEventListener("click",()=>infoPop.classList.add("h"));

// ── Random Fact ───────────────────────────────────────────────────────────────
(async function(){
  const el=document.getElementById("fact-txt");if(!el)return;
  try{
    const r=await fetch("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en");
    const d=await r.json();el.textContent=d.text||"No fact today.";el.classList.remove("loading");
  }catch{el.textContent="Could not load a fact right now.";el.classList.remove("loading");}
})();

// ── Settings ──────────────────────────────────────────────────────────────────
let scrubWords=[], ovDomains=[], saveTimer=null;

function showSaved(){
  const el=document.getElementById("s-saved");if(!el)return;
  el.classList.add("vis");
  clearTimeout(saveTimer);saveTimer=setTimeout(()=>el.classList.remove("vis"),2000);
}

async function doSave(){
  const qv=id=>document.getElementById(id);
  const payload={
    profile:{username:qv("s-name")?.value.trim()||""},
    jsonPrettify:{enabledByDefault:qv("s-json")?.checked!==false},
    historyScrub:{
      enabled:qv("s-scrub-on")?.checked!==false,
      words:scrubWords,
      frequency:qv("s-scrub-freq")?.value||"startup",
    },
    viewedOverlay:{domains:ovDomains},
    softRefreshInterval:parseInt(qv("s-refresh")?.value||"30",10),
    collectionLockTimeout:parseInt(qv("s-lock")?.value||"120",10),
    dateTime:{
      useSystemSettings:qv("s-dt-sys")?.checked!==false,
      timezone:qv("s-dt-tz")?.value||"UTC",
      hourFormat:qv("s-dt-hr")?.value||"24",
      dateFormat:qv("s-dt-fmt")?.value||"D MMM YYYY",
    },
  };
  try{
    const r=await fetch(`${API}/api/settings`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(r.ok){
      S=await r.json();
      chrome.storage.local.set({jsonPrettifyEnabled:payload.jsonPrettify.enabledByDefault,viewedOverlayDomains:ovDomains});
      chrome.runtime.sendMessage({type:"SETTINGS_UPDATED"}).catch(()=>{});
      renderGreet();renderClock();showSaved();
    }
  }catch{}
}

function mkTagList(words,containerId,onRemove){
  const c=document.getElementById(containerId);if(!c)return;
  c.innerHTML="";
  words.forEach((w,i)=>{
    const t=document.createElement("div");t.className="tag";
    const ws=document.createElement("span");ws.textContent=w;
    const rb=document.createElement("button");rb.className="tag-rm";rb.textContent="×";rb.title="Remove";
    rb.addEventListener("click",()=>{words.splice(i,1);mkTagList(words,containerId,onRemove);doSave();});
    t.append(ws,rb);c.appendChild(t);
  });
}

function openSettings(){
  sPop.classList.remove("h");infoPop.classList.add("h");
  loadS().then(s=>{
    if(!s)return;
    const qv=id=>document.getElementById(id);
    if(qv("s-name"))qv("s-name").value=s.profile?.username||"";
    if(qv("s-json"))qv("s-json").checked=s.jsonPrettify?.enabledByDefault!==false;
    if(qv("s-scrub-on"))qv("s-scrub-on").checked=s.historyScrub?.enabled!==false;
    if(qv("s-scrub-freq"))qv("s-scrub-freq").value=s.historyScrub?.frequency||"startup";
    scrubWords=[...(s.historyScrub?.words||[])];mkTagList(scrubWords,"s-scrub-tags");
    ovDomains=[...(s.viewedOverlay?.domains||[])];mkTagList(ovDomains,"s-ov-tags");
    if(qv("s-refresh"))qv("s-refresh").value=String(s.softRefreshInterval||30);
    if(qv("s-lock"))qv("s-lock").value=String(s.collectionLockTimeout||120);
    const sys=s.dateTime?.useSystemSettings!==false;
    if(qv("s-dt-sys")){qv("s-dt-sys").checked=sys;const cd=document.getElementById("s-dt-cust");if(cd)cd.style.display=sys?"none":"block";}
    if(qv("s-dt-tz"))qv("s-dt-tz").value=s.dateTime?.timezone||"UTC";
    if(qv("s-dt-hr"))qv("s-dt-hr").value=s.dateTime?.hourFormat||"24";
    if(qv("s-dt-fmt"))qv("s-dt-fmt").value=s.dateTime?.dateFormat||"D MMM YYYY";
    // Wire auto-save (only once)
    if(!sPop.dataset.wired){
      sPop.dataset.wired="1";
      ["s-json","s-scrub-on","s-refresh","s-lock","s-scrub-freq"].forEach(id=>document.getElementById(id)?.addEventListener("change",doSave));
      ["s-dt-sys","s-dt-tz","s-dt-hr","s-dt-fmt"].forEach(id=>document.getElementById(id)?.addEventListener("change",e=>{
        if(id==="s-dt-sys"){const cd=document.getElementById("s-dt-cust");if(cd)cd.style.display=e.target.checked?"none":"block";}
        doSave();
      }));
      const nm=document.getElementById("s-name");
      nm?.addEventListener("blur",doSave);nm?.addEventListener("keydown",e=>{if(e.key==="Enter")doSave();});
      // Scrub words
      document.getElementById("s-scrub-add")?.addEventListener("click",()=>{
        const inp=document.getElementById("s-scrub-inp"),v=(inp?.value||"").trim().toLowerCase();
        if(v&&!scrubWords.includes(v)){scrubWords.push(v);mkTagList(scrubWords,"s-scrub-tags");doSave();if(inp)inp.value="";}
      });
      document.getElementById("s-scrub-inp")?.addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("s-scrub-add")?.click();});
      // Overlay domains
      document.getElementById("s-ov-add")?.addEventListener("click",()=>{
        const inp=document.getElementById("s-ov-inp"),v=(inp?.value||"").trim().toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/.*$/,"");
        if(v&&!ovDomains.includes(v)){ovDomains.push(v);mkTagList(ovDomains,"s-ov-tags");doSave();if(inp)inp.value="";}
      });
      document.getElementById("s-ov-inp")?.addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("s-ov-add")?.click();});
    }
  });
}

document.getElementById("btn-settings")?.addEventListener("click",e=>{
  e.stopPropagation();
  if(!sPop.classList.contains("h")){sPop.classList.add("h");return;}
  openSettings();
  if(bwSlide)bwSlide.classList.add("h");btnBw.classList.remove("on");
});
document.getElementById("s-close")?.addEventListener("click",()=>sPop.classList.add("h"));
document.getElementById("s-bd")?.addEventListener("click",()=>sPop.classList.add("h"));
