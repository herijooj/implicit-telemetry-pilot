// Participant client: flow + first-party telemetry per §6. No third-party trackers.
const QTEXT = {
  B1: ["radio", "Is it currently day or night where you are?", ["Day", "Night"]],
  B2: ["number", "How many windows are in the room you're in?", { min: 0, max: 50 }],
  B3: ["dropdown", "Which month were you born in?", ["January","February","March","April","May","June","July","August","September","October","November","December"]],
  R1: ["number", "How many tabs are open in your browser right now?", { min: 0, max: 999 }],
  R2: ["number", "How many apps have you opened today?", { min: 0, max: 999 }],
  R3: ["number", "How many times last week did you check your phone before getting out of bed?", { min: 0, max: 99 }],
  S1: ["yesno", "Have you ever stepped on a bug on purpose?"],
  S2: ["yesno", "Have you ever pretended to have read a book you hadn't?"],
  S3: ["yesno", 'Have you ever clicked "I agree" without reading the terms?'],
  S4: ["yesno", "Have you ever laughed at a joke you didn't understand?"],
  S5: ["yesno", "Have you ever sent a message to the wrong person?"],
  L1: ["likert5", "I usually finish what I start."],
  L2: ["likert5", "I am a patient person."],
  L3: ["likert5", "I am rarely late."],
  L3b: ["likert5", "I am often late."],
  C1: ["yesno", "Have you ever pretended to get a joke to fit in?"],
  T1: ["text", "Describe the last time you were really late for something."],
  Z: ["multiselect", "Which of these questions made you stop and think? (select all that apply)"],
};
const FLAGGED = new Set(["S1","S2","S3","S4","S5"]);

const S = {
  sid: sessionStorage.getItem("sid") || null,
  order: [], confirm: {}, seed: null,
  idx: 0, visits: {}, answers: {}, firstAnswers: {},
  confirmDone: {}, pendingConfirm: null,
  seq: Number(sessionStorage.getItem("seq") || 0),
  buf: JSON.parse(sessionStorage.getItem("buf") || "[]"),
  qOnset: 0, qOnsetAbs: 0, samplingMs: 50,
  interacted: false, answered: false, lastMove: null, lastMoveT: 0, lastScroll: 0,
};

const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const tRel = () => now() - S.qOnset;

function emit(type, question_id, visit_id, payload = {}) {
  S.seq += 1;
  S.buf.push({ seq: S.seq, type, question_id: question_id ?? null, visit_id: visit_id ?? null, t: question_id ? tRel() : now(), t_abs: Date.now(), payload });
  sessionStorage.setItem("seq", String(S.seq));
  sessionStorage.setItem("buf", JSON.stringify(S.buf.slice(-500)));
  if (S.buf.length >= 50) flush();
}
let flushing = false, failDelay = 1000;
async function flush(useBeacon = false) {
  if (!S.sid || !S.buf.length || flushing) return;
  const batch = S.buf.splice(0, S.buf.length);
  sessionStorage.setItem("buf", JSON.stringify(S.buf));
  const url = "/api/events";
  const body = JSON.stringify({ session_id: S.sid, events: batch });
  try {
    flushing = true;
    if (useBeacon && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      if (!ok) throw new Error("beacon failed");
    } else {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (!r.ok) throw new Error("http " + r.status);
    }
    failDelay = 1000;
  } catch {
    S.buf.unshift(...batch); // keep unsent, retry with backoff
    sessionStorage.setItem("buf", JSON.stringify(S.buf.slice(-500)));
    const d = failDelay; failDelay = Math.min(failDelay * 2, 15000);
    setTimeout(flush, d);
  } finally { flushing = false; }
}
setInterval(flush, 2000);
document.addEventListener("visibilitychange", () => {
  emit("visibility_change", curQ(), curVisit(), { state: document.hidden ? "hidden" : "visible" });
  if (document.hidden) flush(true);
});
window.addEventListener("pagehide", () => flush(true));
window.addEventListener("resize", () => {
  emit("viewport_resize", curQ(), curVisit(), { width: innerWidth, height: innerHeight, orientation: screen.orientation?.type || "" });
  snapshot();
});

const curQ = () => S.order[S.idx] || null;
const curVisit = () => S.visits[curQ()] || 1;

function keyClass(k) {
  if (k.length === 1) return "char";
  if (k === "Backspace") return "backspace";
  if (k === "Delete") return "delete";
  if (k === "Enter") return "enter";
  if (k === "Tab") return "tab";
  if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(k)) return "nav";
  if (["Shift","Control","Alt","Meta","CapsLock"].includes(k)) return "modifier";
  return "other";
}

// ---- global listeners (attached once; guard on active question) ----
document.addEventListener("pointermove", (e) => {
  if (!$("screen-q").hidden === false && curQ()) {
    const t = now();
    if (t - S.lastMoveT < S.samplingMs) return;
    if (S.lastMove && S.lastMove.x === e.clientX && S.lastMove.y === e.clientY) return; // emit only on change
    S.lastMove = { x: e.clientX, y: e.clientY }; S.lastMoveT = t;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const r = ($("q-body")).getBoundingClientRect();
    emit("pointer_move", curQ(), curVisit(), {
      x_vp: Math.round(e.clientX), y_vp: Math.round(e.clientY),
      x_el: Math.round(e.clientX - r.left), y_el: Math.round(e.clientY - r.top),
      pointer_type: e.pointerType || "mouse",
    });
    firstInteraction(e.pointerType === "touch" ? "touch" : "mouse");
  }
}, { passive: true });
document.addEventListener("pointerdown", (e) => {
  if (!curQ() || $("screen-q").hidden) return;
  emit("pointer_down", curQ(), curVisit(), { x_vp: e.clientX, y_vp: e.clientY, target_id: e.target.id || e.target.name || e.target.tagName, button: e.button });
  firstInteraction(e.pointerType === "touch" ? "touch" : "mouse");
}, { passive: true });
document.addEventListener("pointerup", (e) => {
  if (!curQ() || $("screen-q").hidden) return;
  emit("pointer_up", curQ(), curVisit(), { x_vp: e.clientX, y_vp: e.clientY, target_id: e.target.id || e.target.name || e.target.tagName, button: e.button });
}, { passive: true });
document.addEventListener("keydown", (e) => {
  if (!curQ() || $("screen-q").hidden) return;
  if (e.target.closest && e.target.closest("#q-body")) {
    emit("key", curQ(), curVisit(), { phase: "down", key_class: keyClass(e.key), element_id: e.target.id || e.target.name });
    firstInteraction("keyboard");
  }
});
document.addEventListener("keyup", (e) => {
  if (!curQ() || $("screen-q").hidden) return;
  if (e.target.closest && e.target.closest("#q-body"))
    emit("key", curQ(), curVisit(), { phase: "up", key_class: keyClass(e.key), element_id: e.target.id || e.target.name });
});
document.addEventListener("focus", (e) => {
  if (e.target.closest && e.target.closest("#q-body")) emit("focus", curQ(), curVisit(), { element_id: e.target.id || e.target.name });
}, true);
document.addEventListener("blur", (e) => {
  if (e.target.closest && e.target.closest("#q-body")) emit("blur", curQ(), curVisit(), { element_id: e.target.id || e.target.name });
}, true);
document.addEventListener("scroll", () => {
  const t = now();
  if (t - S.lastScroll < 100 || !curQ() || $("screen-q").hidden) return; // throttled 100ms
  S.lastScroll = t;
  emit("scroll", curQ(), curVisit(), { scroll_y: Math.round(scrollY) });
}, { passive: true, capture: true });

function firstInteraction(modality) {
  if (S.interacted || !curQ()) return;
  S.interacted = true;
  emit("q_first_interaction", curQ(), curVisit(), { modality });
}
function firstAnswer(value) {
  if (S.answered || !curQ()) return;
  S.answered = true;
  emit("q_answered_first", curQ(), curVisit(), { value });
}

function snapshot() {
  if (!curQ()) return;
  const boxes = {};
  document.querySelectorAll("#q-body [data-opt-id], #q-body input, #q-body button.opt, #btn-next, #btn-back").forEach(el => {
    const r = el.getBoundingClientRect();
    const id = el.dataset.optId || el.id || el.name || el.tagName;
    boxes[id] = { id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  emit("layout_snapshot", curQ(), curVisit(), { boxes });
}

// ---- flow ----
function detectDevice() {
  if (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820) return "phone";
  if (navigator.maxTouchPoints > 0 && /tablet|ipad/i.test(navigator.userAgent)) return "tablet";
  return "desktop";
}

$("consent-box").addEventListener("change", (e) => { $("btn-start").disabled = !e.target.checked; });

$("btn-start").addEventListener("click", async () => {
  // No telemetry before consent except session creation + consent_given (§13.2)
  const detected = detectDevice();
  const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_detected: detected,
      viewport: { w: innerWidth, h: innerHeight }, screen: { w: screen.width, h: screen.height },
      dpr: devicePixelRatio, lang: navigator.language }) });
  const j = await r.json();
  Object.assign(S, { sid: j.session_id, order: j.order, confirm: j.confirm_assignment, seed: j.seed, samplingMs: j.sampling_ms });
  sessionStorage.setItem("sid", S.sid);
  emit("session_start", null, null, { app_version: j.app_version, seed: j.seed, order: j.order, confirm_assignment: j.confirm_assignment, device_detected: detected, viewport: { w: innerWidth, h: innerHeight }, screen: { w: screen.width, h: screen.height }, dpr: devicePixelRatio, ua: navigator.userAgent.slice(0, 500), lang: navigator.language });
  emit("consent_given", null, null, { consent_text_version: "v1" });
  $("device-sel").value = detected;
  $("device-detected").textContent = `Detected: ${detected} — correct it if wrong.`;
  show("screen-context");
});

$("btn-context-next").addEventListener("click", () => {
  emit("context_submitted", null, null, { device_confirmed: $("device-sel").value, age_range: $("age-sel").value || null });
  S.idx = 0;
  renderQ();
});

function show(id) {
  for (const s of ["screen-consent", "screen-context", "screen-q", "screen-done"]) $(s).hidden = s !== id;
}

function renderQ() {
  const qid = curQ();
  if (!qid) return finish();
  S.visits[qid] = (S.visits[qid] || 0) + 1;
  S.interacted = false; S.answered = S.answers[qid] !== undefined;
  S.qOnset = now(); S.qOnsetAbs = Date.now();
  emit("q_shown", qid, curVisit(), { position_index: S.idx });
  show("screen-q");
  $("progress").textContent = `Question ${S.idx + 1} of ${S.order.length}`;
  const [type, text, extra] = QTEXT[qid];
  $("q-text").textContent = text;
  $("q-err").hidden = true;
  $("btn-back").disabled = S.idx === 0;
  const bodyEl = $("q-body");
  bodyEl.innerHTML = "";
  const existing = S.answers[qid];

  const trackChange = (oldV, newV, source = "user") => {
    emit("answer_changed", qid, curVisit(), { old: oldV ?? null, new: newV, source });
    emit("q_answered_first", qid, curVisit(), { value: newV });
  };

  if (type === "radio" || type === "yesno" || type === "likert5") {
    const LIKERT = [
      ["1", "Strongly disagree"], ["2", "Disagree"], ["3", "Neutral"],
      ["4", "Agree"], ["5", "Strongly agree"],
    ];
    const opts = type === "yesno" ? [["Yes", "Yes"], ["No", "No"]]
      : type === "likert5" ? LIKERT
      : extra.map(o => [o, o]);
    const wrap = document.createElement("div");
    wrap.className = "opts"; wrap.setAttribute("role", "radiogroup");
    opts.forEach(([op, label], i) => {
      const id = `opt-${qid}-${i}`;
      const lab = document.createElement("label");
      lab.dataset.optId = id;
      lab.innerHTML = `<input type="radio" name="${qid}" id="${id}" value="${op}" ${existing === op ? "checked" : ""}>${label}`;
      const inp = lab.querySelector("input");
      inp.addEventListener("change", () => {
        const old = S.answers[qid];
        if (old !== undefined && old !== op) trackChange(old, op);
        else firstAnswer(op);
        S.answers[qid] = op;
        validate();
      });
      lab.addEventListener("mouseenter", () => emit("hover_enter", qid, curVisit(), { option_id: id }));
      lab.addEventListener("mouseleave", () => emit("hover_leave", qid, curVisit(), { option_id: id }));
      wrap.appendChild(lab);
    });
    bodyEl.appendChild(wrap);
  } else if (type === "number") {
    const inp = document.createElement("input");
    inp.type = "number"; inp.id = `in-${qid}`; inp.min = extra.min; inp.max = extra.max; inp.value = existing ?? "";
    inp.setAttribute("aria-label", text);
    inp.addEventListener("input", () => {
      const old = S.answers[qid];
      if (inp.value !== "" && old !== undefined && String(old) !== inp.value) trackChange(old, inp.value);
      else if (inp.value !== "" && old === undefined) firstAnswer(inp.value);
      if (inp.value !== "") S.answers[qid] = inp.value;
      validate();
    });
    inp.addEventListener("paste", () => emit("paste", qid, curVisit(), { element_id: inp.id, length: (navigator.clipboard ? -1 : -1) }));
    bodyEl.appendChild(inp);
  } else if (type === "dropdown") {
    const sel = document.createElement("select");
    sel.id = `in-${qid}`;
    sel.innerHTML = `<option value="">— select —</option>` + extra.map(m => `<option ${existing === m ? "selected" : ""}>${m}</option>`).join("");
    sel.addEventListener("change", () => {
      const old = S.answers[qid];
      if (old !== undefined && old !== sel.value) trackChange(old, sel.value);
      else if (sel.value) firstAnswer(sel.value);
      S.answers[qid] = sel.value;
      validate();
    });
    bodyEl.appendChild(sel);
  } else if (type === "text") {
    const ta = document.createElement("textarea");
    ta.id = `in-${qid}`; ta.maxLength = 1000; ta.rows = 4; ta.value = existing ?? "";
    ta.setAttribute("aria-label", text);
    ta.addEventListener("input", () => {
      const old = S.answers[qid];
      if (old !== undefined && old !== ta.value) emit("answer_changed", qid, curVisit(), { old, new: ta.value, source: "user" });
      else if (old === undefined && ta.value) firstAnswer("[text]");
      S.answers[qid] = ta.value;
      validate();
    });
    ta.addEventListener("paste", () => emit("paste", qid, curVisit(), { element_id: ta.id, length: ta.value.length }));
    bodyEl.appendChild(ta);
  } else if (type === "multiselect") {
    // Z: options in administration order + exclusive "None of them"
    const list = S.order.filter(q => q !== "Z");
    const sel = new Set(Array.isArray(existing) ? existing : []);
    const wrap = document.createElement("div");
    wrap.className = "opts"; wrap.style.flexDirection = "column";
    const redraw = () => {
      wrap.innerHTML = "";
      [...list.map(q => [q, QTEXT[q][1]]), ["NONE", "None of them"]].forEach(([id, label]) => {
        const lab = document.createElement("label");
        lab.dataset.optId = `z-${id}`;
        lab.innerHTML = `<input type="checkbox" value="${id}" ${sel.has(id) ? "checked" : ""}>${label}`;
        lab.querySelector("input").addEventListener("change", (e) => {
          if (id === "NONE" && e.target.checked) sel.clear();
          if (id !== "NONE" && e.target.checked) sel.delete("NONE");
          e.target.checked ? sel.add(id) : sel.delete(id);
          S.answers[qid] = [...sel];
          firstAnswer([...sel]);
          emit("answer_changed", qid, curVisit(), { old: null, new: [...sel], source: "user" });
          validate(); redraw();
        });
        wrap.appendChild(lab);
      });
    };
    redraw();
    bodyEl.appendChild(wrap);
  }
  validate();
  requestAnimationFrame(snapshot);
}

function currentValueValid() {
  const qid = curQ();
  const [type, , extra] = QTEXT[qid];
  const v = S.answers[qid];
  if (qid === "Z") return true; // optional-ish self-report; empty = none
  if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) return false;
  if (type === "number") {
    const n = Number(v);
    if (!Number.isInteger(n) || n < extra.min || n > extra.max) return false;
  }
  if (type === "text" && String(v).length < 1) return false;
  return true;
}
function validate() {
  const qid = curQ();
  const ok = currentValueValid();
  $("btn-next").disabled = !ok;
  if (!ok && S.answers[qid] !== undefined && S.answers[qid] !== "") {
    $("q-err").hidden = false;
    $("q-err").textContent = "Please enter a valid integer in range.";
    emit("validation_error", qid, curVisit(), { error_code: "number_range" });
  } else $("q-err").hidden = true;
}

$("btn-back").addEventListener("click", () => {
  if (S.idx === 0) return;
  const from = curQ();
  S.idx -= 1;
  emit("q_back_navigated", curQ(), curVisit(), { from_question_id: from, to_question_id: curQ() });
  renderQ();
});

$("btn-next").addEventListener("click", async () => {
  const qid = curQ();
  const v = S.answers[qid];
  if (qid === "Z") emit("answer_z_submitted", qid, curVisit(), { selected_ids: v || [] });
  emit("q_submitted", qid, curVisit(), { value: typeof v === "string" && QTEXT[qid][0] === "text" ? v : v, chosen_id: chosenOptId(qid, v) });
  await fetch("/api/answers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: S.sid, question_id: qid, value: v ?? null }) });
  flush();
  // Confirm manipulation §5: flagged + confirm condition, fires after either answer, once per item
  if (FLAGGED.has(qid) && S.confirm[qid] === "confirm" && !S.confirmDone[qid]) {
    S.pendingConfirm = { qid, answer: v, t0: now() };
    S.confirmDone[qid] = true;
    emit("confirm_shown", qid, curVisit(), { answer_at_prompt: v });
    $("confirm-modal").hidden = false;
    $("btn-keep").focus();
    return; // wait for choice
  }
  S.idx += 1;
  renderQ();
});

function chosenOptId(qid, v) {
  const [type] = QTEXT[qid];
  if (type === "yesno") return v === "Yes" ? `opt-${qid}-0` : v === "No" ? `opt-${qid}-1` : undefined;
  return undefined;
}

$("btn-keep").addEventListener("click", () => {
  const p = S.pendingConfirm;
  emit("confirm_response", p.qid, curVisit(), { choice: "keep", latency_ms: Math.round(now() - p.t0) });
  $("confirm-modal").hidden = true;
  S.pendingConfirm = null;
  S.idx += 1; renderQ();
});
$("btn-change").addEventListener("click", async () => {
  const p = S.pendingConfirm;
  const flipped = p.answer === "Yes" ? "No" : p.answer === "No" ? "Yes" : p.answer;
  S.answers[p.qid] = flipped; // flip is the revision; do not return to question screen
  emit("answer_changed", p.qid, curVisit(), { old: p.answer, new: flipped, source: "confirm_change" });
  emit("confirm_response", p.qid, curVisit(), { choice: "change", latency_ms: Math.round(now() - p.t0) });
  await fetch("/api/answers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: S.sid, question_id: p.qid, value: flipped }) });
  $("confirm-modal").hidden = true;
  S.pendingConfirm = null;
  S.idx += 1; renderQ();
});

async function finish() {
  await flush();
  await fetch(`/api/session/${S.sid}/end`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ completion_status: "completed" }) });
  emit("session_end", null, null, { completion_status: "completed" });
  await flush(true);
  sessionStorage.removeItem("sid"); sessionStorage.removeItem("buf"); sessionStorage.removeItem("seq");
  $("sess-id").textContent = S.sid;
  show("screen-done");
}

$("btn-delete").addEventListener("click", async () => {
  if (!confirm("Delete this session and all its events?")) return;
  await fetch(`/api/session/${S.sid}`, { method: "DELETE" });
  $("del-msg").textContent = "Deleted.";
});

// Resume after reload: continue same session, log session_resumed
if (S.sid) {
  fetch(`/api/events`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: S.sid, events: [{ seq: S.seq + 1, type: "session_resumed", question_id: null, visit_id: null, t: 0, t_abs: Date.now(), payload: {} }] }) }).catch(() => {});
}
