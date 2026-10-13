// Dashboard client: sessions table, detail, trajectory over layout_snapshot, question + comparison views.
const $ = (id) => document.getElementById(id);
let sessions = [], cur = null;

function status(msg, isErr = false) {
  const el = $("status");
  if (el) { el.textContent = msg; el.style.color = isErr ? "#b91c1c" : "#333"; }
}
async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: "same-origin", ...opts });
  if (r.status === 401) {
    $("dash").hidden = true; $("login").hidden = false;
    status("Session expired or not logged in — please log in again.", true);
    throw new Error("auth");
  }
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

$("btn-login").onclick = async () => {
  try {
    const r = await fetch("/api/admin/login", { method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ password: $("pw").value }) });
    if (!r.ok) { status("Login failed: wrong password.", true); return; }
    $("login").hidden = true; $("dash").hidden = false;
    status("");
    await loadAll();
  } catch (e) { status(`Login error: ${e.message}`, true); }
};
$("btn-refresh").onclick = () => load().catch(e => status(`Refresh failed: ${e.message}`, true));

async function load() {
  const j = await api("/api/admin/sessions");
  sessions = j.sessions || [];
  status(`Loaded ${sessions.length} session(s). Click a row for detail.`);
  const fd = $("f-dev").value, fs = $("f-st").value;
  const tb = $("tbl").querySelector("tbody");
  tb.innerHTML = "";
  sessions.filter(s => (!fd || s.device_confirmed === fd || s.device_detected === fd) && (!fs || s.completion_status === fs)).forEach(s => {
    const tr = document.createElement("tr");
    tr.className = "row";
    const ca = (s.confirm_assignment && typeof s.confirm_assignment === "object") ? s.confirm_assignment : {};
    const confirmed = Object.entries(ca).filter(([, v]) => v === "confirm").map(([k]) => k).join(",");
    const f = s.flags || {};
    tr.innerHTML = `<td>${s.id.slice(0, 8)}</td><td>${s.device_confirmed || s.device_detected || ""}</td><td>${new Date(s.created_at).toLocaleString()}</td><td>${s.completion_status}</td><td>${confirmed}</td><td>${[`S4_C1:${f.S4_C1_discordant ?? "-"}`, `L3:${f.L3_L3b_inconsistent ?? "-"}`].join(" ")}</td><td><button data-del="${s.id}">del</button></td>`;
    tr.onclick = (e) => { if (e.target.dataset.del) return; detail(s.id); };
    tr.querySelector("[data-del]").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Delete session?")) return;
      try {
        await api(`/api/admin/sessions/${s.id}`, { method: "DELETE" });
        await load();
      } catch (err) { status(`Delete failed: ${err.message}`, true); }
    };
    tb.appendChild(tr);
  });
  // Auto-open the first session so detail/trajectory/events are never blank.
  const shown = sessions.filter(s => (!fd || s.device_confirmed === fd || s.device_detected === fd) && (!fs || s.completion_status === fs));
  if (shown.length) await detail(shown[0].id);
}
async function detail(id) {
  let d;
  try {
    d = await api(`/api/admin/sessions/${id}`);
  } catch (e) { status(`Detail failed: ${e.message}`, true); return; }
  cur = d;
  try {
  const { session, answers, metrics, flags, events } = d;
  // Server sends question_order/confirm_assignment already parsed; accept strings too.
  const order = Array.isArray(session.question_order) ? session.question_order : JSON.parse(session.question_order || "[]");
  const ca = (session.confirm_assignment && typeof session.confirm_assignment === "object")
    ? session.confirm_assignment : JSON.parse(session.confirm_assignment || "{}");
  const agg = (qid, name) => metrics.find(m => m.question_id === qid && m.visit_id == null && m.metric_name === name);
  const hes = (qid) => {
    const h = agg(qid, "hesitation_score");
    const comps = ["time_to_submit", "hover_switches", "direction_changes", "max_deviation_toward_unchosen"]
      .map(c => `${c}=${agg(qid, c)?.value_raw?.toFixed?.(1) ?? agg(qid, c)?.value_raw ?? "–"}`).join(" ");
    return `${h?.value_raw?.toFixed?.(2) ?? "–"} <small>(${comps})</small>`;
  };
  let html = `<p><b>${session.id}</b> seed=${session.seed} order=${order.join(",")}</p>`;
  if (session.contact_email) html += `<p>Results email: <b>${esc(session.contact_email)}</b></p>`;
  html += `<table><thead><tr><th>q</th><th>first</th><th>final</th><th>rev</th><th>confirm</th><th>hesitation (components)</th><th>self-rep</th></tr></thead><tbody>`;
  for (const qid of order) {
    const a = answers[qid];
    html += `<tr><td>${qid}</td><td>${JSON.stringify(a?.first ?? "")}</td><td>${JSON.stringify(a?.final ?? "")}</td>
      <td>${agg(qid, "revision_count")?.value_raw ?? agg(qid, "revision_count")?.value_raw ?? 0}</td>
      <td>${ca[qid] || ""}/${events.find(e => e.question_id === qid && e.type === "confirm_response")?.payload.choice || ""}</td>
      <td>${hes(qid)}</td><td>${flags[`self_reported_hesitation:${qid}`] ?? ""}</td></tr>`;
  }
  // timeline per question: markers on a time axis
  html += `</tbody></table><h3>Timeline (per question, ms since q_shown)</h3>`;
  for (const qid of order.slice(0, 18)) {
    const ev = events.filter(e => e.question_id === qid).sort((a, b) => a.t - b.t);
    if (!ev.length) continue;
    const tmax = Math.max(...ev.map(e => e.t), 1);
    const marks = ev.map(e => `<span title="${e.type} @${Math.round(e.t)}" style="position:absolute;left:${(100 * e.t / tmax).toFixed(1)}%;top:0">|</span>`).join("");
    html += `<div><b>${qid}</b> <div style="position:relative;height:18px;background:#f3f4f6">${marks}</div></div>`;
  }
  $("detail").innerHTML = html;
  // trajectory selector
  const tq = $("traj-q");
  tq.innerHTML = events.map(e => e.question_id).filter((v, i, a) => v && a.indexOf(v) === i).map(q => `<option>${q}</option>`).join("");
  tq.onchange = drawTraj;
  drawTraj();
  // raw events
  const filt = ($("ev-f").value || "").trim();
  const tb = $("evtbl").querySelector("tbody");
  tb.innerHTML = "";
  events.filter(e => !filt || e.type.includes(filt)).slice(0, 500).forEach(e => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${e.seq}</td><td>${e.type}</td><td>${e.question_id || ""}</td><td>${e.visit_id ?? ""}</td><td>${Math.round(e.t ?? 0)}</td><td><code>${JSON.stringify(e.payload).slice(0, 200)}</code></td>`;
    tb.appendChild(tr);
  });
  } catch (e) { status(`Detail render failed: ${e.message}`, true); }
}
$("ev-f").oninput = () => cur && detail(cur.session.id);

function drawTraj() {
  const c = $("traj"), ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  if (!cur) return;
  const qid = $("traj-q").value;
  const ev = cur.events.filter(e => e.question_id === qid);
  const snap = [...ev].reverse().find(e => e.type === "layout_snapshot");
  if (snap) {
    for (const b of Object.values(snap.payload.boxes || {})) {
      const sx = c.width / 800, sy = c.height / 600; // viewport→canvas scale approx
      ctx.strokeStyle = "#2563eb"; ctx.strokeRect(b.x * sx, b.y * sy, Math.max(b.w * sx, 20), Math.max(b.h * sy, 14));
      ctx.fillStyle = "#333"; ctx.fillText(b.id.slice(0, 14), b.x * sx, b.y * sy - 2);
    }
  }
  const moves = ev.filter(e => e.type === "pointer_move").sort((a, b) => a.t - b.t);
  moves.forEach((m, i) => {
    const sx = c.width / 800, sy = c.height / 600;
    ctx.fillStyle = `hsl(${(240 - 240 * i / Math.max(moves.length, 1)).toFixed(0)},80%,45%)`;
    ctx.beginPath(); ctx.arc(m.payload.x_vp * sx, m.payload.y_vp * sy, 2.5, 0, 7); ctx.fill();
  });
  ev.filter(e => e.type === "pointer_down" || e.type === "pointer_up").forEach(e => {
    const sx = c.width / 800, sy = c.height / 600;
    ctx.fillStyle = "#000";
    ctx.fillRect(e.payload.x_vp * sx - 3, e.payload.y_vp * sy - 3, 6, 6);
  });
}

// ---- tiny canvas chart helpers (no deps, first-party) ----
const PALETTE = ["#2563eb", "#f59e0b", "#16a34a", "#9333ea", "#6b7280"];
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function C(id) { const c = $(id), x = c.getContext("2d"); x.clearRect(0, 0, c.width, c.height); return [c, x]; }
function stats(a) {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return { n: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, min: v[0], p25: q(.25), med: q(.5), p75: q(.75), max: v[v.length - 1], mean: v.reduce((s, x) => s + x, 0) / v.length };
}
function bars(id, counts) {
  // counts: {label: n}
  const [c, x] = C(id);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  const bw = c.width / Math.max(entries.length, 1);
  entries.forEach(([lab, n], i) => {
    const h = (n / total) * (c.height - 50);
    x.fillStyle = PALETTE[i % PALETTE.length];
    x.fillRect(i * bw + 8, c.height - 24 - h, bw - 16, h);
    x.fillStyle = "#000"; x.font = "11px sans-serif";
    x.fillText(`${lab} (${n})`, i * bw + 8, c.height - 8);
  });
  x.fillStyle = "#000"; x.fillText(`n=${total}`, 8, 12);
}
function histOverlap(id, series) {
  // series: {label: number[]}
  const [c, x] = C(id);
  const all = Object.values(series).flat().filter(Number.isFinite);
  if (!all.length) { x.fillStyle = "#000"; x.fillText("no data", 8, 16); return; }
  const lo = Math.min(...all), hi = Math.max(...all);
  const B = 10, span = (hi - lo) || 1;
  const keys = Object.keys(series);
  const bins = keys.map(k => {
    const b = new Array(B).fill(0);
    for (const v of series[k]) if (Number.isFinite(v)) b[Math.min(B - 1, Math.floor((v - lo) / span * B))]++;
    return b;
  });
  const mx = Math.max(...bins.flat(), 1);
  const bh = (c.height - 50) / B;
  keys.forEach((k, si) => {
    const st = stats(series[k]);
    x.fillStyle = "#000"; x.font = "11px sans-serif";
    x.fillText(`${k} n=${st.n} mean=${st.mean?.toFixed?.(0) ?? "?"} med=${st.med?.toFixed?.(0) ?? "?"}`, 8 + si * 180, 12);
    x.fillStyle = PALETTE[si % PALETTE.length] + "cc";
    bins[si].forEach((n, b) => {
      const w = (n / mx) * (c.width / keys.length - 20);
      const y = 20 + b * bh;
      x.fillRect(10 + si * (c.width / keys.length), y, w, bh - 2);
    });
  });
  x.fillStyle = "#666";
  x.fillText(`${lo.toFixed(0)}`, 8, c.height - 8);
  x.fillText(`${hi.toFixed(0)}`, c.width - 40, c.height - 8);
}
function strip(id, points) {
  // points: [{x, changed}]
  const [c, x] = C(id);
  const xs = points.map(p => p.x).filter(Number.isFinite);
  if (!xs.length) { x.fillStyle = "#000"; x.fillText("no data", 8, 16); return; }
  const lo = Math.min(...xs), hi = Math.max(...xs), span = (hi - lo) || 1;
  x.fillStyle = "#000"; x.font = "11px sans-serif";
  x.fillText("kept (0)", 8, 30); x.fillText("changed (1)", 8, 80);
  points.forEach((p, i) => {
    if (!Number.isFinite(p.x)) return;
    const px = 80 + ((p.x - lo) / span) * (c.width - 100);
    const py = p.changed ? 74 + (i % 5) * 4 : 24 + (i % 5) * 4;
    x.fillStyle = p.changed ? "#dc2626" : "#2563eb";
    x.beginPath(); x.arc(px, py, 4, 0, 7); x.fill();
  });
}

async function loadQV() {
  const qid = $("qv-q").value.trim();
  let j;
  try {
    j = await api(`/api/admin/questions/${encodeURIComponent(qid)}/stats`);
  } catch (e) { status(`Question view failed: ${e.message}`, true); return; }
  const rows = j.rows || [];
  const dist = {};
  for (const row of rows) {
    const k = Array.isArray(row.final) ? row.final.join("+") || "∅" : String(row.final ?? "∅");
    dist[k] = (dist[k] || 0) + 1;
  }
  bars("qv-dist", dist);
  const byDev = (met) => {
    const out = {};
    for (const row of rows) {
      const v = met === "revision_count" ? (row.metrics[met] ?? 0) : row.metrics[met];
      if (met === "revision_count" || Number.isFinite(v)) (out[row.device] ??= []).push(v);
    }
    return out;
  };
  histOverlap("qv-time", byDev("time_to_submit"));
  histOverlap("qv-hes", byDev("hesitation_score"));
  histOverlap("qv-rev", byDev("revision_count"));
  const allT = rows.map(r => r.metrics.time_to_submit).filter(Number.isFinite);
  const allH = rows.map(r => r.metrics.hesitation_score).filter(Number.isFinite);
  $("qv-tbl").innerHTML = `<p>n=${rows.length}.</p>` +
    `<pre>time_to_submit ${JSON.stringify(stats(allT))}\nhesitation ${JSON.stringify(stats(allH))}</pre>`;
}
$("btn-qv").onclick = loadQV;

async function loadCmp() {
  const q = $("cmp-q").value.trim(), by = $("cmp-by").value;
  let j;
  try {
    j = await api(`/api/admin/compare?question=${encodeURIComponent(q)}&by=${by}`);
  } catch (e) { status(`Comparison failed: ${e.message}`, true); return; }
  const g = (met) => Object.fromEntries(Object.entries(j.groups || {}).map(([k, v]) => [k, v.rows.map(x => x.metrics[met]).filter(Number.isFinite)]));
  histOverlap("cmp-time", g("time_to_submit"));
  histOverlap("cmp-hes", g("hesitation_score"));
  strip("cmp-strip", j.prePrompt || []);
  const ag = j.agreement || {};
  $("cmp-out").innerHTML = `<p>` +
    `Pre-prompt hesitation vs confirm change: point-biserial r=${j.prePrompt_r?.toFixed?.(2) ?? "–"} (n=${(j.prePrompt || []).length}, exploratory). ` +
    `Self-report × behavior agreement: both=${ag.both ?? 0}, neither=${ag.neither ?? 0}, behavior-only=${ag.behav_only ?? 0}, self-only=${ag.self_only ?? 0}.</p>` +
    `<pre>${JSON.stringify(j.summary, null, 1)}</pre>`;
}
$("btn-cmp").onclick = loadCmp;

// Auto-load graphs on login so squares are never blank when data exists.
async function loadAll() {
  await load();
  await Promise.allSettled([loadQV(), loadCmp()]);
}
