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
const STORAGE_KEY = "reward_task_manager_v24";

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
    if(!c.start_date && c.start) c.start_date = c.start;
    if(c.type === "gacha") ensureGacha(c);
    c.rules ||= [];
  });
  state.delivery ||= {};
  state.purchases ||= {};
  state.gacha_history ||= {};
  state.listener_pool ||= {};
  state.active_listener ||= {};
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

/* ===== Reward summary for Campaign list ===== */
function rewardSummaryText(c){
  const type = normalizeCampaignType(c.type);
  if(type === "gacha"){
    ensureGacha(c);
    const cost = c.gacha?.singleCost ? `1回${c.gacha.singleCost}pt` : "1回pt未設定";
    const items = (c.gacha?.items || []).map(it=>it?.name).filter(Boolean);
    const itemText = items.length ? items.join(" / ") : "景品未設定";
    const text = `${cost}｜${itemText}`;
    return text.length > 80 ? text.slice(0,80) + "…" : text;
  }

  const rules = rulesSorted(c.rules);
  if(!rules.length) return "返礼品未設定";

  const parts = rules.map(r=>{
    if(type === "achievement") return `${r.threshold}pt達成：${r.reward}`;
    return `${r.threshold}：${r.reward}`;
  });
  const joined = parts.join(" / ");
  return joined.length > 80 ? joined.slice(0,80) + "…" : joined;
}

/* ===== SPA routing ===== */
const views = {
  home: $("view-home"),
  tasks: $("view-tasks"),
  campaigns: $("view-campaigns"),
  campaign: $("view-campaign"),
  live: $("view-live"),
  iriam: $("view-iriam"),
};

function setActiveNav(viewName){
  document.querySelectorAll(".navlink").forEach(a=>a.classList.remove("active"));
  const map = { home:"home", tasks:"tasks", campaigns:"campaigns", campaign:"tasks", live:"tasks", iriam:"iriam" };
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

  
  if(path === "iriam"){
    showView("iriam");
    renderIriam();
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

/* ===== ★未入力なら作成ボタン押せない ===== */
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
    // ルール：1行も完成してないならNG
    const rules = $("rulesBox") ? collectRulesFrom($("rulesBox")) : [];
    if(rules.length === 0){ ok=false; msg="返礼品（ポイント＋内容）を1つ以上入力"; }
    // 途中入力（片方だけ）を検出
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

// 入力で常に判定
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
    const multiCost  = Number(fd.get("g_multiCost")||0);
    const multiCount = Number(fd.get("g_multiCount")||0);
    const items = $("gachaItemsBox") ? collectGachaItemsFrom($("gachaItemsBox")) : [];
    campaign.gacha = { singleCost, multiCost, multiCount, items };
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
  if(!rules.length){
    return boughtHtml;
  }

  const can = rules.filter(r=>remaining>=r.threshold);
  const canHtml = can.length
    ? `<div class="shopItems">${can.map(r=>`<button class="btn small ghost" data-buy="${r.threshold}" data-buyname="${escapeHtml(r.reward)}">買う</button>`).join(" ")}</div>`
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
    body.innerHTML = `<tr><td colspan="4" class="muted">データなし</td></tr>`;
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

  if(normalizeCampaignType(c.type)==="shopping"){
    body.querySelectorAll("[data-buy]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
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
      btn.addEventListener("click", ()=>{
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
    const items = c.gacha.items || [];
    box.innerHTML = items.length
      ? items.map(it => `<div class="rewardChip">${escapeHtml(it.name)}（${escapeHtml(it.rate)}%）</div>`).join("")
      : `<div class="muted">返礼品なし</div>`;
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
    tr.addEventListener("click", ()=>{
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

  // 入力欄は消さない
  if(input) input.value = name;

  saveState();
  renderAll();
  if(sel) sel.value = name;
  toast("追加");
}

/* ===== Gacha ===== */
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

/* ===== Gacha Undo ===== */
const gachaUndoStack = [];
const GACHA_UNDO_MAX = 50;
function updateGachaUndoBtn(){
  const b = $("gachaUndoBtn");
  if(b) b.disabled = gachaUndoStack.length === 0;
}
function pushGachaUndo(action){
  gachaUndoStack.push(action);
  if(gachaUndoStack.length > GACHA_UNDO_MAX) gachaUndoStack.shift();
  updateGachaUndoBtn();
}
function undoLastGacha(){
  const a = gachaUndoStack.pop();
  updateGachaUndoBtn();
  if(!a) return toast("戻せない");

  // logs: remove the log inserted by gacha
  const li = state.logs.findIndex(l => l.id === a.log_id);
  if(li >= 0) state.logs.splice(li, 1);

  // gacha history: truncate to the previous length (safe even if list is shorter)
  const list = getGachaList(a.campaign_id, a.listener_name);
  if(list.length > a.prev_hist_len) list.splice(a.prev_hist_len);

  // restore active listener (optional)
  if(a.prev_active){
    state.active_listener[a.campaign_id] = a.prev_active;
  }else{
    delete state.active_listener[a.campaign_id];
  }

  saveState();
  renderAll();

  // clear result box (UI safety)
  if($("gachaResultBox")) $("gachaResultBox").value = "";

  toast("戻した");
}

function rollGacha(user, pt){
  const c = getCurrentCampaign();
  if(!c) return;
  ensureGacha(c);

  const calc = calcGachaPulls(pt, c.gacha);
  if(calc.total <= 0){
    if($("gachaResultBox")) $("gachaResultBox").value = "";
    return toast("回せない");
  }

  addListenerToPool(c.id, user);
  setActiveListener(c.id, user);

  const results = [];
  for(let i=0;i<calc.total;i++){
    results.push(pickGachaItem(c.gacha.items || []) ?? "（景品未設定）");
  }

  // ptは加算ログ（Undo用に直前状態を保存）
  const logId = uid();
  pushGachaUndo({
    campaign_id: c.id,
    listener_name: user,
    log_id: logId,
    prev_hist_len: getGachaList(c.id, user).length,
    prev_active: getActiveListener(c.id),
  });

  state.logs.push({
    id: logId,
    campaign_id: c.id,
    listener_name: user,
    delta_points: pt,
    created_at: new Date().toISOString(),
  });

  addGachaResult(c.id, user, pt, results);

  // 表示：番号なし、使用ptは出さない、被りは×n
  const count = new Map();
  for(const r of results) count.set(r, (count.get(r) || 0) + 1);
  const lines = Array.from(count.entries())
    .sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => (n === 1 ? `${name}` : `${name} ×${n}`))
    .join("\n");

  if($("gachaResultBox")){
    $("gachaResultBox").value = `回した人：${user}\n回数：${calc.total}\n\n${lines}`;
  }

  saveState();
  renderAll();
  toast("結果");
}

/* ===== ★企画編集（ライブ画面） ===== */
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

  // 入力監視
  ["editCampName","editCampStart","editCampType","editGSingle","editGMultiCost","editGMultiCount"].forEach(id=>{
    $(id)?.addEventListener("input", validateEditCampaign);
    $(id)?.addEventListener("change", ()=>{
      if(id==="editCampType") setEditTypeUI(normalizeCampaignType($("editCampType").value));
      validateEditCampaign();
    });
  });

  validateEditCampaign();
}

function closeCampaignEdit(){
  $("campaignEditPanel")?.classList.add("hidden");
}

function saveCampaignEdit(){
  const c = getCurrentCampaign();
  if(!c) return;
  validateEditCampaign();
  if($("saveEditCampaignBtn")?.disabled) return;

  const name = ($("editCampName")?.value||"").toString().trim();
  const start = ($("editCampStart")?.value||"").toString().trim();
  const type = normalizeCampaignType(($("editCampType")?.value||"achievement").toString());

  c.name = name;
  c.start_date = start;
  c.type = type;

  if(type === "gacha"){
    c.rules = [];
    c.gacha = {
      singleCost: Number($("editGSingle")?.value||0),
      multiCost: Number($("editGMultiCost")?.value||0),
      multiCount: Number($("editGMultiCount")?.value||0),
      items: $("editGachaItemsBox") ? collectGachaItemsFrom($("editGachaItemsBox")) : []
    };
    ensureGacha(c);
  }else{
    c.gacha = c.gacha || undefined; // 残っても害はないが一応
    c.rules = $("editRulesBox") ? collectRulesFrom($("editRulesBox")) : [];
  }

  saveState();
  toast("保存");
  closeCampaignEdit();
  renderAll();
}

/* edit panel buttons */
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

/* ===== LIVE render ===== */
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

  // name add
  if($("addNameBtn")) $("addNameBtn").onclick = ()=> addNewListenerFromInput("addNameInput", "listenerSelect");
  if($("addNameInput")) $("addNameInput").onkeydown = (e)=>{ if(e.key==="Enter"){ e.preventDefault(); addNewListenerFromInput("addNameInput","listenerSelect"); } };

  if($("gachaAddNameBtn")) $("gachaAddNameBtn").onclick = ()=> addNewListenerFromInput("gachaAddNameInput", "gachaListenerSelect");
  if($("gachaAddNameInput")) $("gachaAddNameInput").onkeydown = (e)=>{ if(e.key==="Enter"){ e.preventDefault(); addNewListenerFromInput("gachaAddNameInput","gachaListenerSelect"); } };

  // select sync
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

  // gacha
  if(isGacha){
    if($("gachaRollBtn")){
      $("gachaRollBtn").onclick = ()=>{
        const user = ($("gachaListenerSelect")?.value || "").trim();
        const pt = Number($("gachaPtInput")?.value || 0);
        if(!user) return toast("リスナー未選択");
        if(!Number.isFinite(pt) || pt<=0) return toast("pt");
        rollGacha(user, pt);
      };
    }

    if($("gachaUndoBtn")){
      updateGachaUndoBtn();
      $("gachaUndoBtn").onclick = ()=> undoLastGacha();
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



/* ===== IRIAM calc (integrated) ===== */
const IRIAM_STORAGE_KEY = "unified_iriam_v1";
let __iriamInited = false;
function notifyIriam(msg){ try{ if(typeof toast === 'function'){ toast(msg); return; } }catch{} alert(msg); }
function initIriam(){
  if(__iriamInited) return;
  __iriamInited = true;
const plusSelect = document.getElementById('init-plus');
        for(let i=0; i<=17; i++) {
            let opt = document.createElement('option');
            opt.value = i; opt.innerText = i;
            plusSelect.appendChild(opt);
        }
        const passSelect = document.getElementById('init-pass');
        for(let i=0; i<=10; i++) {
            let opt = document.createElement('option');
            opt.value = i; opt.innerText = i + " 枚";
            passSelect.appendChild(opt);
        }

        const todayObj = new Date();
        const todayStr = todayObj.getFullYear() + '-' + ('0' + (todayObj.getMonth() + 1)).slice(-2) + '-' + ('0' + todayObj.getDate()).slice(-2);
        
        renderTable(); 
        loadData();    
        
        if(!document.getElementById('start-date').value) {
            document.getElementById('start-date').value = todayStr;
        }
        
        runSim();
}
function renderIriam(){ initIriam(); }
/* ---- original IRIAM logic (with storage key replaced) ---- */

    const RANKS = ["D", "C1", "C2", "C3", "C4", "C5", "B1", "B2", "B3", "A1", "A2", "A3", "S1", "S2", "S3"];
    const DAYS_LIMIT = 60;

    function renderTable() {
        const tbody = document.getElementById('table-body');
        tbody.innerHTML = "";
        for (let i = 0; i < DAYS_LIMIT; i++) {
            let tr = document.createElement('tr');
            tr.id = `row-${i}`;
            tr.innerHTML = `
                <td id="date-${i}"></td>
                <td id="rank-${i}"></td>
                <td id="days-${i}"></td>
                <td>
                    <select class="score-select" id="score-${i}" onchange="runSim()">
                        <option value="1">1</option><option value="2">2</option>
                        <option value="4">4</option><option value="6">6</option>
                        <option value="0">0</option>
                    </select>
                </td>
                <td><input type="checkbox" class="pass-chk" id="pass-${i}" onchange="runSim()"></td>
                <td id="total-${i}"></td>
                <td id="status-${i}"></td>
                <td id="passcnt-${i}"></td>
            `;
            tbody.appendChild(tr);
        }
    }

    function runSim() {
        let curRank = document.getElementById('init-rank').value;
        let dayRem = parseInt(document.getElementById('init-days').value);
        let totalPlus = parseInt(document.getElementById('init-plus').value);
        let passHold = parseInt(document.getElementById('init-pass').value);
        let startDateInput = document.getElementById('start-date').value;
        let startDate = startDateInput ? new Date(startDateInput) : new Date();
        
        const now = new Date();
        const todayStr = (now.getMonth()+1) + "/" + now.getDate();
        let todayPassCount = "期間外";
        document.getElementById('today-date-display').innerText = `(${todayStr})`;

        for (let i = 0; i < DAYS_LIMIT; i++) {
            let d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            let dayOfWeek = d.getDay(); 
            let dateKey = (d.getMonth()+1) + "/" + d.getDate();
            let dateStr = dateKey + `(${['日','月','火','水','木','金','土'][dayOfWeek]})`;
            
            if (dayOfWeek === 1 && i !== 0) {
                passHold = Math.min(10, passHold + 1);
            }

            let passEl = document.getElementById(`pass-${i}`);
            
            // パスを持っていない場合はチェックボックスを無効化（ただし既にチェック済みの場合は許可）
            if (passHold <= 0 && !passEl.checked) {
                passEl.disabled = true;
            } else {
                passEl.disabled = false;
            }

            let isPass = passEl.checked;
            let dailyScore = parseInt(document.getElementById(`score-${i}`).value) || 0;
            let status = "-";
            let isEnd = false;

            const dateCell = document.getElementById(`date-${i}`);
            const row = document.getElementById(`row-${i}`);
            dateCell.innerText = dateStr;
            
            if (dateKey === todayStr) {
                row.classList.add('today-highlight');
                todayPassCount = passHold; 
            } else {
                row.classList.remove('today-highlight');
            }

            if (dayOfWeek === 2) { dateCell.className = "tuesday"; } else { dateCell.className = ""; }

            if (isPass) {
                status = "SKIP";
                passHold = Math.max(0, passHold - 1);
                row.classList.add("pass-row");
            } else {
                totalPlus += dailyScore;
                row.classList.remove("pass-row");
                if (totalPlus >= 18) { status = "アップ"; isEnd = true; }
                else if (dayRem <= 0) { status = (totalPlus >= 12) ? "キープ" : "ダウン"; isEnd = true; }
            }

            document.getElementById(`rank-${i}`).innerText = curRank;
            document.getElementById(`days-${i}`).innerText = isPass ? "-" : `${dayRem}日`;
            document.getElementById(`total-${i}`).innerText = isPass ? "-" : totalPlus;
            let sCell = document.getElementById(`status-${i}`);
            sCell.innerText = status;
            sCell.className = (status==="アップ")?"up":(status==="ダウン")?"down":(status==="キープ")?"keep":"";
            document.getElementById(`passcnt-${i}`).innerText = `${passHold}枚`;

            if (!isPass) {
                if (isEnd) {
                    let idx = RANKS.indexOf(curRank);
                    if (status === "アップ" && idx < RANKS.length-1) curRank = RANKS[idx+1];
                    else if (status === "ダウン" && idx > 0) curRank = RANKS[idx-1];
                    totalPlus = 0; dayRem = 6;
                } else {
                    dayRem--;
                }
            }
        }
        document.getElementById('current-pass-display').innerText = todayPassCount;
    }

    function saveAndRefresh() {
        runSim();
        let scores = []; let passes = [];
        for(let i=0; i<60; i++){
            scores.push(document.getElementById(`score-${i}`).value);
            passes.push(document.getElementById(`pass-${i}`).checked);
        }
        let data = {
            rank: document.getElementById('init-rank').value,
            days: document.getElementById('init-days').value,
            plus: document.getElementById('init-plus').value,
            pass: document.getElementById('init-pass').value,
            start: document.getElementById('start-date').value,
            scores: scores, passes: passes
        };
        localStorage.setItem(IRIAM_STORAGE_KEY, JSON.stringify(data));
        notifyIriam("実行しました。入力を保存しました。");
    }

    function loadData() {
        let raw = localStorage.getItem(IRIAM_STORAGE_KEY);
        if (!raw) return;
        let d = JSON.parse(raw);
        document.getElementById('init-rank').value = d.rank;
        document.getElementById('init-days').value = d.days;
        document.getElementById('init-plus').value = d.plus;
        document.getElementById('init-pass').value = d.pass;
        if(d.start) document.getElementById('start-date').value = d.start;
        for(let i=0; i<60; i++){
            if(d.scores && d.scores[i] !== undefined) document.getElementById(`score-${i}`).value = d.scores[i];
            if(d.passes && d.passes[i] !== undefined) document.getElementById(`pass-${i}`).checked = d.passes[i];
        }
    }



/* ===== Init ===== */
function setCreateTypeUIInit(){
  setCreateTypeUI($("createTypeSelect")?.value || "achievement");
  validateCreateForm();
}

setCreateTypeUIInit();
route();
renderAll();
