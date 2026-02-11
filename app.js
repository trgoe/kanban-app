/* ---------- SUPABASE SETUP ---------- */
const SUPABASE_URL = "https://xopxxznvaorhvqucamve.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvcHh4em52YW9yaHZxdWNhbXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MDczNzEsImV4cCI6MjA4NjM4MzM3MX0.cF4zK8lrFWAURnVui_7V7ZweAgJxlEn4nyxH7qKGgko";

// Supabase v2 client
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- ROUTING ---------- */
const app = document.getElementById("app");
const hash = window.location.hash || "#/";

if (hash.startsWith("#/line/")) {
  const line = hash.split("/")[2];
  renderLine(line);
} else if (hash === "#/warehouse") {
  renderWarehouse();
} else if (hash === "#/monitor") {
  renderMonitor();
} else {
  app.innerHTML = "<h1>Factory Kanban</h1><p>Invalid URL</p>";
}

/* ---------- LINE VIEW ---------- */
async function renderLine(line) {
  app.innerHTML = `
    <h1>Line ${line}</h1>
    <div id="components"></div>
    <h2>My Requests</h2>
    <div id="requests"></div>
  `;

  await loadComponents(line);
  await loadMyRequests(line);

  // Real-time updates for this line
  db.from("requests")
    .on("INSERT", payload => {
      if (payload.new.line === line) loadMyRequests(line);
    })
    .on("UPDATE", payload => {
      if (payload.new.line === line) loadMyRequests(line);
    })
    .subscribe();
}

async function loadComponents(line) {
  const { data: comps, error } = await db
    .from("components")
    .select("*")
    .eq("line", line);

  if (error) {
    console.error(error);
    document.getElementById("components").innerText = "Failed to load components.";
    return;
  }

  const compDiv = document.getElementById("components");
  compDiv.innerHTML = "";

  comps?.forEach(c => {
    const btn = document.createElement("button");
    btn.className = "new";
    btn.innerText = `Order ${c.component}`;
    btn.onclick = async () => {
      await db.from("requests").insert({
        line,
        component: c.component,
        unit: c.unit,
        status: "NEW",
        requested_at: new Date().toISOString()
      });
      loadMyRequests(line);
    };
    compDiv.appendChild(btn);
  });
}

async function loadMyRequests(line) {
  const { data, error } = await db.from("requests")
    .select("*")
    .eq("line", line)
    .neq("status", "CONFIRMED")
    .order("requested_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

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
          .update({ status: "CONFIRMED", confirmed_at: new Date().toISOString() })
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
  await loadWarehouse();

  // Real-time updates
  db.from("requests")
    .on("INSERT", loadWarehouse)
    .on("UPDATE", loadWarehouse)
    .subscribe();
}

async function loadWarehouse() {
  const { data, error } = await db.from("requests")
    .select("*")
    .neq("status", "CONFIRMED")
    .order("requested_at", { ascending: true });

  if (error) {
    console.error(error);
    document.getElementById("queue").innerText = "Failed to load requests.";
    return;
  }

  const div = document.getElementById("queue");
  div.innerHTML = "";

  data?.forEach(r => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<b>${r.component}</b> (${r.line})<br>Status: ${r.status}`;

    if (r.status === "NEW") {
      const btn = document.createElement("button");
      btn.className = "taken";
      btn.innerText = "Take";
      btn.onclick = async () => {
        await db.from("requests")
          .update({ status: "TAKEN", taken_at: new Date().toISOString() })
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
          .update({ status: "DELIVERED", delivered_at: new Date().toISOString() })
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
  await loadMonitor();

  // Real-time updates
  db.from("requests")
    .on("INSERT", loadMonitor)
    .on("UPDATE", loadMonitor)
    .subscribe();
}

async function loadMonitor() {
  const { data, error } = await db.from("requests")
    .select("*")
    .neq("status", "CONFIRMED")
    .order("requested_at", { ascending: true });

  if (error) {
    console.error(error);
    document.getElementById("board").innerText = "Failed to load requests.";
    return;
  }

  const div = document.getElementById("board");
  div.innerHTML = "";

  data?.forEach(r => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<b>${r.component}</b> (${r.line})<br>${r.status}`;
    div.appendChild(card);
  });
}
