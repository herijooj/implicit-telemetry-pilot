# Implicit Interaction Telemetry — Pilot

> Deployer must obtain ethics/IRB approval or documented exemption **before** collecting data. Do not collect real data with placeholder contact text.

Participant form with first-party behavioral telemetry + protected dashboard. Zero npm dependencies (Node 22+ stdlib only, built-in SQLite).

- Participant flow: consent → context → 18 questions (B fixed, R/S/L block-shuffled, X fixed, Z last) → thank-you page with self-delete.
- Balanced confirm assignment (2–3 of S1–S5, seeded), fires after Yes or No, once per item, neutral styling.
- Telemetry: q_shown/first_interaction/answered/answer_changed/submitted/back/confirm/key-class-only/pointer sampled + on-change/scroll throttled/focus-blur/visibility/paste-length/resize/validation/layout_snapshot; buffering 2s/50 + sendBeacon + sessionStorage + resume; dedupe (session_id,seq).
- Derived metrics + z-scores vs baseline + hesitation composite + flags, `metric_version`, idempotent recompute.
- Admin `/admin` (password cookie, rate-limited, noindex): sessions table, detail w/ hesitation components + timeline + trajectory over option boxes + raw events, question view, compare (Cohen's d, n), exports (events.json, metrics.csv, answers.csv).
- `node scripts/simulate.mjs --check` validates ordering + balanced assignment over 1000 seeds + idempotency.
- `node scripts/mock-runs.mjs [N] [BASE]` creates synthetic sessions through the API for dashboard testing.
- Bilingual participant form (English + Português): `APP_LANG=pt` in `.env` makes Portuguese the default; `?lang=en` or `?lang=pt-BR` overrides per visit. Stored answer values stay canonical (`Yes`/`No`, `1`–`5`), only display labels translate. Dashboard stays in English.

## Quick run (local)

```sh
cp .env.example .env   # set DASHBOARD_PASSWORD, PORT, etc.
node server.js          # http://localhost:3000/  (form)  http://localhost:3000/admin (dashboard)
```

## Deploy on a VM (systemd + Caddy, HTTPS)

Requirements on the server: Node 22+ and Caddy. No build step, no `npm install`.

**1. Copy the files and configure.**

```sh
# on the VM, as your app user
git clone <your-repo-url> /opt/forms && cd /opt/forms
cp .env.example .env
nano .env   # set at minimum:
            #   DASHBOARD_PASSWORD=<long random password>
            #   PORT=3000
            #   DATA_DIR=/opt/forms/data
            #   CONTACT_TEXT="Contact: ..., Ethics: ..."
```

Never commit `.env` (it is gitignored). Generate the password with e.g. `openssl rand -base64 24`.

**2. Run as a service.** Create `/etc/systemd/system/forms.service`:

```ini
[Unit]
Description=telemetry forms pilot
After=network.target

[Service]
Type=simple
User=forms
WorkingDirectory=/opt/forms
EnvironmentFile=/opt/forms/.env
ExecStart=/usr/bin/node /opt/forms/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```sh
sudo useradd -r -m -d /opt/forms forms   # if needed; ensure it owns /opt/forms/data
sudo systemctl daemon-reload
sudo systemctl enable --now forms
sudo journalctl -u forms -f              # check: "pilot listening :3000"
```

**3. HTTPS with Caddy.** The app speaks plain HTTP on localhost; TLS terminates at the proxy (spec requires HTTPS). Example `/etc/caddy/Caddyfile`:

```
forms.example.com {
    reverse_proxy 127.0.0.1:3000
    # no IP logging by the app; keep proxy logs IP-free too:
    log {
        skip_hosts *
    }
}
```

```sh
sudo systemctl reload caddy
```

With Nginx instead: `proxy_pass http://127.0.0.1:3000;` plus `access_log off;` (or a log format without `$remote_addr`).

**4. Before collecting real data.**

- Replace `CONTACT_TEXT`/consent wording placeholders in `.env`; restart the service.
- Confirm ethics/IRB approval or documented exemption.
- Open `https://<domain>/admin`, log in, complete one test session on desktop and one on a phone; check it appears with events, then delete the test sessions from the dashboard.
- Back up `/opt/forms/data/pilot.sqlite` regularly (sqlite3 `.backup` or a file copy while the service is stopped). That single file holds everything.
- Data retention: set `DATA_RETENTION_DAYS` if you want auto-delete (currently default off; enforcement is a deployer cron, e.g. delete rows older than N days).

**5. Updates.**

```sh
cd /opt/forms && git pull && sudo systemctl restart forms
```

Static HTML/JS is served with `Cache-Control: no-store`, so browsers pick up changes immediately.

## Open items (spec §15)

- Ethics/contact text — currently placeholders.
- Copy language: English default.
- `DASHBOARD_PASSWORD` delivery: set it directly in the server `.env`.
