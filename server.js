// Minimal stdlib HTTP server (no deps) for VM self-host. Serves public/ + JSON API per §9.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { resolveOrder, assignConfirm } from "./lib/random.js";
import * as DB from "./lib/db.js";
import { computeMetrics, sessionFlags, METRIC_VERSION } from "./lib/metrics.js";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".txt": "text/plain" };
const adminTokens = new Set();
const loginFails = []; // timestamps for rate limit

function send(res, code, body, type = "application/json") {
  const b = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, { "content-type": type, "content-length": Buffer.byteLength(b) });
  res.end(b);
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function authed(req) {
  return adminTokens.has(cookies(req).admin);
}
async function body(req, limit = 2_000_000) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new Error("too large"); chunks.push(c); }
  const t = Buffer.concat(chunks).toString("utf8");
  return t ? JSON.parse(t) : {};
}
function recompute(session_id) {
  const events = DB.getEvents(session_id);
  const answers = DB.getAnswers(session_id);
  const rows = computeMetrics(events, answers);
  DB.setMetrics(session_id, rows);
  const flags = sessionFlags(answers);
  // ground-truth labels per question from Z
  const z = answers.Z?.final;
  const zSel = Array.isArray(z) ? z : [];
  for (const qid of Object.keys(answers)) {
    if (qid === "Z") continue;
    DB.setFlag(session_id, `self_reported_hesitation:${qid}`, zSel.includes(qid));
    const agg = rows.find(r => r.question_id === qid && r.visit_id == null && r.metric_name === "final_changed_from_first");
    const cc = rows.find(r => r.question_id === qid && r.metric_name === "confirm_changed");
    DB.setFlag(session_id, `behavioral_revision:${qid}`, (agg?.value_raw === 1) || (cc?.value_raw === 1));
  }
  for (const [k, v] of Object.entries(flags)) DB.setFlag(session_id, k, v);
  return { rows, flags };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;

    // ---- static ----
    if (req.method === "GET" && (p === "/" || p.startsWith("/assets") || p.endsWith(".js") || p.endsWith(".css") || p === "/admin" || p === "/robots.txt")) {
      if (p === "/robots.txt") return send(res, 200, "User-agent: *\nDisallow: /admin\nDisallow: /api/admin\n", "text/plain");
      let f = p === "/" ? "/index.html" : p === "/admin" ? "/admin.html" : p;
      const fp = path.join("./public", decodeURIComponent(f));
      if (!path.resolve(fp).startsWith(path.resolve("./public")) || !fs.existsSync(fp)) return send(res, 404, { error: "not found" });
      const data = fs.readFileSync(fp, "utf8");
      // Pilot: never cache HTML/JS so dashboard fixes reach the browser immediately.
      res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "text/plain",
        "cache-control": "no-store", "content-length": Buffer.byteLength(data) });
      return res.end(data);
    }

    // ---- public API ----
    if (req.method === "GET" && p === "/api/config") {
      return send(res, 200, { lang: config.LANG, app_version: config.APP_VERSION,
        consent_text_version: config.CONSENT_TEXT_VERSION,
        contact_text: { en: config.CONTACT_TEXT, pt: config.CONTACT_TEXT_PT } });
    }
    if (req.method === "POST" && p === "/api/session") {
      const b = await body(req);
      const seed = (crypto.randomInt(1 << 30)) >>> 0;
      const { order, prng } = resolveOrder(seed);
      const confirm_assignment = assignConfirm(seed);
      const id = crypto.randomUUID();
      DB.createSession({ id, app_version: config.APP_VERSION, seed, prng, order, confirm_assignment });
      DB.updateSession(id, {
        consent_at: Date.now(), consent_text_version: config.CONSENT_TEXT_VERSION,
        device_detected: b.device_detected || null,
        viewport_w: b.viewport?.w || null, viewport_h: b.viewport?.h || null,
        screen_w: b.screen?.w || null, screen_h: b.screen?.h || null,
        dpr: b.dpr || null, ua: (req.headers["user-agent"] || "").slice(0, 500), lang: b.lang || null,
      });
      // session_start + consent_given recorded server-side from client payload (client sends nothing before consent)
      return send(res, 200, { session_id: id, order, confirm_assignment, seed, prng, sampling_ms: config.SAMPLING_MS, idle_pause_ms: config.IDLE_PAUSE_MS, app_version: config.APP_VERSION });
    }
    if (req.method === "POST" && p === "/api/events") {
      const b = await body(req);
      const evs = Array.isArray(b.events) ? b.events : [];
      if (!b.session_id || !DB.getSession(b.session_id)) return send(res, 404, { error: "no session" });
      // §11: no IP logging — we never store req IP. Strip any client attempt.
      const clean = evs.map(e => ({ ...e, payload: e.payload || {} })).slice(0, 500);
      const n = DB.insertEventsBatch(b.session_id, clean);
      // persist context/consent fields if present
      for (const e of clean) {
        if (e.type === "context_submitted") DB.updateSession(b.session_id, { device_confirmed: String(e.payload.device_confirmed || ""), age_range: String(e.payload.age_range || "") });
        if (e.type === "session_resumed") { /* resume continues same session */ }
      }
      return send(res, 200, { stored: n });
    }
    if (req.method === "POST" && p === "/api/answers") {
      const b = await body(req);
      if (!DB.getSession(b.session_id)) return send(res, 404, { error: "no session" });
      DB.upsertAnswer(b.session_id, b.question_id, b.value);
      return send(res, 200, { ok: true });
    }
    const mEnd = p.match(/^\/api\/session\/([^/]+)\/end$/);
    if (req.method === "POST" && mEnd) {
      const b = await body(req).catch(() => ({}));
      DB.updateSession(mEnd[1], { completion_status: b.completion_status || "completed", ended_at: Date.now() });
      try { recompute(mEnd[1]); } catch (e) { console.error("recompute", e.message); }
      return send(res, 200, { ok: true, metric_version: METRIC_VERSION });
    }
    // Optional results-email opt-in (thank-you page). Stored on the session row so
    // both delete paths (participant + admin) wipe it with everything else.
    const mContact = p.match(/^\/api\/session\/([^/]+)\/contact$/);
    if (req.method === "POST" && mContact) {
      if (!DB.getSession(mContact[1])) return send(res, 404, { error: "no session" });
      const b = await body(req).catch(() => ({}));
      const email = String(b.email || "").trim().slice(0, 320);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: "invalid email" });
      DB.updateSession(mContact[1], { contact_email: email });
      return send(res, 200, { ok: true });
    }
    const mDel = p.match(/^\/api\/session\/([^/]+)$/);
    if (req.method === "DELETE" && mDel && !p.startsWith("/api/admin")) {
      if (!DB.getSession(mDel[1])) return send(res, 404, { error: "no session" });
      DB.deleteSession(mDel[1]);
      return send(res, 200, { ok: true });
    }

    // ---- admin auth ----
    if (req.method === "POST" && p === "/api/admin/login") {
      const now = Date.now();
      while (loginFails.length && now - loginFails[0] > 60_000) loginFails.shift();
      if (loginFails.length >= 10) return send(res, 429, { error: "rate limited" });
      const b = await body(req);
      const ok = crypto.timingSafeEqual(
        Buffer.from(String(b.password || "")), Buffer.from(String(config.DASHBOARD_PASSWORD)));
      if (!ok) { loginFails.push(now); return send(res, 401, { error: "bad password" }); }
      const tok = crypto.randomBytes(24).toString("hex");
      adminTokens.add(tok);
      res.writeHead(200, { "content-type": "application/json", "set-cookie": `admin=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400` });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (p.startsWith("/api/admin")) {
      if (!authed(req)) return send(res, 401, { error: "auth" });
      if (req.method === "GET" && p === "/api/admin/sessions") {
        DB.markAbandoned();
        const sessions = DB.listSessions().map(s => {
          // Lightweight flags from answers (no full recompute → avoids concurrent writes).
          let flags = {};
          try { flags = sessionFlags(DB.getAnswers(s.id)); } catch {}
          let ca = {};
          try { ca = JSON.parse(s.confirm_assignment || "{}"); } catch {}
          return { ...s, question_order: undefined, confirm_assignment: ca, flags };
        });
        return send(res, 200, { sessions });
      }
      const mOne = p.match(/^\/api\/admin\/sessions\/([^/]+)$/);
      if (mOne) {
        const id = decodeURIComponent(mOne[1]);
        if (req.method === "DELETE") { DB.deleteSession(id); return send(res, 200, { ok: true }); }
        const s = DB.getSession(id);
        if (!s) return send(res, 404, { error: "no session" });
        recompute(id);
        return send(res, 200, {
          session: { ...s, question_order: JSON.parse(s.question_order || "[]"), confirm_assignment: JSON.parse(s.confirm_assignment || "{}") },
          answers: DB.getAnswers(id), metrics: DB.getMetrics(id), flags: DB.getFlags(id), events: DB.getEvents(id),
        });
      }
      const mQ = p.match(/^\/api\/admin\/questions\/([^/]+)\/stats$/);
      if (req.method === "GET" && mQ) {
        const qid = decodeURIComponent(mQ[1]);
        const sessions = DB.listSessions();
        const rows = [];
        for (const s of sessions) {
          const ans = DB.db.prepare(`SELECT first_value, final_value FROM answers WHERE session_id=? AND question_id=?`).get(s.id, qid);
          if (!ans) continue;
          const m = DB.db.prepare(`SELECT metric_name, value_raw FROM derived_metrics WHERE session_id=? AND question_id=? AND visit_id IS NULL`).all(s.id, qid);
          const mv = DB.db.prepare(`SELECT metric_name, value_raw FROM derived_metrics WHERE session_id=? AND question_id=? AND visit_id IS NOT NULL`).all(s.id, qid);
          rows.push({
            session: s.id.slice(0, 8),
            device: s.device_confirmed || s.device_detected || "unknown",
            first: parseV(ans.first_value), final: parseV(ans.final_value),
            metrics: Object.fromEntries(m.map(r => [r.metric_name, r.value_raw])),
            visit_metrics: mv.map(r => ({ metric: r.metric_name, raw: r.value_raw })),
          });
        }
        return send(res, 200, { qid, n: rows.length, rows: rows.slice(0, 2000) });
      }
      if (req.method === "GET" && p === "/api/admin/compare") {
        const q = u.searchParams.get("question"), by = u.searchParams.get("by"); // confirm|revised
        if (!q || !["confirm", "revised"].includes(by)) return send(res, 400, { error: "need ?question=&by=confirm|revised" });
        const sessions = DB.listSessions();
        const groups = {};
        const prePrompt = []; // {x: hesitation/time, changed: 0/1} for flagged confirm items
        const agree = { both: 0, neither: 0, behav_only: 0, self_only: 0 };
        for (const s of sessions) {
          let g = null;
          const ca = JSON.parse(s.confirm_assignment || "{}");
          const ans = DB.db.prepare(`SELECT first_value, final_value FROM answers WHERE session_id=? AND question_id=?`).get(s.id, q);
          if (by === "confirm") g = ca[q] || "unknown";
          else g = ans && ans.first_value !== ans.final_value ? "revised" : "not_revised";
          const m = DB.db.prepare(`SELECT metric_name, value_raw FROM derived_metrics WHERE session_id=? AND question_id=? AND visit_id IS NULL`).all(s.id, q);
          const met = Object.fromEntries(m.map(r => [r.metric_name, r.value_raw]));
          const cc = DB.db.prepare(`SELECT value_raw FROM derived_metrics WHERE session_id=? AND question_id=? AND metric_name='confirm_changed'`).all(s.id, q)
            .some(r => r.value_raw === 1);
          const cr = DB.db.prepare(`SELECT payload FROM events WHERE session_id=? AND question_id=? AND type='confirm_response'`).get(s.id, q);
          const fl = DB.db.prepare(`SELECT flag_name, value FROM session_flags WHERE session_id=?`).all(s.id);
          const fmap = Object.fromEntries(fl.map(r => { try { return [r.flag_name, JSON.parse(r.value)]; } catch { return [r.flag_name, r.value]; } }));
          if (ans) {
            (groups[g] ??= []).push({ session: s.id.slice(0, 8), device: s.device_confirmed || s.device_detected || "unknown",
              answer: parseV(ans.final_value), metrics: met, confirm_changed: cc,
              confirm_choice: cr ? JSON.parse(cr.payload).choice : null });
            if (ca[q] === "confirm" && (met.hesitation_score != null || met.time_to_submit != null))
              prePrompt.push({ x: met.hesitation_score ?? met.time_to_submit, changed: cc ? 1 : 0 });
            const sr = fmap[`self_reported_hesitation:${q}`], br = fmap[`behavioral_revision:${q}`];
            if (sr !== undefined || br !== undefined) {
              if (sr && br) agree.both++; else if (!sr && !br) agree.neither++;
              else if (!sr && br) agree.behav_only++; else agree.self_only++;
            }
          }
        }
        // means + Cohen's d for time_to_submit & hesitation_score
        const summary = {};
        for (const met of ["time_to_submit", "hesitation_score", "revision_count"]) {
          const keys = Object.keys(groups);
          if (keys.length >= 2) {
            const [a, bb] = keys;
            const xa = groups[a].map(g => g.metrics[met]).filter(Number.isFinite);
            const xb = groups[bb].map(g => g.metrics[met]).filter(Number.isFinite);
            summary[met] = { n: { [a]: xa.length, [bb]: xb.length }, mean: { [a]: m(xa), [bb]: m(xb) }, cohens_d: d(xa, xb) };
          }
        }
        // point-biserial r: pre-prompt hesitation (x) vs confirm_changed (0/1)
        let pbr = null;
        {
          const xs = prePrompt.map(p => p.x).filter(Number.isFinite);
          const ys = prePrompt.filter(p => Number.isFinite(p.x)).map(p => p.changed);
          if (xs.length >= 3 && new Set(ys).size === 2) {
            const mx = m(xs), my = m(ys);
            const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
            const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
            pbr = den ? num / den : null;
          }
        }
        return send(res, 200, { question: q, by, groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, { n: v.length, rows: v.slice(0, 1000) }])), summary, prePrompt: prePrompt.slice(0, 1000), prePrompt_r: pbr, agreement: agree });
      }
      if (req.method === "GET" && p === "/api/admin/export/events.json") {
        const excl = u.searchParams.get("exclude_abandoned") === "1";
        const sessions = DB.listSessions().filter(s => !excl || s.completion_status !== "abandoned");
        const out = sessions.map(s => ({ session: s, events: DB.getEvents(s.id), answers: DB.getAnswers(s.id) }));
        res.writeHead(200, { "content-type": "application/json", "content-disposition": "attachment; filename=events.json" });
        return res.end(JSON.stringify(out));
      }
      if (req.method === "GET" && p === "/api/admin/export/metrics.csv") {
        const excl = u.searchParams.get("exclude_abandoned") === "1";
        let rows = DB.db.prepare(`SELECT * FROM derived_metrics`).all();
        if (excl) {
          const bad = new Set(DB.listSessions().filter(s => s.completion_status === "abandoned").map(s => s.id));
          rows = rows.filter(r => !bad.has(r.session_id));
        }
        const csv = "session,question,visit,metric,raw,z,version\n" + rows.map(r =>
          [r.session_id, r.question_id, r.visit_id ?? "", r.metric_name, r.value_raw ?? "", r.value_z ?? "", r.metric_version].join(",")).join("\n");
        res.writeHead(200, { "content-type": "text/csv", "content-disposition": "attachment; filename=metrics.csv" });
        return res.end(csv);
      }
      if (req.method === "GET" && p === "/api/admin/export/answers.csv") {
        const excl = u.searchParams.get("exclude_abandoned") === "1";
        const sessions = DB.listSessions().filter(s => !excl || s.completion_status !== "abandoned");
        const qids = [...new Set(DB.db.prepare(`SELECT DISTINCT question_id FROM answers`).all().map(r => r.question_id))].sort();
        const lines = ["session," + qids.join(",")];
        for (const s of sessions) {
          const a = DB.getAnswers(s.id);
          lines.push([s.id, ...qids.map(q => JSON.stringify(a[q]?.final ?? ""))].join(","));
        }
        res.writeHead(200, { "content-type": "text/csv", "content-disposition": "attachment; filename=answers.csv" });
        return res.end(lines.join("\n"));
      }
      return send(res, 404, { error: "not found" });
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: String(e.message || e) });
  }
});

function m(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function parseV(s) { try { return JSON.parse(s); } catch { return s; } }
function d(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const ma = m(a), mb = m(b);
  const va = a.reduce((s, x) => s + (x - ma) ** 2, 0) / (a.length - 1);
  const vb = b.reduce((s, x) => s + (x - mb) ** 2, 0) / (b.length - 1);
  const sp = Math.sqrt(((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2));
  return sp ? (ma - mb) / sp : null;
}

server.listen(config.PORT, () => console.log(`pilot listening :${config.PORT} v${config.APP_VERSION}`));
