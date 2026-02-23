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
function parseTs(ts) {
  if (!ts) return null;
  let s = String(ts).trim();

  // "2026-02-13 14:30:00" -> "2026-02-13T14:30:00"
  if (s.includes(" ") && !s.includes("T")) s = s.replace(" ", "T");

  // If there's no timezone info, treat it as LOCAL time (do NOT add "Z")
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function fmtDateTime(ts) {
  const d = parseTs(ts);
  if (!d) return "-";
  return d.toLocaleString([], {
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
  const s = Math.max(0, sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function waitingColorClass(waitSec) {
  if (waitSec == null) return "";
  if (waitSec >= RED_AFTER_MIN * 60) return "w-red";
  if (waitSec >= YELLOW_AFTER_MIN * 60) return "w-yellow";
  return "w-green";
}

function urgencyClass(sec){
  if (sec == null) return "";
  if (sec >= RED_AFTER_MIN*60) return "uRed";
  if (sec >= YELLOW_AFTER_MIN*60) return "uYellow";
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

// Freeze timer for finished states
function calcSeconds(r){
  const startD = parseTs(r?.requested_at);
  if (!startD) return null;

  const start = startD.getTime();

  // best: stored duration (already frozen)
  if (r.duration_sec != null && Number.isFinite(Number(r.duration_sec))) {
    return Number(r.duration_sec);
  }

  const st = String(r.status || "").toUpperCase();

  // stop time preference: confirmed > delivered
  let stopD = null;

  if ((st === "CONFIRMED" || st === "REJECTED") && r.confirmed_at) {
    stopD = parseTs(r.confirmed_at);
  }
  if (!stopD && (st === "DELIVERED" || st === "CONFIRMED" || st === "REJECTED") && r.delivered_at) {
    stopD = parseTs(r.delivered_at);
  }

  if (stopD) {
    return Math.max(0, Math.floor((stopD.getTime() - start) / 1000));
  }

  // still open
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
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

      const { error } = await sb.from("requests").insert({
        line,
        component: c.component,
        unit: c.unit,
        qty: 1,
        status: "NEW",
        requested_at: new Date().toISOString(),
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

    myRequests.innerHTML = "";
    (data || []).forEach(r => {
      const sec = calcSeconds(r);
      const stopped = ["DELIVERED","CONFIRMED","REJECTED"].includes(String(r.status||"").toUpperCase());
      const label = stopped ? "Lead" : "Wait";

      const card = document.createElement("div");
      card.className = `lineCard ${urgencyClass(sec)}`;

      card.innerHTML = `
        <div class="lineCardTop">
          <div class="lineCardTitle">${r.component}</div>
          <div class="lineCardTimer">${label}: ${formatSec(sec)}</div>
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
          const { error } = await sb.from("requests").update({
            status: "CONFIRMED",
            confirmed_at: new Date().toISOString(),
          }).eq("id", r.id);
          if (error) console.error(error);
        };

        const wrong = document.createElement("button");
        wrong.className = "lineAction lineWrong";
        wrong.textContent = "WRONG MATERIAL";
        wrong.onclick = async () => {
          const { error } = await sb.from("requests").update({
            status: "REJECTED",
            confirmed_at: new Date().toISOString(),
          }).eq("id", r.id);
          if (error) console.error(error);
        };

        btnBox.appendChild(ok);
        btnBox.appendChild(wrong);
      } else {
        btnBox.innerHTML = `<div class="muted2">${stopped ? "Done ✅" : "Waiting…"}</div>`;
      }

      myRequests.appendChild(card);
    });
  }

  refreshMy();
  setInterval(refreshMy, 2000);
}

// ====== WAREHOUSE SCREEN ======
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
      <div class="whCol"><div class="whColHead"><div class="whColTitle">NEW</div><div class="whColCount" id="countNEW">0</div></div><div class="whColBody" id="colNEW"></div></div>
      <div class="whCol"><div class="whColHead"><div class="whColTitle">TAKEN</div><div class="whColCount" id="countTAKEN">0</div></div><div class="whColBody" id="colTAKEN"></div></div>
      <div class="whCol"><div class="whColHead"><div class="whColTitle">DELIVERED</div><div class="whColCount" id="countDELIVERED">0</div></div><div class="whColBody" id="colDELIVERED"></div></div>
    </div>
  `;

  async function render(){
    const { data, error } = await sb.from("requests").select("*").in("status", ["NEW","TAKEN","DELIVERED"]).order("requested_at", {ascending:true});
    if(error){ console.error(error); return; }

    const byStatus = { NEW:[], TAKEN:[], DELIVERED:[] };
    (data||[]).forEach(r => byStatus[r.status]?.push(r));

    const colNEW = document.getElementById("colNEW");
    const colTAKEN = document.getElementById("colTAKEN");
    const colDEL = document.getElementById("colDELIVERED");

    colNEW.innerHTML = "";
    colTAKEN.innerHTML = "";
    colDEL.innerHTML = "";

    byStatus.NEW.forEach(r => colNEW.appendChild(document.createTextNode(r.component)));
    byStatus.TAKEN.forEach(r => colTAKEN.appendChild(document.createTextNode(r.component)));
    byStatus.DELIVERED.forEach(r => colDEL.appendChild(document.createTextNode(r.component)));

    document.getElementById("countNEW").textContent = byStatus.NEW.length;
    document.getElementById("countTAKEN").textContent = byStatus.TAKEN.length;
    document.getElementById("countDELIVERED").textContent = byStatus.DELIVERED.length;
  }

  window.deliver = async (id) => {
    const { data, error } = await sb.from("requests").select("requested_at").eq("id", id).single();
    if(error || !data){ console.error(error); return; }

    const startD = parseTs(data.requested_at);
    if (!startD) { console.error("Bad requested_at"); return; }

    const start = startD.getTime();
    const now = Date.now();
    const duration = Math.max(0, Math.floor((now - start)/1000));

    const { error: updErr } = await sb.from("requests").update({
      status:"DELIVERED",
      delivered_at: new Date(now).toISOString(),
      duration_sec: duration
    }).eq("id", id);
    if(updErr) console.error(updErr);
  };

  render();
}

// ====== MONITOR SCREEN ======
async function loadMonitor() {
  app.innerHTML = `<div class="header">MONITOR</div><div id="monitorRows"></div>`;
}

// ====== ROUTING ======
if (route.startsWith("#line/")) loadLine(route.split("/")[1]);
else if (route.startsWith("#monitor")) loadMonitor();
else loadWarehouse();
