# Waypoint SAT Studio

A React + TypeScript application following the supplied Waypoint visual reference and design specification, with both local-only and Railway/PostgreSQL modes. All four original questions, answer choices, hints and worked solutions are included. The reference HTML files are preserved in `references/`.

## Railway version

Live application: **https://waypoint-web-production-50a5.up.railway.app/**

[Railway project](https://railway.com/project/ff7c016b-3e75-4524-b237-0565185ea0f2) · workspace: My Projects · environment: production.

- `waypoint-web` serves the React production build and Node API in one container. `Postgres` is a separate PostgreSQL service inside the same project with a persistent Railway volume. The web service references `${{Postgres.DATABASE_URL}}`; database credentials are never shipped to the browser or stored in the repository.
- The app uses the database’s private Railway connection. No database public domain or external database provider is required. See [Railway PostgreSQL documentation](https://docs.railway.com/databases/postgresql).
- No student accounts are needed. An unguessable HttpOnly, Secure, SameSite cookie identifies each browser’s private study profile. Visitors do not share a global progress record. Keep this cookie to return to the same profile. Clearing cookies or switching browsers creates a new profile; use export/import to transfer progress across devices.
- Answers, attempts, running/paused test state, flags and reflections save to PostgreSQL. The footer and reflection editor show the actual database save status. Wait for **“Saved to Railway database”** before closing the tab. Offline or failed saves retain pending work in a browser backup and show retry/export controls.
- Saved data loads before the study screens open. Failed initial loads show a reconnect screen, rather than replacing existing progress with a blank state. Concurrent saves use revisions; a stale tab cannot overwrite newer progress. Export pending work before choosing **Reload server copy**.
- The hosted version’s clock still follows the device clock; hosting adds persistence, not a calibrated or secure exam system. The demo remains five minutes with four questions and no SAT score estimate.

### Bring your existing local progress

1. Open the original local app at `http://127.0.0.1:5173/` in the browser where you studied.
2. Click **Export progress backup**.
3. Open the hosted app in your preferred browser, then click **Import progress backup** in its footer and select that JSON file.
4. Confirm replacement of that hosted study profile. The app downloads a backup of its current data first. Wait for the database save confirmation.

Your localhost data is not automatically uploaded. Local and hosted versions keep separate state until you explicitly import it.

### Deployment and operations

`Dockerfile` builds the hosted client (`VITE_PERSISTENCE_MODE=server`) and runs an unprivileged Node 22 service. Railway automatically detects the Dockerfile. The `/api/health` database healthcheck and restart policy are configured in Railway service settings; `railway-settings.json` records those values for reference. Change them through the web service's **Settings → Deploy** page and apply the staged changes. Railway's old `railway.json` deployment format is deprecated and unavailable to new services. The server binds `0.0.0.0` and the Railway `PORT` variable. On startup it creates the version-one `waypoint_progress` table if absent; deploys do not drop or reset data.

From this project directory, with the Railway CLI signed into the correct workspace:

```sh
railway link --project ff7c016b-3e75-4524-b237-0565185ea0f2 --service waypoint-web
railway up . --path-as-root --service waypoint-web --detach
railway deployment list --service waypoint-web --limit 3
```

The project is deployed from local source uploads, not a GitHub repository. Use the commands above to publish later changes. The private database URL stays in Railway variables. Set `APP_ORIGIN` to the exact public HTTPS origin if changing the domain; it enforces same-origin write requests. Use `/api/health` to confirm both the web server and PostgreSQL are reachable.

For a locally running server against your own PostgreSQL instance, set `DATABASE_URL` in your shell, run `VITE_PERSISTENCE_MODE=server npm run build`, then `npm start`. Never put database credentials in a `VITE_` variable. The original `npm run dev` flow below stays local-only.

## Learning Companion

The original four studio screens are preserved. Use **Learning companion** in the header or **Open daily plan** on the dashboard to open the three new screens:

- **`#plan` — Daily Plan:** choose 10, 20 or 30 minutes. The durations and planned question targets follow the handoff. Because the original bank contains four questions, each practice activity explicitly uses one representative original question; a review activity uses one real saved attempt. Only a fresh checked answer or a confirmed review can complete a demo activity. Completed activities survive budget changes and reloads. The week strip uses actual local dates and recorded history. Past/future plans are read-only previews. Accuracy and streaks use saved activity; no mock scores or streaks are shown.
- **`#tutor` — Guided Tutor:** three progressive authored hints, a next-step explanation, choice discussion and a 500-character composer. This version has **scripted replies, not a live AI connection**. Custom questions are stored and displayed literally; they are not interpreted. Drafts, the latest 30 conversation exchanges, hint depth, selected choices and checked attempts save to the same database/profile. Switching subjects/questions resets that tutoring context while preserving attempt history. Checking an answer records an ordinary practice attempt and retains the first attempt separately from retries.
- **`#analysis` — Mistake Analysis:** select an actual saved attempt, explain your thinking, explore an explicitly scripted example, choose the cause that fits, and confirm a tailored strategy. The student can override the category; changing the reflection or cause invalidates confirmation. Per-attempt reasoning drafts are stored separately from existing question strategy notes. A labeled sample mistake is available for new learners, and never contributes to real progress or plan completion. Retry opens the same original question in the tutor.

Guided Tutor and Mistake Analysis are unavailable while a demo test is running or paused. The existing demo remains an interaction rehearsal, with no validated scoring model or secure exam claims. No AI provider, API key or additional paid AI service was added.

The additive `companion` field is optional in version-one saved state, so existing PostgreSQL rows and previously exported backups continue to load without a reset. The Node API validates the new records; database credentials and isolation are unchanged. The handoff HTML files are preserved in `references/`.

Relevant implementation: `src/CompanionScreens.tsx`, `src/companion-model.ts`, `src/companion-types.ts`, `src/data/companion-content.ts`, and `src/companion.css`. Shared question controls and worked solutions live in `src/StudyComponents.tsx`.

## Start the local application

Requires Node.js 22.18+ (or a current supported Node release) and npm.

```sh
cd "/Users/sri/Documents/ChatGPT/WayPoint SAT Studio/waypoint-sat"
npm install
npm run dev -- --port 5173 --strictPort
```

Open **http://127.0.0.1:5173/**. Keep that terminal running. Stop the server with Ctrl+C. Use the same address and port each time: browser storage is scoped to the address, port and browser profile. `localhost` and `127.0.0.1` have separate storage.

For a production build, run `npm run build`, then `npm run preview -- --port 4173`. That port also has its own browser storage. No accounts, cloud services, API keys or deployment are required. After installing dependencies, the app has no runtime network dependencies beyond its local server.

## Use the learning loop

1. **Dashboard:** begin with zero recorded activity. Daily tasks update after checking a Math answer, checking a Reading & Writing answer, and saving a nonempty reflection on an attempted question.
2. **Question Practice:** choose a subject and answer, optionally request a hint, then check it. “Next practice question” switches to the second original question in that subject. “Try again” starts a recorded retry. Answer drafts and per-question elapsed time survive reloads; elapsed practice time counts while this screen is visible and stops after checking.
3. **Practice Test:** select “Begin demo” for four mixed-skills questions and five minutes. Answer, mark questions, and navigate freely. A saved deadline keeps time across screen changes and reloads; closing the browser does not pause it. Reopen after the deadline to get an automatically submitted result. “Pause demo” explicitly freezes the timer and disables answering. The finish dialog shows unanswered and marked totals. Submission locks that session, preserves unanswered items and flags, and opens review. A new demo retains earlier sessions.
4. **Answer Review:** select an actual attempt or demo session. Filter incorrect/unanswered or marked questions. Read the worked solution and write a reflection. Notes save as you type, per question, and remain available across attempts. “Save reflection” retries the save if needed.

The short demo includes pauses and mixed subjects, and shares content with focused practice. It is **not a full SAT simulation**, secure exam environment or calibrated assessment. SAT score estimates remain unavailable because there is no validated scoring method.

## Progress and storage

- First-attempt accuracy uses the earliest checked/submitted attempt for each question across both modes. An unanswered submitted question is incorrect. Retries are recorded separately and do not overwrite the first attempt.
- The seven-day chart counts answered, checked practice attempts and answered submitted demo items, including retries. Draft selections do not count as completed activity.
- Streaks count local calendar days with at least one answered checked/submitted question. Yesterday’s streak remains current until today ends. Empty test submissions and reflections alone do not earn a streak. Dates use the device’s local timezone.
- All data is saved to this browser’s `localStorage` under `waypoint-local-v1`. Use one active tab for studying. Other tabs receive saved changes, but simultaneous editing is not supported.
- Clearing site data, private browsing cleanup or changing the browser/origin can remove or hide local progress. Use “Export progress backup” to download JSON records for safekeeping. The hosted version also has an import UI for restoring this JSON backup.
- Save errors appear visibly with retry and export actions; current changes stay in memory. Damaged or unsupported saved data is preserved until explicitly replaced with “Start fresh.” Export it first. Closing the tab after a failed save can lose changes.
- A running timer uses the device clock. Changing the system clock can affect it; a server-authoritative clock is outside this local version’s scope.

## Project layout

- `src/data/original-questions.json`: original question content and solutions, extracted without changing the reference wording.
- `src/data/questions.ts`: stable question IDs, sections, metadata and hints.
- `src/model.ts`: session timing, submissions, activity calculations and saved-data validation.
- `src/main.tsx`: React shell, screens, shared question/solution components and persistence integration.
- `src/styles.css`: original reference styles.
- `src/accessibility.css`: native radio controls, visible focus, save states and responsive refinements.

## Verification

```sh
npm run build
npm test
npm run test:e2e
npm run test:hosted
```

Browser tests use locally installed Google Chrome (`channel: 'chrome'`) via Playwright. They can reuse the server on port 5173 or start it automatically. They run in isolated temporary browser contexts and do not alter your study progress.

Tests cover deadline restoration, pause/resume, idempotent submission, actual-answer review including unanswered items, independent flags, first attempts versus retries, local-day streaks, save failures, reflection reloads, keyboard radio controls and no horizontal overflow on all four screens at 1440, 834, 390 and 320px. Browser screenshots are written to `test-results/screenshots/`. A 720px viewport also checks reflow equivalent to a 1440px window at 200% zoom. These checks do not constitute a complete screen-reader or WCAG audit.

Server integration tests also verify private visitor profiles, validation, stale-write rejection, idempotent retry, CSRF checks and database outages. Hosted-mode browser tests verify database restoration, recovery from a lost save response, conflict resolution and local backup import. `tests/live-smoke.mjs` explicitly targets the live HTTPS deployment with a separate QA profile and can verify database durability across a redeployment; it does not use or modify your browser's student profile.
