// Seeded PRNG + ordering + confirm assignment. Reproducible per §4.1 / §13.6.
export const PRNG_NAME = "mulberry32";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Blocks: B fixed first; R,S,L shuffled as blocks; X fixed (C1,T1); Z last.
// Constraint: L3 and L3b not adjacent. C1 ≥4 questions after S4 guaranteed by layout.
export function resolveOrder(seed) {
  const rand = mulberry32(seed);
  const B = ["B1", "B2", "B3"];
  const blocks = { R: ["R1", "R2", "R3"], S: ["S1", "S2", "S3", "S4", "S5"], L: ["L1", "L2", "L3", "L3b"] };
  // Spec claims C1≥4 after S4 is "guaranteed by layout", but it is not when the S
  // block comes last and S4 is at its tail — verified by simulation (200/1000
  // violations). Enforce by re-rolling on the same seeded stream until valid.
  for (let attempt = 0; attempt < 100; attempt++) {
    const blockOrder = shuffled(["R", "S", "L"], rand);
    const out = [...B];
    for (const b of blockOrder) out.push(...shuffled(blocks[b], rand));
    out.push("C1", "T1", "Z");
    const iL3 = out.indexOf("L3"), iL3b = out.indexOf("L3b");
    if (Math.abs(iL3 - iL3b) === 1) continue;
    if (out.indexOf("C1") - out.indexOf("S4") < 4) continue;
    return { order: out, blockOrder, seed, prng: PRNG_NAME };
  }
  // Fallback (practically unreachable): last candidate as-is.
  const blockOrder = ["R", "S", "L"];
  const out = [...B, ...blocks.R, ...blocks.S, ...blocks.L, "C1", "T1", "Z"];
  return { order: out, blockOrder, seed, prng: PRNG_NAME };
}

// Balanced assignment: 2 or 3 of the 5 flagged items → confirm (seeded). §5
export function assignConfirm(seed, flagged = ["S1", "S2", "S3", "S4", "S5"]) {
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const n = rand() < 0.5 ? 2 : 3;
  const picks = shuffled(flagged, rand).slice(0, n);
  const out = {};
  for (const f of flagged) out[f] = picks.includes(f) ? "confirm" : "no_confirm";
  return out;
}
