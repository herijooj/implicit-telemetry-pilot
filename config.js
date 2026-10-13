// Single config source per spec §2. Reads .env file (KEY=VALUE) + process.env.
import fs from "node:fs";

function loadDotEnv(path = "./.env") {
  try {
    const txt = fs.readFileSync(path, "utf8");
    for (const line of txt.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch { /* no .env is fine */ }
}
loadDotEnv();

const num = (k, d) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? v : d;
};

export const config = {
  APP_VERSION: process.env.APP_VERSION || "0.1.0-pilot",
  PORT: num("PORT", 3000),
  DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD || "change-me-pilot",
  CONFIRM_RATE: 0.5, // kept for compat; assignment is balanced per §5 (not Bernoulli)
  SAMPLING_MS: num("SAMPLING_MS", 50),
  IDLE_PAUSE_MS: num("IDLE_PAUSE_MS", 2000),
  DATA_DIR: process.env.DATA_DIR || "./data",
  CONSENT_TEXT_VERSION: process.env.CONSENT_TEXT_VERSION || "v1",
  CONTACT_TEXT: process.env.CONTACT_TEXT || "Contact: [YOUR NAME / LAB], [EMAIL]. Ethics: [IRB / EXEMPTION REF].",
  DATA_RETENTION_DAYS: num("DATA_RETENTION_DAYS", 0),
};
