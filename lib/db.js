// Durable storage: Node 22 built-in node:sqlite. Append-only events, dedupe by (session_id, seq).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { config } from "../config.js";

fs.mkdirSync(config.DATA_DIR, { recursive: true });
const db = new DatabaseSync(`${config.DATA_DIR}/pilot.sqlite`);

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, created_at INTEGER, consent_at INTEGER, consent_text_version TEXT,
  app_version TEXT, seed INTEGER, prng TEXT,
  device_detected TEXT, device_confirmed TEXT, age_range TEXT,
  viewport_w INTEGER, viewport_h INTEGER, screen_w INTEGER, screen_h INTEGER,
  dpr REAL, ua TEXT, lang TEXT,
  question_order TEXT, confirm_assignment TEXT,
  completion_status TEXT DEFAULT 'in_progress', ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, seq INTEGER, type TEXT,
  question_id TEXT, visit_id INTEGER, t REAL, t_abs INTEGER, t_server INTEGER, payload TEXT,
  UNIQUE (session_id, seq)
);
CREATE TABLE IF NOT EXISTS answers (
  session_id TEXT, question_id TEXT, first_value TEXT, final_value TEXT, submitted_at INTEGER,
  PRIMARY KEY (session_id, question_id)
);
CREATE TABLE IF NOT EXISTS derived_metrics (
  session_id TEXT, question_id TEXT, visit_id INTEGER, metric_name TEXT,
  value_raw REAL, value_z REAL, metric_version TEXT,
  PRIMARY KEY (session_id, question_id, visit_id, metric_name)
);
CREATE TABLE IF NOT EXISTS session_flags (
  session_id TEXT, flag_name TEXT, value TEXT,
  PRIMARY KEY (session_id, flag_name)
);
`);

export function createSession(s) {
  db.prepare(`INSERT INTO sessions (id, created_at, app_version, seed, prng, question_order, confirm_assignment, completion_status)
    VALUES (?,?,?,?,?,?,?,'in_progress')`).run(
    s.id, Date.now(), s.app_version, s.seed, s.prng,
    JSON.stringify(s.order), JSON.stringify(s.confirm_assignment));
}
export function getSession(id) {
  return db.prepare(`SELECT * FROM sessions WHERE id=?`).get(id) || null;
}
export function updateSession(id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE sessions SET ${keys.map(k => `${k}=?`).join(",")} WHERE id=?`)
    .run(...keys.map(k => patch[k]), id);
}
export function insertEventsBatch(session_id, events) {
  const now = Date.now();
  const ins = db.prepare(`INSERT OR IGNORE INTO events
    (session_id, seq, type, question_id, visit_id, t, t_abs, t_server, payload)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const e of events) {
    const r = ins.run(session_id, e.seq ?? null, e.type, e.question_id ?? null,
      e.visit_id ?? null, e.t ?? null, e.t_abs ?? null, now, JSON.stringify(e.payload ?? {}));
    n += Number(r.changes);
  }
  return n;
}
export function getEvents(session_id) {
  return db.prepare(`SELECT * FROM events WHERE session_id=? ORDER BY seq ASC`).all(session_id)
    .map(r => ({ ...r, payload: JSON.parse(r.payload || "{}") }));
}
export function upsertAnswer(session_id, question_id, value) {
  const v = JSON.stringify(value ?? null);
  const row = db.prepare(`SELECT * FROM answers WHERE session_id=? AND question_id=?`).get(session_id, question_id);
  if (!row) db.prepare(`INSERT INTO answers (session_id, question_id, first_value, final_value, submitted_at) VALUES (?,?,?,?,?)`)
    .run(session_id, question_id, v, v, Date.now());
  else db.prepare(`UPDATE answers SET final_value=?, submitted_at=? WHERE session_id=? AND question_id=?`)
    .run(v, Date.now(), session_id, question_id);
}
export function getAnswers(session_id) {
  const out = {};
  for (const r of db.prepare(`SELECT * FROM answers WHERE session_id=?`).all(session_id)) {
    out[r.question_id] = { first: JSON.parse(r.first_value), final: JSON.parse(r.final_value), submitted_at: r.submitted_at };
  }
  return out;
}
export function setMetrics(session_id, rows) {
  // visit_id NULL breaks PK uniqueness in SQLite (NULL != NULL) → delete-then-insert for idempotent recompute.
  db.prepare(`DELETE FROM derived_metrics WHERE session_id=?`).run(session_id);
  const ins = db.prepare(`INSERT INTO derived_metrics
    (session_id, question_id, visit_id, metric_name, value_raw, value_z, metric_version) VALUES (?,?,?,?,?,?,?)`);
  for (const m of rows) ins.run(session_id, m.question_id, m.visit_id ?? null, m.metric_name, m.value_raw ?? null, m.value_z ?? null, m.metric_version);
}
export function getMetrics(session_id) {
  return db.prepare(`SELECT * FROM derived_metrics WHERE session_id=?`).all(session_id);
}
export function setFlag(session_id, flag_name, value) {
  db.prepare(`INSERT OR REPLACE INTO session_flags (session_id, flag_name, value) VALUES (?,?,?)`)
    .run(session_id, flag_name, JSON.stringify(value));
}
export function getFlags(session_id) {
  const out = {};
  for (const r of db.prepare(`SELECT * FROM session_flags WHERE session_id=?`).all(session_id)) {
    try { out[r.flag_name] = JSON.parse(r.value); } catch { out[r.flag_name] = r.value; }
  }
  return out;
}
export function listSessions() {
  return db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT 500`).all();
}
export function deleteSession(id) {
  // Hard-delete across all tables per §8 (column names differ per table).
  db.prepare(`DELETE FROM derived_metrics WHERE session_id=?`).run(id);
  db.prepare(`DELETE FROM session_flags WHERE session_id=?`).run(id);
  db.prepare(`DELETE FROM answers WHERE session_id=?`).run(id);
  db.prepare(`DELETE FROM events WHERE session_id=?`).run(id);
  db.prepare(`DELETE FROM sessions WHERE id=?`).run(id);
}
export function markAbandoned(timeoutMs = 30 * 60 * 1000) {
  const cutoff = Date.now() - timeoutMs;
  db.prepare(`UPDATE sessions SET completion_status='abandoned'
    WHERE completion_status='in_progress' AND created_at < ?`).run(cutoff);
}
export { db };
