console.log("app.js loaded");

// ====== CONFIG ======
const SUPABASE_URL = "https://xopxxznvaorhvqucamve.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvcHh4em52YW9yaHZxdWNhbXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MDczNzEsImV4cCI6MjA4NjM4MzM3MX0.cF4zK8lrFWAURnVui_7V7ZweAgJxlEn4nyxH7qKGgko";

// thresholds for colors
const YELLOW_AFTER_MIN = 5;
const RED_AFTER_MIN = 10;

// ====== INIT ======
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById("app");
const route = location.hash || "#warehouse";

// ====== HELPERS ======
function fmtDateTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function secSince(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
}

function formatSec(sec) {
  if (sec == null) return "-";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function waitingColorClass(waitSec) {
  if (waitSec == null) return "";
  if (waitSec >= RED_AFTER_MIN * 60) return "w-red";
  if (waitSec >= YELLOW_AFTER_MIN * 60) return "w-yellow";
  return "w-green";
}

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "new") return "new";
  if (s === "taken") return "taken";
  if (s === "delivered") return "delivered";
  if (s === "confirmed") return "confirm";
  if (s === "rejected") return "rejected";
  return "";
}

// ====== DATA FETCH (open orders) ======
async function fetchOpenRequests(filters = {}) {
  // filters: { line, q, status, daysBack }
  const daysBack = Number(filters.daysBack ?? 7);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  let query = sb
    .from("requests")
    .select("*")
    .gte("requested_at", since)
    .order("requested_at", { ascending: true });

  // Open vs all:
  // - "open": not CONFIRMED
  // - "all": everything in date range
  // - "newonly": NEW only
  if (filters.status === "open") query = query.neq("status", "CONFIRMED");
  if (filters.status === "newonly") query = query.eq("status", "NEW");

  // optional line filter
  if (filters.line && filters.line !== "ALL") {
    query = query.eq("line", filters.line);
  }

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return [];
  }

  let rows = data || [];

  // text search on component
  if (filters.q && filters.q.trim()) {
    const needle = filters.q.trim().toLowerCase();
    rows = rows.filter(r => String(r.component || "").toLowerCase().includes(needle));
  }

  return rows;
}

// ====== DUPLICATE PROTECTION ======
async function hasOpenDuplicate(line, component) {
  const { data, error } = await sb
    .from("requests")
    .select("id,status")
    .eq("line", line)
    .eq("component", component)
    .in("status", ["NEW", "TAKEN", "DELIVERED"]) // open statuses
    .limit(1);

  if (error) {
    console.error(error);
    // if unsure, allow rather than block
    return false;
  }
  return (data || []).length > 0;
}

// ====== LINE SCREEN ======
async function loadLine(line) {
  app.innerHTML = `
    <div class="header">LINE ${line}</div>
    <div class="grid" id="grid"></div>

    <div class="center">
      <h3>My Requests</h3>
      <div id="myRequests"></div>
    </div>
  `;

  const grid = document.getElementById("grid");
  const myRequests = document.getElementById("myRequests");

  // components for this line
  const { data: comps, error: compErr } = await sb.from("components").select("*").eq("line", line);
  if (compErr) console.error(compErr);

  (comps || []).forEach(c => {
    const btn = document.createElement("div");
    btn.className = "btn";
    btn.innerText = `${c.component}\n(${c.unit || ""})`;
    btn.onclick = async () => {
      // anti-duplicate
      const dup = await hasOpenDuplicate(line, c.component);
      if (dup) {
        alert("Already requested (still open).");
        return;
      }

      const { error } = await sb.from("requests").insert({
        line,
        component: c.component,
        unit: c.unit,
        qty: 1,
        status: "NEW",
        requested_at: new Date(),
      });

      if (error) {
        console.error(error);
        alert("Request failed.");
      } else {
        alert("Request sent");
      }
    };
    grid.appendChild(btn);
  });

  async function refreshMy() {
    const { data, error } = await sb
      .from("requests")
      .select("*")
      .eq("line", line)
      .order("requested_at", { ascending: false })
      .limit(30);

    if (error) console.error(error);

    const rows = data || [];
    myRequests.innerHTML = "";

    rows.forEach(r => {
      const card = document.createElement("div");
      card.className = "card";

      const waitSec = r.status === "DELIVERED"
        ? (r.duration_sec ?? Math.floor((new Date(r.delivered_at) - new Date(r.requested_at)) / 1000))
        : secSince(r.requested_at);

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
          <div>
            <div style="font-weight:bold;">${r.component}</div>
            <div style="opacity:.85;">Status: <span class="${statusClass(r.status)}">${r.status}</span></div>
            <div style="opacity:.85;">Requested: ${fmtDateTime(r.requested_at)}</div>
            <div style="opacity:.85;">Delivered: ${fmtDateTime(r.delivered_at)}</div>
          </div>
          <div class="${waitingColorClass(waitSec)}" style="min-width:90px;text-align:right;">
            ${r.status === "DELIVERED" ? "Lead" : "Wait"}: ${formatSec(waitSec)}
          </div>
        </div>
        <div style="margin-top:10px;" id="actions-${r.id}"></div>
      `;

      const actions = card.querySelector(`#actions-${r.id}`);

      // Confirm / Reject only when delivered
      if (r.status === "DELIVERED") {
        const confirmBtn = document.createElement("button");
        confirmBtn.className = "confirm";
        confirmBtn.innerText = "Confirm";

        confirmBtn.onclick = async () => {
          const { error } = await sb.from("requests").update({
            status: "CONFIRMED",
            confirmed_at: new Date(),
          }).eq("id", r.id);
          if (error) console.error(error);
        };

        const rejectBtn = document.createElement("button");
        rejectBtn.className = "rejected";
        rejectBtn.innerText = "Wrong material";

        rejectBtn.onclick = async () => {
          const reason = prompt("Reason (optional):", "Wrong material");
          const payload = { status: "REJECTED" };
          // if you later add a column 'reject_reason', we can save it.
          const { error } = await sb.from("requests").update(payload).eq("id", r.id);
          if (error) console.error(error);
        };

        actions.appendChild(confirmBtn);
        actions.appendChild(rejectBtn);
      }

      myRequests.appendChild(card);
    });
  }

  refreshMy();

  // realtime + fallback refresh
  sb.channel(`line_${line}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, (payload) => {
      if (payload.new?.line === line) refreshMy();
    })
    .subscribe();

  setInterval(refreshMy, 3000);
}

async function loadWarehouse() {
  const state = { q:"", line:"ALL", daysBack:1 };

  app.innerHTML = `
    <div class="header">WAREHOUSE</div>

    <div class="whTopbar">
      <input id="search" class="whInput" placeholder="Search component..." />
      <select id="lineFilter" class="whInput">
        <option value="ALL">All lines</option>
        ${Array.from({length:9},(_,i)=>`<option value="L${i+1}">L${i+1}</option>`).join("")}
      </select>
      <select id="rangeFilter" class="whInput">
        <option value="1">Today</option>
        <option value="7">7 days</option>
        <option value="30">30 days</option>
      </select>

      <button id="btnExport" class="whBtn whBtnBlue">Export CSV</button>
      <a href="#monitor" class="whBtn whBtnGhost">Monitor</a>
    </div>

    <div class="whBoard">
      <div class="whCol">
        <div class="whColHead">
          <div class="whColTitle">NEW</div>
          <div class="whColHint">Pick these first</div>
          <div class="whColCount" id="countNEW">0</div>
        </div>
        <div class="whColBody" id="colNEW"></div>
      </div>

      <div class="whCol">
        <div class="whColHead">
          <div class="whColTitle">TAKEN</div>
          <div class="whColHint">Preparing / on the way</div>
          <div class="whColCount" id="countTAKEN">0</div>
        </div>
        <div class="whColBody" id="colTAKEN"></div>
      </div>

      <div class="whCol">
        <div class="whColHead">
          <div class="whColTitle">DELIVERED</div>
          <div class="whColHint">Waiting line confirmation</div>
          <div class="whColCount" id="countDELIVERED">0</div>
        </div>
        <div class="whColBody" id="colDELIVERED"></div>
      </div>
    </div>
  `;

  const searchEl = document.getElementById("search");
  const lineEl   = document.getElementById("lineFilter");
  const rangeEl  = document.getElementById("rangeFilter");
  const exportBtn= document.getElementById("btnExport");

  const colNEW = document.getElementById("colNEW");
  const colTAKEN = document.getElementById("colTAKEN");
  const colDEL = document.getElementById("colDELIVERED");

  const countNEW = document.getElementById("countNEW");
  const countTAKEN = document.getElementById("countTAKEN");
  const countDEL = document.getElementById("countDELIVERED");

  function readState(){
    state.q = searchEl.value || "";
    state.line = lineEl.value || "ALL";
    state.daysBack = Number(rangeEl.value || 1);
  }

  function waitingSec(r){
    if(r.status === "DELIVERED"){
      // frozen lead time
      if(r.duration_sec != null) return r.duration_sec;
      if(r.delivered_at && r.requested_at) {
        return Math.floor((new Date(r.delivered_at)-new Date(r.requested_at))/1000);
      }
      return null;
    }
    // live waiting time until delivered
    return r.requested_at ? Math.floor((Date.now()-new Date(r.requested_at))/1000) : null;
  }

  function fmtMMSS(sec){
    if(sec == null) return "--:--";
    const m = Math.floor(sec/60);
    const s = sec%60;
    return `${m}:${String(s).padStart(2,"0")}`;
  }

  function urgencyClass(sec){
    if(sec == null) return "";
    if(sec >= RED_AFTER_MIN*60) return "uRed";
    if(sec >= YELLOW_AFTER_MIN*60) return "uYellow";
    return "uGreen";
  }

  function makeCard(r){
    const sec = waitingSec(r);
    const card = document.createElement("div");
    card.className = `whCard2 ${urgencyClass(sec)}`;

    const req = r.requested_at ? new Date(r.requested_at) : null;
    const del = r.delivered_at ? new Date(r.delivered_at) : null;

    // minimal, warehouse-friendly info
    card.innerHTML = `
      <div class="whCardTop2">
        <div class="whLinePill">${r.line}</div>
        <div class="whTimeBig">${fmtMMSS(sec)}</div>
      </div>

      <div class="whComp2">${r.component}</div>

      <div class="whSub2">
        <div><span class="muted2">Qty</span> <b>${r.qty ?? 1}</b> ${r.unit ?? ""}</div>
        <div class="muted2">${r.status}</div>
      </div>

      <div class="whMiniTimes2">
        <div><span class="muted2">Req</span> ${req ? req.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "-"}</div>
        <div><span class="muted2">Del</span> ${del ? del.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "-"}</div>
      </div>

      <div class="whBtns2" id="btns-${r.id}"></div>
    `;

    const btns = card.querySelector(`#btns-${r.id}`);

    const takeBtn = document.createElement("button");
    takeBtn.className = "whBigBtn whTake";
    takeBtn.textContent = "TAKE";
    takeBtn.disabled = (r.status !== "NEW");
    takeBtn.onclick = () => window.take(r.id);

    const delBtn = document.createElement("button");
    delBtn.className = "whBigBtn whDel";
    delBtn.textContent = "DELIVER";
    delBtn.disabled = (r.status === "DELIVERED");
    delBtn.onclick = () => window.deliver(r.id);

    btns.appendChild(takeBtn);
    btns.appendChild(delBtn);

    return card;
  }

  async function render(){
    readState();

    // only open requests in selected range (NEW/TAKEN/DELIVERED)
    const daysBack = state.daysBack;
    const since = new Date(Date.now() - daysBack*24*60*60*1000).toISOString();

    let q = sb
      .from("requests")
      .select("*")
      .gte("requested_at", since)
      .in("status", ["NEW","TAKEN","DELIVERED"])
      .order("requested_at", {ascending:true});

    if(state.line !== "ALL") q = q.eq("line", state.line);

    const { data, error } = await q;
    if(error){ console.error(error); return; }

    let rows = data || [];
    if(state.q.trim()){
      const needle = state.q.trim().toLowerCase();
      rows = rows.filter(r => String(r.component||"").toLowerCase().includes(needle));
    }

    // sort by longest waiting first within each status
    const byStatus = { NEW:[], TAKEN:[], DELIVERED:[] };
    rows.forEach(r => byStatus[r.status]?.push(r));
    ["NEW","TAKEN","DELIVERED"].forEach(st => {
      byStatus[st].sort((a,b)=>(waitingSec(b)||0)-(waitingSec(a)||0));
    });

    colNEW.innerHTML = "";
    colTAKEN.innerHTML = "";
    colDEL.innerHTML = "";

    byStatus.NEW.forEach(r => colNEW.appendChild(makeCard(r)));
    byStatus.TAKEN.forEach(r => colTAKEN.appendChild(makeCard(r)));
    byStatus.DELIVERED.forEach(r => colDEL.appendChild(makeCard(r)));

    countNEW.textContent = byStatus.NEW.length;
    countTAKEN.textContent = byStatus.TAKEN.length;
    countDEL.textContent = byStatus.DELIVERED.length;
  }

  // actions (same logic as before)
  window.take = async (id) => {
    const { error } = await sb.from("requests").update({
      status:"TAKEN",
      taken_at:new Date()
    }).eq("id", id);
    if(error) console.error(error);
  };

  window.deliver = async (id) => {
    const { data, error } = await sb.from("requests").select("requested_at").eq("id", id).single();
    if(error || !data){ console.error(error); return; }

    const start = new Date(data.requested_at);
    const now = new Date();
    const duration = Math.floor((now - start)/1000);

    const { error: updErr } = await sb.from("requests").update({
      status:"DELIVERED",
      delivered_at: now,
      duration_sec: duration
    }).eq("id", id);
    if(updErr) console.error(updErr);
  };

  exportBtn.onclick = () => window.downloadCSV && window.downloadCSV();

  searchEl.addEventListener("input", render);
  lineEl.addEventListener("change", render);
  rangeEl.addEventListener("change", render);

  render();

  sb.channel("warehouse_requests")
    .on("postgres_changes", {event:"*", schema:"public", table:"requests"}, render)
    .subscribe();

  // smooth live timers
  setInterval(render, 2000);
}

    // apply same component search filter client-side
    let rows = data || [];
    if (state.q && state.q.trim()) {
      const needle = state.q.trim().toLowerCase();
      rows = rows.filter(r => String(r.component || "").toLowerCase().includes(needle));
    }

    const cols = ["id","line","component","qty","unit","status","priority","requested_at","taken_at","delivered_at","confirmed_at","duration_sec"];

    const escapeCSV = (v) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g,'""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };

    const csv = [
      cols.join(","),
      ...rows.map(r => cols.map(c => escapeCSV(r[c])).join(","))
    ].join("\n");

    const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `kanban_${state.line}_${daysBack}d_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  exportBtn.onclick = () => window.downloadCSV();

  // wire inputs
  searchEl.addEventListener("input", () => render());
  lineEl.addEventListener("change", () => render());
  statusEl.addEventListener("change", () => render());
  rangeEl.addEventListener("change", () => render());

  // realtime + fallback timer refresh
  render();

  sb.channel("warehouse_requests")
    .on("postgres_changes", { event:"*", schema:"public", table:"requests" }, () => render())
    .subscribe();

  // update timers
  setInterval(render, 3000);
}

// ====== MONITOR (TV) SCREEN ======
async function loadMonitor() {
  app.innerHTML = `
    <div class="header">MONITOR</div>
    <div class="toolbar">
      <a href="#warehouse" class="linkBtn">Warehouse</a>
      <div style="opacity:.85;">Yellow ≥ ${YELLOW_AFTER_MIN} min | Red ≥ ${RED_AFTER_MIN} min</div>
    </div>
    <div id="monitorRows"></div>
  `;

  const el = document.getElementById("monitorRows");

  async function render() {
    // show only open orders (not confirmed), last 7 days
    const data = await fetchOpenRequests({ status: "open", daysBack: 7 });

    // compute waiting time and sort by longest waiting
    const items = (data || []).map(r => {
      const waitSec = r.status === "DELIVERED"
        ? (r.duration_sec ?? Math.floor((new Date(r.delivered_at) - new Date(r.requested_at)) / 1000))
        : secSince(r.requested_at);

      return { r, waitSec };
    }).sort((a,b) => (b.waitSec ?? 0) - (a.waitSec ?? 0));

    el.innerHTML = "";
    items.forEach(({ r, waitSec }) => {
      const card = document.createElement("div");
      card.className = "card monitorCard";

      card.innerHTML = `
        <div class="rowTop">
          <div>
            <div style="font-weight:bold;font-size:22px;">${r.line} — ${r.component}</div>
            <div style="opacity:.85;font-size:16px;">Status: <span class="${statusClass(r.status)}">${r.status}</span></div>
          </div>
          <div class="${waitingColorClass(waitSec)} timerBig">
            ${r.status === "DELIVERED" ? "Lead" : "Wait"}: ${formatSec(waitSec)}
          </div>
        </div>
      `;

      el.appendChild(card);
    });
  }

  render();

  sb.channel("monitor_requests")
    .on("postgres_changes", { event:"*", schema:"public", table:"requests" }, () => render())
    .subscribe();

  setInterval(render, 2000);
}
window.downloadCSV = async () => {
  // last 7 days, all lines by default
  const since = new Date(Date.now() - 7*24*60*60*1000).toISOString();

  const { data, error } = await sb
    .from("requests")
    .select("id,line,component,qty,unit,status,priority,requested_at,taken_at,delivered_at,confirmed_at,duration_sec")
    .gte("requested_at", since)
    .order("requested_at", { ascending: true });

  if (error) { console.error(error); alert("Export failed"); return; }

  const cols = ["id","line","component","qty","unit","status","priority","requested_at","taken_at","delivered_at","confirmed_at","duration_sec"];
  const escapeCSV = (v) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g,'""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };

  const csv = [cols.join(","), ...(data||[]).map(r => cols.map(c => escapeCSV(r[c])).join(","))].join("\n");

  const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kanban_export_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// ====== ROUTING ======
if (route.startsWith("#line/")) loadLine(route.split("/")[1]); // #line/L1
else if (route.startsWith("#monitor")) loadMonitor();
else loadWarehouse();



