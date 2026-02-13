console.log("app.js loaded");

// ====== CONFIG ======
const SUPABASE_URL = "https://xopxxznvaorhvqucamve.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvcHh4em52YW9yaHZxdWNhbXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MDczNzEsImV4cCI6MjA4NjM4MzM3MX0.cF4zK8lrFWAURnVui_7V7ZweAgJxlEn4nyxH7qKGgko";

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

function formatSec(sec) {
  if (sec == null) return "--:--";
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

function urgencyClass(sec) {
  if (sec == null) return "";
  if (sec >= RED_AFTER_MIN * 60) return "uRed";
  if (sec >= YELLOW_AFTER_MIN * 60) return "uYellow";
  return "uGreen";
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

// ✅ One correct timer logic everywhere
// - NEW/TAKEN => live wait (now - requested_at)
// - DELIVERED/CONFIRMED/REJECTED => frozen lead time
function calcSeconds(r) {
  if (!r?.requested_at) return null;

  const requested = new Date(r.requested_at).getTime();
  const delivered = r.delivered_at ? new Date(r.delivered_at).getTime() : null;
  const confirmed = r.confirmed_at ? new Date(r.confirmed_at).getTime() : null;

  const frozenStatuses = ["DELIVERED", "CONFIRMED", "REJECTED"];
  const isFrozen = frozenStatuses.includes(String(r.status || "").toUpperCase());

  // If DB already has duration_sec, ALWAYS trust it for frozen states
  if (isFrozen && r.duration_sec != null) return r.duration_sec;

  if (isFrozen) {
    // pick best “stop time”
    const stop = delivered ?? confirmed ?? Date.now();
    return Math.max(0, Math.floor((stop - requested) / 1000));
  }

  // live waiting
  return Math.max(0, Math.floor((Date.now() - requested) / 1000));
}

function isFrozenStatus(status) {
  const s = String(status || "").toUpperCase();
  return s === "DELIVERED" || s === "CONFIRMED" || s === "REJECTED";
}

// ====== DATA FETCH ======
async function fetchOpenRequests(filters = {}) {
  const daysBack = Number(filters.daysBack ?? 7);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  let query = sb
    .from("requests")
    .select("*")
    .gte("requested_at", since)
    .order("requested_at", { ascending: true });

  if (filters.status === "open") query = query.neq("status", "CONFIRMED");
  if (filters.status === "newonly") query = query.eq("status", "NEW");

  if (filters.line && filters.line !== "ALL") query = query.eq("line", filters.line);

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return [];
  }

  let rows = data || [];
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
    .in("status", ["NEW", "TAKEN", "DELIVERED"])
    .limit(1);

  if (error) {
    console.error(error);
    return false;
  }
  return (data || []).length > 0;
}

// ====== LINE SCREEN ======
async function loadLine(line) {
  app.innerHTML = `
    <div class="header">LINE ${line}</div>

    <div class="lineWrap">
      <div class="lineSectionTitle">Order component</div>
      <div class="lineGrid" id="grid"></div>

      <div class="lineSectionTitle">My requests (latest)</div>
      <div id="myRequests" class="lineCards"></div>
    </div>
  `;

  const grid = document.getElementById("grid");
  const myRequests = document.getElementById("myRequests");

  const { data: comps, error: compErr } = await sb
    .from("components")
    .select("*")
    .eq("line", line)
    .order("component", { ascending: true });

  if (compErr) console.error(compErr);

  (comps || []).forEach(c => {
    const btn = document.createElement("button");
    btn.className = "lineBtn";
    btn.innerHTML = `
      <div class="lineBtnName">${c.component}</div>
      <div class="lineBtnUnit">${c.unit || ""}</div>
    `;

    btn.onclick = async () => {
      const dup = await hasOpenDuplicate(line, c.component);
      if (dup) {
        alert("Already requested (still open).");
        return;
      }

      // ✅ IMPORTANT: set requested_at explicitly so timer starts at 0:00, not ~60
      const nowIso = new Date().toISOString();

      const { error } = await sb.from("requests").insert({
        line,
        component: c.component,
        unit: c.unit,
        qty: 1,
        status: "NEW",
        requested_at: nowIso
      });

      if (error) {
        console.error(error);
        alert("Request failed (check RLS).");
      } else {
        // refresh immediately so UI updates without waiting
        refreshMy();
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
      .limit(20);

    if (error) console.error(error);

    myRequests.innerHTML = "";
    (data || []).forEach(r => {
      const sec = calcSeconds(r);
      const frozen = isFrozenStatus(r.status);

      const card = document.createElement("div");
      card.className = `lineCard ${urgencyClass(sec)}`;

      card.innerHTML = `
        <div class="lineCardTop">
          <div class="lineCardTitle">${r.component}</div>
          <div class="lineCardTimer">${frozen ? "Lead" : "Wait"}: ${formatSec(sec)}</div>
        </div>

        <div class="lineCardMeta">
          <div><span class="muted2">Qty</span> <b>${r.qty ?? 1}</b> ${r.unit ?? ""}</div>
          <div><span class="muted2">Status</span> <b>${r.status}</b></div>
        </div>

        <div class="lineCardTimes">
          <div><span class="muted2">Requested</span> ${fmtDateTime(r.requested_at)}</div>
          <div><span class="muted2">Delivered</span> ${fmtDateTime(r.delivered_at)}</div>
          <div><span class="muted2">Confirmed</span> ${fmtDateTime(r.confirmed_at)}</div>
        </div>

        <div class="lineCardBtns" id="lineBtns-${r.id}"></div>
      `;

      const btnBox = card.querySelector(`#lineBtns-${r.id}`);

      if (String(r.status).toUpperCase() === "DELIVERED") {
        const ok = document.createElement("button");
        ok.className = "lineAction lineConfirm";
        ok.textContent = "CONFIRM";
        ok.onclick = async () => {
          // ✅ freeze timer by storing duration_sec on confirmation if missing
          const secFinal = calcSeconds({ ...r, status: "CONFIRMED", confirmed_at: new Date().toISOString() });

          const { error } = await sb.from("requests").update({
            status: "CONFIRMED",
            confirmed_at: new Date(),
            duration_sec: r.duration_sec ?? secFinal
          }).eq("id", r.id);

          if (error) console.error(error);
        };

        const wrong = document.createElement("button");
        wrong.className = "lineAction lineWrong";
        wrong.textContent = "WRONG MATERIAL";
        wrong.onclick = async () => {
          const secFinal = calcSeconds({ ...r, status: "REJECTED", confirmed_at: new Date().toISOString() });

          const { error } = await sb.from("requests").update({
            status: "REJECTED",
            duration_sec: r.duration_sec ?? secFinal
          }).eq("id", r.id);

          if (error) console.error(error);
        };

        btnBox.appendChild(ok);
        btnBox.appendChild(wrong);
      } else {
        btnBox.innerHTML = `<div class="muted2">—</div>`;
      }

      myRequests.appendChild(card);
    });
  }

  refreshMy();

  sb.channel(`line_${line}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, (payload) => {
      if (payload.new?.line === line) refreshMy();
    })
    .subscribe();

  // live timers
  setInterval(refreshMy, 2000);
}

// ====== WAREHOUSE SCREEN ======
async function loadWarehouse() {
  const state = { q: "", line: "ALL", daysBack: 1 };

  app.innerHTML = `
    <div class="header">WAREHOUSE</div>

    <div class="whTopbar">
      <input id="search" class="whInput" placeholder="Search component..." />
      <select id="lineFilter" class="whInput">
        <option value="ALL">All lines</option>
        ${Array.from({ length: 9 }, (_, i) => `<option value="L${i + 1}">L${i + 1}</option>`).join("")}
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
  const lineEl = document.getElementById("lineFilter");
  const rangeEl = document.getElementById("rangeFilter");
  const exportBtn = document.getElementById("btnExport");

  const colNEW = document.getElementById("colNEW");
  const colTAKEN = document.getElementById("colTAKEN");
  const colDEL = document.getElementById("colDELIVERED");

  const countNEW = document.getElementById("countNEW");
  const countTAKEN = document.getElementById("countTAKEN");
  const countDEL = document.getElementById("countDELIVERED");

  function readState() {
    state.q = searchEl.value || "";
    state.line = lineEl.value || "ALL";
    state.daysBack = Number(rangeEl.value || 1);
  }

  function makeCard(r) {
    const sec = calcSeconds(r);
    const card = document.createElement("div");
    card.className = `whCard2 ${urgencyClass(sec)}`;

    const req = r.requested_at ? new Date(r.requested_at) : null;
    const del = r.delivered_at ? new Date(r.delivered_at) : null;

    card.innerHTML = `
      <div class="whCardTop2">
        <div class="whLinePill">${r.line}</div>
        <div class="whTimeBig">${formatSec(sec)}</div>
      </div>

      <div class="whComp2">${r.component}</div>

      <div class="whSub2">
        <div><span class="muted2">Qty</span> <b>${r.qty ?? 1}</b> ${r.unit ?? ""}</div>
        <div class="muted2">${r.status}</div>
      </div>

      <div class="whMiniTimes2">
        <div><span class="muted2">Req</span> ${req ? req.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}</div>
        <div><span class="muted2">Del</span> ${del ? del.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}</div>
      </div>

      <div class="whBtns2" id="btns-${r.id}"></div>
    `;

    const btns = card.querySelector(`#btns-${r.id}`);

    const takeBtn = document.createElement("button");
    takeBtn.className = "whBigBtn whTake";
    takeBtn.textContent = "TAKE";
    takeBtn.disabled = (String(r.status).toUpperCase() !== "NEW");
    takeBtn.onclick = () => window.take(r.id);

    const delBtn = document.createElement("button");
    delBtn.className = "whBigBtn whDel";
    delBtn.textContent = "DELIVER";
    delBtn.disabled = (String(r.status).toUpperCase() === "DELIVERED");
    delBtn.onclick = () => window.deliver(r.id);

    btns.appendChild(takeBtn);
    btns.appendChild(delBtn);

    return card;
  }

  async function render() {
    readState();

    const since = new Date(Date.now() - state.daysBack * 24 * 60 * 60 * 1000).toISOString();

    let q = sb
      .from("requests")
      .select("*")
      .gte("requested_at", since)
      .in("status", ["NEW", "TAKEN", "DELIVERED"])
      .order("requested_at", { ascending: true });

    if (state.line !== "ALL") q = q.eq("line", state.line);

    const { data, error } = await q;
    if (error) {
      console.error(error);
      return;
    }

    let rows = data || [];
    if (state.q.trim()) {
      const needle = state.q.trim().toLowerCase();
      rows = rows.filter(r => String(r.component || "").toLowerCase().includes(needle));
    }

    // sort longest first within each status
    const byStatus = { NEW: [], TAKEN: [], DELIVERED: [] };
    rows.forEach(r => byStatus[r.status]?.push(r));
    ["NEW", "TAKEN", "DELIVERED"].forEach(st => {
      byStatus[st].sort((a, b) => (calcSeconds(b) || 0) - (calcSeconds(a) || 0));
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

  // actions
  window.take = async (id) => {
    const { error } = await sb.from("requests").update({
      status: "TAKEN",
      taken_at: new Date()
    }).eq("id", id);
    if (error) console.error(error);
  };

  window.deliver = async (id) => {
    const { data, error } = await sb.from("requests").select("requested_at").eq("id", id).single();
    if (error || !data) { console.error(error); return; }

    const start = new Date(data.requested_at);
    const now = new Date();
    const duration = Math.max(0, Math.floor((now - start) / 1000));

    const { error: updErr } = await sb.from("requests").update({
      status: "DELIVERED",
      delivered_at: now,
      duration_sec: duration
    }).eq("id", id);

    if (updErr) console.error(updErr);
  };

  exportBtn.onclick = () => window.downloadCSV && window.downloadCSV();

  searchEl.addEventListener("input", render);
  lineEl.addEventListener("change", render);
  rangeEl.addEventListener("change", render);

  render();

  sb.channel("warehouse_requests")
    .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, render)
    .subscribe();

  setInterval(render, 2000);
}

// ====== MONITOR SCREEN ======
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
    const data = await fetchOpenRequests({ status: "open", daysBack: 7 });

    const items = (data || [])
      .map(r => ({ r, sec: calcSeconds(r) }))
      .sort((a, b) => (b.sec ?? 0) - (a.sec ?? 0));

    el.innerHTML = "";
    items.forEach(({ r, sec }) => {
      const frozen = isFrozenStatus(r.status);

      const card = document.createElement("div");
      card.className = "card monitorCard";

      card.innerHTML = `
        <div class="rowTop">
          <div>
            <div style="font-weight:bold;font-size:22px;">${r.line} — ${r.component}</div>
            <div style="opacity:.85;font-size:16px;">Status: <span class="${statusClass(r.status)}">${r.status}</span></div>
          </div>
          <div class="${waitingColorClass(sec)} timerBig">
            ${frozen ? "Lead" : "Wait"}: ${formatSec(sec)}
          </div>
        </div>
      `;

      el.appendChild(card);
    });
  }

  render();

  sb.channel("monitor_requests")
    .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, render)
    .subscribe();

  setInterval(render, 2000);
}

// ====== EXPORT CSV ======
window.downloadCSV = async () => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

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

  const csv = [cols.join(","), ...(data || []).map(r => cols.map(c => escapeCSV(r[c])).join(","))].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
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
