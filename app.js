"use strict";

/* =========================================================
  基本ユーティリティ
========================================================= */
const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "reward_task_manager_v22";

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function escapeHtml(str){
  return (str ?? "").toString().replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  })[c]);
}
function toast(msg){
  const t = $("toast");
  if(!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.add("hidden"),1200);
}

/* =========================================================
  State
========================================================= */
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  }catch{
    return {};
  }
}
let state = loadState();
state.campaigns ??= [];
state.logs ??= [];
state.delivery ??= {};
state.listener_pool ??= {};
state.active_listener ??= {};
state.gacha_history ??= {};

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* =========================================================
  Campaign helpers
========================================================= */
function getCampaign(id){
  return state.campaigns.find(c=>c.id===id) || null;
}
function isCampaignDone(c){
  const totals = computeTotals(c.id);
  if(!totals.length) return false;
  return totals.every(r => state.delivery[c.id]?.[r.name]==="done");
}
function computeTotals(campaignId){
  const map = new Map();
  for(const l of state.logs.filter(x=>x.campaign_id===campaignId)){
    map.set(l.listener, (map.get(l.listener)||0)+l.delta);
  }
  return [...map.entries()].map(([name,pt])=>({name,pt}))
    .sort((a,b)=>b.pt-a.pt);
}

/* =========================================================
  Listener管理
========================================================= */
function getListenerPool(cid){
  state.listener_pool[cid] ??= [];
  return state.listener_pool[cid];
}
function addListener(cid,name){
  name=name.trim();
  if(!name) return;
  const pool=getListenerPool(cid);
  if(!pool.includes(name)) pool.push(name);
  state.active_listener[cid]=name;
  saveState();
}
function getActiveListener(cid){
  return state.active_listener[cid]||"";
}

/* =========================================================
  Routing
========================================================= */
const views={
  home:$("view-home"),
  tasks:$("view-tasks"),
  campaigns:$("view-campaigns"),
  campaign:$("view-campaign"),
  live:$("view-live"),
};
let currentCampaignId=null;

function showView(v){
  Object.entries(views).forEach(([k,el])=>{
    if(el) el.classList.toggle("hidden",k!==v);
  });
}
function route(){
  const h=location.hash||"#home";
  if(h.startsWith("#live=")){
    const id=h.split("=")[1];
    if(getCampaign(id)){
      currentCampaignId=id;
      showView("live");
      renderLive();
      return;
    }
  }
  if(h.startsWith("#campaign=")){
    const id=h.split("=")[1];
    if(getCampaign(id)){
      currentCampaignId=id;
      showView("campaign");
      renderCampaign();
      return;
    }
  }
  if(h==="#tasks"){
    showView("tasks");
    renderTasks();
    return;
  }
  if(h==="#campaigns"){
    showView("campaigns");
    renderCampaigns();
    return;
  }
  showView("home");
  renderHome();
}
window.addEventListener("hashchange",route);

/* =========================================================
  Home
========================================================= */
function renderHome(){
  $("statCampaigns").textContent=state.campaigns.length;
  const done=state.campaigns.filter(isCampaignDone).length;
  $("statDoneCampaigns").textContent=done;
  $("statOpenCampaigns").textContent=state.campaigns.length-done;
}

/* =========================================================
  Campaign list / create
========================================================= */
$("createCampaignForm")?.addEventListener("submit",(e)=>{
  e.preventDefault();
  const fd=new FormData(e.target);
  const c={
    id:uid(),
    name:fd.get("name").toString(),
    start:fd.get("start_date").toString(),
    type:fd.get("type"),
    rules:[],
    gacha:{items:[],singleCost:0},
    created:new Date().toISOString()
  };
  state.campaigns.unshift(c);
  saveState();
  e.target.reset();
  toast("企画作成");
  renderCampaigns();
});

function renderCampaigns(){
  const box=$("campaignList");
  if(!box) return;
  box.innerHTML=state.campaigns.map(c=>`
    <div class="item">
      <div>
        <strong>${escapeHtml(c.name)}</strong>
        <div class="muted">${escapeHtml(c.start)}</div>
      </div>
      <div class="itemActions">
        <button onclick="location.hash='#campaign=${c.id}'">確認</button>
        <button onclick="location.hash='#live=${c.id}'">リアルタイム</button>
      </div>
    </div>
  `).join("");
}

/* =========================================================
  Tasks
========================================================= */
function renderTasks(){
  const box=$("taskCampaignList");
  if(!box) return;
  box.innerHTML=state.campaigns.map(c=>`
    <div class="item itemClickable" onclick="location.hash='#campaign=${c.id}'">
      <strong>${escapeHtml(c.name)}</strong>
    </div>
  `).join("");
}

/* =========================================================
  Campaign confirm
========================================================= */
function renderCampaign(){
  const c=getCampaign(currentCampaignId);
  if(!c) return;
  $("campaignTitle").textContent=c.name;
  $("campaignMeta").textContent=c.start;
  $("goLiveBtn").href=`#live=${c.id}`;
  const body=$("leaderboardBody");
  const totals=computeTotals(c.id);
  body.innerHTML=totals.map(r=>`
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${r.pt}</td>
      <td></td>
      <td>
        <select onchange="state.delivery['${c.id}']??={};state.delivery['${c.id}']['${r.name}']=this.value;saveState()">
          <option value="open">未完了</option>
          <option value="done">完了</option>
        </select>
      </td>
    </tr>
  `).join("");
}

/* =========================================================
  Live
========================================================= */
function renderLive(){
  const c=getCampaign(currentCampaignId);
  if(!c) return;

  $("liveTitle").textContent=c.name;
  $("liveMeta").textContent=c.start;
  $("goConfirmBtn").href=`#campaign=${c.id}`;

  const pool=getListenerPool(c.id);
  const active=getActiveListener(c.id);

  const sel=$("listenerSelect");
  sel.innerHTML=`<option value="">選択</option>`+
    pool.map(n=>`<option ${n===active?"selected":""}>${escapeHtml(n)}</option>`).join("");

  $("addNameBtn").onclick=()=>{
    const v=$("addNameInput").value.trim();
    if(!v) return;
    addListener(c.id,v);
    $("addNameInput").value=v; // ★消さない
    renderLive();
  };

  sel.onchange=()=>{
    state.active_listener[c.id]=sel.value;
    $("addNameInput").value=sel.value;
    saveState();
  };

  document.querySelectorAll("[data-add]").forEach(btn=>{
    btn.onclick=()=>{
      const n=getActiveListener(c.id);
      if(!n) return toast("リスナー未選択");
      state.logs.push({
        id:uid(),
        campaign_id:c.id,
        listener:n,
        delta:parseInt(btn.dataset.add,10),
        at:new Date().toISOString()
      });
      saveState();
      renderLive();
    };
  });

  const body=$("liveLeaderboardBody");
  const totals=computeTotals(c.id);
  body.innerHTML=totals.map(r=>`
    <tr>
      <td onclick="state.active_listener['${c.id}']='${r.name}';$('addNameInput').value='${r.name}';saveState();renderLive()">
        ${escapeHtml(r.name)}
      </td>
      <td>${r.pt}</td>
      <td></td>
    </tr>
  `).join("");
}

/* =========================================================
  Init
========================================================= */
route();
renderHome();
renderCampaigns();
