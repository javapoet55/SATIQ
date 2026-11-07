import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {emptyState, parseState} from '../src/model.ts';
import {createAssistant, studyContext, assistantError} from './assistant.mjs';
import {hashPassword, verifyPassword, burnPasswordCheck, newToken, tokenHash, TOKEN, normalizeEmail, passwordProblem, PASSWORD_MAX, SESSION_TTL_MS, RESET_TTL_MS, RateLimiter, createMailer} from './auth.mjs';

const ANON_COOKIE = 'waypoint_student';
const SESSION_COOKIE = 'waypoint_session';
const AUTH_ROUTES = new Set(['GET /api/auth/me','POST /api/auth/signup','POST /api/auth/signin','POST /api/auth/signout','POST /api/auth/forgot','POST /api/auth/reset']);
const ownerOf = user => `user:${user.id}`;
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon'};
const headers = {
  'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
export function createApp({database, assistant = createAssistant(), dist = resolve('dist'), production = process.env.NODE_ENV === 'production', appOrigin = process.env.APP_ORIGIN, mailer = createMailer(), limits = {
  ip: new RateLimiter({limit:30, windowMs:15 * 60 * 1000}),
  email: new RateLimiter({limit:10, windowMs:15 * 60 * 1000}),
  reset: new RateLimiter({limit:3, windowMs:60 * 60 * 1000}),
}}) {
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
        if (!(path === '/api/progress' && ['GET','PUT'].includes(req.method)) && !(isAssistant && ['GET','POST'].includes(req.method)) && !AUTH_ROUTES.has(`${req.method} ${path}`)) { json(404, {message:'Unknown endpoint.'}); return; }
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
        if (isAssistant) {
          const snapshot = await database.get(owner, emptyState());
          const body = req.method === 'POST' ? await readBody(req) : null;
          const timezone = body?.timezone ?? new URL(req.url,'http://localhost').searchParams.get('timezone') ?? 'UTC';
          if (typeof timezone !== 'string' || timezone.length > 100) throw assistantError(400,'Invalid time zone.');
          const context = studyContext(snapshot.state,timezone);
          const history = await database.assistantHistory(owner);
          if (req.method === 'GET') {json(200,{configured:assistant.configured,model:assistant.model,profileId:snapshot.profileId,context,history});return;}
          if (typeof body?.message !== 'string' || !body.message.trim() || body.message.trim().length > 2000 || !UUID.test(body.requestId)) throw assistantError(400,'Enter a question of 1–2,000 characters with a valid request ID.');
          if (context.testBlocked) throw assistantError(409,'Finish and submit your practice test before using AI help.');
          if (!assistant.configured) throw assistantError(503,'GPT is not connected yet. Add OPENAI_API_KEY to the Railway web service and deploy the variable change.');
          const message = body.message.trim();
          const reservation = await database.reserveAssistant(owner,body.requestId,message,context);
          if (reservation.kind === 'completed') {json(200,{id:body.requestId,message,answer:reservation.answer,context:reservation.context});return;}
          if (reservation.kind === 'mismatch') throw assistantError(409,'This request ID belongs to a different question. Start a new question.');
          if (reservation.kind === 'busy') throw assistantError(409,'An answer is still being prepared. Wait a moment before retrying.');
          if (reservation.kind === 'limit') throw assistantError(429,'The daily AI question allowance has been reached. Try again tomorrow.');
          try {
            const answer = await assistant.answer(message,context,history);
            const latest = await database.get(owner,emptyState());
            if (latest.state.sessions.some(s=>['running','paused'].includes(s.status))) throw assistantError(409,'A practice test started while your answer was being prepared. Submit it before asking again.');
            await database.completeAssistant(owner,body.requestId,answer);
            json(200,{id:body.requestId,message,answer,context});return;
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
