console.log("app.js loaded");

const SUPABASE_URL = "https://xopxxznvaorhvqucamve.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvcHh4em52YW9yaHZxdWNhbXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MDczNzEsImV4cCI6MjA4NjM4MzM3MX0.cF4zK8lrFWAURnVui_7V7ZweAgJxlEn4nyxH7qKGgko";

// safer: use window.supabase
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const app = document.getElementById('app');
const route = location.hash || '#warehouse';

// ---------- helpers ----------
function fmtTime(ts){
  if(!ts) return '-';
  return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function formatSec(sec){
  if(sec == null) return '-';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// ===================== Line tablet =====================
async function loadLine(line){
  app.innerHTML = `
    <div class='header'>LINE ${line}</div>
    <div id='grid' class='grid'></div>
    <div class='center'>
      <h3>My Requests</h3>
      <ul id='myRequests'></ul>
    </div>
  `;

  const g = document.getElementById('grid');
  const ul = document.getElementById('myRequests');

  // Load components for this line
  const { data: comps, error: compErr } = await sb.from('components').select('*').eq('line', line);
  if(compErr) console.error(compErr);

  (comps || []).forEach(c => {
    const d = document.createElement('div');
    d.className = 'btn';
    d.innerText = `${c.component} (${c.unit})`;
    d.onclick = async () => {
      const { error } = await sb.from('requests').insert({
        line,
        component: c.component,
        unit: c.unit,
        qty: 1,
        status: 'NEW',
        requested_at: new Date()
      });
      if(error) {
        console.error(error);
        alert("Request failed (check RLS).");
      } else {
        alert('Request sent');
      }
    };
    g.appendChild(d);
  });

  async function refreshRequests(){
    const { data, error } = await sb.from('requests').select('*')
      .eq('line', line)
      .order('requested_at', { ascending: true });

    if(error) console.error(error);

    ul.innerHTML = '';
    (data || []).forEach(r => {
      const li = document.createElement('li');

      let statusColor = 'green';
      if(r.status === 'NEW') statusColor = 'red';
      else if(r.status === 'TAKEN') statusColor = 'yellow';
      else if(r.status === 'DELIVERED') statusColor = 'green';

      li.innerHTML = `${r.component} - ${r.status} <span class='${statusColor}'>●</span>`;

      if(r.status === 'DELIVERED'){
        const btn = document.createElement('button');
        btn.innerText = 'Confirm';
        btn.onclick = async () => {
          const { error } = await sb.from('requests').update({
            status: 'CONFIRMED',
            confirmed_at: new Date()
          }).eq('id', r.id);
          if(error) console.error(error);
        };
        li.appendChild(btn);
      }

      ul.appendChild(li);
    });
  }

  refreshRequests();

  // realtime
  sb.channel('line_requests')
    .on('postgres_changes', { event:'*', schema:'public', table:'requests' }, payload => {
      if(payload.new?.line === line) refreshRequests();
    })
    .subscribe();

  // fallback refresh (helps on file:// and flaky wifi)
  setInterval(refreshRequests, 3000);
}

// ===================== Warehouse =====================
async function loadWarehouse(){
  app.innerHTML = `
    <div class='header'>WAREHOUSE</div>
    <table class='table'>
      <thead>
        <tr>
          <th>Line</th>
          <th>Component</th>
          <th>Qty</th>
          <th>Unit</th>
          <th>Status</th>
          <th>Delivered at</th>
          <th>Duration</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id='rows'></tbody>
    </table>
  `;

  const tb = document.getElementById('rows');

  async function refresh(){
    const { data, error } = await sb.from('requests').select('*')
      .neq('status','CONFIRMED')
      .order('requested_at', { ascending: true });

    if(error) console.error(error);

    tb.innerHTML = '';
    (data || []).forEach(r => {
      const tr = document.createElement('tr');

      let statusColor = 'green';
      if(r.status === 'NEW') statusColor = 'red';
      else if(r.status === 'TAKEN') statusColor = 'yellow';
      else if(r.status === 'DELIVERED') statusColor = 'green';

      tr.innerHTML = `
        <td>${r.line}</td>
        <td>${r.component}</td>
        <td>${r.qty}</td>
        <td>${r.unit}</td>
        <td class='status ${statusColor}'>${r.status}</td>
        <td>${fmtTime(r.delivered_at)}</td>
        <td>${formatSec(r.duration_sec)}</td>
        <td>
          <button onclick="take(${r.id})">TAKE</button>
          <button onclick="deliver(${r.id})">DELIVER</button>
        </td>
      `;

      tb.appendChild(tr);
    });
  }

  window.take = async (id) => {
    const { error } = await sb.from('requests').update({
      status: 'TAKEN',
      taken_at: new Date()
    }).eq('id', id);
    if(error) console.error(error);
  };

  window.deliver = async (id) => {
    const { data, error } = await sb.from('requests').select('requested_at').eq('id', id).single();
    if(error || !data) { console.error(error); return; }

    const start = new Date(data.requested_at);
    const now = new Date();
    const duration = Math.floor((now - start) / 1000);

    const { error: updErr } = await sb.from('requests').update({
      status: 'DELIVERED',
      delivered_at: now,
      duration_sec: duration
    }).eq('id', id);

    if(updErr) console.error(updErr);
  };

  refresh();

  // realtime
  sb.channel('warehouse_requests')
    .on('postgres_changes', { event:'*', schema:'public', table:'requests' }, refresh)
    .subscribe();

  // fallback refresh
  setInterval(refresh, 3000);
}

// ===================== Routing =====================
if(route.startsWith('#line/')) loadLine(route.split('/')[1]);   // example: #line/L1
else loadWarehouse();                                          // default



