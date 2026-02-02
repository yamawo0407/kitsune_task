"use strict";

const jsStatus = document.getElementById("jsStatus");
if (jsStatus) jsStatus.textContent = "JS: OK";

const STORAGE_KEY = "reward_task_manager_v10";

function uid(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }
function escapeHtml(s){
  return (s ?? "").toString().replace(/[&<>"']/g,(c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function byISODateOnly(iso){ return (iso || "").slice(0,10); }

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? JSON.parse(raw) : {};
    return {
      campaigns: Array.isArray(s.campaigns) ? s.campaigns : [],
      logs: Array.isArray(s.logs) ? s.logs : [],
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
      delivery: (s.delivery && typeof s.delivery === "object") ? s.delivery : {},
      purchases: (s.purchases && typeof s.purchases === "object") ? s.purchases : {}
    };
  }catch{
    return { campaigns: [], logs: [], tasks: [], delivery: {}, purchases: {} };
  }
}
let state = loadState();
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function normalizeCampaignType(t){
  return (t === "shopping" || t === "achievement") ? t : "achievement";
}
function migrate(){
  state.campaigns.forEach(c=>{
    c.type = normalizeCampaignType(c.type);
    if(!c.created_at) c.created_at = new Date().toISOString();
  });
  if(!state.delivery || typeof state.delivery !== "object") state.delivery = {};
  if(!state.purchases || typeof state.purchases !== "object") state.purchases = {};
}
migrate(); saveState();

/* toast */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg){
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toastEl.classList.add("hidden"), 1300);
}

/* views */
const views = {
  home: document.getElementById("view-home"),
  tasks: document.getElementById("view-tasks"),
  campaigns: document.getElementById("view-campaigns"),
  campaign: document.getElementById("view-campaign"),
  live: document.getElementById("view-live"),
};
function showView(name){
  Object.entries(views).forEach(([k, el])=> el && el.classList.toggle("hidden", k !== name));
  setActiveNav(name);
}
function setActiveNav(viewName){
  document.querySelectorAll(".navlink").forEach(a=>a.classList.remove("active"));
  const map = { home:"home", tasks:"tasks", campaigns:"campaigns", campaign:"tasks", live:"tasks" };
  const key = map[viewName] || "home";
  const el = document.querySelector(`.navlink[data-nav="${key}"]`);
  if(el) el.classList.add("active");
}
function parseHashParts(){
  const raw = (location.hash || "#home").slice(1);
  const [path, queryStr] = raw.split("?");
  const params = new URLSearchParams(queryStr || "");
  return { path: path || "home", params };
}

/* helpers */
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
function isCampaignDone(campaign){
  const totals = computeTotalsForCampaign(campaign.id);
  if(totals.length === 0) return false;
  return totals.every(r => getDeliveryStatus(campaign.id, r.listener_name) === "done");
}

/* sort campaigns by start_date desc */
function campaignSortDesc(a,b){
  const ad = (a.start_date||"");
  const bd = (b.start_date||"");
  if(ad !== bd) return bd.localeCompare(ad); // YYYY-MM-DD compare OK
  const ac = a.created_at || "";
  const bc = b.created_at || "";
  return bc.localeCompare(ac);
}

/* routing */
let currentCampaignId = null;
let taskPageFilter = "open";
let editMode = false;

function route(){
  const { path, params } = parseHashParts();

  if(path.startsWith("campaign=")){
    const id = path.split("=")[1];
    if(id && state.campaigns.some(c=>c.id===id)){
      currentCampaignId = id;
      editMode = false;
      showView("campaign");
      renderCampaignConfirm();
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
    taskPageFilter = (list==="open"||list==="done"||list==="all") ? list : "open";
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

/* HOME */
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

/* rules ui */
const rulesBox = document.getElementById("rulesBox");
const addRuleRowBtn = document.getElementById("addRuleRowBtn");
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
addRuleRowBtn?.addEventListener("click", ()=> rulesBox && addRuleRow(rulesBox, "", ""));
if(rulesBox && rulesBox.children.length===0){
  addRuleRow(rulesBox, "1000", "デジグッズA");
  addRuleRow(rulesBox, "3000", "デジグッズB");
}

/* create campaign */
const createCampaignForm = document.getElementById("createCampaignForm");
createCampaignForm?.addEventListener("submit",(e)=>{
  e.preventDefault();
  const fd = new FormData(createCampaignForm);
  const name = (fd.get("name")||"").toString().trim();
  const start_date = (fd.get("start_date")||"").toString().trim();
  const type = normalizeCampaignType((fd.get("type")||"achievement").toString());
  if(!name || !start_date) return;

  const rules = rulesBox ? collectRulesFrom(rulesBox) : [];

  state.campaigns.unshift({
    id: uid(),
    name,
    start_date,
    type,
    rules,
    created_at: new Date().toISOString(),
  });

  saveState();
  createCampaignForm.reset();
  renderAll();
  toast("作成");
});

/* campaign list (campaigns page) */
const campaignListEl = document.getElementById("campaignList");
const campaignSearchEl = document.getElementById("campaignSearch");
campaignSearchEl?.addEventListener("input", renderCampaigns);

function deleteCampaign(campaignId){
  state.campaigns = state.campaigns.filter(x=>x.id!==campaignId);
  state.logs = state.logs.filter(x=>x.campaign_id!==campaignId);
  state.tasks = state.tasks.filter(x=>x.campaign_id!==campaignId);
  delete state.delivery[campaignId];
  delete state.purchases[campaignId];
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
          <div>
            <strong>${escapeHtml(c.name)}</strong>
            <span class="badge">${escapeHtml(c.start_date)}</span>
            <span class="badge">${statusLabel}</span>
          </div>
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
      saveState();
      renderAll();
      toast("削除");
    });
  });
}

/* TASKS */
const taskCampaignListEl = document.getElementById("taskCampaignList");
const filterOpenBtn = document.getElementById("filterOpenCampaigns");
const filterDoneBtn = document.getElementById("filterDoneCampaigns");
const filterAllBtn = document.getElementById("filterAllCampaigns");

filterOpenBtn?.addEventListener("click", ()=>{ taskPageFilter="open"; renderTaskCampaignList(); });
filterDoneBtn?.addEventListener("click", ()=>{ taskPageFilter="done"; renderTaskCampaignList(); });
filterAllBtn?.addEventListener("click", ()=>{ taskPageFilter="all"; renderTaskCampaignList(); });

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
          <div>
            <strong>${escapeHtml(c.name)}</strong>
            <span class="badge">${escapeHtml(c.start_date)}</span>
            <span class="badge">${statusLabel}</span>
          </div>
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

/* CAMPAIGN CONFIRM */
const campaignTitleEl = document.getElementById("campaignTitle");
const campaignMetaEl = document.getElementById("campaignMeta");
const campaignStatusPill = document.getElementById("campaignStatusPill");
const goLiveBtn = document.getElementById("goLiveBtn");

const toggleEditModeBtn = document.getElementById("toggleEditModeBtn");
const campaignEditPanel = document.getElementById("campaignEditPanel");
const editCampaignForm = document.getElementById("editCampaignForm");
const closeEditCampaignBtn = document.getElementById("closeEditCampaignBtn");
const editRulesBox = document.getElementById("editRulesBox");
const editAddRuleRowBtn = document.getElementById("editAddRuleRowBtn");
const deleteCampaignBtn = document.getElementById("deleteCampaignBtn");

const leaderboardBody = document.getElementById("leaderboardBody");
const createTaskFormEl = document.getElementById("createTaskForm");
const taskListEl = document.getElementById("taskList");

function getCurrentCampaign(){
  return state.campaigns.find(c=>c.id===currentCampaignId) || null;
}

function setEditMode(on){
  editMode = !!on;
  if(campaignEditPanel) campaignEditPanel.classList.toggle("hidden", !editMode);
  if(createTaskFormEl) createTaskFormEl.classList.toggle("hidden", !editMode);
  if(toggleEditModeBtn) toggleEditModeBtn.textContent = editMode ? "編集を閉じる" : "編集";
  renderAll();
}

toggleEditModeBtn?.addEventListener("click", ()=> setEditMode(!editMode));
closeEditCampaignBtn?.addEventListener("click", ()=> setEditMode(false));
editAddRuleRowBtn?.addEventListener("click", ()=> editRulesBox && addRuleRow(editRulesBox, "", ""));

deleteCampaignBtn?.addEventListener("click", ()=>{
  const c = getCurrentCampaign();
  if(!c) return;
  if(!confirm(`「${c.name}」を削除します。OK？`)) return;
  deleteCampaign(c.id);
  saveState();
  toast("削除");
  location.hash = "#tasks";
});

editCampaignForm?.addEventListener("submit",(e)=>{
  e.preventDefault();
  const c = getCurrentCampaign();
  if(!c) return;

  const fd = new FormData(editCampaignForm);
  const name = (fd.get("name")||"").toString().trim();
  const start_date = (fd.get("start_date")||"").toString().trim();
  const type = normalizeCampaignType((fd.get("type")||"achievement").toString());
  if(!name || !start_date) return;

  c.name = name;
  c.start_date = start_date;
  c.type = type;
  c.rules = editRulesBox ? collectRulesFrom(editRulesBox) : [];
  saveState();
  toast("保存");
  renderAll();
});

function renderCampaignEditForm(c){
  if(!editCampaignForm) return;
  editCampaignForm.elements["name"].value = c.name;
  editCampaignForm.elements["start_date"].value = c.start_date;
  editCampaignForm.elements["type"].value = normalizeCampaignType(c.type);

  if(!editRulesBox) return;
  editRulesBox.innerHTML = "";
  const rules = rulesSorted(c.rules);
  if(rules.length===0) addRuleRow(editRulesBox, "", "");
  else for(const r of rules) addRuleRow(editRulesBox, String(r.threshold), r.reward);
}

function renameListener(campaignId, oldName, newName){
  const oldN = (oldName||"").trim();
  const newN = (newName||"").trim();
  if(!oldN || !newN) return false;
  if(oldN===newN) return true;

  for(const l of state.logs){
    if(l.campaign_id===campaignId && (l.listener_name||"").trim()===oldN) l.listener_name = newN;
  }
  for(const t of state.tasks){
    if(t.campaign_id===campaignId && (t.listener_name||"").trim()===oldN){
      t.listener_name = newN;
      t.updated_at = new Date().toISOString();
    }
  }
  const dm = getDeliveryMap(campaignId);
  if (dm[oldN]) { dm[newN] = dm[oldN]; delete dm[oldN]; }

  const pm = getPurchaseMap(campaignId);
  if (pm[oldN]) { pm[newN] = pm[oldN]; delete pm[oldN]; }

  return true;
}
function deleteListener(campaignId, name){
  const n = (name||"").trim();
  state.logs = state.logs.filter(l=>!(l.campaign_id===campaignId && (l.listener_name||"").trim()===n));
  state.tasks = state.tasks.filter(t=>!(t.campaign_id===campaignId && (t.listener_name||"").trim()===n));
  const dm = getDeliveryMap(campaignId); delete dm[n];
  const pm = getPurchaseMap(campaignId); delete pm[n];
}

function renderRewardCell(campaign, listenerName, points){
  const type = normalizeCampaignType(campaign.type);

  if(type === "achievement"){
    const list = achievedRewards(campaign, points);
    if(list.length === 0) return `<div class="muted">—</div>`;
    return `<div class="shopItems">${
      list.map(x=>`<span class="shopItemChip">${escapeHtml(`${x.cost}pt達成：${x.reward}`)}</span>`).join("")
    }</div>`;
  }

  const rules = rulesSorted(campaign.rules).map(r=>({cost:r.threshold, reward:r.reward}));
  const purchases = getPurchases(campaign.id, listenerName);
  const spent = purchases.reduce((s,x)=> s + (x.cost||0), 0);
  const remaining = points - spent;

  const purchasedChips = purchases.length
    ? `<div class="shopItems">${purchases.map(x=>`<span class="shopItemChip">${escapeHtml(`${x.cost}：${x.reward}`)}</span>`).join("")}</div>`
    : `<div class="muted">—</div>`;

  const buyButtons = rules.length
    ? `<div class="shopBuyList">${
        rules.map(x=>{
          const disabled = remaining < x.cost;
          return `<button class="shopBuyBtn" type="button" data-buy="${escapeHtml(listenerName)}" data-cost="${x.cost}" data-reward="${escapeHtml(x.reward)}" ${disabled?"disabled":""}>${escapeHtml(`${x.cost}：${x.reward}`)}</button>`;
        }).join("")
      }</div>`
    : `<div class="muted">—</div>`;

  return `
    <div class="shopBox">
      <div class="shopRemaining">残pt：${remaining}</div>
      ${purchasedChips}
      ${buyButtons}
      <div class="row gap wrapBtns" style="margin-top:6px;">
        <button class="btn ghost micro" type="button" data-undo-buy="${escapeHtml(listenerName)}">取り消し</button>
      </div>
    </div>
  `;
}

function renderRewardTable(tbodyEl, campaign){
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

          ${editMode ? `
            <div class="row gap wrapBtns" style="margin-top:8px;">
              <button class="btn ghost micro" type="button" data-l-edit="${escapeHtml(r.listener_name)}">編集</button>
              <button class="btn danger micro" type="button" data-l-del="${escapeHtml(r.listener_name)}">削除</button>
            </div>` : ""
          }
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

  tbodyEl.querySelectorAll("[data-buy]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const name = btn.getAttribute("data-buy");
      const cost = parseInt(btn.getAttribute("data-cost"),10);
      const reward = btn.getAttribute("data-reward");
      addPurchase(campaign, name, cost, reward);
      toast("購入");
      renderAll();
    });
  });
  tbodyEl.querySelectorAll("[data-undo-buy]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const name = btn.getAttribute("data-undo-buy");
      const ok = undoPurchase(campaign, name);
      toast(ok ? "取り消し" : "なし");
      renderAll();
    });
  });

  if(editMode){
    tbodyEl.querySelectorAll("[data-l-edit]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const oldName = btn.getAttribute("data-l-edit");
        const newName = prompt(`リスナー名を変更`, oldName);
        if(newName===null) return;
        if(!newName.trim()) return;
        renameListener(campaign.id, oldName, newName.trim());
        saveState();
        renderAll();
        toast("変更");
      });
    });
    tbodyEl.querySelectorAll("[data-l-del]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const name = btn.getAttribute("data-l-del");
        if(!confirm(`削除しますか？`)) return;
        deleteListener(campaign.id, name);
        saveState();
        renderAll();
        toast("削除");
      });
    });
  }
}

/* task CRUD */
createTaskFormEl?.addEventListener("submit",(e)=>{
  e.preventDefault();
  const c = getCurrentCampaign();
  if(!c) return;

  const fd = new FormData(createTaskFormEl);
  const listener_name = (fd.get("listener_name")||"").toString().trim();
  const title = (fd.get("title")||"").toString().trim();
  const status = (fd.get("status")||"todo").toString();
  if(!listener_name || !title) return;

  state.tasks.unshift({
    id: uid(),
    campaign_id: c.id,
    listener_name,
    title,
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  saveState();
  createTaskFormEl.reset();
  renderAll();
  toast("追加");
});

function renderTaskListForCampaign(c){
  if(!taskListEl) return;
  const tasks = state.tasks.filter(t=>t.campaign_id===c.id);

  if(!tasks.length){
    taskListEl.innerHTML = "";
    return;
  }

  taskListEl.innerHTML = tasks.map(t=>{
    const created = byISODateOnly(t.created_at);
    const isDone = t.status==="done";
    return `
      <div class="taskItem">
        <div class="taskTop">
          <div>
            <div class="taskTitle">${escapeHtml(t.title)}</div>
            <div class="taskMeta">${escapeHtml(t.listener_name)} / ${created}</div>
          </div>
          <div class="taskBtns">
            ${editMode ? `
              ${isDone
                ? `<button class="btn ghost small" type="button" data-undone="${t.id}">戻す</button>`
                : `<button class="btn primary small" type="button" data-done="${t.id}">完了</button>`
              }
              <button class="btn ghost small" type="button" data-edit="${t.id}">編集</button>
              <button class="btn danger small" type="button" data-del="${t.id}">削除</button>
            ` : ``}
          </div>
        </div>
      </div>
    `;
  }).join("");

  if(!editMode) return;

  taskListEl.querySelectorAll("[data-done]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const t = state.tasks.find(x=>x.id===btn.getAttribute("data-done"));
      if(!t) return;
      t.status="done"; t.updated_at=new Date().toISOString();
      saveState(); renderAll(); toast("完了");
    });
  });
  taskListEl.querySelectorAll("[data-undone]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const t = state.tasks.find(x=>x.id===btn.getAttribute("data-undone"));
      if(!t) return;
      t.status="todo"; t.updated_at=new Date().toISOString();
      saveState(); renderAll(); toast("戻す");
    });
  });
  taskListEl.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const t = state.tasks.find(x=>x.id===btn.getAttribute("data-edit"));
      if(!t) return;
      const newTitle = prompt("内容", t.title);
      if(newTitle===null || !newTitle.trim()) return;
      const newListener = prompt("リスナー", t.listener_name);
      if(newListener===null || !newListener.trim()) return;
      t.title=newTitle.trim();
      t.listener_name=newListener.trim();
      t.updated_at=new Date().toISOString();
      saveState(); renderAll(); toast("編集");
    });
  });
  taskListEl.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-del");
      if(!confirm("削除しますか？")) return;
      state.tasks = state.tasks.filter(x=>x.id!==id);
      saveState(); renderAll(); toast("削除");
    });
  });
}

function renderCampaignConfirm(){
  const c = getCurrentCampaign();
  if(!c){ location.hash="#tasks"; return; }

  const done = isCampaignDone(c);
  const statusLabel = done ? "完了" : "未完了";

  if(campaignTitleEl) campaignTitleEl.textContent = c.name;
  if(campaignMetaEl) campaignMetaEl.textContent = `${c.start_date}`;
  if(campaignStatusPill) campaignStatusPill.textContent = statusLabel;
  if(goLiveBtn) goLiveBtn.href = `#live=${c.id}`;

  if(!editMode){
    if(campaignEditPanel) campaignEditPanel.classList.add("hidden");
    if(createTaskFormEl) createTaskFormEl.classList.add("hidden");
  }

  renderCampaignEditForm(c);
  renderRewardTable(leaderboardBody, c);
  renderTaskListForCampaign(c);
}

/* LIVE */
const liveTitle = document.getElementById("liveTitle");
const liveMeta = document.getElementById("liveMeta");
const goConfirmBtn = document.getElementById("goConfirmBtn");
const goTaskEditBtn = document.getElementById("goTaskEditBtn");
const liveLeaderboardBody = document.getElementById("liveLeaderboardBody");
const rewardListBox = document.getElementById("rewardListBox");

const listenerNameInput = document.getElementById("listenerName");
const customPointsInput = document.getElementById("customPoints");
const liveMsg = document.getElementById("liveMsg");
function setLiveMsg(msg){ if(liveMsg) liveMsg.textContent = msg || ""; }

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

function addLog(delta){
  const c = getCurrentCampaign();
  if(!c) return;
  const name = (listenerNameInput?.value||"").trim();
  if(!name) return;

  state.logs.push({
    id: uid(),
    campaign_id: c.id,
    listener_name: name,
    delta_points: delta,
    created_at: new Date().toISOString(),
  });
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

function renderRewardList(c){
  if(!rewardListBox) return;
  const rules = rulesSorted(c.rules);
  if(!rules.length){
    rewardListBox.innerHTML = `<div class="muted">返礼品なし</div>`;
    return;
  }
  const type = normalizeCampaignType(c.type);
  rewardListBox.innerHTML = rules.map(r=>{
    const label = (type==="achievement")
      ? `${r.threshold}pt達成：${escapeHtml(r.reward)}`
      : `${r.threshold}：${escapeHtml(r.reward)}`;
    return `<div class="rewardChip">${label}</div>`;
  }).join("");
}

function renderLive(){
  const c = getCurrentCampaign();
  if(!c){ location.hash="#tasks"; return; }

  const done = isCampaignDone(c);
  const statusLabel = done ? "完了" : "未完了";

  if(liveTitle) liveTitle.textContent = c.name;
  if(liveMeta) liveMeta.textContent = `${c.start_date} / ${statusLabel}`;
  if(goConfirmBtn) goConfirmBtn.href = `#campaign=${c.id}`;
  if(goTaskEditBtn) goTaskEditBtn.href = `#campaign=${c.id}`;

  renderRewardList(c);
  renderRewardTable(liveLeaderboardBody, c);
  setLiveMsg("");
}

/* Backup/Restore */
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
      tasks: Array.isArray(obj.tasks) ? obj.tasks : [],
      delivery: (obj.delivery && typeof obj.delivery === "object") ? obj.delivery : {},
      purchases: (obj.purchases && typeof obj.purchases === "object") ? obj.purchases : {},
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

/* render */
function renderAll(){
  renderHome();
  renderCampaigns();
  if((location.hash||"").startsWith("#tasks")) renderTaskCampaignList();
  if((location.hash||"").startsWith("#campaign=")) renderCampaignConfirm();
  if((location.hash||"").startsWith("#live=")) renderLive();
}

/* init */
route();
renderAll();
