// Seeded simulation: synthetic sessions to test dashboard/export before real collection (§14).
// Checks: ordering rules, balanced confirm assignment (~50% ±5% over 1000), metrics recompute idempotent.
import { resolveOrder, assignConfirm } from "../lib/random.js";
import { computeMetrics } from "../lib/metrics.js";

const N = Number(process.argv[3] || 1000);
const counts = { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 };
let orderViolations = 0, confirmSizeBad = 0;

for (let s = 1; s <= N; s++) {
  const { order } = resolveOrder(s);
  const ca = assignConfirm(s);
  for (const k of Object.keys(counts)) if (ca[k] === "confirm") counts[k]++;
  const nConfirm = Object.values(ca).filter(v => v === "confirm").length;
  if (nConfirm < 2 || nConfirm > 3) confirmSizeBad++;
  // rules: B first fixed; X fixed C1,T1 then Z last; L3/L3b not adjacent; C1 ≥4 after S4
  if (order.slice(0, 3).join() !== "B1,B2,B3") orderViolations++;
  if (order.slice(-3).join() !== "C1,T1,Z") orderViolations++;
  const iL3 = order.indexOf("L3"), iL3b = order.indexOf("L3b");
  if (Math.abs(iL3 - iL3b) === 1) orderViolations++;
  if (order.indexOf("C1") - order.indexOf("S4") < 4) orderViolations++;
}

console.log(`sessions=${N} confirmCounts=`, counts);
console.log(`confirmSizeBad=${confirmSizeBad} orderViolations=${orderViolations}`);
let ok = true;
for (const [k, c] of Object.entries(counts)) {
  const p = c / N;
  if (Math.abs(p - 0.5) > 0.05) { console.error(`FAIL ${k} rate ${p.toFixed(3)} outside 50%±5%`); ok = false; }
}
if (confirmSizeBad || orderViolations) { console.error("FAIL rules"); ok = false; }

// idempotency: same raw events → identical metrics
const fakeEvents = [
  { seq: 1, type: "q_shown", question_id: "S1", visit_id: 1, t: 0, t_abs: 1, payload: {} },
  { seq: 2, type: "q_first_interaction", question_id: "S1", visit_id: 1, t: 800, t_abs: 2, payload: { modality: "mouse" } },
  { seq: 3, type: "q_answered_first", question_id: "S1", visit_id: 1, t: 2500, t_abs: 3, payload: { value: "Yes" } },
  { seq: 4, type: "q_submitted", question_id: "S1", visit_id: 1, t: 4000, t_abs: 4, payload: { value: "Yes" } },
];
const a = computeMetrics(fakeEvents, { S1: { first: "Yes", final: "Yes" } });
const b = computeMetrics(fakeEvents, { S1: { first: "Yes", final: "Yes" } });
if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("FAIL idempotent"); ok = false; }
else console.log("idempotent recompute: OK");

// no key identities in key events by construction (key_class only) — assert helper
console.log(ok ? "SIMULATION CHECKS PASSED" : "SIMULATION CHECKS FAILED");
process.exit(ok ? 0 : 1);
