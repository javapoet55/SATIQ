# PrepOrbit AI SAT Studio

A React + TypeScript Digital SAT practice app with both local-only and Railway/PostgreSQL modes. It ships a reviewed bank of 79 original questions covering all 29 Digital SAT skills (8 domains), timed adaptive practice tests, and GPT-powered tutoring, explanations, handwriting reading, coach notes, and admin-reviewed question generation. The reference HTML files are preserved in `references/`.

Existing internal database, cookie, and browser-storage identifiers, question IDs, project paths, and the Railway URL stay compatible so existing profiles and bookmarks keep working. Original design references and historical screenshots are archived unchanged; current product branding is PrepOrbit AI.

## Railway version

Live application: **https://waypoint-web-production-50a5.up.railway.app/**

[Railway project](https://railway.com/project/ff7c016b-3e75-4524-b237-0565185ea0f2) · workspace: My Projects · environment: production.

- `waypoint-web` serves the React production build and Node API in one container. `Postgres` is a separate PostgreSQL service inside the same project with a persistent Railway volume. The web service references `${{Postgres.DATABASE_URL}}`; database credentials are never shipped to the browser or stored in the repository.
- The app uses the database’s private Railway connection. No database public domain or external database provider is required. See [Railway PostgreSQL documentation](https://docs.railway.com/databases/postgresql).
- Students sign in with an email and password. Each account has its own progress record, so it follows the student to any device. See **Accounts** below.
- Answers, attempts, running/paused test state, flags and reflections save to PostgreSQL. The footer and reflection editor show the actual database save status. Wait for **“Saved to Railway database”** before closing the tab. Offline or failed saves retain pending work in a browser backup and show retry/export controls.
- Saved data loads before the study screens open. Failed initial loads show a reconnect screen, rather than replacing existing progress with a blank state. Concurrent saves use revisions; a stale tab cannot overwrite newer progress. Export pending work before choosing **Reload server copy**.
- The hosted version’s clock still follows the device clock; hosting adds persistence, not a calibrated or secure exam system. Practice tests report correct counts, not an SAT score: a reliable scale needs calibration data the app does not have yet.

### What students get

- **Navigation**: Home · Practice · Test · Review · Plan · Ask AI (plus **Admin** for administrators). Pages with related tools show sub-tabs (for example Review → Answer Review, Mistake Reflection, Explain My Work, Handwritten Work). Old links such as `#adaptive` and `#similar` open adaptive practice.
- **Question bank** (`src/data/sat-bank.json`): 79 original questions (41 Math, 38 Reading and Writing) across every Digital SAT skill at Easy, Medium and Hard, including 9 typed-answer (student-produced response) math questions. Every wrong choice has an explanation of why it is tempting. Correct-answer positions are balanced across A–D. Math uses KaTeX (`\( … \)` inline; `$` stays money).
- **Answer-key verification**: every math key is checked by `server/question-check.mjs` (mathjs) — the stated answer must equal a computed value or be algebraically equivalent, and no wrong choice may equal it — and was independently re-solved with sympy when authored. `tests/bank.test.mjs` re-runs the machine checks on every build.
- **Practice**: filter by section, domain or skill and by level, or use **Adaptive** (a correct answer moves up a level, a miss moves down). Typed answers follow SAT rules (equivalent fractions and decimals; decimals need 3+ places if not exact). Desmos calculator and the reference sheet are available for Math.
- **Practice tests**: Quick check (10 questions, 13 min), Reading & Writing or Math section (2 adaptive modules), or a full-length 4-module test with a break. Module 2 is harder when Module 1 is at least 60% correct, otherwise easier. Timing is real SAT pacing (32 min / 27 RW questions, 35 min / 22 Math questions), scaled to module length; modules grow to full length as the bank grows (each module uses at most half of a section's questions). Expired modules submit automatically. AI help is paused for the whole test; **Stop test** ends it early.
- **Daily plan**: built from first-attempt accuracy — the weakest Math skill and weakest Reading and Writing skill (or the next untried one), plus a reflection on a missed question. A practice activity completes after its planned number of new answers in that skill.

### AI features (OpenAI)

All AI calls go through `server/ai.mjs` (Responses API, `store: false`). The server rebuilds every fact from PostgreSQL and the answer key; nothing the browser claims is trusted.

| Feature | Endpoint | Daily limit per student |
| --- | --- | --- |
| Live guided tutor (Socratic; never states the key before the student has a checked attempt, enforced by instructions **and** a server-side leak filter) | `POST /api/ai/tutor` | 80 |
| Explain my mistake (the algebra checker marks each line; GPT explains the first wrong one) | `POST /api/ai/explain-work` | 40 |
| Read handwriting (photo → lines; the student confirms before checking) | `POST /api/ai/handwriting` | 15 |
| Coach notes on Home, Plan and Weekly Summary (cached per day/week) | `POST /api/ai/insight` | 12 new notes |

Limits are stored atomically in `waypoint_ai_usage` and reset each UTC day. Without `OPENAI_API_KEY`, every screen still works: the tutor falls back to step-by-step hints and handwriting to typed transcription.

**Question generator (admins only).** Set `ADMIN_EMAILS` (comma-separated) on `waypoint-web`. An admin's **Admin** page generates 1–5 questions per job for a chosen skill, difficulty and format. Each draft must pass: a strict JSON schema, structural validation, the machine math check, a duplicate check, and a **blind solve** by a separate call that never sees the key. Failures are rejected; a blind-solve disagreement is flagged. Nothing reaches students until an admin approves it; approved questions join practice and tests immediately and can be retired later. Stored in `waypoint_questions`.

Optional variables: `OPENAI_MODEL` (default `gpt-5-mini`), `OPENAI_GENERATOR_MODEL` and `OPENAI_VERIFIER_MODEL` (default: `OPENAI_MODEL`), no key is needed for the calculator: the Desmos graphing calculator is shown in a frame served by desmos.com, so no outside script runs on this site.

### Practice Test: choose a topic and take 25 questions

Open **Practice Test** (`/#test`). Choose Math or Reading & Writing, then one content domain and **Start 25-question test**. The page includes:

- **Math:** Algebra, Advanced Math, Problem-Solving & Data Analysis, Geometry & Trigonometry. Each domain has 25 original questions and a 40-minute practice timer.
- **Reading & Writing:** Information & Ideas, Craft & Structure, Expression of Ideas, Standard English Conventions. Each has 25 original questions and a 30-minute timer.
- A bank of **200 original questions** with four choices, answer keys, and worked explanations. Each attempt shuffles the selected domain’s same 25 items; these are authored questions and deterministic numerical templates, not live AI-generated exam items. They are introductory topic practice, not calibrated SAT difficulty or a full adaptive SAT simulation. Topics follow the College Board’s [Math domains](https://satsuite.collegeboard.org/sat/whats-on-the-test/math/types) and [Reading & Writing domains](https://satsuite.collegeboard.org/sat/whats-on-the-test/reading-writing).
- A saved overall deadline and time spent on each question. The timer continues when navigating away, closing the browser, or reloading. **Pause practice** explicitly freezes it. This uses the device clock, not a secure exam clock. Math/R&W durations are PrepOrbit AI practice settings, not official SAT module durations.
- Navigation across all 25 questions, independent review flags, a confirmation dialog showing unanswered/marked counts, and automatic submission on expiry. Submission is idempotent; it records all 25 outcomes, including unanswered items, and locks the attempt.
- Answer Review with all 25 actual choices, worked solutions and saved reflections. Completed topic attempts appear in Dashboard, Weekly Summary, and AI Assistant database context. First attempts remain preserved on retakes; no estimated SAT score is produced.

The original four-question, five-minute demo remains under **Open 4-question quick demo**. Original saved sessions and backups remain compatible. Topic content is in `src/data/test-topics.ts`, `test-questions.ts`, and `test-reading.ts`, separate from the React screen in `src/TopicTests.tsx`.

After deployment, `node --experimental-strip-types tests/live-topic-smoke.mjs HTTPS_ORIGIN` creates a separate QA account and checks two real 25-question PostgreSQL saves, grading, context integration and AI-help blocking. It makes no LLM calls and sends no email; no existing student account is used.

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

- `src/data/sat-bank.json`: the reviewed question bank. `src/data/question-schema.ts`: question types, SAT skill taxonomy, grading (including typed answers) and validation, shared by browser and server. `src/data/bank.ts`: browser registry that adds approved generated questions.
- `src/practice-engine.ts`: question selection, adaptive level, skill statistics, and test/module assembly with adaptive routing.
- `src/model.ts`: saved-progress model, timing, submissions and validation (accepts the earlier 4-question demo data unchanged).
- `src/main.tsx`: app shell and navigation. `src/StudioScreens.tsx` (Home, Practice, Test, Review), `src/CompanionScreens.tsx` (Tutor, Mistake Reflection, Daily Plan), `src/IntelligenceScreens.tsx` (Explain My Work, Handwritten Work, Pacing, Weekly), `src/AdminScreen.tsx`.
- `src/work-check.ts`: line-by-line algebra checker for one-variable linear questions.
- `server/`: HTTP app, accounts, PostgreSQL, assistant, `ai.mjs`, `study-ai.mjs` (tutor, explanations, handwriting, coach notes), `generator.mjs`, `question-check.mjs`, `bank.mjs`.

## Verification

```sh
npm run build
npm test
npm run test:e2e
npm run test:hosted
DATABASE_URL=postgres://… npm run test:auth   # full stack: real server + a disposable PostgreSQL database
```

Browser tests use locally installed Google Chrome (`channel: 'chrome'`) via Playwright. They can reuse the server on port 5173 or start it automatically. They run in isolated temporary browser contexts and do not alter your study progress.

Tests cover the question bank (structure, machine-verified math keys, skill coverage, SAT typed-answer grading), practice and retries, wrong-choice explanations, quick checks and adaptive section tests (module routing, automatic submission when time expires, stopping early), the daily plan, tutor hints, the step checker, loading progress saved by the earlier 4-question demo, the AI endpoints and generator with a fake OpenAI (answer-leak filter, limits, test blocking, verification gates, admin approval), and no horizontal overflow on every page at 1440, 834, 390 and 320px. Browser screenshots are written to `test-results/screenshots/`. A 720px viewport also checks reflow equivalent to a 1440px window at 200% zoom. These checks do not constitute a complete screen-reader or WCAG audit.

Server integration tests also verify private visitor profiles, validation, stale-write rejection, idempotent retry, CSRF checks and database outages. Hosted-mode browser tests verify database restoration, recovery from a lost save response, conflict resolution and local backup import. `tests/live-smoke.mjs` explicitly targets the live HTTPS deployment with a separate QA profile and can verify database durability across a redeployment; it does not use or modify your browser's student profile.


## AI Assistant math tools

The hosted `#assistant` screen can now use the private `preporbit-math-mcp` Railway service to check calculations, statistics, unit conversions and compound growth, and draw function, histogram, scatter, line and box charts. Students can choose either math example, edit it and send it, or ask in their own words. Replies show successful tool calls, expandable calculation results, and inline PNG charts. Charts and evidence are saved with the account's chat and restored on reload/retry. Earlier plain-text replies remain compatible.

The web backend requires `MATH_MCP_URL=http://preporbit-math-mcp.railway.internal:8080/mcp` and a Railway variable reference `MATH_MCP_JWT_SECRET=${{preporbit-math-mcp.MATH_MCP_JWT_SECRET}}`. Keep these server-side; no `VITE_` variables or browser credentials. The backend signs 90-second JWTs. OpenAI calls custom functions through the backend rather than receiving a private Railway URL or token. See [the private service documentation](../services/math-mcp/README.md).

A fixed nine-tool allowlist is enforced both at discovery and execution. Shared workspace tools, resources and matrix/financial simulation tools are inaccessible to student chat. Only requested expressions and numeric data go to the math service. The assistant retains read-only access to the signed-in student's progress summary. Running/paused practice tests block AI before generation, before every tool call and before saving a reply. There are at most two tool rounds, four calls and two chart images per answer, within a 65-second overall deadline. Tool failures appear as warnings; ordinary GPT tutoring can continue without claiming a tool-checked result. Numerical checks do not establish the correctness of every explanation or provide a validated SAT score.

`waypoint_assistant.details` is an additive JSONB column holding successful tool names/results, bounded PNG chart data and warnings. It follows the existing account ownership and completed-request replay rules. No student content is written to the shared administrative math workspace. The existing per-account and global daily question limits still apply; a question involving tools may make up to three GPT requests.

Implementation follows the [official OpenAI function-calling documentation](https://developers.openai.com/api/docs/guides/function-calling): replay response output items and function outputs with `store:false`, including encrypted reasoning items. No image bytes or private service credentials are sent back to the language model.

Verification: `npm test`, `npm run build`, and `npm run test:hosted -- tests/hosted/assistant.spec.ts`. In the web container, `tests/live-math-assistant.mjs` exercises three paid GPT → MCP requests, saved charts, replay, anonymous rejection and active-test blocking using a disposable QA account that it removes afterward. `tests/assistant-postgres-smoke.mjs` checks additive chat persistence/isolation with synthetic records and no GPT calls.

Verified November 8, 2026: 47 application tests, 9 Assistant Chrome tests, production build, real MCP calculator/chart checks, and all live GPT → MCP calculation/statistics/graph requests passed. Deployment `127bba36-88af-4f39-9046-d734b7bf4a16` is healthy. Production browser testing confirmed the composer generates a real chart, reload restores it, and 1440/834/390/320px layouts have no horizontal overflow. PostgreSQL checks passed for chart evidence, replay, account isolation, concurrency, failure retries and daily limits. Disposable test accounts were removed. `node tests/live-math-browser.mjs` repeats the production UI check (one GPT request, installed Chrome and authenticated Railway CLI required) and removes its QA account afterward. Screenshots are in the ignored `test-results-hosted/` directory.


## Public landing page and study app on Railway

The public homepage `/` now serves the combined SAT practice/community tutoring landing page, ported from `community-landing/` into `landing/` for the existing Node service. The study app is at `/app/` and all live landing-page SAT and Log In actions use that same-origin path. The app logo links back to the public homepage. The community Site remains a separate copy; Railway builds the canonical integrated source in `waypoint-sat/landing/`.

The build produces both the existing study assets and a separate `dist/landing/` entry with local photos, logo, fonts and a labeled tutor preview. No Cloudflare runtime or separate Sites login is required on Railway. API routes, PostgreSQL, student session cookies and browser storage stay on their existing origin and retain their data. Old `/#dashboard`, `/#practice`, `/#assistant` and other study bookmarks redirect to `/app/#…`; the landing page uses `#sat-practice` to avoid collisions. Old password-reset links still forward into the app, and new emails use `/app/#reset=…`.

Verify a production-equivalent build with `VITE_PERSISTENCE_MODE=server npm run build`, `npm test` and `npx playwright test --config playwright.landing.config.ts`. The browser integration tests run the real Node static routing against a stub health check, with no production student data or GPT calls. They cover public homepage → practice sign-in → homepage, legacy bookmarks/reset URLs, tutor filtering, Escape dismissal, loaded images and 1440/834/390/320px layouts.

## Tutor matching (free, volunteer)

Sign-up asks whether you are a student, a tutor or both. Students search tutors by distance and subject and send an email invite; if the tutor accepts, they meet offline. Tutors log sessions, students confirm them, and after 100 confirmed hours an administrator (`ADMIN_EMAILS`) can issue a stamped certificate under **Admin → Tutoring**. Anyone can check a certificate at `/#verify/<code>`; it prints or saves as PDF from the browser.

Privacy: others see only "First L." and a distance band (ZIP code and coordinates are never exposed). Full name and email appear only while a connection is accepted. Invite emails contain no personal details beyond display names. Tutor LinkedIn/school are self-reported and not verified; a "Reviewed" badge only means an administrator looked at the profile (it clears when LinkedIn or school changes). Invite emails need `RESEND_API_KEY` and a verified `MAIL_FROM` domain; requests also appear in the app regardless.
