"use strict";

/* ===== JSロード確認 ===== */
const jsStatus = document.getElementById("jsStatus");
if (jsStatus) jsStatus.textContent = "JS: OK";

/* ========= State ========= */
const STORAGE_KEY = "reward_task_manager_v7";

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
    };
  }catch{
    return { campaigns: [], logs: [], tasks: [] };
  }
}
let state = loadState();
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

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
  campaign: document.getElementById("view-campaign"),  // 確認（タスク）
  live: document.getElementById("view-live"),          // リアルタイム編集
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

/* ========= Hash parse (#tasks?status=open 等) ========= */
function parseHashParts(){
  const raw = (location.hash || "#home").slice(1);
  const [path, queryStr] = raw.split("?");
  const params = new URLSearchParams(queryStr || "");
  return { path: path || "home", params };
}

/* ========= Reward helpers ========= */
function normalizeCampaignType(t){
  return (t === "shopping" || t === "achievement") ? t : "achievement";
}
function rulesSorted(rules){
  return (Array.isArray(rules) ? rules : [])
    .filter(r => Number.isFinite(r.threshold) && (r.reward||"").trim())
    .slice()
    .sort((a,b)=>a.threshold-b.threshold);
}
/** returns { reward: string, threshold: number|null } */
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
  return hit.reward; // shopping
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
function incompleteCountByCampaign(campaignId){
  return state.tasks.filter(t => t.campaign_id===campaignId && t.status!=="done").length;
}

/* ========= Routing ========= */
let currentCampaignId = null;
let taskPageFilter = "open";     // open/all
let globalStatusFromHash = "open"; // open/done/all

function route(){
  const { path, params } = parseHashParts();

  if(path.startsWith("campaign=")){
    const id = path.split("=")[1];
    if(id && state.campaigns.some(c=>c.id===id)){
      currentCampaignId = id;
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
    const status = (params.get("status") || "").toLowerCase();
    globalStatusFromHash = (status==="done"||status==="all"||status==="open") ? status : "open";
    // ハッシュ指定があるときは検索のstatusも合わせる
    const statusSel = document.getElementById("globalTaskStatus");
    if(statusSel) statusSel.value = globalStatusFromHash;
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
  const open = state.tasks.filter(t=>t.status!=="done").length;
  const done = state.tasks.filter(t=>t.status==="done").length;

  if(statCampaigns) statCampaigns.textContent = String(state.campaigns.length);
  if(statTasksOpen) statTasksOpen.textContent = String(open);
  if(statTasksDone) statTasksDone.textContent = String(done);
  if(overallPill) overallPill.textContent = open>0 ? `未完了 ${open}` : "未完了なし";
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
    const open = incompleteCountByCampaign(c.id);
    const icon = open>0 ? "🔴" : "✅";
    const typeLabel = normalizeCampaignType(c.type)==="achievement" ? "達成型" : "お買い物方式";
    const rulesSummary = rulesSorted(c.rules).slice(0,2).map(r=>{
      return normalizeCampaignType(c.type)==="achievement"
        ? `${r.threshold}pt達成→${escapeHtml(r.reward)}`
        : `${r.threshold}→${escapeHtml(r.reward)}`;
    }).join(" / ");

    return `
      <div class="item">
        <div>
          <div><strong>${escapeHtml(c.name)}</strong><span class="badge">${escapeHtml(c.start_date)}</span><span class="badge">${typeLabel}</span></div>
          <div class="muted">未完了 ${open} · 返礼品: ${rulesSummary || "—"}</div>
        </div>
        <div class="itemActions">
          <button class="btn ghost small" type="button" data-c-open="${c.id}">確認</button>
          <button class="btn ghost small" type="button" data-c-live="${c.id}">リアルタイム</button>
          <button class="btn danger small" type="button" data-c-del="${c.id}">削除</button>
          <div style="font-size:18px;">${icon}</div>
        </div>
      </div>
    `;
  }).join("");

  campaignListEl.querySelectorAll("[data-c-open]").forEach(btn=>{
    btn.addEventListener("click",()=> location.hash = `#campaign=${btn.getAttribute("data-c-open")}`);
  });
  campaignListEl.querySelectorAll("[data-c-live]").forEach(btn=>{
    btn.addEventListener("click",()=> location.hash = `#live=${btn.getAttribute("data-c-live")}`);
  });
  campaignListEl.querySelectorAll("[data-c-del]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const id = btn.getAttribute("data-c-del");
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

/* ========= Tasks top ========= */
const taskCampaignListEl = document.getElementById("taskCampaignList");
const tasksCampaignSearchEl = document.getElementById("tasksCampaignSearch");
const filterOpenCampaignsBtn = document.getElementById("filterOpenCampaigns");
const filterAllCampaignsBtn = document.getElementById("filterAllCampaigns");

tasksCampaignSearchEl?.addEventListener("input", renderTaskCampaignList);
filterOpenCampaignsBtn?.addEventListener("click", ()=>{ taskPageFilter="open"; renderTaskCampaignList(); });
filterAllCampaignsBtn?.addEventListener("click", ()=>{ taskPageFilter="all"; renderTaskCampaignList(); });

function renderTasksTop(){
  // default: 未完了あり
  taskPageFilter = "open";
  renderGlobalTaskSearchResults();
  renderTaskCampaignList();
}

function renderTaskCampaignList(){
  if(!taskCampaignListEl) return;

  const q = (tasksCampaignSearchEl?.value||"").trim().toLowerCase();
  let list = state.campaigns.filter(c => (c.name||"").toLowerCase().includes(q));

  if(taskPageFilter==="open"){
    list = list.filter(c => incompleteCountByCampaign(c.id) > 0);
  }

  if(!list.length){
    taskCampaignListEl.innerHTML = `<div class="muted">該当する企画がありません。</div>`;
    return;
  }

  taskCampaignListEl.innerHTML = list.map(c=>{
    const open = incompleteCountByCampaign(c.id);
    const icon = open>0 ? "🔴" : "✅";
    const typeLabel = normalizeCampaignType(c.type)==="achievement" ? "達成型" : "お買い物方式";

    return `
      <div class="item itemClickable" data-open="${c.id}">
        <div>
          <div><strong>${escapeHtml(c.name)}</strong><span class="badge">${escapeHtml(c.start_date)}</span><span class="badge">${typeLabel}</span></div>
          <div class="muted">未完了 ${open}</div>
        </div>
        <div class="itemActions">
          <button class="btn ghost small" type="button" data-live="${c.id}">リアルタイム編集</button>
          <div style="font-size:18px;">${icon}</div>
        </div>
      </div>
    `;
  }).join("");

  // 枠全体タップで確認へ（ボタン押下は除外）
  taskCampaignListEl.querySelectorAll(".itemClickable").forEach(el=>{
    el.addEventListener("click",(e)=>{
      const isButton = (e.target.closest("button") != null);
      if(isButton) return;
      const id = el.getAttribute("data-open");
      location.hash = `#campaign=${id}`;
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
function isOpenStatus(s){ return s !== "done"; }

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
    if(status==="open" && !isOpenStatus(t.status)) return false;
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

/* ========= Campaign Confirm (tasks page) ========= */
const campaignTitleEl = document.getElementById("campaignTitle");
const campaignMetaEl = document.getElementById("campaignMeta");
const campaignStatusPill = document.getElementById("campaignStatusPill");
const goLiveBtn = document.getElementById("goLiveBtn");

const deleteCampaignBtn = document.getElementById("deleteCampaignBtn");
const toggleEditCampaignBtn = document.getElementById("toggleEditCampaignBtn");
const campaignEditPanel = document.getElementById("campaignEditPanel");
const editCampaignForm = document.getElementById("editCampaignForm");
const closeEditCampaignBtn = document.getElementById("closeEditCampaignBtn");
const editRulesBox = document.getElementById("editRulesBox");
const editAddRuleRowBtn = document.getElementById("editAddRuleRowBtn");

const leaderboardBody = document.getElementById("leaderboardBody");
const createTaskForm = document.getElementById("createTaskForm");
const taskListEl = document.getElementById("taskList");

function getCurrentCampaign(){ return state.campaigns.find(c=>c.id===currentCampaignId) || null; }

function deleteCampaign(campaignId){
  state.campaigns = state.campaigns.filter(x=>x.id!==campaignId);
  state.logs = state.logs.filter(x=>x.campaign_id!==campaignId);
  state.tasks = state.tasks.filter(x=>x.campaign_id!==campaignId);
}

function toggleEditPanel(open){
  if(!campaignEditPanel) return;
  campaignEditPanel.classList.toggle("hidden", !open);
}
toggleEditCampaignBtn?.addEventListener("click", ()=>{
  const open = campaignEditPanel?.classList.contains("hidden");
  toggleEditPanel(open);
});
closeEditCampaignBtn?.addEventListener("click", ()=>toggleEditPanel(false));
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
  toggleEditPanel(false);
  renderAll();
  toast("保存");
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

/* listener CRUD */
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
  return true;
}
function deleteListener(campaignId, name){
  const n = (name||"").trim();
  state.logs = state.logs.filter(l=>!(l.campaign_id===campaignId && (l.listener_name||"").trim()===n));
  state.tasks = state.tasks.filter(t=>!(t.campaign_id===campaignId && (t.listener_name||"").trim()===n));
}

function renderLeaderboardTable(tbodyEl, campaign){
  if(!tbodyEl) return;
  const totals = computeTotalsForCampaign(campaign.id);

  if(!totals.length){
    tbodyEl.innerHTML = `<tr><td colspan="4" class="muted">データなし</td></tr>`;
    return;
  }

  tbodyEl.innerHTML = totals.map(r=>{
    return `
      <tr>
        <td>${escapeHtml(r.listener_name)}</td>
        <td class="right">${r.points}</td>
        <td>${escapeHtml(formatReward(campaign, r.points))}</td>
        <td>
          <button class="btn ghost small" type="button" data-l-edit="${escapeHtml(r.listener_name)}">編集</button>
          <button class="btn danger small" type="button" data-l-del="${escapeHtml(r.listener_name)}">削除</button>
        </td>
      </tr>
    `;
  }).join("");

  tbodyEl.querySelectorAll("[data-l-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const c = getCurrentCampaign();
      if(!c) return;
      const oldName = btn.getAttribute("data-l-edit");
      const newName = prompt(`リスナー名を変更\n「${oldName}」→`, oldName);
      if(newName===null) return;
      if(!newName.trim()) return alert("空は不可");
      renameListener(c.id, oldName, newName.trim());
      saveState();
      renderAll();
      toast("変更");
    });
  });

  tbodyEl.querySelectorAll("[data-l-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const c = getCurrentCampaign();
      if(!c) return;
      const name = btn.getAttribute("data-l-del");
      if(!confirm(`リスナー「${name}」を削除します。\nこの企画のログとタスクも消えます。OK？`)) return;
      deleteListener(c.id, name);
      saveState();
      renderAll();
      toast("削除");
    });
  });
}

/* tasks CRUD in confirm page */
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
            ${isDone
              ? `<button class="btn ghost small" type="button" data-undone="${t.id}">未完了に戻す</button>`
              : `<button class="btn primary small" type="button" data-done="${t.id}">完了</button>`
            }
            <button class="btn ghost small" type="button" data-edit="${t.id}">編集</button>
            <button class="btn danger small" type="button" data-del="${t.id}">削除</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

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

  const open = incompleteCountByCampaign(c.id);
  const typeLabel = normalizeCampaignType(c.type)==="achievement" ? "達成型" : "お買い物方式";

  if(campaignTitleEl) campaignTitleEl.textContent = c.name;
  if(campaignMetaEl) campaignMetaEl.textContent = `開始日：${c.start_date} / 方式：${typeLabel} / 返礼品数：${rulesSorted(c.rules).length}`;
  if(campaignStatusPill) campaignStatusPill.textContent = open>0 ? `未完了 ${open}` : "未完了なし";

  if(goLiveBtn) goLiveBtn.href = `#live=${c.id}`;

  renderCampaignEditForm(c);
  renderLeaderboardTable(leaderboardBody, c);
  renderTaskListForCampaign(c);
}

/* ========= Live (real-time only) ========= */
const liveTitle = document.getElementById("liveTitle");
const liveMeta = document.getElementById("liveMeta");
const goConfirmBtn = document.getElementById("goConfirmBtn");
const liveLeaderboardBody = document.getElementById("liveLeaderboardBody");

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

function renderLive(){
  const c = getCurrentCampaign();
  if(!c){ location.hash="#tasks"; return; }

  const typeLabel = normalizeCampaignType(c.type)==="achievement" ? "達成型" : "お買い物方式";
  if(liveTitle) liveTitle.textContent = c.name;
  if(liveMeta) liveMeta.textContent = `開始日：${c.start_date} / 方式：${typeLabel}`;
  if(goConfirmBtn) goConfirmBtn.href = `#campaign=${c.id}`;

  renderLeaderboardTable(liveLeaderboardBody, c);
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
    };
    // type未設定の旧データがあっても壊れないように補正
    state.campaigns.forEach(c=>{ c.type = normalizeCampaignType(c.type); });
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
