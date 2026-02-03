"use strict";

/* =========================
   Utils
========================= */
const jsStatus = document.getElementById("jsStatus");
if (jsStatus) jsStatus.textContent = "JS: OK";

const STORAGE_KEY = "reward_task_manager_v18";

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
      purchases: (s.purchases && typeof s.purchases === "object") ? s.purchases : {},
      gacha_history: (s.gacha_history && typeof s.gacha_history === "object") ? s.gacha_history : {},
      listener_pool: (s.listener_pool && typeof s.listener_pool === "object") ? s.listener_pool : {},
      active_listener: (s.active_listener && typeof s.active_listener === "object") ? s.active_listener : {}, // {campaignId: "name"}
    };
  }catch{
    return { campaigns: [], logs: [], delivery: {}, purchases: {}, gacha_history: {}, listener_pool: {}, active_listener:{} };
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
  if(!state.purchases || typeof state.purchases !== "object") state.purchases = {};
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
   Listener pool + Active listener
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

/* =========================
   Purchases (shopping)
========================= */
function getPurchaseMap(campaignId){
  if(!state.purchases[campaignId] || typeof state.purchases[campaignId] !== "object") state.purchases[campaignId] = {};
  return state.purchases[campaignId];
}
function getPurchases(campaignId, listenerName){
  const m = getPurchaseMap(campaignId);
  if(!Array.isArray(m[listenerName])) m[listenerName] = [];
  return m[listenerName];
}
function addPurchase(campaign, listenerName, cost, reward){
  const arr = getPurchases(campaign.id, listenerName);
  arr.push({ cost, reward, at: new Date().toISOString() });
  saveState();
}
function undoPurchase(campaign, listenerName){
  const arr = getPurchases(campaign.id, listenerName);
  if(arr.length>0){ arr.pop(); saveState(); return true; }
  return false;
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
   Campaign create UI
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
      <span>&nbsp;</span>
      <button class="btn ghost" type="button" data-del>削除</button>
    </div>
  `;
  el.querySelector("[data-del]").addEventListener("click", ()=>el.remove());
  container.appendChild(el);
}
function collectGachaItemsFrom(container){
  const items = [];
  container.querySelectorAll(".ruleRow").forEach(row=>{
    const name = (row.querySelector("[data-g-name]")?.value||"").toString().trim();
    const rate = parseFloat(row.querySelector("[data-g-rate]")?.value);
    if(name && Number.isFinite(rate) && rate > 0) items.push({ name, rate });
  });
  return items;
}

/* Campaign create DOM */
const campaignListEl = document.getElementById("campaignList");
const campaignSearchEl = document.getElementById("campaignSearch");
const createCampaignForm = document.getElementById("createCampaignForm");
const createTypeSelect = document.getElementById("createTypeSelect");
const createRulesSection = document.getElementById("createRulesSection");
const createGachaSection = document.getElementById("createGachaSection");
const rulesBox = document.getElementById("rulesBox");
const addRuleRowBtn = document.getElementById("addRuleRowBtn");
const addGachaRowBtn = document.getElementById("addGachaRowBtn");
const gachaItemsBox = document.getElementById("gachaItemsBox");

function setCreateTypeUI(type){
  const isGacha = type === "gacha";
  createRulesSection?.classList.toggle("hidden", isGacha);
  createGachaSection?.classList.toggle("hidden", !isGacha);
}
createTypeSelect?.addEventListener("change", ()=> setCreateTypeUI(createTypeSelect.value));

addRuleRowBtn?.addEventListener("click", ()=> rulesBox && addRuleRow(rulesBox, "", ""));
if(rulesBox && rulesBox.children.length===0){
  addRuleRow(rulesBox, "1000", "デジグッズA");
  addRuleRow(rulesBox, "3000", "デジグッズB");
}
addGachaRowBtn?.addEventListener("click", ()=> gachaItemsBox && addGachaRow(gachaItemsBox, "", ""));
if(gachaItemsBox && gachaItemsBox.children.length===0){
  addGachaRow(gachaItemsBox, "SSR", "1");
  addGachaRow(gachaItemsBox, "SR", "9");
  addGachaRow(gachaItemsBox, "R", "90");
}

createCampaignForm?.addEventListener("submit",(e)=>{
  e.preventDefault();
  const fd = new FormData(createCampaignForm);

  const name = (fd.get("name")||"").toString().trim();
  const start_date = (fd.get("start_date")||"").toString().trim();
  const type = normalizeCampaignType((fd.get("type")||"achievement").toString());
  if(!name || !start_date) return;

  const campaign = {
    id: uid(),
    name,
    start_date,
    type,
    rules: [],
    created_at: new Date().toISOString(),
  };

  if(type === "gacha"){
    const singleCost = Number(fd.get("g_singleCost")||0);
    const multiCost  = Number(fd.get("g_multiCost")||0);
    const multiCount = Number(fd.get("g_multiCount")||0);
    const items = gachaItemsBox ? collectGachaItemsFrom(gachaItemsBox) : [];
    campaign.gacha = { singleCost, multiCost, multiCount, items };
    ensureGacha(campaign);
  }else{
    campaign.rules = rulesBox ? collectRulesFrom(rulesBox) : [];
  }

  state.campaigns.unshift(campaign);
  saveState();

  createCampaignForm.reset();
  if(createTypeSelect){
    createTypeSelect.value = "achievement";
    setCreateTypeUI("achievement");
  }
  renderAll();
  toast("作成");
});
campaignSearchEl?.addEventListener("input", renderCampaigns);

function deleteCampaign(campaignId){
  state.campaigns = state.campaigns.filter(x=>x.id!==campaignId);
  state.logs = state.logs.filter(x=>x.campaign_id!==campaignId);
  delete state.delivery[campaignId];
  delete state.purchases[campaignId];
  delete state.gacha_history[campaignId];
  delete state.listener_pool[campaignId];
  delete state.active_listener[campaignId];
  saveState();
}

function renderCampaigns(){
  if(!campaignListEl) return;
  const q = (campaignSearchEl?.value||"").trim().toLowerCase();

  const list = state.campaigns
    .filter(c => (c.name||"").toLowerCase().includes(q))
    .slice()
    .sort(campaignSortDesc);

  if(!list.length){
    campaignListEl.innerHTML = `<div class="muted">企画がありません。</div>`;
    return;
  }

  campaignListEl.innerHTML = list.map(c=>{
    const done = isCampaignDone(c);
    const statusLabel = done ? "完了" : "未完了";
    const statusBadge = done ? "✅" : "🔴";
    return `
      <div class="item">
        <div>
          <div><strong>${escapeHtml(c.name)}</strong></div>
          <div class="muted">${escapeHtml(c.start_date)} / ${statusLabel}</div>
        </div>
        <div class="itemActions">
          <button class="btn ghost small" type="button" data-open="${c.id}">確認</button>
          <button class="btn ghost small" type="button" data-live="${c.id}">リアルタイム</button>
          <button class="btn danger micro" type="button" data-del="${c.id}">削除</button>
          <div style="font-size:18px;">${statusBadge}</div>
        </div>
      </div>
    `;
  }).join("");

  campaignListEl.querySelectorAll("[data-open]").forEach(btn=>{
    btn.addEventListener("click",()=> location.hash = `#campaign=${btn.getAttribute("data-open")}`);
  });
  campaignListEl.querySelectorAll("[data-live]").forEach(btn=>{
    btn.addEventListener("click",()=> location.hash = `#live=${btn.getAttribute("data-live")}`);
  });
  campaignListEl.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const id = btn.getAttribute("data-del");
      const c = state.campaigns.find(x=>x.id===id);
      if(!c) return;
      if(!confirm(`「${c.name}」を削除します。OK？`)) return;
      deleteCampaign(id);
      renderAll();
      toast("削除");
    });
  });
}

/* =========================
   Tasks
========================= */
const taskCampaignListEl = document.getElementById("taskCampaignList");
document.getElementById("filterAllCampaigns")?.addEventListener("click", ()=>{ taskPageFilter="all"; renderTaskCampaignList(); });
document.getElementById("filterOpenCampaigns")?.addEventListener("click", ()=>{ taskPageFilter="open"; renderTaskCampaignList(); });
document.getElementById("filterDoneCampaigns")?.addEventListener("click", ()=>{ taskPageFilter="done"; renderTaskCampaignList(); });

function filterCampaignsByListMode(list, campaigns){
  if(list==="open") return campaigns.filter(c=>!isCampaignDone(c));
  if(list==="done") return campaigns.filter(c=>isCampaignDone(c));
  return campaigns;
}
function renderTaskCampaignList(){
  if(!taskCampaignListEl) return;

  let list = state.campaigns.slice().sort(campaignSortDesc);
  list = filterCampaignsByListMode(taskPageFilter, list);

  if(!list.length){
    taskCampaignListEl.innerHTML = `<div class="muted">該当する企画がありません。</div>`;
    return;
  }

  taskCampaignListEl.innerHTML = list.map(c=>{
    const done = isCampaignDone(c);
    const statusBadge = done ? "✅" : "🔴";
    const statusLabel = done ? "完了" : "未完了";
    return `
      <div class="item itemClickable" data-open="${c.id}">
        <div>
          <div><strong>${escapeHtml(c.name)}</strong></div>
          <div class="muted">${escapeHtml(c.start_date)} / ${statusLabel}</div>
        </div>
        <div class="itemActions">
          <div style="font-size:18px;">${statusBadge}</div>
        </div>
      </div>
    `;
  }).join("");

  taskCampaignListEl.querySelectorAll(".itemClickable").forEach(el=>{
    el.addEventListener("click",()=> location.hash = `#campaign=${el.getAttribute("data-open")}`);
  });
}

/* =========================
   Reward cell
========================= */
function renderRewardCell(campaign, listenerName, points){
  const type = normalizeCampaignType(campaign.type);

  if(type === "gacha"){
    const chips = gachaSummaryChips(campaign.id, listenerName);
    if(!chips.length) return `<div class="muted">—</div>`;
    return `<div class="shopItems">${chips.map(x=>`<span class="shopItemChip">${escapeHtml(x)}</span>`).join("")}</div>`;
  }

  if(type === "achievement"){
    const list = achievedRewards(campaign, points);
    if(list.length === 0) return `<div class="muted">—</div>`;
    return `<div class="shopItems">${list.map(x=>`<span class="shopItemChip">${escapeHtml(`${x.cost}pt達成：${x.reward}`)}</span>`).join("")}</div>`;
  }

  // shopping: 表示だけ（購入ボタン等は今回省略）
  const rules = rulesSorted(campaign.rules).map(r=>({cost:r.threshold, reward:r.reward}));
  if(!rules.length) return `<div class="muted">—</div>`;

  // 残pt計算（購入管理を使うならここを拡張）
  const purchases = getPurchases(campaign.id, listenerName);
  const spent = purchases.reduce((s,x)=> s + (x.cost||0), 0);
  const remaining = points - spent;

  const purchasedChips = purchases.length
    ? `<div class="shopItems">${purchases.map(x=>`<span class="shopItemChip">${escapeHtml(`${x.cost}：${x.reward}`)}</span>`).join("")}</div>`
    : `<div class="muted">—</div>`;

  return `
    <div class="shopBox">
      <div class="shopRemaining">残pt：${remaining}</div>
      ${purchasedChips}
    </div>
  `;
}

/* =========================
   Campaign (confirm)
========================= */
const campaignTitleEl = document.getElementById("campaignTitle");
const campaignMetaEl = document.getElementById("campaignMeta");
const campaignStatusPill = document.getElementById("campaignStatusPill");
const goLiveBtn = document.getElementById("goLiveBtn");
const leaderboardBody = document.getElementById("leaderboardBody");

function renderRewardTableConfirm(tbodyEl, campaign){
  if(!tbodyEl) return;
  const totals = computeTotalsForCampaign(campaign.id);
  if(!totals.length){
    tbodyEl.innerHTML = `<tr><td colspan="4" class="muted">データなし</td></tr>`;
    return;
  }

  tbodyEl.innerHTML = totals.map(r=>{
    const status = getDeliveryStatus(campaign.id, r.listener_name);
    return `
      <tr>
        <td>${escapeHtml(r.listener_name)}</td>
        <td class="right">${r.points}</td>
        <td class="center">${renderRewardCell(campaign, r.listener_name, r.points)}</td>
        <td>
          <select class="input" data-delivery="${escapeHtml(r.listener_name)}">
            <option value="open" ${status==="open"?"selected":""}>未完了</option>
            <option value="done" ${status==="done"?"selected":""}>完了</option>
          </select>
        </td>
      </tr>
    `;
  }).join("");

  tbodyEl.querySelectorAll("[data-delivery]").forEach(sel=>{
    sel.addEventListener("change", ()=>{
      const name = sel.getAttribute("data-delivery");
      setDeliveryStatus(campaign.id, name, sel.value);
      toast("更新");
      renderAll();
    });
  });
}

function renderCampaign(){
  const c = getCurrentCampaign();
  if(!c){ location.hash="#tasks"; return; }

  const done = isCampaignDone(c);
  const statusLabel = done ? "完了" : "未完了";

  if(campaignTitleEl) campaignTitleEl.textContent = c.name;
  if(campaignMetaEl) campaignMetaEl.textContent = `${c.start_date}`;
  if(campaignStatusPill) campaignStatusPill.textContent = statusLabel;
  if(goLiveBtn) goLiveBtn.href = `#live=${c.id}`;

  renderRewardTableConfirm(leaderboardBody, c);
}

/* =========================
   LIVE
========================= */
const liveTitle = document.getElementById("liveTitle");
const liveMeta = document.getElementById("liveMeta");
const goConfirmBtn = document.getElementById("goConfirmBtn");
const liveLeaderboardBody = document.getElementById("liveLeaderboardBody");
const rewardListBox = document.getElementById("rewardListBox");
const liveGachaCard = document.getElementById("liveGachaCard");
const liveInputCard = document.getElementById("liveInputCard");

const activeListenerLabel = document.getElementById("activeListenerLabel");
const clearActiveBtn = document.getElementById("clearActiveBtn");
const listenerNameInput = document.getElementById("listenerNameInput");

const customPointsInput = document.getElementById("customPoints");
const liveMsg = document.getElementById("liveMsg");
function setLiveMsg(msg){ if(liveMsg) liveMsg.textContent = msg || ""; }

const gachaUserInput = document.getElementById("gachaUserInput");
const gachaPtInput = document.getElementById("gachaPtInput");
const gachaRollBtn = document.getElementById("gachaRollBtn");
const gachaResultBox = document.getElementById("gachaResultBox");
const gachaCopyBtn = document.getElementById("gachaCopyBtn");

function renderRewardList(c){
  if(!rewardListBox) return;
  const type = normalizeCampaignType(c.type);

  if(type === "gacha"){
    ensureGacha(c);
    const items = c.gacha.items || [];
    rewardListBox.innerHTML = items.length
      ? items.map(it => `<div class="rewardChip">${escapeHtml(it.name)}（${escapeHtml(it.rate)}%）</div>`).join("")
      : `<div class="muted">返礼品なし</div>`;
    return;
  }

  const rules = rulesSorted(c.rules);
  rewardListBox.innerHTML = rules.length
    ? rules.map(r=>{
        const label = (type==="achievement")
          ? `${r.threshold}pt達成：${escapeHtml(r.reward)}`
          : `${r.threshold}：${escapeHtml(r.reward)}`;
        return `<div class="rewardChip">${label}</div>`;
      }).join("")
    : `<div class="muted">返礼品なし</div>`;
}

function renderActiveLabel(campaignId){
  const name = getActiveListener(campaignId);
  if(activeListenerLabel) activeListenerLabel.textContent = name || "未選択";
}

function renderRewardTableLiveTapToSelect(tbodyEl, campaign){
  if(!tbodyEl) return;

  const totals = computeTotalsForCampaign(campaign.id);
  if(!totals.length){
    tbodyEl.innerHTML = `<tr><td colspan="3" class="muted">データなし</td></tr>`;
    return;
  }

  const active = getActiveListener(campaign.id);

  tbodyEl.innerHTML = totals.map(r=>{
    const isActive = active && active === r.listener_name;
    return `
      <tr class="tapRow ${isActive ? "active" : ""}" data-listener="${escapeHtml(r.listener_name)}">
        <td>${escapeHtml(r.listener_name)}</td>
        <td class="right">${r.points}</td>
        <td class="center">${renderRewardCell(campaign, r.listener_name, r.points)}</td>
      </tr>
    `;
  }).join("");

  // ✅行タップで active を切り替え
  tbodyEl.querySelectorAll("tr[data-listener]").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const name = (tr.getAttribute("data-listener") || "").trim();
      if(!name) return;

      setActiveListener(campaign.id, name);
      renderActiveLabel(campaign.id);

      // 見た目のactive反映
      tbodyEl.querySelectorAll("tr.tapRow").forEach(x=>x.classList.remove("active"));
      tr.classList.add("active");

      // 入力を促すために右側へ軽くスクロール（任意）
      liveInputCard?.scrollIntoView({ behavior:"smooth", block:"start" });

      toast(name);
    });
  });
}

function addLog(delta){
  const c = getCurrentCampaign();
  if(!c) return;

  const name = getActiveListener(c.id);
  if(!name) return toast("リスナー未選択");

  state.logs.push({
    id: uid(),
    campaign_id: c.id,
    listener_name: name,
    delta_points: delta,
    created_at: new Date().toISOString(),
  });

  addListenerToPool(c.id, name);
  saveState();
  renderAll();
  setLiveMsg(`${delta>0?"+":""}${delta} / ${name}`);
  toast("反映");
}

function undoLastLog(){
  const c = getCurrentCampaign();
  if(!c) return;
  for(let i=state.logs.length-1;i>=0;i--){
    if(state.logs[i].campaign_id===c.id){
      state.logs.splice(i,1);
      saveState();
      renderAll();
      toast("戻す");
      return;
    }
  }
}

/* ✅名前入力：1回入力したら登録＆選択（0.4秒停止で確定） */
let nameDebounceTimer = null;
listenerNameInput?.addEventListener("input", ()=>{
  const c = getCurrentCampaign();
  if(!c) return;

  clearTimeout(nameDebounceTimer);
  nameDebounceTimer = setTimeout(()=>{
    const name = (listenerNameInput.value||"").trim();
    if(!name) return;

    setActiveListener(c.id, name);
    listenerNameInput.value = "";
    renderActiveLabel(c.id);
    renderAll(); // テーブル側のactive表示を更新
    toast("追加");
  }, 400);
});
listenerNameInput?.addEventListener("keydown", (e)=>{
  if(e.key === "Enter"){
    e.preventDefault();
    const c = getCurrentCampaign();
    if(!c) return;
    const name = (listenerNameInput.value||"").trim();
    if(!name) return;
    setActiveListener(c.id, name);
    listenerNameInput.value = "";
    renderActiveLabel(c.id);
    renderAll();
    toast("追加");
  }
});

clearActiveBtn?.addEventListener("click", ()=>{
  const c = getCurrentCampaign();
  if(!c) return;
  setActiveListener(c.id, "");
  renderActiveLabel(c.id);
  renderAll();
  toast("解除");
});

/* buttons */
document.querySelectorAll("[data-add]").forEach(btn=>{
  btn.addEventListener("click", ()=> addLog(parseInt(btn.getAttribute("data-add"),10)));
});
document.getElementById("addCustomBtn")?.addEventListener("click", ()=>{
  const v = parseInt(customPointsInput.value,10);
  if(!v) return;
  addLog(v);
  customPointsInput.value = "";
});
document.getElementById("subtractBtn")?.addEventListener("click", ()=>{
  const v = parseInt(customPointsInput.value,10);
  if(!v) return;
  addLog(-Math.abs(v));
  customPointsInput.value = "";
});
document.getElementById("undoBtn")?.addEventListener("click", ()=> undoLastLog());

/* =========================
   Gacha
========================= */
function calcGachaPulls(pt, g){
  const singleCost = Math.max(0, Number(g.singleCost||0));
  const multiCost = Math.max(0, Number(g.multiCost||0));
  const multiCount = Math.max(0, Number(g.multiCount||0));
  if(pt <= 0 || singleCost <= 0) return { total:0 };

  let remain = pt;
  let multiTimes = 0;
  if(multiCost > 0 && multiCount > 0){
    multiTimes = Math.floor(remain / multiCost);
    remain -= multiTimes * multiCost;
  }
  const singleTimes = Math.floor(remain / singleCost);
  const total = multiTimes * (multiCount||0) + singleTimes;
  return { total };
}
function pickGachaItem(items){
  const cleaned = items
    .filter(x => x && x.name && Number.isFinite(Number(x.rate)) && Number(x.rate) > 0)
    .map(x => ({ name: x.name, rate: Number(x.rate) }));

  if(cleaned.length===0) return null;

  const sum = cleaned.reduce((s,x)=>s+x.rate,0);
  const r = Math.random() * sum;
  let acc = 0;
  for(const it of cleaned){
    acc += it.rate;
    if(r <= acc) return it.name;
  }
  return cleaned[cleaned.length-1].name;
}
function rollGacha(user, pt){
  const c = getCurrentCampaign();
  if(!c) return;
  ensureGacha(c);

  const calc = calcGachaPulls(pt, c.gacha);
  if(calc.total <= 0){
    if(gachaResultBox) gachaResultBox.value = "";
    return toast("回せない");
  }

  // userをpoolに追加 & activeにもする（ガチャ用）
  setActiveListener(c.id, user);

  const results = [];
  for(let i=0;i<calc.total;i++){
    results.push(pickGachaItem(c.gacha.items || []) ?? "（景品未設定）");
  }

  state.logs.push({
    id: uid(),
    campaign_id: c.id,
    listener_name: user,
    delta_points: pt,
    created_at: new Date().toISOString(),
  });
  addGachaResult(c.id, user, pt, results);

  // 番号なし、被り×n、使用pt表記なし
  const count = new Map();
  for(const r of results) count.set(r, (count.get(r) || 0) + 1);
  const lines = Array.from(count.entries())
    .sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => (n === 1 ? `${name}` : `${name} ×${n}`))
    .join("\n");

  if(gachaResultBox){
    gachaResultBox.value = `回した人：${user}\n回数：${calc.total}\n\n` + lines;
  }

  saveState();
  toast("結果");
  renderAll();
}
gachaRollBtn?.addEventListener("click", ()=>{
  const c = getCurrentCampaign();
  if(!c) return;

  const user = (gachaUserInput?.value || "").trim();
  const pt = Number(gachaPtInput?.value || 0);
  if(!user) return toast("名前");
  if(!Number.isFinite(pt) || pt<=0) return toast("pt");

  // 入力欄は残しても良いが、ここは消す方が事故が減る
  gachaUserInput.value = "";
  rollGacha(user, pt);
});
gachaCopyBtn?.addEventListener("click", async ()=>{
  const text = (gachaResultBox?.value||"").toString();
  if(!text.trim()) return toast("空");
  try{
    await navigator.clipboard.writeText(text);
    toast("コピー");
  }catch{
    try{
      gachaResultBox.focus();
      gachaResultBox.select();
      document.execCommand("copy");
      toast("コピー");
    }catch{
      alert("コピーに失敗しました。");
    }
  }
});

/* =========================
   LIVE render
========================= */
function renderGachaVisibility(c){
  const isGacha = normalizeCampaignType(c.type) === "gacha";
  liveGachaCard?.classList.toggle("hidden", !isGacha);
  liveInputCard?.classList.toggle("hidden", isGacha);
}

function renderLive(){
  const c = getCurrentCampaign();
  if(!c){ location.hash="#tasks"; return; }

  const done = isCampaignDone(c);
  const statusLabel = done ? "完了" : "未完了";

  if(liveTitle) liveTitle.textContent = c.name;
  if(liveMeta) liveMeta.textContent = `${c.start_date} / ${statusLabel}`;
  if(goConfirmBtn) goConfirmBtn.href = `#campaign=${c.id}`;

  renderGachaVisibility(c);
  renderRewardList(c);
  renderActiveLabel(c.id);
  renderRewardTableLiveTapToSelect(liveLeaderboardBody, c);
  setLiveMsg("");
}

/* =========================
   Backup / Restore
========================= */
document.getElementById("exportBtn")?.addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `reward-task-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("バックアップ");
});
document.getElementById("importFile")?.addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  const text = await file.text();
  try{
    const obj = JSON.parse(text);
    state = {
      campaigns: Array.isArray(obj.campaigns) ? obj.campaigns : [],
      logs: Array.isArray(obj.logs) ? obj.logs : [],
      delivery: (obj.delivery && typeof obj.delivery === "object") ? obj.delivery : {},
      purchases: (obj.purchases && typeof obj.purchases === "object") ? obj.purchases : {},
      gacha_history: (obj.gacha_history && typeof obj.gacha_history === "object") ? obj.gacha_history : {},
      listener_pool: (obj.listener_pool && typeof obj.listener_pool === "object") ? obj.listener_pool : {},
      active_listener: (obj.active_listener && typeof obj.active_listener === "object") ? obj.active_listener : {},
    };
    migrate();
    saveState();
    toast("復元");
    route();
    renderAll();
  }catch{
    alert("復元に失敗：JSONが不正です。");
  }finally{
    e.target.value = "";
  }
});

/* =========================
   renderAll
========================= */
function renderAll(){
  renderHome();
  renderCampaigns();

  const h = location.hash || "";
  if(h.startsWith("#tasks")) renderTaskCampaignList();
  if(h.startsWith("#campaign=")) renderCampaign();
  if(h.startsWith("#live=")) renderLive();
}

/* init */
if(createTypeSelect){
  setCreateTypeUI(createTypeSelect.value);
}
route();
renderAll();
