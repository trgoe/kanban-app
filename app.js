const SUPABASE_URL = "https://xopxxznvaorhvqucamve.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvcHh4em52YW9yaHZxdWNhbXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MDczNzEsImV4cCI6MjA4NjM4MzM3MX0.cF4zK8lrFWAURnVui_7V7ZweAgJxlEn4nyxH7qKGgko";

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const path = window.location.pathname;
const app = document.getElementById("app");

if (path.startsWith("/line/")) {
  const line = path.split("/")[2];
  renderLine(line);
} else if (path === "/warehouse") {
  renderWarehouse();
} else if (path === "/monitor") {
  renderMonitor();
} else {
  app.innerHTML = "<h1>Factory Kanban</h1><p>Invalid URL</p>";
}

/* ---------- LINE VIEW ---------- */

async function renderLine(line) {
  app.innerHTML = `<h1>Line ${line}</h1><div id="components"></div><h2>My Requests</h2><div id="requests"></div>`;

  const { data: comps } = await db.from("components").select("*").eq("line", line);

  const compDiv = document.getElementById("components");

  comps?.forEach(c => {
    const btn = document.createElement("button");
    btn.className = "new";
    btn.innerText = `Order ${c.component}`;
    btn.onclick = async () => {
      await db.from("requests").insert({
        line,
        component: c.component,
        unit: c.unit
      });
      loadMyRequests(line);
    };
    compDiv.appendChild(btn);
  });

  loadMyRequests(line);
}

async function loadMyRequests(line) {
  const { data } = await db.from("requests")
    .select("*")
    .eq("line", line)
    .neq("status", "CONFIRMED")
    .order("requested_at", { ascending: false });

  const reqDiv = document.getElementById("requests");
  reqDiv.innerHTML = "";

  data?.forEach(r => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <b>${r.component}</b><br>
      Status: ${r.status}
    `;

    if (r.status === "DELIVERED") {
      const btn = document.createElement("button");
      btn.className = "confirm";
      btn.innerText = "Confirm";
      btn.onclick = async () => {
        await db.from("requests")
          .update({ status: "CONFIRMED", confirmed_at: new Date() })
          .eq("id", r.id);
        loadMyRequests(line);
      };
      card.appendChild(btn);
    }

    reqDiv.appendChild(card);
  });
}

/* ---------- WAREHOUSE VIEW ---------- */

async function renderWarehouse() {
  app.innerHTML = `<h1>Warehouse</h1><div id="queue"></div>`;
  loadWarehouse();

  setInterval(loadWarehouse, 3000);
}

async function loadWarehouse() {
  const { data } = await db.from("requests")
    .select("*")
    .neq("status", "CONFIRMED")
    .order("requested_at");

  const div = document.getElementById("queue");
  div.innerHTML = "";

  data?.forEach(r => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <b>${r.component}</b> (${r.line})<br>
      Status: ${r.status}
    `;

    if (r.status === "NEW") {
      const btn = document.createElement("button");
      btn.className = "taken";
      btn.innerText = "Take";
      btn.onclick = async () => {
        await db.from("requests")
          .update({ status: "TAKEN", taken_at: new Date() })
          .eq("id", r.id);
        loadWarehouse();
      };
      card.appendChild(btn);
    }

    if (r.status === "TAKEN") {
      const btn = document.createElement("button");
      btn.className = "delivered";
      btn.innerText = "Deliver";
      btn.onclick = async () => {
        await db.from("requests")
          .update({ status: "DELIVERED", delivered_at: new Date() })
          .eq("id", r.id);
        loadWarehouse();
      };
      card.appendChild(btn);
    }

    div.appendChild(card);
  });
}

/* ---------- MONITOR VIEW ---------- */

async function renderMonitor() {
  app.innerHTML = `<h1>Live Monitor</h1><div id="board"></div>`;
  loadMonitor();
  setInterval(loadMonitor, 3000);
}

async function loadMonitor() {
  const { data } = await db.from("requests")
    .select("*")
    .neq("status", "CONFIRMED")
    .order("requested_at");

  const div = document.getElementById("board");
  div.innerHTML = "";

  data?.forEach(r => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <b>${r.component}</b> (${r.line})<br>
      ${r.status}
    `;
    div.appendChild(card);
  });
}
