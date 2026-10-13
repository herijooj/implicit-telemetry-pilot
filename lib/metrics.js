// Derived metrics per §7. Pure function of raw events → idempotent recompute.
import { config } from "../config.js";
import { BASELINE } from "./questions.js";
export const METRIC_VERSION = "m2";

function mean(a) { if (!a.length) return null; return a.reduce((x, y) => x + y, 0) / a.length; }
function sd(a, m) {
  if (a.length < 2) return 0;
  m = m ?? mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
const first = (ev, ...types) => ev.find(e => types.includes(e.type));

// events: raw rows with parsed payload. answers: {qid:{first,final}}
export function computeMetrics(allEvents, answers, idlePauseMs = config.IDLE_PAUSE_MS) {
  const byQ = {};
  for (const e of allEvents) {
    const q = e.question_id || "__session__";
    (byQ[q] ??= []).push(e);
  }
  const rows = []; // {question_id, visit_id, metric_name, value_raw}
  const push = (qid, visit, name, raw) => rows.push({ question_id: qid, visit_id: visit, metric_name: name, value_raw: raw, metric_version: METRIC_VERSION });

  for (const [qid, evs] of Object.entries(byQ)) {
    if (qid === "__session__") continue;
    const visits = [...new Set(evs.map(e => e.visit_id ?? 1))];
    for (const v of visits) {
      const ev = evs.filter(e => (e.visit_id ?? 1) === v).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      const shown = first(ev, "q_shown");
      const t0 = shown ? shown.t : 0;
      const fi = first(ev, "q_first_interaction");
      const fa = first(ev, "q_answered_first");
      const sub = [...ev].reverse().find(e => e.type === "q_submitted");
      if (shown && fi) push(qid, v, "time_to_first_interaction", fi.t - t0);
      if (shown && fa) push(qid, v, "time_to_first_answer", fa.t - t0);
      if (shown && sub) push(qid, v, "time_to_submit", sub.t - t0);

      const revs = ev.filter(e => e.type === "answer_changed" && (e.payload.source || "user") === "user");
      push(qid, v, "revision_count", revs.length);
      push(qid, v, "option_switches_before_submit", revs.length);
      const cc = ev.some(e => e.type === "answer_changed" && e.payload.source === "confirm_change");
      push(qid, v, "confirm_changed", cc ? 1 : 0);
      const confirmed = ev.find(e => e.type === "confirm_response");
      if (confirmed) push(qid, v, "confirm_latency", confirmed.payload.latency_ms ?? null);

      // Keyboard (number/text): key events carry phase + key_class only (§6.1)
      const keys = ev.filter(e => e.type === "key").sort((a, b) => a.t - b.t);
      const downs = keys.filter(k => k.payload.phase === "down");
      const nChar = downs.filter(k => k.payload.key_class === "char").length;
      const nBs = downs.filter(k => k.payload.key_class === "backspace").length;
      const nDel = downs.filter(k => k.payload.key_class === "delete").length;
      push(qid, v, "backspace_count", nBs);
      push(qid, v, "delete_count", nDel);
      push(qid, v, "backspace_ratio", nChar ? nBs / nChar : 0);
      // dwell (down→up) + flight (up→next down) summarized
      const dwells = [];
      const flights = [];
      const pend = {};
      // pair by order: track last up time
      let lastUp = null;
      for (const k of keys) {
        if (k.payload.phase === "down") {
          if (lastUp != null) flights.push(k.t - lastUp);
        } else if (k.payload.phase === "up") {
          lastUp = k.t;
        }
      }
      // dwell needs matched pairs — approximate with consecutive down/up gaps
      for (let i = 0; i + 1 < keys.length; i++) {
        if (keys[i].payload.phase === "down" && keys[i + 1].payload.phase === "up") dwells.push(keys[i + 1].t - keys[i].t);
      }
      push(qid, v, "dwell_mean", mean(dwells));
      push(qid, v, "dwell_sd", dwells.length > 1 ? sd(dwells) : 0);
      push(qid, v, "flight_mean", mean(flights));
      push(qid, v, "flight_sd", flights.length > 1 ? sd(flights) : 0);
      let idle = 0, idleMs = 0;
      for (let i = 1; i < keys.length; i++) {
        const g = keys[i].t - keys[i - 1].t;
        if (g > idlePauseMs) { idle++; idleMs += g; }
      }
      push(qid, v, "idle_pauses", idle);
      push(qid, v, "idle_total_ms", idleMs);
      if (shown && sub && nChar) {
        const secs = Math.max((sub.t - t0) / 1000, 0.001);
        push(qid, v, "chars_per_second", nChar / secs);
      }

      // Pointer
      const pm = ev.filter(e => e.type === "pointer_move").sort((a, b) => a.t - b.t);
      let path = 0, dirChanges = 0, prevAng = null;
      for (let i = 1; i < pm.length; i++) {
        const dx = pm[i].payload.x_vp - pm[i - 1].payload.x_vp;
        const dy = pm[i].payload.y_vp - pm[i - 1].payload.y_vp;
        path += Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        if (prevAng != null) {
          let d = Math.abs(ang - prevAng);
          if (d > Math.PI) d = 2 * Math.PI - d;
          if (d > Math.PI / 4) dirChanges++;
        }
        prevAng = ang;
      }
      push(qid, v, "path_length", path);
      push(qid, v, "direction_changes", dirChanges);
      const hovers = ev.filter(e => e.type === "hover_enter");
      push(qid, v, "hover_switches", Math.max(hovers.length - 1, 0));
      // hover time per option → total
      push(qid, v, "hover_time_total", hoverTime(ev));
      push(qid, v, "click_to_decision_ratio", clickDecision(ev));
      push(qid, v, "max_deviation_toward_unchosen", maxDeviation(ev));

      // Attention
      const blurs = ev.filter(e => e.type === "blur");
      push(qid, v, "blur_count", blurs.length);
      push(qid, v, "blur_total_ms", blurTotal(ev));
      const hidden = ev.filter(e => e.type === "visibility_change" && e.payload.state === "hidden");
      push(qid, v, "tab_hidden_count", hidden.length);
      push(qid, v, "tab_hidden_total_ms", hiddenTotal(ev));

      const backs = ev.filter(e => e.type === "q_back_navigated");
      push(qid, v, "back_navigations_to_item", backs.length);
    }
    // Aggregate across visits (visit_id=null): sum visit-level counts/times so the
    // dashboard and compare views can read one row per question-session.
    const all = evs;
    const showns = all.filter(e => e.type === "q_shown").sort((a, b) => a.t_abs - b.t_abs);
    const subs = all.filter(e => e.type === "q_submitted").sort((a, b) => a.t_abs - b.t_abs);
    let dwell = 0;
    for (let i = 0; i < Math.min(showns.length, subs.length); i++) dwell += Math.max(subs[i].t - showns[i].t, 0);
    push(qid, null, "total_dwell", dwell);
    push(qid, null, "time_to_submit", dwell);
    const vrows = (n) => rows.filter(r => r.question_id === qid && r.visit_id != null && r.metric_name === n && typeof r.value_raw === "number").map(r => r.value_raw);
    const vsum = (n) => { const v = vrows(n); return v.length ? v.reduce((s, x) => s + x, 0) : 0; };
    for (const n of ["revision_count", "option_switches_before_submit", "backspace_count", "delete_count",
      "idle_pauses", "idle_total_ms", "path_length", "direction_changes", "hover_switches",
      "hover_time_total", "blur_count", "blur_total_ms", "tab_hidden_count", "tab_hidden_total_ms",
      "back_navigations_to_item", "time_to_first_interaction", "time_to_first_answer"]) push(qid, null, n, vsum(n));
    const cc = rows.some(r => r.question_id === qid && r.visit_id != null && r.metric_name === "confirm_changed" && r.value_raw === 1);
    push(qid, null, "confirm_changed", cc ? 1 : 0);
    const cl = rows.find(r => r.question_id === qid && r.visit_id != null && r.metric_name === "confirm_latency" && typeof r.value_raw === "number");
    if (cl) push(qid, null, "confirm_latency", cl.value_raw);
    const a = answers[qid];
    if (a) push(qid, null, "final_changed_from_first", JSON.stringify(a.first) !== JSON.stringify(a.final) ? 1 : 0);
  }

  // Per-participant z-scores vs baseline (B1–B3) §7 normalization
  const base = {};
  for (const r of rows) {
    if (BASELINE.includes(r.question_id) && typeof r.value_raw === "number") (base[r.metric_name] ??= []).push(r.value_raw);
  }
  const stats = {};
  for (const [k, v] of Object.entries(base)) stats[k] = { m: mean(v), s: sd(v, mean(v)) };
  for (const r of rows) {
    const st = stats[r.metric_name];
    r.value_z = (st && st.s > 0 && typeof r.value_raw === "number") ? (r.value_raw - st.m) / st.s : null;
  }

  // Hesitation composite (aggregate visit=null) = mean of z(time_to_submit, hover_switches, direction_changes, max_deviation)
  const comp = ["time_to_submit", "hover_switches", "direction_changes", "max_deviation_toward_unchosen"];
  const qids = [...new Set(rows.map(r => r.question_id))];
  for (const q of qids) {
    const zs = comp.map(c => rows.find(r => r.question_id === q && r.visit_id == null && r.metric_name === c)?.value_z
      ?? mean(rows.filter(r => r.question_id === q && r.metric_name === c && r.value_z != null).map(r => r.value_z)));
    const valid = zs.filter(z => typeof z === "number");
    rows.push({ question_id: q, visit_id: null, metric_name: "hesitation_score", value_raw: valid.length ? mean(valid) : null, value_z: valid.length ? mean(valid) : null, metric_version: METRIC_VERSION });
  }
  return rows;
}

function hoverTime(ev) {
  let total = 0, enter = null;
  for (const e of [...ev].sort((a, b) => a.t - b.t)) {
    if (e.type === "hover_enter") enter = e.t;
    if (e.type === "hover_leave" && enter != null) { total += e.t - enter; enter = null; }
  }
  return total;
}
function clickDecision(ev) {
  const sub = [...ev].reverse().find(e => e.type === "q_submitted");
  const firstHover = ev.filter(e => e.type === "hover_enter").sort((a, b) => a.t - b.t)[0];
  if (!sub || !firstHover) return null;
  return sub.t - firstHover.t;
}
function maxDeviation(ev) {
  // Normalized lateral distance toward unchosen option before final click.
  // Needs layout_snapshot + chosen option centre; else null.
  const snap = [...ev].reverse().find(e => e.type === "layout_snapshot");
  const sub = [...ev].reverse().find(e => e.type === "q_submitted");
  const moves = ev.filter(e => e.type === "pointer_move");
  if (!snap || !sub || moves.length < 2 || !snap.payload.boxes) return null;
  const boxes = Object.values(snap.payload.boxes);
  if (boxes.length < 2) return null;
  const chosenId = sub.payload.chosen_id || snap.payload.chosen_id;
  const chosen = boxes.find(b => b.id === chosenId) || boxes[0];
  const other = boxes.find(b => b.id !== chosen.id);
  if (!other) return null;
  const cx = c => c.x + c.w / 2, cy = c => c.y + c.h / 2;
  const dist = Math.hypot(cx(chosen) - cx(other), cy(chosen) - cy(other)) || 1;
  let mx = 0;
  for (const m of moves) {
    if (m.t >= sub.t) break;
    const d = Math.hypot(m.payload.x_vp - cx(other), m.payload.y_vp - cy(other));
    mx = Math.max(mx, 1 - d / dist);
  }
  return Math.max(0, Math.min(1, mx));
}
function blurTotal(ev) {
  let total = 0, t0 = null;
  for (const e of [...ev].sort((a, b) => a.t - b.t)) {
    if (e.type === "blur") t0 = e.t;
    if (e.type === "focus" && t0 != null) { total += e.t - t0; t0 = null; }
  }
  return total;
}
function hiddenTotal(ev) {
  let total = 0, t0 = null;
  for (const e of [...ev].sort((a, b) => a.t - b.t)) {
    if (e.type === "visibility_change" && e.payload.state === "hidden") t0 = e.t;
    if (e.type === "visibility_change" && e.payload.state === "visible" && t0 != null) { total += e.t - t0; t0 = null; }
  }
  return total;
}

// Consistency flags §7
export function sessionFlags(answers) {
  const out = {};
  if (answers.S4 && answers.C1) {
    const s4 = answers.S4.final, c1 = answers.C1.final;
    out.S4_C1_discordant = (s4 === "Yes") !== (c1 === "Yes");
  }
  if (answers.L3 && answers.L3b) {
    const sum = Number(answers.L3.final) + Number(answers.L3b.final);
    out.L3_L3b_inconsistent = !(sum >= 5 && sum <= 7);
  }
  return out;
}
