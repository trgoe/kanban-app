<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Factory Kanban</title>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<style>
body{font-family:Arial;margin:0;background:#111;color:#fff}
.header{padding:12px;background:#222;font-size:22px;text-align:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;padding:12px}
.btn{background:#2b7cff;border-radius:14px;padding:22px;text-align:center;font-size:20px;cursor:pointer}
.btn:active{transform:scale(.95)}
.table{width:100%;border-collapse:collapse}
.table td,.table th{border-bottom:1px solid #444;padding:10px}
.red{color:#ff4d4d}.yellow{color:#ffd24d}.green{color:#4dff88}
.center{padding:20px;text-align:center}
.status{font-weight:bold}
</style>
</head>
<body>
<div id="app"></div>
<script>
const SUPABASE_URL = "https://xopxxznvaorhvqucamve.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvcHh4em52YW9yaHZxdWNhbXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MDczNzEsImV4cCI6MjA4NjM4MzM3MX0.cF4zK8lrFWAURnVui_7V7ZweAgJxlEn4nyxH7qKGgko";

const sb = supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const app = document.getElementById('app');
const route = location.hash || '#warehouse';
const currentLine = route.startsWith('#line/') ? route.split('/')[1] : null;

// ===================== Line tablet =====================
async function loadLine(line){
    app.innerHTML=`
        <div class='header'>LINE ${line}</div>
        <div id='grid' class='grid'></div>
        <div class='center'>
            <h3>My Requests</h3>
            <ul id='myRequests'></ul>
        </div>
    `;
    const g=document.getElementById('grid');
    const ul=document.getElementById('myRequests');

    // Load components for this line
    const {data} = await sb.from('components').select('*').eq('line',line);
    (data||[]).forEach(c=>{
        let d=document.createElement('div');
        d.className='btn';
        d.innerText=`${c.component} (${c.unit})`;
        d.onclick = async()=>{
            await sb.from('requests').insert({
  line,
  component:c.component,
  unit:c.unit,
  qty:1,
  status:'NEW',
  requested_at:new Date()
});
            alert('Request sent');
        };
        g.appendChild(d);
    });

    // Function to refresh my requests
    async function refreshRequests(){
        const {data} = await sb.from('requests').select('*')
            .eq('line',line)
            .order('requested_at',{ascending:true});
        ul.innerHTML='';
        (data||[]).forEach(r=>{
            const li=document.createElement('li');
            let statusColor='green';
            if(r.status==='NEW') statusColor='red';
            else if(r.status==='TAKEN') statusColor='yellow';
            else if(r.status==='DELIVERED') statusColor='green';
            li.innerHTML=`${r.component} - ${r.status} <span class='${statusColor}'>●</span>`;
            // Show confirm button if delivered
            if(r.status==='DELIVERED'){
                const btn=document.createElement('button');
                btn.innerText='Confirm';
                btn.onclick=async()=>{
                    await sb.from('requests').update({status:'CONFIRMED',confirmed_at:new Date()}).eq('id',r.id);
                };
                li.appendChild(btn);
            }
            ul.appendChild(li);
        });
    }

    // Initial load
    refreshRequests();

    // Realtime updates
    sb.channel('line_requests')
      .on('postgres_changes',{event:'*',schema:'public',table:'requests'},payload=>{
          if(payload.new?.line===line) refreshRequests();
      })
      .subscribe();
}

// ===================== Warehouse =====================
async function loadWarehouse(){
    app.innerHTML=`<div class='header'>WAREHOUSE</div>
    <table class='table'>
        <thead>
            <tr><th>Line</th><th>Component</th><th>Qty</th><th>Unit</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody id='rows'></tbody>
    </table>`;

    const tb=document.getElementById('rows');

    async function refresh(){
        const {data} = await sb.from('requests').select('*').neq('status','CONFIRMED').order('requested_at',{ascending:true});
        tb.innerHTML='';
        (data||[]).forEach(r=>{
            const tr=document.createElement('tr');
            let statusColor='green';
            if(r.status==='NEW') statusColor='red';
            else if(r.status==='TAKEN') statusColor='yellow';
            else if(r.status==='DELIVERED') statusColor='green';
            tr.innerHTML=`<td>${r.line}</td><td>${r.component}</td><td>${r.qty}</td><td>${r.unit}</td><td class='status ${statusColor}'>${r.status}</td>
            <td>
                <button onclick="take(${r.id})">TAKE</button>
                <button onclick="deliver(${r.id})">DELIVER</button>
            </td>`;
            tb.appendChild(tr);
        });
    }

    window.take=async(id)=>{await sb.from('requests').update({status:'TAKEN',taken_at:new Date()}).eq('id',id);refresh();};
   window.deliver = async (id) => {

  // 1. get the request first (we need start time)
  const { data } = await sb
    .from('requests')
    .select('requested_at')
    .eq('id', id)
    .single();

  if(!data) return;

  const start = new Date(data.requested_at);
  const now = new Date();
  const duration = Math.floor((now - start) / 1000);

  // 2. update row with delivery info
  await sb.from('requests').update({
      status:'DELIVERED',
      delivered_at: now,
      duration_sec: duration
  }).eq('id',id);

};

    // Initial load
    refresh();

    // Realtime subscription
    sb.channel('warehouse_requests')
      .on('postgres_changes',{event:'*',schema:'public',table:'requests'},refresh)
      .subscribe();
}

// ===================== Routing =====================
if(route.startsWith('#line/')) loadLine(route.split('/')[1]);
else loadWarehouse();
</script>
</body>
</html>
