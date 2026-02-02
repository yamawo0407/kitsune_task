"use strict";

/* ===== JSロード確認 ===== */
const jsStatus = document.getElementById("jsStatus");
if (jsStatus) jsStatus.textContent = "JS: OK";

/* ========= State ========= */
const STORAGE_KEY = "reward_task_manager_v8";

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
      delivery: (s.delivery && typeof s.delivery === "object") ? s.delivery : {}, // {campaignId:{listenerName:"done"|"open"}}
    };
  }catch{
    return { campaigns: [], logs: [], tasks: [], delivery: {} };
  }
}
let state = loadState();
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

/* ===== migrate older data ===== */
function normalizeCampaignType(t){
  return (t === "shopping" || t === "achievement") ? t : "achievement";
}
function migrate(){
  state.campaigns.forEach(c=>{
    c.type = normalizeCampaignType(c.type);
    if (typeof c.is_closed !== "boolean") c.is_closed = false; // v8: 企画の完了/未完了
  });
  if (!state.delivery || typeof state.delivery !== "object") state.delivery = {};
}
migrate();
saveState();

/* ========= Toast ========= */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg){
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toastEl.classList.add("hidden"), 1400);
}

/* ========= Views ========= */
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

/* ========= Hash parse ========= */
function parseHashParts(){
  const raw = (location.hash || "#home").slice(1);
  const [path, queryStr] = raw.split("?");
  const params = new URLSearchParams(queryStr || "");
  return { path: path || "home", params };
}

/* ========= Reward helpers ========= */
function rulesSorted(rules){
  return (Array.isArray(rules) ? rules : [])
    .filter(r => Number.isFinite(r.threshold) && (r.reward||"").trim())
    .slice()
    .sort((a,b)=>a.threshold-b.threshold);
}
function getRewardHit(rules, points){
  const sorted = rulesSorted(rules);
  let hit = { reward: "", threshold: null };
  for(const r of sorted){
    if(points >= r.threshold) hit = { reward: r.reward, threshold: r.threshold };
    else break;
  }
  return hit;
}
function formatReward(campaign, points){
  const type = normalizeCampaignType(campaign.type);
  const hit = getRewardHit(campaign.rules, points);
  if(!hit.reward) return "—";
  if(type === "achievement" && hit.threshold != null){
    return `${hit.threshold}pt達成：${hit.reward}`;
  }
  return hit.reward;
}

/* ========= Totals ========= */
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

/* ========= Delivery (per listener) ========= */
function getDeliveryMap(campaignId){
  if (!state.delivery[campaignId] || typeof state.delivery[campaignId] !== "object") {
    state.delivery[campaignId] = {};
  }
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

/* ========= Routing ========= */
let currentCampaignId = null;
let taskPageFilter = "open"; // open/done/all
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
    renderTasksTop();
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

/* ========= Home ========= */
const statCampaigns = document.getElementById("statCampaigns");
const statTasksOpen = document.getElementById("statTasksOpen");
const statTasksDone = document.getElementById("statTasksDone");
const overallPill = document.getElementById("overallPill");

function renderHome(){
  const all = state.campaigns.length;
  const open = state.campaigns.filter(c=>!c.is_closed).length;
  const done = state.campaigns.filter(c=>c.is_closed).length;

  if(statCampaigns) statCampaigns.textContent = String(all);
  if(statTasksOpen) statTasksOpen.textContent = String(open);
  if(statTasksDone) statTasksDone.textContent = String(done);
  if(overallPill) overallPill.textContent = open>0 ? `未完了企画 ${open}` : "未完了なし";
}

/* ========= Rules UI ========= */
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

/* ========= Campaign create ========= */
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
    is_closed: false,          // デフォルト未完了
    created_at: new Date().toISOString(),
  });

  saveState();
  createCampaignForm.reset();
  renderAll();
  toast("企画を作成");
});

/* ========= Campaign list (campaigns page) ========= */
const campaignListEl = document.getElementById("campaignList");
const campaignSearchEl = document.getElementById("campaignSearch");
campaignSearchEl?.addEventListener("input", renderCampaigns);

function renderCampaigns(){
  if(!campaignListEl) return;
  const q = (campaignSearchEl?.value||"").trim().toLowerCase();
  const list = state.campaigns.filter(c => (c.name||"").toLowerCase().includes(q));

  if(!list.length){
    campaignListEl.innerHTML = `<div class="muted">企画がありません。</div>`;
    return;
  }

  campaignListEl.innerHTML = list.map(c=>{
    const typeLabel = normalizeCampaignType(c.type)==="achievement" ? "達成型" : "お買い物方式";
    const statusLabel = c.is_closed ? "完了" : "未完了";
    const statusBadge = c.is_closed ? "✅" : "🔴";
    const rulesSummary = rulesSorted(c.rules).slice(0,2).map(r=>{
      return normalizeCampaignType(c.type)==="achievement"
        ? `${r.threshold}pt達成→${escapeHtml(r.reward)}`
        : `${r.threshold}→${escapeHtml(r.reward)}`;
    }).join(" / ");

    return `
      <div class="item">
        <div>
          <div>
            <strong>${escapeHtml(c.name)}</strong>
            <span class="badge">${escapeHtml(c.start_date)}</span>
            <span class="badge">${typeLabel}</span>
            <span class="badge">${statusLabel}</span>
          </div>
          <div class="muted">返礼品: ${rulesSummary || "—"}</div>
        </div>
        <div class="itemActions">
          <button class="btn ghost small" type="button" data-open="${c.id}">確認</button>
          <button class="btn ghost small" type="button" data-live="${c.id}">リアルタイム</button>
          <button class="btn danger tiny" type="button" data-del="${c.id}">削除</button>
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
      if(!confirm(`「${c.name}」を削除します。ログ/タスクも消えます。OK？`)) return;
      deleteCampaign(id);
      saveState();
      renderAll();
      toast("削除");
    });
  });
}

/* ========= Tasks Top ========= */
const taskCampaignListEl = document.getElementById("taskCampaignList");
const tasksCampaignSearchEl = document.getElementById("tasksCampaignSearch");
const filterOpenBtn = document.getElementById("filterOpenCampaigns");
const filterDoneBtn = document.getElementById("filterDoneCampaigns");
const filterAllBtn = document.getElementById("filterAllCampaigns");

tasksCampaignSearchEl?.addEventListener("input", renderTaskCampaignList);
filterOpenBtn?.addEventListener("click", ()=>{ taskPageFilter="open"; renderTaskCampaignList(); });
filterDoneBtn?.addEventListener("click", ()=>{ taskPageFilter="done"; renderTaskCampaignList(); });
filterAllBtn?.addEventListener("click", ()=>{ taskPageFilter="all"; renderTaskCampaignList(); });

function renderTasksTop(){
  // ハッシュで指定された filter を尊重
  renderGlobalTaskSearchResults();
  renderTaskCampaignList();
}

function filterCampaignsByListMode(list, campaigns){
  if(list==="open") return campaigns.filter(c=>!c.is_closed);
  if(list==="done") return campaigns.filter(c=>c.is_closed);
  return campaigns;
}

function renderTaskCampaignList(){
  if(!taskCampaignListEl) return;

  const q = (tasksCampaignSearchEl?.value||"").trim().toLowerCase();
  let list = state.campaigns.filter(c => (c.name||"").toLowerCase().includes(q));
  list = filterCampaignsByListMode(taskPageFilter, list);

  if(!list.length){
    taskCampaignListEl.innerHTML = `<div class="muted">該当する企画がありません。</div>`;
    return;
  }

  taskCampaignListEl.innerHTML = list.map(c=>{
    const typeLabel = normalizeCampaignType(c.type)==="achievement" ? "達成型" : "お買い物方式";
    const statusBadge = c.is_closed ? "✅" : "🔴";
    const statusLabel = c.is_closed ? "完了" : "未完了";

    return `
      <div class="item itemClickable" data-open="${c.id}">
        <div>
          <div>
            <strong>${escapeHtml(c.name)}</strong>
            <span class="badge">${escapeHtml(c.start_date)}</span>
            <span class="badge">${typeLabel}</span>
            <span class="badge">${statusLabel}</span>
          </div>
          <div class="muted">枠タップで確認（編集は中の「編集」ボタン）</div>
        </div>
        <div class="itemActions">
          <button class="btn ghost small" type="button" data-live="${c.id}">リアルタイム編集</button>
          <div style="font-size:18px;">${statusBadge}</div>
        </div>
      </div>
    `;
  }).join("");

  taskCampaignListEl.querySelectorAll(".itemClickable").forEach(el=>{
    el.addEventListener("click",(e)=>{
      if(e.target.closest("button")) return;
      location.hash = `#campaign=${el.getAttribute("data-open")}`;
    });
  });
  taskCampaignListEl.querySelectorAll("[data-live]").forEach(btn=>{
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      location.hash = `#live=${btn.getAttribute("data-live")}`;
    });
  });
}

/* ========= Global task search ========= */
const globalTaskListener = document.getElementById("globalTaskListener");
const globalTaskFrom = document.getElementById("globalTaskFrom");
const globalTaskTo = document.getElementById("globalTaskTo");
const globalTaskStatus = document.getElementById("globalTaskStatus");
const clearGlobalTaskSearch = document.getElementById("clearGlobalTaskSearch");
const globalTaskResults = document.getElementById("globalTaskResults");

function matchesDateRange(taskISO, from, to){
  const d = byISODateOnly(taskISO);
  if(from && d < from) return false;
  if(to && d > to) return false;
  return true;
}

[globalTaskListener, globalTaskFrom, globalTaskTo, globalTaskStatus].forEach(el=>{
  el?.addEventListener("input", renderGlobalTaskSearchResults);
  el?.addEventListener("change", renderGlobalTaskSearchResults);
});
clearGlobalTaskSearch?.addEventListener("click", ()=>{
  if(globalTaskListener) globalTaskListener.value = "";
  if(globalTaskFrom) globalTaskFrom.value = "";
  if(globalTaskTo) globalTaskTo.value = "";
  if(globalTaskStatus) globalTaskStatus.value = "open";
  renderGlobalTaskSearchResults();
});

function renderGlobalTaskSearchResults(){
  if(!globalTaskResults) return;

  const q = (globalTaskListener?.value||"").trim().toLowerCase();
  const from = (globalTaskFrom?.value||"").trim();
  const to = (globalTaskTo?.value||"").trim();
  const status = (globalTaskStatus?.value||"open").trim();

  const tasks = state.tasks.filter(t=>{
    if(q && !(t.listener_name||"").toLowerCase().includes(q)) return false;
    if(!matchesDateRange(t.created_at, from, to)) return false;
    if(status==="open" && t.status==="done") return false;
    if(status==="done" && t.status!=="done") return false;
    return true;
  }).slice(0, 60);

  if(!tasks.length){
    globalTaskResults.innerHTML = `<div class="muted">該当タスクなし</div>`;
    return;
  }

  globalTaskResults.innerHTML = tasks.map(t=>{
    const c = state.campaigns.find(x=>x.id===t.campaign_id);
    const cname = c ? c.name : "（削除済み企画）";
    const created = byISODateOnly(t.created_at);
    const link = c ? `#campaign=${c.id}` : "#tasks";
    return `
      <div class="taskItem">
        <div class="taskTop">
          <div>
            <div class="taskTitle">${escapeHtml(t.title)}</div>
            <div class="taskMeta">${escapeHtml(t.listener_name)} / ${created} / 状態：${escapeHtml(t.status)} / 企画：${escapeHtml(cname)}</div>
          </div>
          <div class="taskBtns">
            ${c ? `<a class="btn ghost small" href="${link}">確認へ</a>
                   <a class="btn ghost small" href="#live=${c.id}">リアルタイム</a>` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

/* ========= Campaign Confirm ========= */
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
const createTaskForm = document.getElementById("createTaskForm");
const taskListEl = document.getElementById("taskList");
const taskEditHint = document.getElementById("taskEditHint");

function getCurrentCampaign(){
  return state.campaigns.find(c=>c.id===currentCampaignId) || null;
}
function deleteCampaign(campaignId){
  state.campaigns = state.campaigns.filter(x=>x.id!==campaignId);
  state.logs = state.logs.filter(x=>x.campaign_id!==campaignId);
  state.tasks = state.tasks.filter(x=>x.campaign_id!==campaignId);
  delete state.delivery[campaignId];
}

function setEditMode(on){
  editMode = !!on;
  if(campaignEditPanel) campaignEditPanel.classList.toggle("hidden", !editMode);
  if(createTaskForm) createTaskForm.classList.toggle("hidden", !editMode);
  if(taskEditHint) taskEditHint.classList.toggle("hidden", editMode);
  if(toggleEditModeBtn) toggleEditModeBtn.textContent = editMode ? "編集を閉じる" : "編集";
  renderAll();
}

toggleEditModeBtn?.addEventListener("click", ()=> setEditMode(!editMode));
closeEditCampaignBtn?.addEventListener("click", ()=> setEditMode(false));
editAddRuleRowBtn?.addEventListener("click", ()=> editRulesBox && addRuleRow(editRulesBox, "", ""));

deleteCampaignBtn?.addEventListener("click", ()=>{
  const c = getCurrentCampaign();
  if(!c) return;
  if(!confirm(`「${c.name}」を削除します。ログ/タスクも消えます。OK？`)) return;
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

/* listener rename/delete affects tasks+logs */
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
  return true;
}
function deleteListener(campaignId, name){
  const n = (name||"").trim();
  state.logs = state.logs.filter(l=>!(l.campaign_id===campaignId && (l.listener_name||"").trim()===n));
  state.tasks = state.tasks.filter(t=>!(t.campaign_id===campaignId && (t.listener_name||"").trim()===n));
  const dm = getDeliveryMap(campaignId);
  delete dm[n];
}

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

/* ===== 返礼品状況テーブル ===== */
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
        <td class="center">${escapeHtml(formatReward(campaign, r.points))}</td>
        <td>
          <select class="input" data-delivery="${escapeHtml(r.listener_name)}">
            <option value="open" ${status==="open"?"selected":""}>未完了</option>
            <option value="done" ${status==="done"?"selected":""}>完了</option>
          </select>
          ${editMode ? `
            <div class="row gap wrapBtns" style="margin-top:8px;">
              <button class="btn ghost tiny" type="button" data-l-edit="${escapeHtml(r.listener_name)}">編集</button>
              <button class="btn danger tiny" type="button" data-l-del="${escapeHtml(r.listener_name)}">削除</button>
            </div>` : ""
          }
        </td>
      </tr>
    `;
  }).join("");

  // 状況：常に変更可能
  tbodyEl.querySelectorAll("[data-delivery]").forEach(sel=>{
    sel.addEventListener("change", ()=>{
      const name = sel.getAttribute("data-delivery");
      setDeliveryStatus(campaign.id, name, sel.value);
      toast("更新");
    });
  });

  // 編集モード時のみ listener rename/delete
  if(editMode){
    tbodyEl.querySelectorAll("[data-l-edit]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const oldName = btn.getAttribute("data-l-edit");
        const newName = prompt(`リスナー名を変更\n「${oldName}」→`, oldName);
        if(newName===null) return;
        if(!newName.trim()) return alert("空は不可");
        renameListener(campaign.id, oldName, newName.trim());
        saveState();
        renderAll();
        toast("変更");
      });
    });
    tbodyEl.querySelectorAll("[data-l-del]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const name = btn.getAttribute("data-l-del");
        if(!confirm(`リスナー「${name}」を削除します。\nこの企画のログとタスクも消えます。OK？`)) return;
        deleteListener(campaign.id, name);
        saveState();
        renderAll();
        toast("削除");
      });
    });
  }
}

/* ===== タスク CRUD（編集モード時のみ編集ボタンを出す） ===== */
createTaskForm?.addEventListener("submit",(e)=>{
  e.preventDefault();
  const c = getCurrentCampaign();
  if(!c) return;

  const fd = new FormData(createTaskForm);
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
  createTaskForm.reset();
  renderAll();
  toast("タスク追加");
});

function renderTaskListForCampaign(c){
  if(!taskListEl) return;
  const tasks = state.tasks.filter(t=>t.campaign_id===c.id);

  if(!tasks.length){
    taskListEl.innerHTML = `<div class="muted">タスクなし</div>`;
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
            <div class="taskMeta">${escapeHtml(t.listener_name)} / ${created} / 状態：${escapeHtml(t.status)}</div>
          </div>
          <div class="taskBtns">
            ${editMode ? `
              ${isDone
                ? `<button class="btn ghost small" type="button" data-undone="${t.id}">未完了に戻す</button>`
                : `<button class="btn primary small" type="button" data-done="${t.id}">完了</button>`
              }
              <button class="btn ghost small" type="button" data-edit="${t.id}">編集</button>
              <button class="btn danger small" type="button" data-del="${t.id}">削除</button>
            ` : `<div class="muted">（閲覧）</div>`}
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
      saveState(); renderAll(); toast("未完了");
    });
  });
  taskListEl.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const t = state.tasks.find(x=>x.id===btn.getAttribute("data-edit"));
      if(!t) return;

      const newTitle = prompt("タスク内容を編集", t.title);
      if(newTitle===null) return;
      if(!newTitle.trim()) return alert("空は不可");

      const newListener = prompt("リスナー名を編集", t.listener_name);
      if(newListener===null) return;
      if(!newListener.trim()) return alert("空は不可");

      t.title=newTitle.trim();
      t.listener_name=newListener.trim();
      t.updated_at=new Date().toISOString();
      saveState(); renderAll(); toast("編集");
    });
  });
  taskListEl.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-del");
      if(!confirm("このタスクを削除しますか？")) return;
      state.tasks = state.tasks.filter(x=>x.id!==id);
      saveState(); renderAll(); toast("削除");
    });
  });
}

function renderCampaignConfirm(){
  const c = getCurrentCampaign();
  if(!c){ location.hash="#tasks"; return; }

  const typeLabel = normalizeCampaignType(c.type)==="achievement" ? "達成型" : "お買い物方式";
  const statusLabel = c.is_closed ? "完了" : "未完了";

  if(campaignTitleEl) campaignTitleEl.textContent = c.name;
  if(campaignMetaEl) campaignMetaEl.textContent = `開始日：${c.start_date} / 方式：${typeLabel} / 状態：${statusLabel}`;
  if(campaignStatusPill) campaignStatusPill.textContent = statusLabel;

  if(goLiveBtn) goLiveBtn.href = `#live=${c.id}`;

  // 編集UI
  if(!editMode){
    if(campaignEditPanel) campaignEditPanel.classList.add("hidden");
    if(createTaskForm) createTaskForm.classList.add("hidden");
    if(taskEditHint) taskEditHint.classList.remove("hidden");
  }else{
    if(taskEditHint) taskEditHint.classList.add("hidden");
  }

  renderCampaignEditForm(c);
  renderRewardTable(leaderboardBody, c);
  renderTaskListForCampaign(c);
}

/* ========= Live ========= */
const liveTitle = document.getElementById("liveTitle");
const liveMeta = document.getElementById("liveMeta");
const goConfirmBtn = document.getElementById("goConfirmBtn");
const goTaskEditBtn = document.getElementById("goTaskEditBtn");
const liveLeaderboardBody = document.getElementById("liveLeaderboardBody");
const rewardListBox = document.getElementById("rewardListBox");
const endCampaignBtn = document.getElementById("endCampaignBtn");

const listenerNameInput = document.getElementById("listenerName");
const customPointsInput = document.getElementById("customPoints");
const liveMsg = document.getElementById("liveMsg");
function setLiveMsg(msg){ if(liveMsg) liveMsg.textContent = msg || ""; }

document.querySelectorAll("[data-add]").forEach(btn=>{
  btn.addEventListener("click", ()=> addLog(parseInt(btn.getAttribute("data-add"),10)));
});
document.getElementById("addCustomBtn")?.addEventListener("click", ()=>{
  const v = parseInt(customPointsInput.value,10);
  if(!v) return setLiveMsg("任意ptを入れて。");
  addLog(v);
  customPointsInput.value = "";
});
document.getElementById("subtractBtn")?.addEventListener("click", ()=>{
  const v = parseInt(customPointsInput.value,10);
  if(!v) return setLiveMsg("減算したいpt（正の数）を入れて。");
  addLog(-Math.abs(v));
  customPointsInput.value = "";
});
document.getElementById("undoBtn")?.addEventListener("click", ()=> undoLastLog());

function addLog(delta){
  const c = getCurrentCampaign();
  if(!c) return;
  const name = (listenerNameInput?.value||"").trim();
  if(!name) return setLiveMsg("リスナー名を入力して。");

  state.logs.push({
    id: uid(),
    campaign_id: c.id,
    listener_name: name,
    delta_points: delta,
    created_at: new Date().toISOString(),
  });
  saveState();
  renderAll();
  setLiveMsg(`${delta>0?"+":""}${delta} を ${name} に反映`);
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
      toast("もどした");
      setLiveMsg("直近1件を取り消し");
      return;
    }
  }
  setLiveMsg("取り消すログがありません。");
}

function renderRewardList(c){
  if(!rewardListBox) return;
  const rules = rulesSorted(c.rules);
  if(!rules.length){
    rewardListBox.innerHTML = `<div class="muted">返礼品が未設定です。</div>`;
    return;
  }
  rewardListBox.innerHTML = rules.map(r=>{
    const label = normalizeCampaignType(c.type)==="achievement"
      ? `${r.threshold}pt達成：${escapeHtml(r.reward)}`
      : `${r.threshold}：${escapeHtml(r.reward)}`;
    return `<div class="rewardChip">${label}</div>`;
  }).join("");
}

endCampaignBtn?.addEventListener("click", ()=>{
  const c = getCurrentCampaign();
  if(!c) return;
  if(c.is_closed) return toast("すでに完了です");
  if(!confirm("この企画を「完了」にします。OK？")) return;
  c.is_closed = true;
  saveState();
  toast("企画を完了");
  location.hash = `#campaign=${c.id}`;
  // 確認ページで編集モードに入りたいならここを true にできる
  // editMode = true;
});

function renderLive(){
  const c = getCurrentCampaign();
  if(!c){ location.hash="#tasks"; return; }

  const typeLabel = normalizeCampaignType(c.type)==="achievement" ? "達成型" : "お買い物方式";
  const statusLabel = c.is_closed ? "完了" : "未完了";

  if(liveTitle) liveTitle.textContent = c.name;
  if(liveMeta) liveMeta.textContent = `開始日：${c.start_date} / 方式：${typeLabel} / 状態：${statusLabel}`;
  if(goConfirmBtn) goConfirmBtn.href = `#campaign=${c.id}`;
  if(goTaskEditBtn) goTaskEditBtn.href = `#campaign=${c.id}`;

  renderRewardList(c);
  renderRewardTable(liveLeaderboardBody, c);
  setLiveMsg("");
}

/* ========= Backup / Restore ========= */
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

/* ========= Global render ========= */
function renderAll(){
  renderHome();
  renderCampaigns();
  if((location.hash||"").startsWith("#tasks")) {
    renderGlobalTaskSearchResults();
    renderTaskCampaignList();
  }
  if((location.hash||"").startsWith("#campaign=")) renderCampaignConfirm();
  if((location.hash||"").startsWith("#live=")) renderLive();
}

/* ========= Init ========= */
route();
renderAll();
