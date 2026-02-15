"use strict";

const $ = (id) => document.getElementById(id);

/* ===== Status / Toast ===== */
const jsStatus = $("jsStatus");
if (jsStatus) jsStatus.textContent = "JS: OK";

const toastEl = $("toast");
let toastTimer = null;
function toast(msg){
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toastEl.classList.add("hidden"), 1200);
}

/* ===== Utils ===== */
const STORAGE_KEY = "reward_task_manager_v31";
function uid(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }
function escapeHtml(s){
  return (s ?? "").toString().replace(/[&<>"']/g,(c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

/* ===== State ===== */
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
      active_listener: (s.active_listener && typeof s.active_listener === "object") ? s.active_listener : {},
      notes: (s.notes && typeof s.notes === "object") ? s.notes : {},
      gacha_free_eligible: (s.gacha_free_eligible && typeof s.gacha_free_eligible === "object") ? s.gacha_free_eligible : {},
    };
  }catch{
    return {
      campaigns: [], logs: [], delivery: {}, purchases: {}, gacha_history: {},
      listener_pool: {}, active_listener:{}, notes:{}, gacha_free_eligible:{}
    };
  }
}
let state = loadState();
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function normalizeCampaignType(t){
  return (t === "shopping" || t === "achievement" || t === "gacha") ? t : "achievement";
}
function ensureGacha(c){
  if(!c.gacha || typeof c.gacha !== "object"){
    c.gacha = {
      singleCost: 0,
      firstCost: 0,     // 初回単価（任意）
      multiCost: 0,
      multiCount: 0,
      items: []
    };
  }
  if(!Array.isArray(c.gacha.items)) c.gacha.items = [];
  c.gacha.singleCost = Number(c.gacha.singleCost||0);
  c.gacha.firstCost  = Number(c.gacha.firstCost||0);
  c.gacha.multiCost  = Number(c.gacha.multiCost||0);
  c.gacha.multiCount = Number(c.gacha.multiCount||0);
}
function migrate(){
  state.campaigns.forEach(c=>{
    c.type = normalizeCampaignType(c.type);
    if(!c.created_at) c.created_at = new Date().toISOString();
    if(!c.start_date && c.start) c.start_date = c.start;
    c.rules ||= [];
    if(c.type === "gacha") ensureGacha(c);
  });
  state.delivery ||= {};
  state.purchases ||= {};
  state.gacha_history ||= {};
  state.listener_pool ||= {};
  state.active_listener ||= {};
  state.notes ||= {};
  state.gacha_free_eligible ||= {};
}
migrate(); saveState();

/* ===== Calculations ===== */
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

/* ===== Delivery ===== */
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

/* ===== Notes ===== */
function getNotesMap(campaignId){
  if(!state.notes[campaignId] || typeof state.notes[campaignId] !== "object"){
    state.notes[campaignId] = {};
  }
  return state.notes[campaignId];
}
function getNote(campaignId, listenerName){
  const m = getNotesMap(campaignId);
  return (m[listenerName] || "").toString();
}
function setNote(campaignId, listenerName, text){
  const m = getNotesMap(campaignId);
  m[listenerName] = (text || "").toString();
  saveState();
}

/* ===== Listener pool ===== */
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
function getAllKnownListeners(campaignId){
  const pool = getListenerPool(campaignId).slice();
  const totals = computeTotalsForCampaign(campaignId).map(r=>r.listener_name);
  const set = new Set([...pool, ...totals].map(x=>x.trim()).filter(Boolean));
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}

/* ===== Shopping purchases ===== */
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
  if(arr.length>0){
    arr.pop();
    saveState();
    return true;
  }
  return false;
}
function totalPurchasedCost(campaign, listenerName){
  const arr = getPurchases(campaign.id, listenerName);
  return arr.reduce((s,x)=>s + (Number(x.cost)||0), 0);
}

/* ===== Gacha history ===== */
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
function hasGachaEver(campaignId, listenerName){
  return getGachaList(campaignId, listenerName).length > 0;
}
function hasUsedFirstPricing(campaignId, listenerName){
  const list = getGachaList(campaignId, listenerName);
  return list.some(x => x?.meta?.usedFirstPricing === true);
}
function addGachaResult(campaignId, listenerName, ptUsed, results, meta){
  const list = getGachaList(campaignId, listenerName);
  list.push({ at: new Date().toISOString(), ptUsed, results: results.slice(), meta: meta || null });
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

/* ===== Gacha free eligibility ===== */
function getGachaEligibleMap(campaignId){
  if(!state.gacha_free_eligible[campaignId] || typeof state.gacha_free_eligible[campaignId] !== "object"){
    state.gacha_free_eligible[campaignId] = {};
  }
  return state.gacha_free_eligible[campaignId];
}
function isGachaEligible(campaignId, listenerName){
  const m = getGachaEligibleMap(campaignId);
  return m[listenerName] === true;
}
function setGachaEligible(campaignId, listenerName, val){
  const m = getGachaEligibleMap(campaignId);
  if(val) m[listenerName] = true;
  else delete m[listenerName];
  saveState();
}

/* ===== Reward summary for Campaign list ===== */
function rewardSummaryText(c){
  const type = normalizeCampaignType(c.type);
  if(type === "gacha"){
    ensureGacha(c);
    const cost = c.gacha?.singleCost ? `1回${c.gacha.singleCost}pt` : "1回pt未設定";
    const first = (c.gacha?.firstCost && c.gacha.firstCost > 0) ? `｜初回1回${c.gacha.firstCost}pt` : "";
    const items = (c.gacha?.items || []).map(it=>it?.name).filter(Boolean);
    const itemText = items.length ? items.join(" / ") : "景品未設定";
    const text = `${cost}${first}｜${itemText}`;
    return text.length > 90 ? text.slice(0,90) + "…" : text;
  }

  const rules = rulesSorted(c.rules);
  if(!rules.length) return "返礼品未設定";

  const parts = rules.map(r=>{
    if(type === "achievement") return `${r.threshold}pt達成：${r.reward}`;
    return `${r.threshold}：${r.reward}`;
  });
  const joined = parts.join(" / ");
  return joined.length > 90 ? joined.slice(0,90) + "…" : joined;
}

/* ===== SPA routing ===== */
const views = {
  home: $("view-home"),
  tasks: $("view-tasks"),
  campaigns: $("view-campaigns"),
  campaign: $("view-campaign"),
  live: $("view-live"),
};
function setActiveNav(viewName){
  document.querySelectorAll(".navlink").forEach(a=>a.classList.remove("active"));
  const map = { home:"home", tasks:"tasks", campaigns:"campaigns", campaign:"tasks", live:"tasks" };
  const key = map[viewName] || "home";
  const el = document.querySelector(`.navlink[data-nav="${key}"]`);
  if(el) el.classList.add("active");
}
function showView(name){
  Object.entries(views).forEach(([k, el])=> { if(el) el.classList.toggle("hidden", k !== name); });
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

/* ===== HOME ===== */
function renderHome(){
  const all = state.campaigns.length;
  const done = state.campaigns.filter(c=>isCampaignDone(c)).length;
  const open = all - done;

  $("statCampaigns") && ($("statCampaigns").textContent = String(all));
  $("statOpenCampaigns") && ($("statOpenCampaigns").textContent = String(open));
  $("statDoneCampaigns") && ($("statDoneCampaigns").textContent = String(done));
  $("overallPill") && ($("overallPill").textContent = open>0 ? `未完了 ${open}` : "未完了なし");
}

/* ===== Create campaign UI helpers ===== */
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
  el.querySelector("[data-del]")?.addEventListener("click", ()=>{
    el.remove();
    validateCreateForm();
  });
  el.querySelectorAll("input").forEach(inp=> inp.addEventListener("input", validateCreateForm));
  container.appendChild(el);
}
function collectRulesFrom(container){
  const rules = [];
  container.querySelectorAll(".ruleRow").forEach(row=>{
    const thRaw = row.querySelector("[data-threshold]")?.value;
    const rw = (row.querySelector("[data-reward]")?.value||"").toString().trim();
    const th = parseInt(thRaw, 10);
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
  el.querySelector("[data-del]")?.addEventListener("click", ()=>{
    el.remove();
    validateCreateForm();
  });
  el.querySelectorAll("input").forEach(inp=> inp.addEventListener("input", validateCreateForm));
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
function setCreateTypeUI(type){
  const isGacha = type === "gacha";
  $("createRulesSection")?.classList.toggle("hidden", isGacha);
  $("createGachaSection")?.classList.toggle("hidden", !isGacha);
  validateCreateForm();
}
$("createTypeSelect")?.addEventListener("change", ()=> setCreateTypeUI($("createTypeSelect").value));
$("addRuleRowBtn")?.addEventListener("click", ()=> { const b=$("rulesBox"); if(b) addRuleRow(b, "", ""); validateCreateForm(); });
$("addGachaRowBtn")?.addEventListener("click", ()=> { const b=$("gachaItemsBox"); if(b) addGachaRow(b, "", ""); validateCreateForm(); });

(function initRuleDefaults(){
  const b = $("rulesBox");
  if(b && b.children.length===0){
    addRuleRow(b, "1000", "デジグッズA");
    addRuleRow(b, "3000", "デジグッズB");
  }
  const g = $("gachaItemsBox");
  if(g && g.children.length===0){
    addGachaRow(g, "SSR", "1");
    addGachaRow(g, "SR", "9");
    addGachaRow(g, "R", "90");
  }
})();

/* ===== Create validation ===== */
function validateCreateForm(){
  const btn = $("createCampaignBtn");
  const hint = $("createCampaignHint");
  const form = $("createCampaignForm");
  if(!btn || !hint || !form) return;

  const fd = new FormData(form);
  const name = (fd.get("name")||"").toString().trim();
  const start = (fd.get("start_date")||"").toString().trim();
  const type = normalizeCampaignType((fd.get("type")||"achievement").toString());

  let ok = true;
  let msg = "";

  if(!name){ ok=false; msg="企画名が未入力"; }
  else if(!start){ ok=false; msg="開始日が未入力"; }
  else if(type === "gacha"){
    const single = Number(fd.get("g_singleCost")||0);
    const items = $("gachaItemsBox") ? collectGachaItemsFrom($("gachaItemsBox")) : [];
    if(!(Number.isFinite(single) && single > 0)){ ok=false; msg="ガチャ：1回の必要ptが未入力"; }
    else if(items.length === 0){ ok=false; msg="ガチャ：景品が未入力"; }
  }else{
    const rules = $("rulesBox") ? collectRulesFrom($("rulesBox")) : [];
    if(rules.length === 0){ ok=false; msg="返礼品（ポイント＋内容）を1つ以上入力"; }
    if(ok && $("rulesBox")){
      const rows = $("rulesBox").querySelectorAll(".ruleRow");
      for(const row of rows){
        const th = (row.querySelector("[data-threshold]")?.value||"").toString().trim();
        const rw = (row.querySelector("[data-reward]")?.value||"").toString().trim();
        if((th && !rw) || (!th && rw)){
          ok=false; msg="返礼品の行に未入力があります"; break;
        }
      }
    }
  }

  btn.disabled = !ok;
  hint.textContent = ok ? "" : msg;
}
$("createCampaignForm")?.addEventListener("input", validateCreateForm);
$("createCampaignForm")?.addEventListener("change", validateCreateForm);

$("createCampaignForm")?.addEventListener("submit",(e)=>{
  e.preventDefault();
  validateCreateForm();
  if($("createCampaignBtn")?.disabled) return;

  const form = $("createCampaignForm");
  const fd = new FormData(form);

  const name = (fd.get("name")||"").toString().trim();
  const start_date = (fd.get("start_date")||"").toString().trim();
  const type = normalizeCampaignType((fd.get("type")||"achievement").toString());

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
    const firstCost  = Number(fd.get("g_firstCost")||0); // 任意
    const multiCost  = Number(fd.get("g_multiCost")||0);
    const multiCount = Number(fd.get("g_multiCount")||0);
    const items = $("gachaItemsBox") ? collectGachaItemsFrom($("gachaItemsBox")) : [];
    campaign.gacha = { singleCost, firstCost, multiCost, multiCount, items };
    ensureGacha(campaign);
  }else{
    campaign.rules = $("rulesBox") ? collectRulesFrom($("rulesBox")) : [];
  }

  state.campaigns.unshift(campaign);
  saveState();

  form.reset();
  if($("createTypeSelect")){
    $("createTypeSelect").value = "achievement";
    setCreateTypeUI("achievement");
  }
  validateCreateForm();
  renderAll();
  toast("作成");
});

$("campaignSearch")?.addEventListener("input", renderCampaigns);

/* ===== Campaign list ===== */
function deleteCampaign(campaignId){
  state.campaigns = state.campaigns.filter(x=>x.id!==campaignId);
  state.logs = state.logs.filter(x=>x.campaign_id!==campaignId);
  delete state.delivery[campaignId];
  delete state.purchases[campaignId];
  delete state.gacha_history[campaignId];
  delete state.listener_pool[campaignId];
  delete state.active_listener[campaignId];
  delete state.notes[campaignId];
  delete state.gacha_free_eligible[campaignId];
  saveState();
}
function renderCampaigns(){
  const listEl = $("campaignList");
  if(!listEl) return;

  const q = ($("campaignSearch")?.value || "").trim().toLowerCase();
  const list = state.campaigns
    .filter(c => (c.name||"").toLowerCase().includes(q))
    .slice()
    .sort(campaignSortDesc);

  if(!list.length){
    listEl.innerHTML = `<div class="muted">企画がありません。</div>`;
    return;
  }

  listEl.innerHTML = list.map(c=>{
    const done = isCampaignDone(c);
    const statusLabel = done ? "完了" : "未完了";
    const badge = done ? "✅" : "🔴";
    const summary = rewardSummaryText(c);

    return `
      <div class="item">
        <div style="min-width:0;">
          <div><strong>${escapeHtml(c.name)}</strong></div>
          <div class="muted">${escapeHtml(c.start_date)} / ${statusLabel}</div>
          <div class="muted" style="margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(summary)}
          </div>
        </div>
        <div class="itemActions">
          <button class="btn ghost small" type="button" data-open="${c.id}">確認</button>
          <button class="btn ghost small" type="button" data-live="${c.id}">リアルタイム</button>
          <button class="btn danger micro" type="button" data-del="${c.id}">削除</button>
          <div style="font-size:18px;">${badge}</div>
        </div>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll("[data-open]").forEach(btn=>{
    btn.addEventListener("click",()=> location.hash = `#campaign=${btn.getAttribute("data-open")}`);
  });
  listEl.querySelectorAll("[data-live]").forEach(btn=>{
    btn.addEventListener("click",()=> location.hash = `#live=${btn.getAttribute("data-live")}`);
  });
  listEl.querySelectorAll("[data-del]").forEach(btn=>{
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

/* ===== Tasks list ===== */
$("filterAllCampaigns")?.addEventListener("click", ()=>{ taskPageFilter="all"; renderTaskCampaignList(); });
$("filterOpenCampaigns")?.addEventListener("click", ()=>{ taskPageFilter="open"; renderTaskCampaignList(); });
$("filterDoneCampaigns")?.addEventListener("click", ()=>{ taskPageFilter="done"; renderTaskCampaignList(); });

function filterCampaignsByListMode(list, campaigns){
  if(list==="open") return campaigns.filter(c=>!isCampaignDone(c));
  if(list==="done") return campaigns.filter(c=>isCampaignDone(c));
  return campaigns;
}
function renderTaskCampaignList(){
  const el = $("taskCampaignList");
  if(!el) return;

  let list = state.campaigns.slice().sort(campaignSortDesc);
  list = filterCampaignsByListMode(taskPageFilter, list);

  if(!list.length){
    el.innerHTML = `<div class="muted">該当する企画がありません。</div>`;
    return;
  }

  el.innerHTML = list.map(c=>{
    const done = isCampaignDone(c);
    const badge = done ? "✅" : "🔴";
    const status = done ? "完了" : "未完了";
    return `
      <div class="item itemClickable" data-open="${c.id}">
        <div>
          <div><strong>${escapeHtml(c.name)}</strong></div>
          <div class="muted">${escapeHtml(c.start_date)} / ${status}</div>
        </div>
        <div class="itemActions"><div style="font-size:18px;">${badge}</div></div>
      </div>
    `;
  }).join("");

  el.querySelectorAll(".itemClickable").forEach(x=>{
    x.addEventListener("click",()=> location.hash = `#campaign=${x.getAttribute("data-open")}`);
  });
}

/* ===== Reward cells ===== */
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

  // shopping
  const spent = totalPurchasedCost(campaign, listenerName);
  const remaining = Math.max(0, points - spent);

  const bought = getPurchases(campaign.id, listenerName).map(x=>`${x.cost}：${x.reward}`);
  const boughtHtml = bought.length
    ? `<div class="shopItems">${bought.map(x=>`<span class="shopItemChip">${escapeHtml(x)}</span>`).join("")}</div>`
    : `<div class="muted">—</div>`;

  const rules = rulesSorted(campaign.rules);
  if(!rules.length) return boughtHtml;

  const can = rules.filter(r=>remaining>=r.threshold);
  const canHtml = can.length
    ? `<div class="shopItems">${
        can.map(r=>{
          const label = `${r.reward}（${r.threshold}pt）`;
          return `<button class="btn small ghost" data-buy="${r.threshold}" data-buyname="${escapeHtml(r.reward)}">${escapeHtml(label)}</button>`;
        }).join(" ")
      }</div>`
    : `<div class="muted">—</div>`;

  return `
    <div class="muted" style="margin-bottom:6px;">残りpt：${remaining}</div>
    ${boughtHtml}
    <div class="muted" style="margin-top:8px;">購入</div>
    ${canHtml}
    <div class="row gap" style="margin-top:8px;">
      <button class="btn small ghost" data-undo-buy="1">購入を戻す</button>
    </div>
  `;
}

/* ===== Campaign confirm ===== */
function renderCampaign(){
  const c = getCurrentCampaign();
  if(!c){ location.hash="#tasks"; return; }

  const done = isCampaignDone(c);
  const statusLabel = done ? "完了" : "未完了";

  $("campaignTitle") && ($("campaignTitle").textContent = c.name);
  $("campaignMeta") && ($("campaignMeta").textContent = `${c.start_date}`);
  $("campaignStatusPill") && ($("campaignStatusPill").textContent = statusLabel);
  $("goLiveBtn") && ($("goLiveBtn").href = `#live=${c.id}`);

  const body = $("leaderboardBody");
  if(!body) return;

  const totals = computeTotalsForCampaign(c.id);
  if(!totals.length){
    body.innerHTML = `<tr><td colspan="5" class="muted">データなし</td></tr>`;
    return;
  }

  body.innerHTML = totals.map(r=>{
    const status = getDeliveryStatus(c.id, r.listener_name);
    return `
      <tr>
        <td>${escapeHtml(r.listener_name)}</td>
        <td class="right">${r.points}</td>
        <td class="center">${renderRewardCell(c, r.listener_name, r.points)}</td>
        <td>
          <select class="input" data-delivery="${escapeHtml(r.listener_name)}">
            <option value="open" ${status==="open"?"selected":""}>未完了</option>
            <option value="done" ${status==="done"?"selected":""}>完了</option>
          </select>
        </td>
        <td>
          <input class="input" data-note="${escapeHtml(r.listener_name)}" value="${escapeHtml(getNote(c.id, r.listener_name))}" />
        </td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll("[data-delivery]").forEach(sel=>{
    sel.addEventListener("change", ()=>{
      const name = sel.getAttribute("data-delivery");
      setDeliveryStatus(c.id, name, sel.value);
      toast("更新");
      renderAll();
    });
  });

  body.querySelectorAll("[data-note]").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const name = inp.getAttribute("data-note");
      setNote(c.id, name, inp.value);
    });
  });

  if(normalizeCampaignType(c.type)==="shopping"){
    body.querySelectorAll("[data-buy]").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        e.stopPropagation();
        const tr = btn.closest("tr");
        const name = tr?.querySelector("td")?.textContent?.trim();
        if(!name) return;
        const cost = Number(btn.getAttribute("data-buy")||0);
        const reward = btn.getAttribute("data-buyname")||"";
        addPurchase(c, name, cost, reward);
        toast("購入");
        renderAll();
      });
    });
    body.querySelectorAll("[data-undo-buy]").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        e.stopPropagation();
        const tr = btn.closest("tr");
        const name = tr?.querySelector("td")?.textContent?.trim();
        if(!name) return;
        if(undoPurchase(c, name)) toast("戻す");
        renderAll();
      });
    });
  }
}

/* ===== Live helpers ===== */
function fillSelect(selectEl, options, selectedValue){
  if(!selectEl) return;
  const safe = options.map(x=>x.trim()).filter(Boolean);
  const selected = (selectedValue||"").trim();

  const html = [
    `<option value="">未選択</option>`,
    ...safe.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
  ].join("");

  selectEl.innerHTML = html;
  selectEl.value = (selected && safe.includes(selected)) ? selected : "";
}
function renderRewardList(c){
  const box = $("rewardListBox");
  if(!box) return;

  const type = normalizeCampaignType(c.type);
  if(type === "gacha"){
    ensureGacha(c);
    const chips = [];
    if(c.gacha.singleCost>0) chips.push(`<div class="rewardChip">1回${escapeHtml(c.gacha.singleCost)}pt</div>`);
    if(c.gacha.firstCost>0) chips.push(`<div class="rewardChip">初回1回${escapeHtml(c.gacha.firstCost)}pt</div>`);
    const items = c.gacha.items || [];
    if(items.length){
      chips.push(...items.map(it => `<div class="rewardChip">${escapeHtml(it.name)}（${escapeHtml(it.rate)}%）</div>`));
    }else{
      chips.push(`<div class="rewardChip">景品未設定</div>`);
    }
    box.innerHTML = chips.join("");
    return;
  }

  const rules = rulesSorted(c.rules);
  box.innerHTML = rules.length
    ? rules.map(r=>{
        const label = (type==="achievement")
          ? `${r.threshold}pt達成：${escapeHtml(r.reward)}`
          : `${r.threshold}：${escapeHtml(r.reward)}`;
        return `<div class="rewardChip">${label}</div>`;
      }).join("")
    : `<div class="muted">返礼品なし</div>`;
}

/* ===== Live table ===== */
function renderLiveTable(c){
  const tbody = $("liveLeaderboardBody");
  if(!tbody) return;

  const totals = computeTotalsForCampaign(c.id);
  if(!totals.length){
    tbody.innerHTML = `<tr><td colspan="3" class="muted">データなし</td></tr>`;
    return;
  }

  tbody.innerHTML = totals.map(r=>`
    <tr data-pick="${escapeHtml(r.listener_name)}" style="cursor:pointer;">
      <td>${escapeHtml(r.listener_name)}</td>
      <td class="right">${r.points}</td>
      <td class="center">${renderRewardCell(c, r.listener_name, r.points)}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-pick]").forEach(tr=>{
    tr.addEventListener("click", (e)=>{
      if(e.target.closest("button")) return;
      const name = tr.getAttribute("data-pick");
      setActiveListener(c.id, name);
      if($("addNameInput")) $("addNameInput").value = name;
      if($("listenerSelect")) $("listenerSelect").value = name;
      if($("gachaAddNameInput")) $("gachaAddNameInput").value = name;
      if($("gachaListenerSelect")) $("gachaListenerSelect").value = name;
      toast("選択");
      renderLive();
    });
  });

  if(normalizeCampaignType(c.type) === "shopping"){
    tbody.querySelectorAll("[data-buy]").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        e.stopPropagation();
        const tr = btn.closest("tr");
        const name = tr?.getAttribute("data-pick") || tr?.querySelector("td")?.textContent?.trim();
        if(!name) return;
        const cost = Number(btn.getAttribute("data-buy")||0);
        const reward = btn.getAttribute("data-buyname")||"";
        addPurchase(c, name, cost, reward);
        toast("購入");
        renderAll();
      });
    });

    tbody.querySelectorAll("[data-undo-buy]").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        e.stopPropagation();
        const tr = btn.closest("tr");
        const name = tr?.getAttribute("data-pick") || tr?.querySelector("td")?.textContent?.trim();
        if(!name) return;
        if(undoPurchase(c, name)) toast("戻す");
        renderAll();
      });
    });
  }
}

function addLog(delta){
  const c = getCurrentCampaign();
  if(!c) return;

  const name = ($("listenerSelect")?.value || "").trim();
  if(!name) return toast("リスナー未選択");

  state.logs.push({
    id: uid(),
    campaign_id: c.id,
    listener_name: name,
    delta_points: delta,
    created_at: new Date().toISOString(),
  });

  addListenerToPool(c.id, name);
  setActiveListener(c.id, name);

  saveState();
  renderAll();
  if($("liveMsg")) $("liveMsg").textContent = `${delta>0?"+":""}${delta} / ${name}`;
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
function addNewListenerFromInput(inputId, selectId){
  const c = getCurrentCampaign();
  if(!c) return;

  const input = $(inputId);
  const sel = $(selectId);
  const name = (input?.value || "").trim();
  if(!name) return;

  addListenerToPool(c.id, name);
  setActiveListener(c.id, name);

  if(input) input.value = name;

  saveState();
  renderAll();
  if(sel) sel.value = name;
  toast("追加");
}

/* ===== Gacha ===== */
function calcGachaPullsNormal(pt, g){
  const singleCost = Math.max(0, Number(g.singleCost||0));
  const multiCost = Math.max(0, Number(g.multiCost||0));
  const multiCount = Math.max(0, Number(g.multiCount||0));
  if(pt <= 0 || singleCost <= 0) return { total:0, mode:"normal", unit:singleCost };

  let remain = pt;
  let multiTimes = 0;
  if(multiCost > 0 && multiCount > 0){
    multiTimes = Math.floor(remain / multiCost);
    remain -= multiTimes * multiCost;
  }
  const singleTimes = Math.floor(remain / singleCost);
  const total = multiTimes * (multiCount||0) + singleTimes;
  return { total, mode:"normal", unit: singleCost };
}
function calcGachaPullsFirst(pt, g){
  const firstCost = Math.max(0, Number(g.firstCost||0));
  if(pt <= 0 || firstCost <= 0) return { total:0, mode:"first", unit:firstCost };
  const total = Math.floor(pt / firstCost);
  return { total, mode:"first", unit:firstCost };
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

/**
 * paidPt: 入力pt（0可）
 * opts:
 *  - forceFirstPricing: true => 初回単価で回数計算（※「初回単価を使ったことが無い」ならOK）
 *  - forceFreeOne: true => 無料で1回
 */
function rollGacha(user, paidPt, opts={}){
  const c = getCurrentCampaign();
  if(!c) return;
  ensureGacha(c);

  const paid = Math.max(0, Number(paidPt||0));
  const useFirstPricing = !!opts.forceFirstPricing;

  const calc = useFirstPricing ? calcGachaPullsFirst(paid, c.gacha) : calcGachaPullsNormal(paid, c.gacha);
  const freeOne = opts.forceFreeOne ? 1 : 0;
  const totalPulls = calc.total + freeOne;

  if(totalPulls <= 0){
    if($("gachaResultBox")) $("gachaResultBox").value = "";
    return toast("回せない");
  }

  addListenerToPool(c.id, user);
  setActiveListener(c.id, user);

  const results = [];
  for(let i=0;i<totalPulls;i++){
    results.push(pickGachaItem(c.gacha.items || []) ?? "（景品未設定）");
  }

  // 投げpt反映は paid 分だけ
  if(paid > 0){
    state.logs.push({
      id: uid(),
      campaign_id: c.id,
      listener_name: user,
      delta_points: paid,
      created_at: new Date().toISOString(),
    });
  }

  addGachaResult(c.id, user, paid, results, {
    usedFirstPricing: useFirstPricing,
    freeOne
  });

  // テキスト（番号なし、被りは×）
  const count = new Map();
  for(const r of results) count.set(r, (count.get(r) || 0) + 1);
  const lines = Array.from(count.entries())
    .sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => (n === 1 ? `${name}` : `${name} ×${n}`))
    .join("\n");

  const noteLines = [];
  if(paid > 0){
    noteLines.push(useFirstPricing ? `初回単価` : `通常単価`);
  }
  if(freeOne > 0) noteLines.push(`無料1回`);
  const note = noteLines.length ? `（${noteLines.join(" / ")}）` : "";

  if($("gachaResultBox")){
    $("gachaResultBox").value = `回した人：${user}\n回数：${totalPulls}${note}\n\n${lines}`.trim();
  }

  saveState();
  renderAll();
  toast("結果");
}

/* ===== Campaign edit in live ===== */
function clearEditBoxes(){
  const rb = $("editRulesBox");
  const gb = $("editGachaItemsBox");
  if(rb) rb.innerHTML = "";
  if(gb) gb.innerHTML = "";
}
function setEditTypeUI(type){
  const isGacha = type === "gacha";
  $("editRulesSection")?.classList.toggle("hidden", isGacha);
  $("editGachaSection")?.classList.toggle("hidden", !isGacha);
  validateEditCampaign();
}
function validateEditCampaign(){
  const hint = $("editCampaignHint");
  const saveBtn = $("saveEditCampaignBtn");
  if(!hint || !saveBtn) return;

  const name = ($("editCampName")?.value||"").toString().trim();
  const start = ($("editCampStart")?.value||"").toString().trim();
  const type = normalizeCampaignType(($("editCampType")?.value||"achievement").toString());

  let ok = true;
  let msg = "";

  if(!name){ ok=false; msg="企画名が未入力"; }
  else if(!start){ ok=false; msg="開始日が未入力"; }
  else if(type === "gacha"){
    const single = Number($("editGSingle")?.value||0);
    const items = $("editGachaItemsBox") ? collectGachaItemsFrom($("editGachaItemsBox")) : [];
    if(!(Number.isFinite(single) && single > 0)){ ok=false; msg="ガチャ：1回の必要ptが未入力"; }
    else if(items.length === 0){ ok=false; msg="ガチャ：景品が未入力"; }
  }else{
    const rules = $("editRulesBox") ? collectRulesFrom($("editRulesBox")) : [];
    if(rules.length === 0){ ok=false; msg="返礼品（ポイント＋内容）を1つ以上入力"; }
    if(ok && $("editRulesBox")){
      const rows = $("editRulesBox").querySelectorAll(".ruleRow");
      for(const row of rows){
        const th = (row.querySelector("[data-threshold]")?.value||"").toString().trim();
        const rw = (row.querySelector("[data-reward]")?.value||"").toString().trim();
        if((th && !rw) || (!th && rw)){
          ok=false; msg="返礼品の行に未入力があります"; break;
        }
      }
    }
  }

  hint.textContent = ok ? "" : msg;
  saveBtn.disabled = !ok;
}
function openCampaignEdit(){
  const c = getCurrentCampaign();
  if(!c) return;

  $("campaignEditPanel")?.classList.remove("hidden");
  $("editCampName").value = c.name || "";
  $("editCampStart").value = c.start_date || "";
  $("editCampType").value = normalizeCampaignType(c.type);

  clearEditBoxes();

  if(normalizeCampaignType(c.type) === "gacha"){
    ensureGacha(c);
    $("editGSingle").value = String(c.gacha.singleCost || "");
    $("editGFirstCost").value = String(c.gacha.firstCost || "");
    $("editGMultiCost").value = String(c.gacha.multiCost || "");
    $("editGMultiCount").value = String(c.gacha.multiCount || "");
    const gb = $("editGachaItemsBox");
    (c.gacha.items||[]).forEach(it=> addGachaRow(gb, it.name, it.rate));
    setEditTypeUI("gacha");
  }else{
    const rb = $("editRulesBox");
    (c.rules||[]).forEach(r=> addRuleRow(rb, r.threshold, r.reward));
    setEditTypeUI(normalizeCampaignType(c.type));
  }

  validateEditCampaign();
}
function closeCampaignEdit(){ $("campaignEditPanel")?.classList.add("hidden"); }
function saveCampaignEdit(){
  const c = getCurrentCampaign();
  if(!c) return;
  validateEditCampaign();
  if($("saveEditCampaignBtn")?.disabled) return;

  c.name = ($("editCampName")?.value||"").toString().trim();
  c.start_date = ($("editCampStart")?.value||"").toString().trim();
  c.type = normalizeCampaignType(($("editCampType")?.value||"achievement").toString());

  if(c.type === "gacha"){
    c.rules = [];
    c.gacha = {
      singleCost: Number($("editGSingle")?.value||0),
      firstCost:  Number($("editGFirstCost")?.value||0),
      multiCost:  Number($("editGMultiCost")?.value||0),
      multiCount: Number($("editGMultiCount")?.value||0),
      items: $("editGachaItemsBox") ? collectGachaItemsFrom($("editGachaItemsBox")) : []
    };
    ensureGacha(c);
  }else{
    c.rules = $("editRulesBox") ? collectRulesFrom($("editRulesBox")) : [];
  }

  saveState();
  toast("保存");
  closeCampaignEdit();
  renderAll();
}
$("editCampaignBtn")?.addEventListener("click", openCampaignEdit);
$("cancelEditCampaignBtn")?.addEventListener("click", closeCampaignEdit);
$("saveEditCampaignBtn")?.addEventListener("click", saveCampaignEdit);
$("editAddRuleRowBtn")?.addEventListener("click", ()=>{
  const rb = $("editRulesBox");
  if(rb) addRuleRow(rb,"","");
  validateEditCampaign();
});
$("editAddGachaRowBtn")?.addEventListener("click", ()=>{
  const gb = $("editGachaItemsBox");
  if(gb) addGachaRow(gb,"","");
  validateEditCampaign();
});
$("editCampType")?.addEventListener("change", ()=>{
  setEditTypeUI(normalizeCampaignType($("editCampType").value));
});

/* ===== Live render ===== */
function renderLive(){
  const c = getCurrentCampaign();
  if(!c){ location.hash="#tasks"; return; }

  const done = isCampaignDone(c);
  const statusLabel = done ? "完了" : "未完了";

  $("liveTitle") && ($("liveTitle").textContent = c.name);
  $("liveMeta") && ($("liveMeta").textContent = `${c.start_date} / ${statusLabel}`);
  $("goConfirmBtn") && ($("goConfirmBtn").href = `#campaign=${c.id}`);

  const isGacha = normalizeCampaignType(c.type) === "gacha";
  $("liveGachaCard")?.classList.toggle("hidden", !isGacha);
  $("liveInputCard")?.classList.toggle("hidden", isGacha);

  renderRewardList(c);
  renderLiveTable(c);

  const names = getAllKnownListeners(c.id);
  const active = getActiveListener(c.id);

  fillSelect($("listenerSelect"), names, active);
  fillSelect($("gachaListenerSelect"), names, active);

  if(isGacha){
    if($("gachaAddNameInput") && active) $("gachaAddNameInput").value = active;
  }else{
    if($("addNameInput") && active) $("addNameInput").value = active;
  }

  if($("addNameBtn")) $("addNameBtn").onclick = ()=> addNewListenerFromInput("addNameInput", "listenerSelect");
  if($("addNameInput")) $("addNameInput").onkeydown = (e)=>{ if(e.key==="Enter"){ e.preventDefault(); addNewListenerFromInput("addNameInput","listenerSelect"); } };

  if($("gachaAddNameBtn")) $("gachaAddNameBtn").onclick = ()=> addNewListenerFromInput("gachaAddNameInput", "gachaListenerSelect");
  if($("gachaAddNameInput")) $("gachaAddNameInput").onkeydown = (e)=>{ if(e.key==="Enter"){ e.preventDefault(); addNewListenerFromInput("gachaAddNameInput","gachaListenerSelect"); } };

  if($("listenerSelect")){
    $("listenerSelect").onchange = ()=>{
      const n = ($("listenerSelect").value||"").trim();
      if(!n) return;
      setActiveListener(c.id, n);
      if($("addNameInput")) $("addNameInput").value = n;
      toast("選択");
      renderLive();
    };
  }
  if($("gachaListenerSelect")){
    $("gachaListenerSelect").onchange = ()=>{
      const n = ($("gachaListenerSelect").value||"").trim();
      if(!n) return;
      setActiveListener(c.id, n);
      if($("gachaAddNameInput")) $("gachaAddNameInput").value = n;
      toast("選択");
      renderLive();
    };
  }

  if($("clearActiveBtn")){
    $("clearActiveBtn").onclick = ()=>{
      setActiveListener(c.id,"");
      if($("listenerSelect")) $("listenerSelect").value = "";
      if($("addNameInput")) $("addNameInput").value = "";
      toast("解除");
      renderLive();
    };
  }

  document.querySelectorAll("[data-add]").forEach(btn=>{
    btn.onclick = ()=> addLog(parseInt(btn.getAttribute("data-add"),10));
  });

  if($("addCustomBtn")){
    $("addCustomBtn").onclick = ()=>{
      const v = parseInt(($("customPoints")?.value || "").toString(),10);
      if(!v) return;
      addLog(v);
      if($("customPoints")) $("customPoints").value = "";
    };
  }

  if($("subtractBtn")){
    $("subtractBtn").onclick = ()=>{
      const v = parseInt(($("customPoints")?.value || "").toString(),10);
      if(!v) return;
      addLog(-Math.abs(v));
      if($("customPoints")) $("customPoints").value = "";
    };
  }

  if($("undoBtn")) $("undoBtn").onclick = ()=> undoLastLog();

  if(isGacha){
    ensureGacha(c);

    const selectedUser = ($("gachaListenerSelect")?.value || "").trim();
    const eligibleCb = $("gachaEligibleCheckbox");
    const ptInput = $("gachaPtInput");

    if(eligibleCb){
      eligibleCb.disabled = !selectedUser;
      eligibleCb.checked = selectedUser ? isGachaEligible(c.id, selectedUser) : false;
      eligibleCb.onchange = ()=>{
        const u = ($("gachaListenerSelect")?.value || "").trim();
        if(!u) return;
        setGachaEligible(c.id, u, eligibleCb.checked);
        toast("更新");
        renderLive();
      };
    }

    // helper: pt input empty => auto apply default and set input value
    function getPtOrDefault(defaultPt){
      if(!ptInput) return Number(defaultPt||0);
      const raw = (ptInput.value || "").toString().trim();
      if(raw === ""){
        const v = Number(defaultPt||0);
        ptInput.value = String(v);
        return v;
      }
      return Number(raw||0);
    }

    // 通常「回す」＝常に通常単価。空なら singleCost を自動適用
    if($("gachaRollBtn")){
      $("gachaRollBtn").onclick = ()=>{
        const user = ($("gachaListenerSelect")?.value || "").trim();
        if(!user) return toast("リスナー未選択");
        if(!(c.gacha.singleCost > 0)) return toast("1回pt未設定");

        const pt = getPtOrDefault(c.gacha.singleCost);
        const calc = calcGachaPullsNormal(Math.max(0, pt), c.gacha);
        if(calc.total <= 0) return toast("pt");
        rollGacha(user, pt, { forceFirstPricing:false, forceFreeOne:false });
      };
    }

    // 「初回で回す」＝初回単価（無料の後でもOK）
    // 条件：初回ptが設定されていて、まだ “初回単価で回した履歴” が無い
    const firstBtn = $("gachaFirstRollBtn");
    if(firstBtn){
      const firstEnabled =
        !!selectedUser &&
        c.gacha.firstCost > 0 &&
        !hasUsedFirstPricing(c.id, selectedUser);

      firstBtn.disabled = !firstEnabled;

      firstBtn.onclick = ()=>{
        const user = ($("gachaListenerSelect")?.value || "").trim();
        if(!user) return toast("リスナー未選択");
        if(!(c.gacha.firstCost > 0)) return toast("初回pt未設定");
        if(hasUsedFirstPricing(c.id, user)) return toast("初回済み");

        const pt = getPtOrDefault(c.gacha.firstCost);
        const calc = calcGachaPullsFirst(Math.max(0, pt), c.gacha);
        if(calc.total <= 0) return toast("pt");
        rollGacha(user, pt, { forceFirstPricing:true, forceFreeOne:false });
      };
    }

    // 無料で1回（ptは常に0）
    if($("gachaFreeRollBtn")){
      $("gachaFreeRollBtn").disabled = !(selectedUser && isGachaEligible(c.id, selectedUser));
      $("gachaFreeRollBtn").onclick = ()=>{
        const user = ($("gachaListenerSelect")?.value || "").trim();
        if(!user) return toast("リスナー未選択");
        if(!isGachaEligible(c.id, user)) return toast("無料対象ではない");
        rollGacha(user, 0, { forceFirstPricing:false, forceFreeOne:true });
      };
    }

    if($("gachaCopyBtn")){
      $("gachaCopyBtn").onclick = async ()=>{
        const text = ($("gachaResultBox")?.value || "").toString();
        if(!text.trim()) return toast("空");
        try{
          await navigator.clipboard.writeText(text);
          toast("コピー");
        }catch{
          try{
            $("gachaResultBox")?.focus();
            $("gachaResultBox")?.select();
            document.execCommand("copy");
            toast("コピー");
          }catch{
            alert("コピーに失敗しました。");
          }
        }
      };
    }
  }
}

/* ===== renderAll ===== */
function renderAll(){
  renderHome();
  renderCampaigns();

  const h = location.hash || "";
  if(h.startsWith("#tasks")) renderTaskCampaignList();
  if(h.startsWith("#campaign=")) renderCampaign();
  if(h.startsWith("#live=")) renderLive();
}

/* ===== Backup / Restore ===== */
$("exportBtn")?.addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `reward-task-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("バックアップ");
});

$("importFile")?.addEventListener("change", async (e)=>{
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
      notes: (obj.notes && typeof obj.notes === "object") ? obj.notes : {},
      gacha_free_eligible: (obj.gacha_free_eligible && typeof obj.gacha_free_eligible === "object") ? obj.gacha_free_eligible : {},
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

/* ===== Init ===== */
function setCreateTypeUIInit(){
  setCreateTypeUI($("createTypeSelect")?.value || "achievement");
  validateCreateForm();
}
setCreateTypeUIInit();
route();
renderAll();
