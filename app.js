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

// ====== WAREHOUSE SCREEN ======
async function loadWarehouse() {
  // UI state
  const state = {
    q: "",
    line: "ALL",
    status: "open",    // open | all | newonly
    daysBack: 7,       // 1 | 7 | 30 | 90
  };

  app.innerHTML = `
    <div class="header">WAREHOUSE</div>

    <div class="toolbar">
      <input id="search" class="input" placeholder="Search component..." />
      <select id="lineFilter" class="input">
        <option value="ALL">All lines</option>
        ${Array.from({ length: 9 }, (_, i) => `<option value="L${i + 1}">L${i + 1}</option>`).join("")}
      </select>

      <select id="statusFilter" class="input">
        <option value="open">Open (not confirmed)</option>
        <option value="newonly">NEW only</option>
        <option value="all">All (in range)</option>
      </select>

      <select id="rangeFilter" class="input">
        <option value="1">Today</option>
        <option value="7" selected>Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
      </select>

      <button id="btnExport">Download CSV</button>
      <a href="#monitor" class="linkBtn">Monitor</a>
    </div>

    <div id="rows"></div>
  `;

  const rowsEl = document.getElementById("rows");
  const searchEl = document.getElementById("search");
  const lineEl = document.getElementById("lineFilter");
  const statusEl = document.getElementById("statusFilter");
  const rangeEl = document.getElementById("rangeFilter");
  const exportBtn = document.getElementById("btnExport");

  function readState() {
    state.q = searchEl.value || "";
    state.line = lineEl.value || "ALL";
    state.status = statusEl.value || "open";
    state.daysBack = Number(rangeEl.value || 7);
  }

  async function render() {
    readState();
    const data = await fetchOpenRequests(state);

    rowsEl.innerHTML = "";

    data.forEach(r => {
      const card = document.createElement("div");
      card.className = "card";

      // waiting/lead time
      const waitSec = r.status === "DELIVERED"
        ? (r.duration_sec ?? Math.floor((new Date(r.delivered_at) - new Date(r.requested_at)) / 1000))
        : secSince(r.requested_at);

      card.innerHTML = `
        <div class="rowTop">
          <div>
            <div style="font-weight:bold;font-size:18px;">${r.line} — ${r.component}</div>
            <div style="opacity:.85;">
              Status: <span class="${statusClass(r.status)}">${r.status}</span>
              &nbsp;|&nbsp; Qty: <b>${r.qty ?? 1}</b> ${r.unit ?? ""}
            </div>
            <div style="opacity:.85;">Requested: ${fmtDateTime(r.requested_at)}</div>
            <div style="opacity:.85;">Taken: ${fmtDateTime(r.taken_at)}</div>
            <div style="opacity:.85;">Delivered: ${fmtDateTime(r.delivered_at)}</div>
          </div>
          <div class="${waitingColorClass(waitSec)} timerBox">
            ${r.status === "DELIVERED" ? "Lead" : "Wait"}: ${formatSec(waitSec)}
          </div>
        </div>

        <div class="actions">
          <button class="taken" onclick="take(${r.id})">TAKE</button>
          <button class="delivered" onclick="deliver(${r.id})">DELIVER</button>
        </div>
      `;

      rowsEl.appendChild(card);
    });
  }

  // actions
  window.take = async (id) => {
    const { error } = await sb.from("requests").update({
      status: "TAKEN",
      taken_at: new Date(),
    }).eq("id", id);
    if (error) console.error(error);
  };

  window.deliver = async (id) => {
    // get requested_at to compute duration
    const { data, error } = await sb.from("requests").select("requested_at").eq("id", id).single();
    if (error || !data) { console.error(error); return; }

    const start = new Date(data.requested_at);
    const now = new Date();
    const duration = Math.floor((now - start) / 1000);

    const { error: updErr } = await sb.from("requests").update({
      status: "DELIVERED",
      delivered_at: now,
      duration_sec: duration,
    }).eq("id", id);

    if (updErr) console.error(updErr);
  };

  // export CSV respecting current filters/range
  window.downloadCSV = async () => {
    readState();

    const daysBack = Number(state.daysBack ?? 7);
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    let q = sb
      .from("requests")
      .select("id,line,component,qty,unit,status,priority,requested_at,taken_at,delivered_at,confirmed_at,duration_sec")
      .gte("requested_at", since)
      .order("requested_at", { ascending: true });

    if (state.line && state.line !== "ALL") q = q.eq("line", state.line);

    const { data, error } = await q;
    if (error) { console.error(error); alert("Export failed"); return; }

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

// ====== ROUTING ======
if (route.startsWith("#line/")) loadLine(route.split("/")[1]); // #line/L1
else if (route.startsWith("#monitor")) loadMonitor();
else loadWarehouse();
