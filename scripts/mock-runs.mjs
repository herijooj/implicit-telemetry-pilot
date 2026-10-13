// Mock runs: creates synthetic sessions through the public API so the dashboard
// has data to show. Seeded, varied hesitation/revision patterns. Usage:
//   node scripts/mock-runs.mjs [N=12] [BASE=http://localhost:3000]
import { mulberry32, shuffled } from "../lib/random.js";

const BASE = process.argv[3] || "http://localhost:3000";
const N = Number(process.argv[2] || 12);

const QTYPE = {
  B1: "radio", B2: "number", B3: "dropdown", R1: "number", R2: "number", R3: "number",
  S1: "yesno", S2: "yesno", S3: "yesno", S4: "yesno", S5: "yesno",
  L1: "likert5", L2: "likert5", L3: "likert5", L3b: "likert5", C1: "yesno", T1: "text", Z: "multiselect",
};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const LIKERT = ["1","2","3","4","5"];
const TEXTS = [
  "Missed the bus and ran the last two blocks in the rain.",
  "Overslept after my alarm died overnight.",
  "Traffic jam on the highway, arrived 40 minutes late.",
  "Could not find my keys anywhere that morning.",
];

async function post(path, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} -> ${r.status}: ${await r.text()}`);
  return r.json();
}

function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }
function int(rand, lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }

async function mockSession(i) {
  const rand = mulberry32(1000 + i * 77);
  const devices = ["desktop", "desktop", "phone", "tablet"];
  const device = devices[i % devices.length];
  const slow = device === "phone" ? 1.4 : device === "tablet" ? 1.2 : 1.0;

  const s = await post("/api/session", {
    synthetic: true,
    device_detected: device,
    viewport: { w: device === "phone" ? 390 : 1280, h: device === "phone" ? 844 : 800 },
    screen: { w: device === "phone" ? 390 : 1920, h: device === "phone" ? 844 : 1080 },
    dpr: 2, lang: "en-US",
  });
  const { session_id: sid, order, confirm_assignment: ca } = s;
  let seq = 0;
  const evs = [];
  const E = (type, qid, visit, t, payload = {}) => evs.push({ seq: ++seq, type, question_id: qid, visit_id: visit, t, t_abs: Date.now() + Math.round(t), payload });
  const answers = {}; // qid -> {first, final}

  E("session_start", null, null, 0, { app_version: s.app_version, seed: s.seed, order, confirm_assignment: ca, device_detected: device });
  E("consent_given", null, null, 0, { consent_text_version: "v1" });
  E("context_submitted", null, null, 0, { device_confirmed: device, age_range: pick(rand, ["18–24", "25–34", "35–44", "Prefer not to say"]) });

  const flip = (v) => (v === "Yes" ? "No" : v === "No" ? "Yes" : v);
  let s4val = null;

  for (let pos = 0; pos < order.length; pos++) {
    const qid = order[pos];
    const type = QTYPE[qid];
    const hesitant = rand() < (qid.startsWith("S") || qid === "T1" ? 0.45 : 0.2); // trait-like
    const base = (hesitant ? 6000 + rand() * 9000 : 1200 + rand() * 2500) * slow;
    E("q_shown", qid, 1, 0, { position_index: pos });

    // pointer walk + layout snapshot
    const nMoves = hesitant ? int(rand, 15, 40) : int(rand, 2, 8);
    let px = 100 + rand() * 200, py = 100 + rand() * 200;
    const boxes = {};
    const nOpts = type === "likert5" ? 5 : type === "yesno" || type === "radio" ? 2 : 1;
    for (let o = 0; o < nOpts; o++) boxes[`opt-${qid}-${o}`] = { id: `opt-${qid}-${o}`, x: 80 + o * 120, y: 200, w: 100, h: 40 };
    E("layout_snapshot", qid, 1, 5, { boxes });
    const tFirst = Math.max(200, base * 0.3);
    E("q_first_interaction", qid, 1, tFirst, { modality: device === "phone" ? "touch" : "mouse" });
    for (let k = 0; k < nMoves; k++) {
      px += (rand() - 0.5) * 160; py += (rand() - 0.5) * 120;
      E("pointer_move", qid, 1, tFirst + (k + 1) * ((base * 0.5) / nMoves), {
        x_vp: Math.round(px), y_vp: Math.round(py), x_el: Math.round(px - 50), y_el: Math.round(py - 50),
        pointer_type: device === "phone" ? "touch" : "mouse",
      });
    }
    if (hesitant && nOpts > 1) {
      E("hover_enter", qid, 1, tFirst + 100, { option_id: `opt-${qid}-0` });
      E("hover_leave", qid, 1, tFirst + 400, { option_id: `opt-${qid}-0` });
      E("hover_enter", qid, 1, tFirst + 500, { option_id: `opt-${qid}-1` });
      E("hover_leave", qid, 1, tFirst + 900, { option_id: `opt-${qid}-1` });
    }
    if (rand() < 0.12) { E("blur", qid, 1, base * 0.6, { element_id: `in-${qid}` }); E("focus", qid, 1, base * 0.6 + 1500, { element_id: `in-${qid}` }); }

    // value
    let v;
    if (qid === "B1") v = pick(rand, ["Day", "Night"]);
    else if (qid === "B2") v = String(int(rand, 0, 10));
    else if (qid === "B3") v = pick(rand, MONTHS);
    else if (qid === "R1") v = String(int(rand, 1, 30));
    else if (qid === "R2") v = String(int(rand, 0, 20));
    else if (qid === "R3") v = String(int(rand, 0, 7));
    else if (qid === "S4") { v = pick(rand, ["Yes", "No"]); s4val = v; }
    else if (qid === "C1") v = rand() < 0.7 ? s4val || "Yes" : flip(s4val || "Yes"); // usually agrees w/ S4
    else if (type === "yesno") v = qid === "S3" ? (rand() < 0.85 ? "Yes" : "No") : pick(rand, ["Yes", "No"]);
    else if (type === "likert5") v = qid === "L3b" && answers.L3 ? String(6 - Number(answers.L3.final)) : pick(rand, LIKERT); // consistent pair mostly
    else if (qid === "T1") v = pick(rand, TEXTS);
    else if (qid === "Z") v = null; // handled below
    if (qid === "L3" && i % 4 === 3) v = answers.L3b ? answers.L3b.final : v; // break reverse pair → inconsistent flag

    if (qid === "Z") {
      const cands = order.filter((q) => q !== "Z" && (hesitant ? rand() < 0.3 : rand() < 0.08));
      const sel = cands.slice(0, int(rand, 0, 3));
      E("answer_z_submitted", qid, 1, base, { selected_ids: sel });
      E("q_submitted", qid, 1, base + 200, { value: sel });
      answers[qid] = { first: sel, final: sel };
      continue;
    }

    E("q_answered_first", qid, 1, base * 0.7, { value: type === "text" ? "[text]" : v });
    if (type === "text" || type === "number") {
      const str = String(v);
      let kt = base * 0.4;
      for (let c = 0; c < Math.min(str.length, 30); c++) {
        E("key", qid, 1, kt, { phase: "down", key_class: "char", element_id: `in-${qid}` });
        E("key", qid, 1, kt + 60 + rand() * 80, { phase: "up", key_class: "char", element_id: `in-${qid}` });
        kt += 120 + rand() * (hesitant ? 900 : 150);
      }
      if (hesitant) { E("key", qid, 1, kt + 2500, { phase: "down", key_class: "backspace", element_id: `in-${qid}` }); E("key", qid, 1, kt + 2560, { phase: "up", key_class: "backspace", element_id: `in-${qid}` }); }
    }

    let final = v;
    const willRevise = hesitant ? rand() < 0.4 : rand() < 0.08;
    if (willRevise && (type === "yesno" || type === "radio" || type === "likert5")) {
      const alt = type === "yesno" ? flip(v) : type === "radio" ? (v === "Day" ? "Night" : "Day") : String(int(rand, 1, 5));
      E("answer_changed", qid, 1, base * 0.85, { old: v, new: alt, source: "user" });
      final = alt;
    }
    // confirm manipulation
    if (ca[qid] === "confirm") {
      E("confirm_shown", qid, 1, base, { answer_at_prompt: final });
      const change = hesitant ? rand() < 0.5 : rand() < 0.1;
      const lat = Math.round(800 + rand() * (hesitant ? 6000 : 2000));
      if (change && (type === "yesno")) {
        const f2 = flip(final);
        E("answer_changed", qid, 1, base + lat, { old: final, new: f2, source: "confirm_change" });
        final = f2;
        E("confirm_response", qid, 1, base + lat, { choice: "change", latency_ms: lat });
      } else {
        E("confirm_response", qid, 1, base + lat, { choice: "keep", latency_ms: lat });
      }
      E("q_submitted", qid, 1, base + lat + 100, { value: final, chosen_id: final === "Yes" ? `opt-${qid}-0` : final === "No" ? `opt-${qid}-1` : undefined });
    } else {
      E("pointer_down", qid, 1, base, { x_vp: 130, y_vp: 220, target_id: `opt-${qid}-0`, button: 0 });
      E("pointer_up", qid, 1, base + 60, { x_vp: 130, y_vp: 220, target_id: `opt-${qid}-0`, button: 0 });
      E("q_submitted", qid, 1, base + 100, { value: final });
    }
    answers[qid] = { first: v, final };
  }

  await post("/api/events", { session_id: sid, events: evs });
  for (const [qid, a] of Object.entries(answers)) {
    await post("/api/answers", { session_id: sid, question_id: qid, value: a.first });
    if (JSON.stringify(a.first) !== JSON.stringify(a.final))
      await post("/api/answers", { session_id: sid, question_id: qid, value: a.final });
  }
  await post(`/api/session/${sid}/end`, { completion_status: "completed" });
  return sid;
}

const ids = [];
for (let i = 0; i < N; i++) ids.push(await mockSession(i));
console.log(`created ${ids.length} mock sessions`);
