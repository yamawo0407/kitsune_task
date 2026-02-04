// ===============================
// 配信管理ツール（統合版）
// 返礼品管理 / 企画作成 / ライブ入力 / ランク管理
// 保存：localStorage
// ===============================

const STORAGE_KEY = "stream_tool_v1";
const RANK_KEY = "rank60_v1";

// ---- state ----
let state = loadState();
let ui = {
  route: "home",
  rewardsFilter: "all",
  live: {
    ptUndoStack: [],
    gachaUndoStack: []
  }
};

// ---- utils ----
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
const uid = () => Math.random().toString(36).slice(2, 10);

function deepClone(obj){
  return JSON.parse(JSON.stringify(obj));
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return {
    campaigns: [], // {id,name,start,mode,rewards[],gacha:{cost,prizes[]},listeners:{name:{pt,logs[],gachaLogs[]}}}
    lastSelectedCampaignId: null
  };
}

function fmtDate(d){
  const dt = new Date(d);
  if(Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,"0");
  const da = String(dt.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}

function todayISO(){
  return fmtDate(new Date());
}

function getCampaign(id){
  return state.campaigns.find(c => c.id === id) || null;
}

function ensureSelectedCampaign(){
  if(state.campaigns.length === 0) return null;
  const id = state.lastSelectedCampaignId;
  const found = id ? getCampaign(id) : null;
  if(found) return found;
  state.lastSelectedCampaignId = state.campaigns[0].id;
  return state.campaigns[0];
}

// ---- routing ----
function setRoute(route){
  ui.route = route;
  document.querySelectorAll(".nav__link").forEach(a=>{
    a.classList.toggle("is-active", a.dataset.route === route);
  });
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  const view = $("view-" + route);
  if(view) view.classList.remove("hidden");
  render();
}

function routeFromHash(){
  const h = (location.hash || "#home").replace("#","");
  const allowed = new Set(["home","rewards","campaigns","live","rank"]);
  setRoute(allowed.has(h) ? h : "home");
}

window.addEventListener("hashchange", routeFromHash);
window.addEventListener("load", ()=>{
  bindGlobal();
  routeFromHash();
});

// ---- global buttons ----
function bindGlobal(){
  $("btnBackup").addEventListener("click", ()=>{
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stream-tool-backup_${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("fileRestore").addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    try{
      const txt = await f.text();
      const obj = JSON.parse(txt);
      if(!obj || !Array.isArray(obj.campaigns)) throw new Error("形式が違う");
      state = obj;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      alert("復元しました");
      render();
    }catch(err){
      alert("復元に失敗しました（JSON形式を確認）");
    }finally{
      e.target.value = "";
    }
  });

  $("btnReset").addEventListener("click", ()=>{
    if(!confirm("すべて削除します。戻せません。よろしいですか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(RANK_KEY);
    state = loadState();
    ui.live.ptUndoStack = [];
    ui.live.gachaUndoStack = [];
    location.hash = "#home";
    render();
  });

  // rewards filter
  document.querySelectorAll("#view-rewards .seg__btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("#view-rewards .seg__btn").forEach(b=>b.classList.remove("is-active"));
      btn.classList.add("is-active");
      ui.rewardsFilter = btn.dataset.filter;
      renderRewards();
    });
  });

  // campaigns create UI init
  $("btnAddRewardRow").addEventListener("click", ()=> addRewardRow());
  $("btnAddGachaRow").addEventListener("click", ()=> addGachaRow());
  $("newMode").addEventListener("change", ()=> renderCreateMode());
  $("btnCreateCampaign").addEventListener("click", createCampaign);

  // live
  $("btnAddListener").addEventListener("click", addListener);
  $("btnRemoveListener").addEventListener("click", removeListener);
  $("btnAddPt").addEventListener("click", addPt);
  $("btnUndoPt").addEventListener("click", undoPt);
  $("btnMinus").addEventListener("click", minusPt);

  $("btnRoll").addEventListener("click", rollGacha);
  $("btnUndoGacha").addEventListener("click", undoGacha);
  $("btnCopyGacha").addEventListener("click", copyGacha);

  $("btnOpenEdit").addEventListener("click", openEdit);
  $("btnCancelEdit").addEventListener("click", closeEdit);
  $("btnSaveEdit").addEventListener("click", saveEdit);
  $("editModal").addEventListener("click", (e)=>{
    if(e.target?.dataset?.close) closeEdit();
  });

  // rank
  $("btnRankRun").addEventListener("click", runRank);
  bindRankAutoSave();

  // chips
  const chips = [100,300,500,1000,5000,10000,30000];
  const wrap = $("ptChips");
  wrap.innerHTML = "";
  chips.forEach(v=>{
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = `+${v}`;
    b.addEventListener("click", ()=>{
      $("livePt").value = String(v);
      $("btnAddPt").click();
    });
    wrap.appendChild(b);
  });
}

// ---- render ----
function render(){
  renderHome();
  renderRewards();
  renderCampaigns();
  renderLive();
  renderRankLoad();
}

function renderHome(){
  const total = state.campaigns.length;
  let open = 0, done = 0;
  state.campaigns.forEach(c=>{
    const s = calcCampaignStatus(c);
    if(s.done) done++; else open++;
  });

  $("homeStats").innerHTML = `
    <div class="pill">企画: <b>${total}</b></div>
    <div class="pill">未完了: <b>${open}</b></div>
    <div class="pill">完了: <b>${done}</b></div>
  `;
}

function calcCampaignStatus(c){
  // 達成型/買い物：全リスナーが全返礼品完了で "done" とする（雑だけど実用）
  // ガチャ：返礼品テーブルがあれば同様、無ければ常にopen
  const rewards = c.rewards || [];
  const listeners = Object.values(c.listeners || {});
  if(rewards.length === 0 || listeners.length === 0) return { done:false };

  const allDone = listeners.every(ls=>{
    const got = new Set((ls.gotRewards||[]));
    return rewards.every(r=>got.has(r.id));
  });
  return { done: allDone };
}

function renderRewards(){
  if(ui.route !== "rewards") return;

  const list = $("rewardsList");
  const items = state.campaigns
    .map(c => ({c, s: calcCampaignStatus(c)}))
    .filter(x=>{
      if(ui.rewardsFilter === "all") return true;
      if(ui.rewardsFilter === "open") return !x.s.done;
      if(ui.rewardsFilter === "done") return x.s.done;
      return true;
    });

  if(items.length === 0){
    list.innerHTML = `<div class="hint">企画がありません。先に「企画作成」で作成してください。</div>`;
    return;
  }

  list.innerHTML = items.map(({c,s})=>`
    <div class="item">
      <div>
        <div class="item__title">${esc(c.name)}</div>
        <div class="item__meta">${esc(c.modeLabel)} / 開始: ${esc(c.start||"-")} / リスナー: ${Object.keys(c.listeners||{}).length}名</div>
      </div>
      <div class="item__actions">
        <div class="pill">状況: <b style="color:${s.done ? 'var(--ok)':'var(--warn)'}">${s.done ? "完了":"未完了"}</b></div>
        <a class="btn btn--sub" href="#live" onclick="window.__selectCampaign('${c.id}')">開く</a>
      </div>
    </div>
  `).join("");
}

window.__selectCampaign = (id)=>{
  state.lastSelectedCampaignId = id;
  saveState();
};

function renderCampaigns(){
  if(ui.route !== "campaigns") return;

  // list
  const list = $("campaignList");
  if(state.campaigns.length === 0){
    list.innerHTML = `<div class="hint">まだ企画がありません。右側で作成してください。</div>`;
  }else{
    list.innerHTML = state.campaigns.map(c=>`
      <div class="item">
        <div>
          <div class="item__title">${esc(c.name)}</div>
          <div class="item__meta">${esc(c.modeLabel)} / 開始: ${esc(c.start||"-")}</div>
        </div>
        <div class="item__actions">
          <button class="btn btn--sub" onclick="window.__pick('${c.id}')">選択</button>
          <button class="btn btn--danger" onclick="window.__del('${c.id}')">削除</button>
        </div>
      </div>
    `).join("");
  }

  // create init once
  if(!$("newStart").value) $("newStart").value = todayISO();
  if($("tblRewards").querySelectorAll("tbody tr").length === 0){
    addRewardRow(); addRewardRow();
  }
  if($("tblGacha").querySelectorAll("tbody tr").length === 0){
    addGachaRow(); addGachaRow();
  }
  renderCreateMode();
}

window.__pick = (id)=>{
  state.lastSelectedCampaignId = id;
  saveState();
  alert("ライブ入力の対象に設定しました");
};

window.__del = (id)=>{
  if(!confirm("この企画を削除します。よろしいですか？")) return;
  state.campaigns = state.campaigns.filter(c=>c.id !== id);
  if(state.lastSelectedCampaignId === id) state.lastSelectedCampaignId = state.campaigns[0]?.id || null;
  saveState();
};

function renderCreateMode(){
  const mode = $("newMode").value;
  $("blockGacha").classList.toggle("hidden", mode !== "gacha");
}

function addRewardRow(row={name:"",pt:"",note:""}){
  const tb = $("tblRewards").querySelector("tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="input" value="${esc(row.name)}" placeholder="例）壁紙" data-k="name"></td>
    <td><input class="input" value="${esc(row.pt)}" type="number" min="0" placeholder="例）3000" data-k="pt"></td>
    <td><input class="input" value="${esc(row.note)}" placeholder="任意" data-k="note"></td>
    <td><button class="btn btn--danger" type="button">削除</button></td>
  `;
  tr.querySelector("button").addEventListener("click", ()=> tr.remove());
  tb.appendChild(tr);
}

function addGachaRow(row={name:"",rate:"",note:""}){
  const tb = $("tblGacha").querySelector("tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="input" value="${esc(row.name)}" placeholder="例）アクスタ" data-k="name"></td>
    <td><input class="input" value="${esc(row.rate)}" type="number" min="0" max="100" placeholder="例）20" data-k="rate"></td>
    <td><input class="input" value="${esc(row.note)}" placeholder="任意" data-k="note"></td>
    <td><button class="btn btn--danger" type="button">削除</button></td>
  `;
  tr.querySelector("button").addEventListener("click", ()=> tr.remove());
  tb.appendChild(tr);
}

function collectRewards(){
  const rows = [...$("tblRewards").querySelectorAll("tbody tr")];
  return rows.map(tr=>{
    const inputs = tr.querySelectorAll("input");
    const name = inputs[0].value.trim();
    const pt = Number(inputs[1].value);
    const note = inputs[2].value.trim();
    return { id: uid(), name, pt: Number.isFinite(pt)?pt:0, note };
  }).filter(r=>r.name && r.pt>0);
}

function collectGacha(){
  const rows = [...$("tblGacha").querySelectorAll("tbody tr")];
  const prizes = rows.map(tr=>{
    const inputs = tr.querySelectorAll("input");
    const name = inputs[0].value.trim();
    const rate = Number(inputs[1].value);
    const note = inputs[2].value.trim();
    return { id: uid(), name, rate: Number.isFinite(rate)?rate:0, note };
  }).filter(p=>p.name && p.rate>0);

  const cost = Number($("gachaCost").value);
  return { cost: Number.isFinite(cost)?cost:0, prizes };
}

function markInvalid(el, ok){
  el.style.borderColor = ok ? "" : "rgba(255,92,122,.55)";
}

function createCampaign(){
  const name = $("newName").value.trim();
  const start = $("newStart").value;
  const mode = $("newMode").value;

  const okName = !!name;
  const okStart = !!start;
  markInvalid($("newName"), okName);
  markInvalid($("newStart"), okStart);

  let rewards = collectRewards();
  let gacha = null;

  if(mode === "gacha"){
    gacha = collectGacha();
    const okCost = gacha.cost > 0;
    markInvalid($("gachaCost"), okCost);
    const okPrizes = gacha.prizes.length > 0 && sumRates(gacha.prizes) > 0;
    if(!okPrizes) alert("ガチャ景品（出現率%）を入力してください（最低1行）");
    if(!okName || !okStart || !okCost || !okPrizes) return;
  }else{
    const okRewards = rewards.length > 0;
    if(!okRewards) alert("返礼品（必要pt）を1つ以上入力してください");
    if(!okName || !okStart || !okRewards) return;
  }

  const campaign = {
    id: uid(),
    name,
    start,
    mode,
    modeLabel: mode === "achieve" ? "達成型" : mode === "shop" ? "お買い物方式" : "ガチャ",
    rewards,
    gacha,
    listeners: {}
  };

  state.campaigns.unshift(campaign);
  state.lastSelectedCampaignId = campaign.id;

  // reset minimal
  $("newName").value = "";
  saveState();
  alert("企画を作成しました（ライブ入力から使えます）");
}

function sumRates(prizes){
  return prizes.reduce((a,p)=>a + Number(p.rate||0), 0);
}

// ---- live ----
function renderLive(){
  if(ui.route !== "live") return;

  const sel = $("liveCampaign");
  sel.innerHTML = state.campaigns.length
    ? state.campaigns.map(c=>`<option value="${c.id}">${esc(c.name)}（${esc(c.modeLabel)}）</option>`).join("")
    : `<option value="">企画がありません</option>`;

  const c = ensureSelectedCampaign();
  if(c){
    sel.value = c.id;
    $("btnOpenEdit").disabled = false;
  }else{
    $("btnOpenEdit").disabled = true;
  }

  sel.onchange = ()=>{
    state.lastSelectedCampaignId = sel.value;
    saveState();
  };

  // listeners
  const lsel = $("liveListener");
  lsel.innerHTML = "";
  if(!c){
    $("gachaArea").classList.add("hidden");
    $("tblLiveStatus").querySelector("tbody").innerHTML = "";
    return;
  }

  const names = Object.keys(c.listeners || {});
  if(names.length === 0){
    lsel.innerHTML = `<option value="">リスナーなし</option>`;
  }else{
    lsel.innerHTML = names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");
  }

  // gacha visible
  const isGacha = c.mode === "gacha";
  $("gachaArea").classList.toggle("hidden", !isGacha);
  $("gachaCostLive").textContent = isGacha ? String(c.gacha?.cost ?? 0) : "-";

  // status table
  renderLiveStatus();
  $("btnUndoPt").disabled = ui.live.ptUndoStack.length === 0;
  $("btnUndoGacha").disabled = ui.live.gachaUndoStack.length === 0;
}

function renderLiveStatus(){
  const c = ensureSelectedCampaign();
  const tb = $("tblLiveStatus").querySelector("tbody");
  if(!c){
    tb.innerHTML = "";
    return;
  }
  const entries = Object.entries(c.listeners || {});
  if(entries.length === 0){
    tb.innerHTML = `<tr><td colspan="4" style="color:var(--muted)">リスナーがいません</td></tr>`;
    return;
  }

  const rewards = c.rewards || [];
  tb.innerHTML = entries.map(([name,ls])=>{
    const pt = ls.pt || 0;
    const got = new Set(ls.gotRewards || []);
    let rewardText = "-";
    let status = "-";
    if(c.mode !== "gacha" && rewards.length){
      // 達成/買い物：ptで到達した最大を表示
      const sorted = [...rewards].sort((a,b)=>a.pt-b.pt);
      const achieved = sorted.filter(r=>pt >= r.pt);
      if(achieved.length){
        const last = achieved[achieved.length-1];
        rewardText = `${last.name}（${last.pt}pt）`;
      }
      status = achieved.length === rewards.length ? "完了" : "未完了";
    }else if(c.mode === "gacha"){
      // ガチャ：獲得一覧の数
      const gotNames = (ls.gachaLogs||[]).slice(-3).map(x=>x.prizeName).filter(Boolean);
      rewardText = gotNames.length ? gotNames.join(" / ") : "-";
      status = "—";
    }
    return `
      <tr>
        <td>${esc(name)}</td>
        <td>${pt}</td>
        <td>${esc(rewardText)}</td>
        <td>${esc(status)}</td>
      </tr>
    `;
  }).join("");
}

function addListener(){
  const c = ensureSelectedCampaign();
  if(!c){ alert("先に企画を作成してください"); return; }
  const name = $("liveNewListener").value.trim();
  if(!name){ alert("名前を入力してください"); return; }
  if(c.listeners[name]){ alert("同名が存在します"); return; }

  c.listeners[name] = { pt:0, logs:[], gachaLogs:[], gotRewards:[] };
  $("liveNewListener").value = "";
  saveState();
}

function removeListener(){
  const c = ensureSelectedCampaign();
  if(!c) return;
  const name = $("liveListener").value;
  if(!name) return;
  if(!confirm(`${name} を解除します。よろしいですか？`)) return;
  delete c.listeners[name];
  saveState();
}

function pushPtUndo(snapshot){
  ui.live.ptUndoStack.push(snapshot);
  if(ui.live.ptUndoStack.length > 50) ui.live.ptUndoStack.shift();
  $("btnUndoPt").disabled = ui.live.ptUndoStack.length === 0;
}

function currentListener(){
  const c = ensureSelectedCampaign();
  if(!c) return null;
  const name = $("liveListener").value;
  if(!name || !c.listeners[name]) return null;
  return { c, name, ls: c.listeners[name] };
}

function addPt(){
  const cur = currentListener();
  if(!cur){ alert("リスナーを選択してください"); return; }
  const v = Number($("livePt").value);
  if(!Number.isFinite(v) || v <= 0){ alert("加算ptを入力してください"); return; }

  // undo snapshot (listener only)
  pushPtUndo({ campaignId: cur.c.id, name: cur.name, before: deepClone(cur.ls) });

  cur.ls.pt = (cur.ls.pt || 0) + v;
  cur.ls.logs.push({ t: Date.now(), delta: v });

  $("livePt").value = "";
  autoMarkRewards(cur.c, cur.ls);
  saveState();
}

function minusPt(){
  const cur = currentListener();
  if(!cur){ alert("リスナーを選択してください"); return; }
  const v = Number($("liveMinus").value);
  if(!Number.isFinite(v) || v <= 0){ alert("減算ptを入力してください"); return; }

  pushPtUndo({ campaignId: cur.c.id, name: cur.name, before: deepClone(cur.ls) });

  cur.ls.pt = Math.max(0, (cur.ls.pt || 0) - v);
  cur.ls.logs.push({ t: Date.now(), delta: -v });

  $("liveMinus").value = "";
  autoMarkRewards(cur.c, cur.ls);
  saveState();
}

function undoPt(){
  const last = ui.live.ptUndoStack.pop();
  $("btnUndoPt").disabled = ui.live.ptUndoStack.length === 0;
  if(!last) return;

  const c = getCampaign(last.campaignId);
  if(!c || !c.listeners[last.name]) return;

  c.listeners[last.name] = last.before;
  saveState();
}

function autoMarkRewards(c, ls){
  if(c.mode === "gacha") return;
  const rewards = c.rewards || [];
  const got = new Set(ls.gotRewards || []);
  rewards.forEach(r=>{
    if(ls.pt >= r.pt) got.add(r.id);
  });
  ls.gotRewards = [...got];
}

// ---- gacha ----
function pushGachaUndo(snapshot){
  ui.live.gachaUndoStack.push(snapshot);
  if(ui.live.gachaUndoStack.length > 50) ui.live.gachaUndoStack.shift();
  $("btnUndoGacha").disabled = ui.live.gachaUndoStack.length === 0;
}

function rollGacha(){
  const cur = currentListener();
  if(!cur){ alert("リスナーを選択してください"); return; }
  const c = cur.c;
  if(c.mode !== "gacha"){ alert("この企画はガチャではありません"); return; }

  const cost = c.gacha?.cost ?? 0;
  const usePt = Number($("gachaUsePt").value);
  const pay = Number.isFinite(usePt) && usePt > 0 ? usePt : cost;
  if(pay <= 0){ alert("使用ptが不正です"); return; }
  if((cur.ls.pt || 0) < pay){ alert("ptが不足しています"); return; }

  // undo snapshot (listener only)
  pushGachaUndo({ campaignId: c.id, name: cur.name, before: deepClone(cur.ls) });

  // spend
  cur.ls.pt -= pay;

  // pick prize by weight
  const prizes = (c.gacha?.prizes || []).filter(p=>p.rate>0 && p.name);
  const total = sumRates(prizes);
  if(total <= 0){ alert("ガチャ設定が不正です（出現率）"); return; }

  let r = Math.random() * total;
  let picked = prizes[prizes.length-1];
  for(const p of prizes){
    r -= p.rate;
    if(r <= 0){ picked = p; break; }
  }

  cur.ls.gachaLogs.push({
    t: Date.now(),
    usedPt: pay,
    prizeId: picked.id,
    prizeName: picked.name
  });

  $("gachaResult").value = `${cur.name}：${picked.name}（-${pay}pt）`;
  $("gachaUsePt").value = "";

  saveState();
}

function undoGacha(){
  const last = ui.live.gachaUndoStack.pop();
  $("btnUndoGacha").disabled = ui.live.gachaUndoStack.length === 0;
  if(!last) return;

  const c = getCampaign(last.campaignId);
  if(!c || !c.listeners[last.name]) return;

  c.listeners[last.name] = last.before;
  $("gachaResult").value = "";
  saveState();
}

function copyGacha(){
  const v = $("gachaResult").value.trim();
  if(!v){ alert("結果がありません"); return; }
  navigator.clipboard?.writeText(v).then(()=> alert("コピーしました")).catch(()=> alert("コピーできませんでした"));
}

// ---- edit modal (simple) ----
let editDraft = null;

function openEdit(){
  const c = ensureSelectedCampaign();
  if(!c){ alert("企画がありません"); return; }
  editDraft = deepClone(c);

  $("editBody").innerHTML = buildEditHTML(editDraft);
  bindEditEvents();

  $("editModal").classList.remove("hidden");
}

function closeEdit(){
  $("editModal").classList.add("hidden");
  editDraft = null;
}

function buildEditHTML(c){
  const modeOptions = `
    <option value="achieve" ${c.mode==="achieve"?"selected":""}>達成型</option>
    <option value="shop" ${c.mode==="shop"?"selected":""}>お買い物方式</option>
    <option value="gacha" ${c.mode==="gacha"?"selected":""}>ガチャ</option>
  `;
  const rewardRows = (c.rewards||[]).map(r=>`
    <tr>
      <td><input class="input" data-rid="${r.id}" data-k="name" value="${esc(r.name)}"></td>
      <td><input class="input" data-rid="${r.id}" data-k="pt" type="number" value="${r.pt}"></td>
      <td><input class="input" data-rid="${r.id}" data-k="note" value="${esc(r.note||"")}"></td>
      <td><button class="btn btn--danger" data-del-reward="${r.id}" type="button">削除</button></td>
    </tr>
  `).join("");

  const prizes = (c.gacha?.prizes||[]);
  const prizeRows = prizes.map(p=>`
    <tr>
      <td><input class="input" data-pid="${p.id}" data-k="name" value="${esc(p.name)}"></td>
      <td><input class="input" data-pid="${p.id}" data-k="rate" type="number" value="${p.rate}"></td>
      <td><input class="input" data-pid="${p.id}" data-k="note" value="${esc(p.note||"")}"></td>
      <td><button class="btn btn--danger" data-del-prize="${p.id}" type="button">削除</button></td>
    </tr>
  `).join("");

  return `
    <div class="form">
      <label class="field">
        <div class="field__label">企画名</div>
        <input class="input" id="editName" value="${esc(c.name)}">
      </label>

      <label class="field">
        <div class="field__label">開始日</div>
        <input class="input" id="editStart" type="date" value="${esc(c.start||"")}">
      </label>

      <label class="field">
        <div class="field__label">方式</div>
        <select class="input" id="editMode">${modeOptions}</select>
      </label>

      <div class="subpanel" id="editRewards">
        <div class="subpanel__title">返礼品</div>
        <div class="tablewrap">
          <table class="table">
            <thead><tr><th>返礼品名</th><th>必要pt</th><th>備考</th><th></th></tr></thead>
            <tbody>${rewardRows}</tbody>
          </table>
        </div>
        <button class="btn btn--sub" id="btnEditAddReward" type="button">＋行を追加</button>
      </div>

      <div class="subpanel ${c.mode==="gacha"?"":"hidden"}" id="editGacha">
        <div class="subpanel__title">ガチャ設定</div>
        <label class="field">
          <div class="field__label">1回の必要pt</div>
          <input class="input" id="editGachaCost" type="number" value="${c.gacha?.cost ?? 0}">
        </label>

        <div class="tablewrap">
          <table class="table">
            <thead><tr><th>景品名</th><th>出現率(%)</th><th>備考</th><th></th></tr></thead>
            <tbody>${prizeRows}</tbody>
          </table>
        </div>
        <button class="btn btn--sub" id="btnEditAddPrize" type="button">＋行を追加</button>
      </div>
    </div>
  `;
}

function bindEditEvents(){
  $("editMode").addEventListener("change", ()=>{
    editDraft.mode = $("editMode").value;
    editDraft.modeLabel = editDraft.mode === "achieve" ? "達成型" : editDraft.mode === "shop" ? "お買い物方式" : "ガチャ";
    $("editGacha").classList.toggle("hidden", editDraft.mode !== "gacha");
  });

  $("btnEditAddReward").addEventListener("click", ()=>{
    editDraft.rewards ||= [];
    editDraft.rewards.push({ id: uid(), name:"", pt:0, note:"" });
    $("editBody").innerHTML = buildEditHTML(editDraft);
    bindEditEvents();
  });

  $("btnEditAddPrize")?.addEventListener("click", ()=>{
    editDraft.gacha ||= { cost: 100, prizes: [] };
    editDraft.gacha.prizes ||= [];
    editDraft.gacha.prizes.push({ id: uid(), name:"", rate:0, note:"" });
    $("editBody").innerHTML = buildEditHTML(editDraft);
    bindEditEvents();
  });

  // delegates (delete)
  $("editBody").addEventListener("click", (e)=>{
    const dr = e.target?.dataset?.delReward;
    if(dr){
      editDraft.rewards = (editDraft.rewards||[]).filter(r=>r.id !== dr);
      $("editBody").innerHTML = buildEditHTML(editDraft);
      bindEditEvents();
      return;
    }
    const dp = e.target?.dataset?.delPrize;
    if(dp){
      editDraft.gacha.prizes = (editDraft.gacha.prizes||[]).filter(p=>p.id !== dp);
      $("editBody").innerHTML = buildEditHTML(editDraft);
      bindEditEvents();
      return;
    }
  });
}

function saveEdit(){
  if(!editDraft) return;
  editDraft.name = $("editName").value.trim();
  editDraft.start = $("editStart").value;
  editDraft.mode = $("editMode").value;
  editDraft.modeLabel = editDraft.mode === "achieve" ? "達成型" : editDraft.mode === "shop" ? "お買い物方式" : "ガチャ";

  // gather rewards
  const rewardRows = [...$("editRewards").querySelectorAll("tbody tr")];
  const newRewards = rewardRows.map(tr=>{
    const name = tr.querySelector('[data-k="name"]').value.trim();
    const pt = Number(tr.querySelector('[data-k="pt"]').value);
    const note = tr.querySelector('[data-k="note"]').value.trim();
    const rid = tr.querySelector('[data-k="name"]').dataset.rid;
    return { id: rid, name, pt: Number.isFinite(pt)?pt:0, note };
  }).filter(r=>r.name && r.pt>0);
  editDraft.rewards = newRewards;

  // gather gacha
  if(editDraft.mode === "gacha"){
    const cost = Number($("editGachaCost").value);
    editDraft.gacha ||= { cost: 0, prizes: [] };
    editDraft.gacha.cost = Number.isFinite(cost)?cost:0;

    const prizeRows = [...$("editGacha").querySelectorAll("tbody tr")];
    const newPrizes = prizeRows.map(tr=>{
      const name = tr.querySelector('[data-k="name"]').value.trim();
      const rate = Number(tr.querySelector('[data-k="rate"]').value);
      const note = tr.querySelector('[data-k="note"]').value.trim();
      const pid = tr.querySelector('[data-k="name"]').dataset.pid;
      return { id: pid, name, rate: Number.isFinite(rate)?rate:0, note };
    }).filter(p=>p.name && p.rate>0);
    editDraft.gacha.prizes = newPrizes;
  }else{
    editDraft.gacha = null;
  }

  // validations
  if(!editDraft.name){ alert("企画名が未入力です"); return; }
  if(!editDraft.start){ alert("開始日が未入力です"); return; }
  if(editDraft.mode === "gacha"){
    if(!(editDraft.gacha?.cost > 0)){ alert("ガチャの必要ptが未入力です"); return; }
    if(!editDraft.gacha?.prizes?.length){ alert("ガチャ景品を入力してください"); return; }
  }else{
    if(!editDraft.rewards.length){ alert("返礼品を1つ以上入力してください"); return; }
  }

  // apply to real state
  const idx = state.campaigns.findIndex(c=>c.id === editDraft.id);
  if(idx >= 0){
    // keep listeners as-is
    const listeners = state.campaigns[idx].listeners || {};
    editDraft.listeners = listeners;
    state.campaigns[idx] = editDraft;
    state.lastSelectedCampaignId = editDraft.id;
    saveState();
    closeEdit();
  }
}

// ---- rank (simple 60 days table generator) ----
function loadRank(){
  try{
    const raw = localStorage.getItem(RANK_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return {
    now:"S3",
    remain:6,
    sumPlus:0,
    pass:0,
    start: todayISO()
  };
}
let rankState = loadRank();

function saveRank(){
  localStorage.setItem(RANK_KEY, JSON.stringify(rankState));
}

function bindRankAutoSave(){
  ["rankNow","rankRemain","rankSumPlus","rankPass","rankStart"].forEach(id=>{
    $(id).addEventListener("change", ()=>{
      rankState.now = $("rankNow").value;
      rankState.remain = Number($("rankRemain").value);
      rankState.sumPlus = Number($("rankSumPlus").value||0);
      rankState.pass = Number($("rankPass").value||0);
      rankState.start = $("rankStart").value || todayISO();
      saveRank();
    });
  });
}

function renderRankLoad(){
  if(ui.route !== "rank") return;
  rankState = loadRank();
  $("rankNow").value = rankState.now;
  $("rankRemain").value = String(rankState.remain);
  $("rankSumPlus").value = String(rankState.sumPlus||0);
  $("rankPass").value = String(rankState.pass||0);
  $("rankStart").value = rankState.start || todayISO();
}

function passToday(basePass, date){
  // 月曜に+1（上限10）という仕様を雑に反映：開始時点を base として日ごとに加算
  // 厳密な仕様はあなたの元ツールと違う可能性がある（必要なら後で合わせる）
  let p = basePass;
  // その日が月曜なら+1（上限10）
  if(date.getDay() === 1) p = Math.min(10, p + 1);
  return p;
}

function runRank(){
  rankState.now = $("rankNow").value;
  rankState.remain = Number($("rankRemain").value);
  rankState.sumPlus = Number($("rankSumPlus").value||0);
  rankState.pass = Number($("rankPass").value||0);
  rankState.start = $("rankStart").value || todayISO();
  saveRank();

  const start = new Date(rankState.start);
  if(Number.isNaN(start.getTime())){ alert("開始日が不正です"); return; }

  let p = rankState.pass;
  $("rankPassToday").textContent = String(p);

  const tb = $("tblRank").querySelector("tbody");
  tb.innerHTML = "";

  let remain = rankState.remain;
  let sumPlus = rankState.sumPlus;

  for(let i=0;i<60;i++){
    const d = new Date(start);
    d.setDate(d.getDate()+i);

    p = passToday(p, d);
    const plus = 0; // 今日のプラスは入力欄を作るならここに入れる（今回は生成表だけ）
    sumPlus += plus;

    // 判定は簡易：remainが0なら「要注意」
    const judge = remain <= 0 ? "要注意" : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(d)}</td>
      <td>${esc(rankState.now)}</td>
      <td>${remain}</td>
      <td>${plus}</td>
      <td>0</td>
      <td>${sumPlus}</td>
      <td>${judge}</td>
      <td>${p}</td>
    `;
    tb.appendChild(tr);

    remain = Math.max(0, remain - 1);
  }
}

// initial render
render();
