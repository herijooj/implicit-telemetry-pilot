# Manual test checklist — device matrix + resilience (do before the trial)

Tick each box with a real run and confirm the session in `/admin`. Delete test
sessions from the dashboard when done.

## A. Browsers (one full run each)

- [ ] Chrome desktop: complete run → session `completed`, all 18 questions answered
- [ ] Firefox desktop: complete run
- [ ] Safari desktop (if available): complete run
- [ ] Android Chrome: complete run on a phone
- [ ] iOS Safari (physical iPhone): complete run — **highest risk**, see C

## B. Layout + keyboard (desktop Chrome is fine)

- [ ] 320px viewport: no horizontal scroll, all options tappable, confirm modal fits
- [ ] Keyboard-only run (Tab + arrows + Enter/Space): every question answerable,
      focus always visible, confirm prompt reachable and closable only via its buttons
- [ ] Likert + Yes/No have no pre-selected option; Next stays disabled until valid

## C. iOS Safari touch telemetry (physical device, `/admin` detail view)

- [ ] `pointer_move` events exist with `pointer_type: "touch"`
- [ ] Trajectory plot for a yes/no question shows the touch path over option boxes
- [ ] `q_first_interaction` modality is `touch`
- [ ] Confirm prompt appears once per assigned item, flip records
      `answer_changed` with `source: "confirm_change"`

## D. Reload resume (desktop + phone)

1. Answer 3–4 questions, then reload the page mid-question.
2. [ ] Form continues (no restart from consent); exactly one `session_resumed` event
3. [ ] No duplicate `seq` values in the raw event table for that session
4. [ ] Finish the run; metrics identical after recompute (open detail twice)

## E. Tab-close flush

1. Answer 2–3 questions, then close the tab (do not press anything else).
2. [ ] A new session row exists with the answered questions' events
   (`sendBeacon` path — open dashboard, check event count > 0)
3. [ ] Status flips to `abandoned` after 30 min without events (or leave overnight)

## F. Confirm-prompt rules (use `/admin` compare view, question S1–S5)

- [ ] Prompt fires for assigned items only, after Yes AND after No (try both)
- [ ] Back-navigation to an already-prompted item edits without re-prompting
- [ ] Keep vs Change both recorded with `latency_ms`

## G. Consent, Z, deletion

- [ ] No events exist before consent except `session_start`/`consent_given`
      (check a fresh session's first rows)
- [ ] Z lists questions in that participant's administration order, no ID prefixes
- [ ] "None of them" is exclusive in Z
- [ ] Debrief "Delete my data" removes the session from the dashboard entirely
- [ ] Results-email opt-in stores the address (visible in admin detail) and
      deletion wipes it; address never appears in any export

## H. Exports match the dashboard

- [ ] `events.json` session count == dashboard session count (minus synthetic/abandoned filters)
- [ ] `metrics.csv` row for a known session/question matches its detail view
- [ ] `answers.csv` first/final values match detail view
