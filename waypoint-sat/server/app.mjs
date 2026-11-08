import {createServer} from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {emptyState, parseState} from '../src/model.ts';
import {createAssistant, studyContext, assistantError} from './assistant.mjs';
import {createAI, aiError} from './ai.mjs';
import {createBank} from './bank.mjs';
import {tutorReply, explainWork, transcribe, coachNote} from './study-ai.mjs';
import {generateOne, validSpec} from './generator.mjs';
import {checkWork} from '../src/work-check.ts';
import {QUESTION_ID, SPR_INPUT} from '../src/data/question-schema.ts';
import {hashPassword, verifyPassword, burnPasswordCheck, newToken, tokenHash, TOKEN, normalizeEmail, passwordProblem, PASSWORD_MAX, SESSION_TTL_MS, RESET_TTL_MS, RateLimiter, createMailer} from './auth.mjs';

const ANON_COOKIE = 'waypoint_student';
const SESSION_COOKIE = 'waypoint_session';
const STUDY_ROUTES = new Set(['GET /api/config','GET /api/questions','POST /api/ai/tutor','POST /api/ai/explain-work','POST /api/ai/handwriting','POST /api/ai/insight',
  'GET /api/admin/questions','POST /api/admin/generate','GET /api/admin/jobs','POST /api/admin/decide']);
const AI_LIMITS = {tutor: 80, explain: 40, handwriting: 15, insight: 12};
const AUTH_ROUTES = new Set(['GET /api/auth/me','POST /api/auth/signup','POST /api/auth/signin','POST /api/auth/signout','POST /api/auth/forgot','POST /api/auth/reset']);
const ownerOf = user => `user:${user.id}`;
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon'};
const desmos = process.env.DESMOS_API_KEY ? ' https://www.desmos.com https://*.desmos.com' : '';
const headers = {
  'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'same-origin',
  'Content-Security-Policy': `default-src 'self'; script-src 'self'${desmos}; style-src 'self' 'unsafe-inline'${desmos}; img-src 'self' data: blob:${desmos}; font-src 'self' data:${desmos}; connect-src 'self'${desmos}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
};
async function readBody(req, max = 1024 * 1024) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > max) { const e = new Error(max < 1024 * 1024 ? 'Request is too large.' : 'Progress exceeds the 1 MB limit. Export older attempts.'); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const e = new Error('Invalid JSON request.'); e.status = 400; throw e; }
}
export function createApp({database, assistant = createAssistant(), ai = createAI(), bank = createBank(database), adminEmails = process.env.ADMIN_EMAILS ?? '', desmosKey = process.env.DESMOS_API_KEY ?? '', dist = resolve('dist'), production = process.env.NODE_ENV === 'production', appOrigin = process.env.APP_ORIGIN, mailer = createMailer(), limits = {
  ip: new RateLimiter({limit:30, windowMs:15 * 60 * 1000}),
  email: new RateLimiter({limit:10, windowMs:15 * 60 * 1000}),
  reset: new RateLimiter({limit:3, windowMs:60 * 60 * 1000}),
}}) {
  const admins = new Set(adminEmails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean));
  const jobs = new Map();
  return createServer(async (req, res) => {
    for (const [key,value] of Object.entries(headers)) res.setHeader(key, value);
    const json = (status, value) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/api/health') {
        try { await database.health(); json(200, {ok:true, storage:'postgres'}); }
        catch { json(503, {ok:false, message:'Database is temporarily unavailable.'}); }
        return;
      }
      if (path.startsWith('/api/')) {
        const isAssistant = path === '/api/assistant';
        if (!(path === '/api/progress' && ['GET','PUT'].includes(req.method)) && !(isAssistant && ['GET','POST'].includes(req.method)) && !AUTH_ROUTES.has(`${req.method} ${path}`) && !STUDY_ROUTES.has(`${req.method} ${path}`)) { json(404, {message:'Unknown endpoint.'}); return; }
        const expectedOrigin = appOrigin || `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
        if ((req.headers.origin && req.headers.origin !== expectedOrigin) || req.headers['sec-fetch-site'] === 'cross-site') { json(403, {message:'Cross-site requests are not allowed.'}); return; }
        if (req.method !== 'GET' && (req.headers['x-waypoint-client'] !== '1' || !req.headers['content-type']?.startsWith('application/json'))) { json(403, {message:'A same-origin JSON request is required.'}); return; }
        const route = `${req.method} ${path}`;
        const cookies = parseCookies(req.headers.cookie);
        const cookie = (name, value, maxAge) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${production ? '; Secure' : ''}`;
        const sessionToken = TOKEN.test(cookies[SESSION_COOKIE] ?? '') ? cookies[SESSION_COOKIE] : null;
        const anonToken = TOKEN.test(cookies[ANON_COOKIE] ?? '') ? cookies[ANON_COOKIE] : null;
        const user = sessionToken ? await database.getSessionUser(tokenHash(sessionToken)) : null;
        const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown').trim();
        // Starts a session and adopts this browser's pre-account progress if the account has none yet.
        const signIn = async account => {
          const token = newToken();
          await database.createSession(tokenHash(token), account.id, Date.now() + SESSION_TTL_MS);
          const set = [cookie(SESSION_COOKIE, token, SESSION_TTL_MS / 1000)];
          // The old cookie is cleared only once its progress has moved to an account.
          if (anonToken && await database.claimProgress(createHash('sha256').update(anonToken).digest('hex'), ownerOf(account))) set.push(cookie(ANON_COOKIE, '', 0));
          res.setHeader('Set-Cookie', set);
          json(200, {user:{email:account.email}});
        };
        if (route === 'GET /api/auth/me') { json(200, {user: user ? {email:user.email} : null, emailDelivery: mailer.configured}); return; }
        if (route === 'POST /api/auth/signout') {
          if (sessionToken) await database.deleteSession(tokenHash(sessionToken));
          res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0)); json(200, {ok:true}); return;
        }
        if (route.startsWith('POST /api/auth/')) {
          if (!limits.ip.take(ip)) { json(429, {message:'Too many attempts. Wait a few minutes and try again.'}); return; }
          const body = await readBody(req, 16 * 1024);
          if (route === 'POST /api/auth/signup') {
            const email = normalizeEmail(body?.email);
            if (!email) { json(400, {message:'Enter a valid email address.'}); return; }
            const problem = passwordProblem(body?.password);
            if (problem) { json(400, {message:problem}); return; }
            const account = await database.createUser(email, await hashPassword(body.password));
            if (!account) { json(409, {message:'An account with this email already exists. Sign in, or reset your password.'}); return; }
            await signIn(account); return;
          }
          if (route === 'POST /api/auth/signin') {
            const email = normalizeEmail(body?.email);
            const password = typeof body?.password === 'string' && body.password.length <= PASSWORD_MAX ? body.password : null;
            if (!email || !password) { json(400, {message:'Enter your email and password.'}); return; }
            if (!limits.email.take(email)) { json(429, {message:'Too many sign-in attempts for this email. Wait 15 minutes, or reset your password.'}); return; }
            const account = await database.findUserByEmail(email);
            const valid = account ? await verifyPassword(password, account.passwordHash) : (await burnPasswordCheck(password), false);
            if (!valid) { json(401, {message:'That email and password do not match.'}); return; }
            limits.email.clear(email);
            await signIn(account); return;
          }
          if (route === 'POST /api/auth/forgot') {
            const email = normalizeEmail(body?.email);
            if (!email) { json(400, {message:'Enter a valid email address.'}); return; }
            // Same answer whether or not the account exists, so emails cannot be discovered here.
            json(200, {ok:true, message:'If an account uses that email, a reset link is on its way. It works for 60 minutes.'});
            if (!limits.reset.take(email)) return;
            // Runs after the response so timing does not reveal whether the account exists.
            (async () => {
              const account = await database.findUserByEmail(email);
              if (!account) return;
              const token = newToken();
              await database.createPasswordReset(tokenHash(token), account.id, Date.now() + RESET_TTL_MS);
              await mailer.sendPasswordReset({to:account.email, link:`${expectedOrigin}/#reset=${token}`});
            })().catch(error => console.error('Password reset request failed:', error.message));
            return;
          }
          if (route === 'POST /api/auth/reset') {
            const token = typeof body?.token === 'string' && TOKEN.test(body.token) ? body.token : null;
            if (!token) { json(400, {message:'This reset link is not valid. Ask for a new one.'}); return; }
            const problem = passwordProblem(body?.password);
            if (problem) { json(400, {message:problem}); return; }
            const account = await database.resetPassword(tokenHash(token), await hashPassword(body.password));
            if (!account) { json(400, {message:'This reset link has expired or was already used. Ask for a new one.'}); return; }
            limits.email.clear(account.email);
            await signIn(account); return;
          }
        }
        // Progress and assistant history belong to the signed-in account.
        if (!user) { json(401, {message:'Your session ended. Sign in again to keep saving.'}); return; }
        const owner = ownerOf(user);
        const isAdmin = admins.has(user.email.toLowerCase());
        const testRunning = state => state.sessions.some(s => ['running','paused'].includes(s.status)) || !!state.runs?.some(r => r.status === 'active');
        const useAi = async feature => {
          if (!ai.configured) throw aiError(503,'AI help is not connected yet.');
          if (!(await database.takeAiUsage(owner, feature, AI_LIMITS[feature]))) throw aiError(429,'You have reached today’s limit for this AI feature. It resets tomorrow.');
        };
        if (route === 'GET /api/config') { json(200, {ai: ai.configured, admin: isAdmin, desmosKey: desmosKey || null}); return; }
        if (route === 'GET /api/questions') { await bank.ensure(); json(200, {questions: bank.generated()}); return; }
        if (route.startsWith('POST /api/ai/')) {
          await bank.ensure();
          const body = await readBody(req, route === 'POST /api/ai/handwriting' ? 6 * 1024 * 1024 : 64 * 1024);
          const snapshot = await database.get(owner, emptyState());
          if (route !== 'POST /api/ai/insight' && testRunning(snapshot.state)) throw aiError(409,'Finish and submit your practice test before using AI help.');
          if (route === 'POST /api/ai/insight') {
            const kind = body?.kind === 'weekly' ? 'weekly' : 'daily';
            const timezone = typeof body?.timezone === 'string' && body.timezone.length <= 100 ? body.timezone : 'UTC';
            const context = studyContext(snapshot.state, timezone, Date.now(), bank.lookup());
            const day = kind === 'weekly' ? context.weekStart : context.today;
            const cached = await database.getInsight(owner, day, kind);
            if (cached && body?.refresh !== true) { json(200, {text: cached.text, day, cached: true}); return; }
            if (!context.totalAttempts) { json(200, {text: null, day, cached: false}); return; }
            await useAi('insight');
            const text = await coachNote(ai, {kind, context});
            await database.saveInsight(owner, day, kind, text);
            json(200, {text, day, cached: false}); return;
          }
          if (route === 'POST /api/ai/handwriting') {
            const image = body?.image;
            if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 6 * 1024 * 1024) throw aiError(400,'Send a PNG, JPEG, or WebP photo under 4 MB.');
            const variable = typeof body?.variable === 'string' && /^[a-z]$/.test(body.variable) ? body.variable : 'x';
            await useAi('handwriting');
            json(200, {lines: await transcribe(ai, {image, variable})}); return;
          }
          const q = typeof body?.questionId === 'string' && QUESTION_ID.test(body.questionId) ? bank.get(body.questionId) : null;
          if (!q) throw aiError(404,'That question is not in the question bank.');
          if (route === 'POST /api/ai/tutor') {
            const message = typeof body?.message === 'string' ? body.message.trim() : '';
            if (!message || message.length > 500) throw aiError(400,'Write a message of 1–500 characters.');
            const selected = body?.selected === null || body?.selected === undefined ? null : Number.isInteger(body.selected) && body.selected >= 0 && body.selected < 4 ? body.selected : typeof body.selected === 'string' && SPR_INPUT.test(body.selected) ? body.selected : null;
            const history = Array.isArray(body?.history) ? body.history.filter(m => m && ['user','tutor'].includes(m.role) && typeof m.text === 'string').slice(-8) : [];
            // The answer may be discussed only once the student has a checked attempt saved on the server.
            const checked = snapshot.state.attempts.some(a => a.questionId === q.id && a.mode === 'practice');
            await useAi('tutor');
            json(200, {reply: await tutorReply(ai, {q, checked, selected, hintLevel: Math.min(3, Math.max(0, Number(body?.hintLevel) || 0)), history, message})}); return;
          }
          if (route === 'POST /api/ai/explain-work') {
            if (!q.work) throw aiError(400,'Explain My Work supports one-variable linear questions.');
            const lines = Array.isArray(body?.lines) ? body.lines.filter(l => typeof l === 'string').map(l => l.slice(0, 300)).slice(0, 12) : [];
            if (!lines.some(l => l.trim())) throw aiError(400,'Write at least one line of work.');
            const results = checkWork(lines.join('\n'), q.work.variable, q.work.solution);
            await useAi('explain');
            json(200, {explanation: await explainWork(ai, {q, lines, results}), results}); return;
          }
        }
        if (route.startsWith('GET /api/admin/') || route.startsWith('POST /api/admin/')) {
          if (!isAdmin) { json(403, {message:'Only administrators can manage generated questions.'}); return; }
          if (route === 'GET /api/admin/questions') {
            const status = new URL(req.url,'http://localhost').searchParams.get('status');
            json(200, {questions: await database.listGeneratedQuestions(['pending','flagged','approved','rejected'].includes(status) ? status : null)}); return;
          }
          if (route === 'GET /api/admin/jobs') { json(200, {jobs: [...jobs.values()].reverse()}); return; }
          const body = await readBody(req, 16 * 1024);
          if (route === 'POST /api/admin/decide') {
            const decision = body?.decision === 'approve' ? 'approved' : body?.decision === 'reject' ? 'rejected' : null;
            if (!decision || typeof body?.id !== 'string') throw aiError(400,'Choose approve or reject for a question ID.');
            if (!(await database.decideGeneratedQuestion(body.id, decision, user.email))) throw aiError(404,'That generated question was not found.');
            await bank.refresh(); json(200, {ok:true}); return;
          }
          if (route === 'POST /api/admin/generate') {
            const spec = validSpec(body);
            if (!spec) throw aiError(400,'Choose a section, a matching skill, a difficulty, and a count from 1 to 5.');
            if (!ai.configured) throw aiError(503,'AI is not connected yet.');
            if ([...jobs.values()].some(j => j.status === 'running')) throw aiError(409,'A generation job is already running. Wait for it to finish.');
            const job = {id: randomUUID(), spec, status: 'running', by: user.email, startedAt: Date.now(), results: [], error: null};
            jobs.set(job.id, job); while (jobs.size > 20) jobs.delete(jobs.keys().next().value);
            (async () => {
              await bank.refresh().catch(() => {});
              const texts = bank.staticTexts();
              for (let i = 0; i < spec.count; i++) {
                try {
                  const result = await generateOne(ai, spec, {existingTexts: texts});
                  await database.saveGeneratedQuestion(result.question, result.status, result.verification, user.email);
                  texts.add((result.question.text ?? '').trim().toLowerCase() + (result.question.passage ?? '').trim().toLowerCase());
                  job.results.push({id: result.question.id, status: result.status, problems: result.verification.problems});
                } catch (error) { job.results.push({id: null, status: 'error', problems: [error.status ? error.message : 'Generation failed.']}); }
              }
              job.status = 'done'; job.finishedAt = Date.now();
            })().catch(() => { job.status = 'failed'; });
            json(202, {job}); return;
          }
        }
        if (isAssistant) {
          await bank.ensure();
          const snapshot = await database.get(owner, emptyState());
          const body = req.method === 'POST' ? await readBody(req) : null;
          const timezone = body?.timezone ?? new URL(req.url,'http://localhost').searchParams.get('timezone') ?? 'UTC';
          if (typeof timezone !== 'string' || timezone.length > 100) throw assistantError(400,'Invalid time zone.');
          const context = studyContext(snapshot.state,timezone,Date.now(),bank.lookup());
          const history = await database.assistantHistory(owner);
          if (req.method === 'GET') {json(200,{configured:assistant.configured,mathConfigured:!!assistant.mathConfigured,model:assistant.model,profileId:snapshot.profileId,context,history});return;}
          if (typeof body?.message !== 'string' || !body.message.trim() || body.message.trim().length > 2000 || !UUID.test(body.requestId)) throw assistantError(400,'Enter a question of 1–2,000 characters with a valid request ID.');
          if (context.testBlocked) throw assistantError(409,'Finish and submit your practice test before using AI help.');
          if (!assistant.configured) throw assistantError(503,'AI Assistant is temporarily unavailable. Please try again later.');
          const message = body.message.trim();
          const reservation = await database.reserveAssistant(owner,body.requestId,message,context);
          if (reservation.kind === 'completed') {json(200,{id:body.requestId,message,answer:reservation.answer,details:reservation.details ?? {},context:reservation.context});return;}
          if (reservation.kind === 'mismatch') throw assistantError(409,'This request ID belongs to a different question. Start a new question.');
          if (reservation.kind === 'busy') throw assistantError(409,'An answer is still being prepared. Wait a moment before retrying.');
          if (reservation.kind === 'limit') throw assistantError(429,'The daily AI question allowance has been reached. Try again tomorrow.');
          try {
            const assertAllowed = async () => {
              const latest = await database.get(owner,emptyState());
              if (testRunning(latest.state)) throw assistantError(409,'A practice test started while your answer was being prepared. Submit it before asking again.');
            };
            const result = await assistant.answer(message,context,history,{assertAllowed});
            await assertAllowed();
            const {answer,...details} = typeof result==='string' ? {answer:result} : result;
            await database.completeAssistant(owner,body.requestId,answer,details);
            json(200,{id:body.requestId,message,answer,details,context});return;
          } catch (error) {await database.failAssistant(owner,body.requestId);throw error;}
        }
        if (req.method === 'GET') { const snapshot = await database.get(owner, emptyState()); json(200, snapshot); return; }
        const body = await readBody(req);
        if (!Number.isSafeInteger(body?.revision) || body.revision < 0 || !UUID.test(body.writeId)) { json(400, {message:'Invalid save revision or write ID.'}); return; }
        let state;
        try { state = parseState(JSON.stringify(body.state)); } catch { json(400, {message:'Invalid progress data. Export your backup before retrying.'}); return; }
        const saved = await database.put(owner, body.revision, state, body.writeId);
        if (!saved) { json(409, {message:'Newer progress was saved in another tab. Export your pending work, then reload the server copy.'}); return; }
        json(200, saved); return;
      }
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, {Allow:'GET, HEAD'}); res.end(); return; }
      const name = path === '/' ? '/index.html' : decodeURIComponent(path);
      let file = resolve(dist, `.${name}`);
      if (!file.startsWith(`${resolve(dist)}${sep}`)) { json(403, {message:'Forbidden path.'}); return; }
      try { if (!(await stat(file)).isFile()) throw new Error(); }
      catch { if (extname(name)) { json(404, {message:'File not found.'}); return; } file = resolve(dist, 'index.html'); }
      const contents = await readFile(file);
      res.writeHead(200, {'Content-Type':MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control':file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'});
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      // Never log connection strings, request cookies, reflections, or SQL parameter values.
      console.error('Request failed:', error.status ? 'invalid request' : 'service unavailable');
      json(error.status ?? 503, {message: error.status ? error.message : 'Unable to reach the database. Your local backup is preserved. Retry shortly.'});
    }
  });
}
