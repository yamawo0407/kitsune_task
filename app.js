"use strict";

/* =========================
   Utils
========================= */
const jsStatus = document.getElementById("jsStatus");
if (jsStatus) jsStatus.textContent = "JS: OK";

const STORAGE_KEY = "reward_task_manager_v20";

function uid(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }
function escapeHtml(s){
  return (s ?? "").toString().replace(/[&<>"']/g,(c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg){
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toastEl.classList.add("hidden"), 1200);
}

/* =========================
   State
========================= */
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? JSON.parse(raw) : {};
    return {
      campaigns: Array.isArray(s.campaigns) ? s.campaigns : [],
      logs: Array.isArray(s.logs) ? s.logs : [],
      delivery: (s.delivery && typeof s.delivery === "object") ? s.delivery : {},
      gacha_history: (s.gacha_history && typeof s.gacha_history === "object") ? s.gacha_history : {},
      listener_pool: (s.listener_pool && typeof s.listener_pool === "object") ? s.listener_pool : {},
      active_listener: (s.active_listener && typeof s.active_listener === "object") ? s.active_listener : {},
    };
  }catch{
    return { campaigns: [], logs: [], delivery: {}, gacha_history: {}, listener_pool: {}, active_listener:{} };
  }
}
let state = loadState();
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function normalizeCampaignType(t){
  return (t === "shopping" || t === "achievement" || t === "gacha") ? t : "achievement";
}
function ensureGacha(c){
  if(!c.gacha || typeof c.gacha !== "object"){
    c.gacha = { singleCost: 0, multiCost: 0, multiCount: 0, items: [] };
  }
  if(!Array.isArray(c.gacha.items)) c.gacha.items = [];
  c.gacha.singleCost = Number(c.gacha.singleCost||0);
  c.gacha.multiCost  = Number(c.gacha.multiCost||0);
  c.gacha.multiCount = Number(c.gacha.multiCount||0);
}
function migrate(){
  state.campaigns.forEach(c=>{
    c.type = normalizeCampaignType(c.type);
    if(!c.created_at) c.created_at = new Date().toISOString();
    if(c.type === "gacha") ensureGacha(c);
  });
  if(!state.delivery || typeof state.delivery !== "object") state.delivery = {};
  if(!state.gacha_history || typeof state.gacha_history !== "object") state.gacha_history = {};
  if(!state.listener_pool || typeof state.listener_pool !== "object") state.listener_pool = {};
  if(!state.active_listener || typeof state.active_listener !== "object") state.active_listener = {};
}
migrate(); saveState();

/* =========================
   SPA routing
========================= */
const views = {
  home: document.getElementById("view-home"),
  tasks: document.getElementById("view-tasks"),
  campaigns: document.getElementById("view-campaigns"),
  campaign: document.getElementById("view-campaign"),
  live: document.getElementById("view-live"),
};

function setActiveNav(viewName){
  document.querySelectorAll(".navlink").forEach(a=>a.classList.remove("active"));
  const map = { home:"home", tasks:"tasks", campaigns:"campaigns", campaign:"tasks", live:"tasks" };
  const key = map[viewName] || "home";
  const el = document.querySelector(`.navlink[data-nav="${key}"]`);
  if(el) el.classList.add("active");
}
function showView(name){
  Object.entries(views).forEach(([k, el])=> el && el.classList.toggle("hidden", k !== name));
  setActiveNav(name);
}
function parseHashParts(){
  const raw = (location.hash || "#home").slice(1);
  const [path, queryStr] = raw.split("?");
  const params = new URLSearchParams(queryStr || "");
  return { path: path || "home", params };
}

let currentCampaignId = null;
let taskPageFilter = "all";

function getCurrentCampaign(){
  return state.campaigns.find(c=>c.id===currentCampaignId) || null;
}

function route(){
  const { path, params } = parseHashParts();

  if(path.startsWith("campaign=")){
    const id = path.split("=")[1];
    if(id && state.campaigns.some(c=>c.id===id)){
      currentCampaignId = id;
      showView("campaign");
      renderCampaign();
      return;
    }
    location.hash = "#tasks";
    return;
  }

  if(path.startsWith("live=")){
    const id = path.split("=")[1];
    if(id && state.campaigns.some(c=>c.id===id)){
      currentCampaignId = id;
      showView("live");
      renderLive();
      return;
    }
    location.hash = "#tasks";
    return;
  }

  if(path === "tasks"){
    showView("tasks");
    const list = (params.get("list") || "").toLowerCase();
    taskPageFilter = (list==="open"||list==="done"||list==="all") ? list : "all";
    renderTaskCampaignList();
    return;
  }

  if(path === "campaigns"){
    showView("campaigns");
    renderCampaigns();
    return;
  }

  showView("home");
  renderHome();
}
window.addEventListener("hashchange", ()=>{ route(); renderAll(); });

/* =========================
   Calculations
========================= */
function rulesSorted(rules){
  return (Array.isArray(rules) ? rules : [])
    .filter(r => Number.isFinite(r.threshold) && (r.reward||"").trim())
    .slice()
    .sort((a,b)=>a.threshold-b.threshold);
}
function achievedRewards(campaign, points){
  const rules = rulesSorted(campaign.rules);
  return rules.filter(r => points >= r.threshold).map(r => ({ cost:r.threshold, reward:r.reward }));
}
function computeTotalsForCampaign(campaignId){
  const map = new Map();
  for(const log of state.logs.filter(l=>l.campaign_id===campaignId)){
    const name = (log.listener_name||"").trim();
    if(!name) continue;
    map.set(name, (map.get(name)||0) + (log.delta_points||0));
  }
  const rows = Array.from(map.entries()).map(([listener_name, points])=>({listener_name, points}));
  rows.sort((a,b)=> b.points - a.points || a.listener_name.localeCompare(b.listener_name));
  return rows;
}

/* 完了管理 */
function getDeliveryMap(campaignId){
  if (!state.delivery[campaignId] || typeof state.delivery[campaignId] !== "object") state.delivery[campaignId] = {};
  return state.delivery[campaignId];
}
function getDeliveryStatus(campaignId, listenerName){
  const m = getDeliveryMap(campaignId);
  return m[listenerName] === "done" ? "done" : "open";
}
function setDeliveryStatus(campaignId, listenerName, status){
  const m = getDeliveryMap(campaignId);
  m[listenerName] = (status === "done") ? "done" : "open";
  saveState();
}
function isCampaignDone(campaign){
  const totals = computeTotalsForCampaign(campaign.id);
  if(totals.length === 0) return false;
  return totals.every(r => getDeliveryStatus(campaign.id, r.listener_name) === "done");
}
function campaignSortDesc(a,b){
  const ad = (a.start_date||"");
  const bd = (b.start_date||"");
  if(ad !== bd) return bd.localeCompare(ad);
  const ac = a.created_at || "";
  const bc = b.created_at || "";
  return bc.localeCompare(ac);
}

/* =========================
   Listener pool + Active
========================= */
function getListenerPool(campaignId){
  if(!state.listener_pool[campaignId] || !Array.isArray(state.listener_pool[campaignId])){
    state.listener_pool[campaignId] = [];
  }
  return state.listener_pool[campaignId];
}
function addListenerToPool(campaignId, name){
  const n = (name||"").trim();
  if(!n) return;
  const pool = getListenerPool(campaignId);
  if(!pool.includes(n)){
    pool.push(n);
    pool.sort((a,b)=>a.localeCompare(b));
  }
  saveState();
}
function setActiveListener(campaignId, name){
  const n = (name||"").trim();
  if(!n){
    delete state.active_listener[campaignId];
  }else{
    addListenerToPool(campaignId, n);
    state.active_listener[campaignId] = n;
  }
  saveState();
}
function getActiveListener(campaignId){
  return (state.active_listener[campaignId] || "").trim();
}

/* プルダウン候補：pool + 集計に出てる名前の union */
function getAllKnownListeners(campaignId){
  const pool = getListenerPool(campaignId).slice();
  const totals = computeTotalsForCampaign(campaignId).map(r=>r.listener_name);
  const set = new Set([...pool, ...totals].map(x=>x.trim()).filter(Boolean));
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}

/* =========================
   Gacha history
========================= */
function getGachaCampaignMap(campaignId){
  if(!state.gacha_history[campaignId] || typeof state.gacha_history[campaignId] !== "object"){
    state.gacha_history[campaignId] = {};
  }
  return state.gacha_history[campaignId];
}
function getGachaList(campaignId, listenerName){
  const m = getGachaCampaignMap(campaignId);
  if(!Array.isArray(m[listenerName])) m[listenerName] = [];
  return m[listenerName];
}
function addGachaResult(campaignId, listenerName, ptUsed, results){
  const list = getGachaList(campaignId, listenerName);
  list.push({ at: new Date().toISOString(), ptUsed, results: results.slice() });
  saveState();
}
function gachaSummaryChips(campaignId, listenerName){
  const list = getGachaList(campaignId, listenerName);
  if(!list.length) return [];
  const count = new Map();
  for(const r of list){
    for(const item of (r.results||[])){
      count.set(item, (count.get(item)||0)+1);
    }
  }
  return Array.from(count.entries())
    .sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]))
    .map(([name, n])=>`${name} ×${n}`);
}

/* =========================
   HOME
========================= */
const statCampaigns = document.getElementById("statCampaigns");
const statOpenCampaigns = document.getElementById("statOpenCampaigns");
const statDoneCampaigns = document.getElementById("statDoneCampaigns");
const overallPill = document.getElementById("overallPill");

function renderHome(){
  const all = state.campaigns.length;
  const done = state.campaigns.filter(c=>isCampaignDone(c)).length;
  const open = all - done;

  if(statCampaigns) statCampaigns.textContent = String(all);
  if(statOpenCampaigns) statOpenCampaigns.textContent = String(open);
  if(statDoneCampaigns) statDoneCampaigns.textContent = String(done);
  if(overallPill) overallPill.textContent = open>0 ? `未完了 ${open}` : "未完了なし";
}

/* =========================
   Campaign create
========================= */
function addRuleRow(container, threshold="", reward=""){
  const el = document.createElement("div");
  el.className = "ruleRow";
  el.innerHTML = `
    <label class="field">
      <span>ポイント</span>
      <input class="input" type="number" min="0" step="1" data-threshold value="${escapeHtml(threshold)}" />
    </label>
    <label class="field">
      <span>返礼品内容</span>
      <input class="input" type="text" data-reward value="${escapeHtml(reward)}" />
    </label>
    <div class="field">
      <span>&nbsp;</span>
      <button class="btn ghost" type="button" data-del>削除</button>
    </div>
  `;
  el.querySelector("[data-del]").addEventListener("click", ()=>el.remove());
  container.appendChild(el);
}
function collectRulesFrom(container){
  const rules = [];
  container.querySelectorAll(".ruleRow").forEach(row=>{
    const th = parseInt(row.querySelector("[data-threshold]")?.value, 10);
    const rw = (row.querySelector("[data-reward]")?.value||"").toString().trim();
    if(Number.isFinite(th) && rw) rules.push({threshold: th, reward: rw});
  });
  rules.sort((a,b)=>a.threshold-b.threshold);
  return rules;
}
function addGachaRow(container, name="", rate=""){
  const el = document.createElement("div");
  el.className = "ruleRow";
  el.innerHTML = `
    <label class="field">
      <span>内容</span>
      <input class="input" type="text" data-g-name value="${escapeHtml(name)}" />
    </label>
    <label class="field">
      <span>出現率（%）</span>
      <input class="input" type="number" min="0" step="0.01" data-g-rate value="${escapeHtml(rate)}" />
    </label>
    <div class="field">
