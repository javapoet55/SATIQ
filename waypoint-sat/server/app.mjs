import {createServer} from 'node:http';
import {randomBytes, createHash} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {emptyState, parseState} from '../src/model.ts';
import {createAssistant, studyContext, assistantError} from './assistant.mjs';

const COOKIE = 'waypoint_student';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon'};
const headers = {
  'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
};
async function readBody(req) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) { const e = new Error('Progress exceeds the 1 MB limit. Export older attempts.'); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const e = new Error('Invalid JSON request.'); e.status = 400; throw e; }
}
export function createApp({database, assistant = createAssistant(), dist = resolve('dist'), production = process.env.NODE_ENV === 'production', appOrigin = process.env.APP_ORIGIN}) {
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
        if (!(path === '/api/progress' && ['GET','PUT'].includes(req.method)) && !(isAssistant && ['GET','POST'].includes(req.method))) { json(404, {message:'Unknown endpoint.'}); return; }
        const expectedOrigin = appOrigin || `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
        if ((req.headers.origin && req.headers.origin !== expectedOrigin) || req.headers['sec-fetch-site'] === 'cross-site') { json(403, {message:'Cross-site requests are not allowed.'}); return; }
        if (req.method !== 'GET' && (req.headers['x-waypoint-client'] !== '1' || !req.headers['content-type']?.startsWith('application/json'))) { json(403, {message:'A same-origin JSON request is required.'}); return; }
        const raw = req.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
        let token = raw && /^[a-f0-9]{64}$/.test(raw) ? raw : null;
        if (!token && req.method !== 'GET') { json(401, {message:'Study session expired. Reload to reconnect.'}); return; }
        if (!token) token = randomBytes(32).toString('hex');
        const owner = createHash('sha256').update(token).digest('hex');
        res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${production ? '; Secure' : ''}`);
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
