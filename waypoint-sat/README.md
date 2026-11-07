# PrepOrbit AI SAT Studio

A React + TypeScript application following the supplied visual reference and design specification, with both local-only and Railway/PostgreSQL modes. All four original questions, answer choices, hints and worked solutions are included. The reference HTML files are preserved in `references/`.

Existing internal database, cookie, and browser-storage identifiers, question IDs, project paths, and the Railway URL stay compatible so existing profiles and bookmarks keep working. Original design references and historical screenshots are archived unchanged; current product branding is PrepOrbit AI.

## Railway version

Live application: **https://waypoint-web-production-50a5.up.railway.app/**

[Railway project](https://railway.com/project/ff7c016b-3e75-4524-b237-0565185ea0f2) · workspace: My Projects · environment: production.

- `waypoint-web` serves the React production build and Node API in one container. `Postgres` is a separate PostgreSQL service inside the same project with a persistent Railway volume. The web service references `${{Postgres.DATABASE_URL}}`; database credentials are never shipped to the browser or stored in the repository.
- The app uses the database’s private Railway connection. No database public domain or external database provider is required. See [Railway PostgreSQL documentation](https://docs.railway.com/databases/postgresql).
- Students sign in with an email and password. Each account has its own progress record, so it follows the student to any device. See **Accounts** below.
- Answers, attempts, running/paused test state, flags and reflections save to PostgreSQL. The footer and reflection editor show the actual database save status. Wait for **“Saved to Railway database”** before closing the tab. Offline or failed saves retain pending work in a browser backup and show retry/export controls.
- Saved data loads before the study screens open. Failed initial loads show a reconnect screen, rather than replacing existing progress with a blank state. Concurrent saves use revisions; a stale tab cannot overwrite newer progress. Export pending work before choosing **Reload server copy**.
- The hosted version’s clock still follows the device clock; hosting adds persistence, not a calibrated or secure exam system. The demo remains five minutes with four questions and no SAT score estimate.

### AI Assistant: connect GPT

Open **Learning Companion → AI Assistant** (or `/#assistant`). Five editable examples cover weekly weak areas, latest mistakes, a 20-minute study plan, linear equations, and pacing. Choose an example, edit it if desired, then select **Ask PrepOrbit AI**. Examples never send a paid API request by themselves.

In the existing Railway project, select **waypoint-web → Variables**:

1. Add `OPENAI_API_KEY` with your OpenAI API key. Keep it on the web service, without a `VITE_` prefix. Do not commit it or paste it into chat.
2. Optionally add `OPENAI_MODEL`. The default is `gpt-5-mini`; choose a model available to your API project that supports the Responses API. GPT-5 models use low reasoning effort.
3. Deploy the variable changes. Reload AI Assistant or select **Refresh context**. “GPT connected” means a key is configured; the first successful question verifies that the key, model access, and API billing work.

Without a key, the screen shows actual database context and preserves a draft, but does not generate or simulate AI answers. API failures appear visibly with a retry action. Local-only `npm run dev` does not connect to GPT; use the hosted app or build with `VITE_PERSISTENCE_MODE=server` and run `DATABASE_URL=... OPENAI_API_KEY=... npm start` to use a local Node server backed by PostgreSQL.

The server reads the signed-in account's PostgreSQL profile on every question and builds a bounded, read-only summary of recent attempts, confirmed mistake reflections, strategy notes, the current question, latest mistake with a verified solution, today's plan, and recent submitted demo sessions. Accuracy is recomputed against the question catalog. Weekly figures use the student's IANA time zone, Monday through today, and first attempt per distinct question within that week. Small samples are explicitly identified. No SAT score is estimated. The model has no SQL tool, database credentials, arbitrary database access, or progress-write capability.

Questions, the six most recent exchanges, and the summary are sent to OpenAI through the server's [Responses API](https://developers.openai.com/api/docs/guides/conversation-state) with `store:false`. This disables response-object storage at OpenAI; it is not a promise of zero retention under OpenAI's other data policies. The browser receives no API key. AI text renders as plain text, never executable HTML. Running and paused tests block requests on the server, including a test started during response generation.

Chat is stored separately in `waypoint_assistant`, scoped to the signed-in account (it moves with the account's progress when a pre-account profile is adopted). The latest 20 completed exchanges are displayed; older exchanges remain in PostgreSQL. Reload restores completed replies, drafts, and retry IDs. Repeating a completed request ID returns its saved reply without another GPT call. Failed or abandoned requests can be retried; a provider call completed before a database failure may be charged again. Chat is separate from the existing progress export/import and is not transferred by those controls. Browser drafts require localStorage; completed chat remains in PostgreSQL.

Requests are capped at 2,000 characters and 4,096 output tokens, with a 60-second provider timeout, one in-flight request per profile, and rolling 24-hour allowances of 30 provider requests per profile and 500 globally (including failed retries). These limits are shared across app instances through PostgreSQL. Sign-up is open, so someone could create several accounts; these remain modest cost controls rather than strong abuse prevention. Set an appropriate spending limit in your OpenAI project before sharing broadly.

Verification uses mocked OpenAI responses for success, provider errors, missing-key mode, retries, isolation, test blocking, and responsive chat at 1440, 834, 390 and 320px. A real paid GPT answer must be checked after a valid API key is configured.

After configuring the key, an opt-in live check creates a new QA profile with synthetic attempts and makes four paid GPT requests (weekly weaknesses, a worked mistake, concept help, and a 20-minute plan). It also verifies saved chat, idempotent replay, profile isolation, and test blocking. It does not read browser cookies or change an existing student's progress:

```sh
node --experimental-strip-types tests/live-assistant.mjs https://waypoint-web-production-50a5.up.railway.app --allow-paid-requests
```

Add `--focused` to make only two GPT requests for the week-to-date and readable-answer-label regression checks. QA profiles remain separate from student profiles.

### Accounts: sign in, sign up and forgot password

- **Sign up / sign in.** The hosted app opens on a sign-in screen. Email is case-insensitive. Passwords need 8–128 characters and are stored only as salted scrypt hashes (N=2^15, r=8, p=1; parameters are stored with each hash so they can be raised later). Sign-in gives the same error for an unknown email and a wrong password.
- **Sessions.** A random 256-bit token sits in an HttpOnly, SameSite=Lax, Secure cookie (`waypoint_session`) for 30 days; only its SHA-256 hash is stored in `waypoint_sessions`. **Sign out** deletes the session on the server and clears this browser's cached copy of the progress.
- **Students from before accounts existed.** Their progress was tied to the old `waypoint_student` cookie. The first time they sign up (or sign in to an account that has no progress yet) in that same browser, the progress moves into the account automatically. Nothing is deleted.
- **Forgot password.** The form always gives the same answer, whether or not the email has an account. If it does, a single-use link (`/#reset=<token>`) valid for 60 minutes is emailed. Only the newest link works. Using it sets the new password, signs out every other session and signs the student in. The token stays in the URL fragment, so it never reaches server or proxy logs.
- **Rate limits** (in memory, one replica): 30 auth requests per IP per 15 minutes, 10 sign-in attempts per email per 15 minutes, 3 reset emails per email per hour.
- **Email delivery.** Railway blocks outbound SMTP on most plans, so reset emails go through the [Resend](https://resend.com) HTTPS API. Set these variables on `waypoint-web`:
  - `RESEND_API_KEY` — the Resend API key.
  - `MAIL_FROM` — for example `Waypoint <no-reply@your-domain.com>`, on a domain verified in Resend. Without it, Resend's test sender only delivers to the Resend account owner's own address.
  - Until `RESEND_API_KEY` is set, the reset link is written to the `waypoint-web` deploy log (`[password-reset] … Reset link for …`). Only project members can read that log; a project owner can pass the link to the student.
- **Tables** (created on startup if missing; deploys never drop data): `waypoint_users`, `waypoint_sessions`, `waypoint_password_resets`. Account progress lives in the existing `waypoint_progress` table under `owner_hash = 'user:<account id>'`.

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
railway up .. --path-as-root --service waypoint-web --detach
railway deployment list --service waypoint-web --limit 3
```

Railway is connected to the SATIQ repository with `/waypoint-sat` as the service root. The manual upload above includes the repository root to preserve that layout. The private database URL stays in Railway variables. Set `APP_ORIGIN` to the exact public HTTPS origin if changing the domain; it enforces same-origin write requests. Use `/api/health` to confirm both the web server and PostgreSQL are reachable.

For a locally running server against your own PostgreSQL instance, set `DATABASE_URL` in your shell, run `VITE_PERSISTENCE_MODE=server npm run build`, then `npm start`. Never put database credentials in a `VITE_` variable. The original `npm run dev` flow below stays local-only.

## Learning Companion

All thirteen screens are available from one persistent left menu, grouped as **SAT Studio**, **Learning Companion**, and **Practice Intelligence**. On phones, tap **Menu**, choose a destination, and the menu closes to show that screen. Existing hash links still work.

The six Practice Intelligence screens from `references/new1.html` are:

- `#adaptive`: three curated algebra questions with a transparent next-question rule based on correctness and hint use. Checked attempts save to the study profile.
- `#work`: a typed equation verifier for the original tool-rental problem. It identifies the first unsupported or non-equivalent equation using a restricted algebra parser; it does not call AI or execute entered code.
- `#pacing`: actual submitted demo question timings, filters and a saved pacing goal. An explicitly labeled sample report is also available.
- `#similar`: nine verified template variants across Foundation, Medium and Stretch levels. No live AI generation is used.
- `#weekly`: a summary derived from real saved original and intelligent-practice attempts, with student/parent wording and print support. No messages are sent or parent accounts created.
- `#handwriting`: a session-only local image preview, manual transcription or illustrative sample, confirmation and equation verification. Automatic handwriting recognition is not connected. Typed lines are saved; uploaded images are not sent to the server.

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
DATABASE_URL=postgres://… npm run test:auth   # full stack: real server + a disposable PostgreSQL database
```

Browser tests use locally installed Google Chrome (`channel: 'chrome'`) via Playwright. They can reuse the server on port 5173 or start it automatically. They run in isolated temporary browser contexts and do not alter your study progress.

Tests cover deadline restoration, pause/resume, idempotent submission, actual-answer review including unanswered items, independent flags, first attempts versus retries, local-day streaks, save failures, reflection reloads, keyboard radio controls and no horizontal overflow on all four screens at 1440, 834, 390 and 320px. Browser screenshots are written to `test-results/screenshots/`. A 720px viewport also checks reflow equivalent to a 1440px window at 200% zoom. These checks do not constitute a complete screen-reader or WCAG audit.

Server integration tests also verify private visitor profiles, validation, stale-write rejection, idempotent retry, CSRF checks and database outages. Hosted-mode browser tests verify database restoration, recovery from a lost save response, conflict resolution and local backup import. `tests/live-smoke.mjs` explicitly targets the live HTTPS deployment with a separate QA profile and can verify database durability across a redeployment; it does not use or modify your browser's student profile.
