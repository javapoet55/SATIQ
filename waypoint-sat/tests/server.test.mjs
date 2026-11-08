import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {emptyState} from '../src/model.ts';

class TestDatabase {
  rows = new Map(); users = new Map(); sessions = new Map(); resets = new Map(); failing = false;
  async health() {if (this.failing) throw new Error('sensitive connection details');}
  async get(owner, state) {
    await this.health();
    if (!this.rows.has(owner)) this.rows.set(owner, {profileId:randomUUID(), state, revision:0});
    return this.rows.get(owner);
  }
  async put(owner, revision, state, writeId) {
    await this.health(); const row = this.rows.get(owner);
    if (!row) return null;
    if (row.lastWriteId === writeId) return {revision:row.revision};
    if (revision !== row.revision) return null;
    this.rows.set(owner, {...row, revision:revision + 1, state, lastWriteId:writeId});
    return {revision:revision + 1};
  }
  async claimProgress(from, to) {
    if (!this.rows.has(from) || this.rows.has(to)) return false;
    this.rows.set(to, this.rows.get(from)); this.rows.delete(from); return true;
  }
  async createUser(email, passwordHash, role = 'student') {
    await this.health();
    if ([...this.users.values()].some(u => u.email === email)) return null;
    const now = new Date().toISOString();
    const user = {id:randomUUID(), email, passwordHash, role, createdAt:now, lastActiveAt:now}; this.users.set(user.id, user); return {id:user.id, email, role};
  }
  touches = 0;
  async touchUser(id) { this.touches++; const u = this.users.get(id); if (u) u.lastActiveAt = new Date().toISOString(); }
  async listUsers() { return [...this.users.values()].map(({passwordHash, ...u}) => u).reverse(); }
  async setUserRole(id, role) { const u = this.users.get(id); if (!u) return false; u.role = role; return true; }
  async findUserByEmail(email) { await this.health(); return [...this.users.values()].find(u => u.email === email) ?? null; }
  async createSession(hash, userId, expiresAt) { this.sessions.set(hash, {userId, expiresAt}); }
  async getSessionUser(hash) {
    await this.health(); const s = this.sessions.get(hash);
    if (!s || s.expiresAt <= Date.now()) return null;
    const u = this.users.get(s.userId); return u ? {id:u.id, email:u.email} : null;
  }
  async deleteSession(hash) { this.sessions.delete(hash); }
  async createPasswordReset(hash, userId, expiresAt) {
    for (const [k, r] of this.resets) if (r.userId === userId) this.resets.delete(k);
    this.resets.set(hash, {userId, expiresAt, used:false});
  }
  async resetPassword(hash, passwordHash) {
    const r = this.resets.get(hash);
    if (!r || r.used || r.expiresAt <= Date.now()) return null;
    r.used = true; const u = this.users.get(r.userId); u.passwordHash = passwordHash;
    for (const [k, s] of this.sessions) if (s.userId === u.id) this.sessions.delete(k);
    return {id:u.id, email:u.email};
  }
}
const cookieOf = (response, name) => response.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith(`${name}=`));
async function start(t, options = {}) {
  const database = new TestDatabase(); const sent = [];
  const mailer = {configured:true, async sendPasswordReset(message) {sent.push(message);}};
  const server = createApp({database, production:false, mailer, ...options});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const get = async (cookie = '') => fetch(`${url}/api/progress`, {headers:{cookie}});
  const put = async (cookie, body, extra = {}) => fetch(`${url}/api/progress`, {method:'PUT', headers:{cookie, 'Content-Type':'application/json', 'X-Waypoint-Client':'1', ...extra}, body:JSON.stringify(body)});
  const auth = async (action, body, cookie = '', extra = {}) => fetch(`${url}/api/auth/${action}`, {method:'POST', headers:{cookie, 'Content-Type':'application/json', 'X-Waypoint-Client':'1', ...extra}, body:JSON.stringify(body)});
  const me = async cookie => (await fetch(`${url}/api/auth/me`, {headers:{cookie}})).json();
  const signup = async (email = `s${randomUUID()}@example.com`, password = 'correct horse battery', cookie = '', role) => {
    const response = await auth('signup', role === undefined ? {email, password} : {email, password, role}, cookie);
    assert.equal(response.status, 200);
    return {email, password, cookie: cookieOf(response, 'waypoint_session'), response};
  };
  return {database, url, get, put, auth, me, signup, sent};
}
test('API isolates accounts and restores saved progress', async t => {
  const {get, put, signup} = await start(t);
  const {cookie, response} = await signup();
  assert.match(response.headers.get('set-cookie'), /waypoint_session=[a-f0-9]{64}; HttpOnly; SameSite=Lax/);
  const first = await get(cookie);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const profile = await first.json();
  const state = emptyState(); state.reflections['wp-math-001'] = {text:'Keep the fixed fee separate.', updatedAt:Date.now()};
  assert.equal((await put(cookie, {revision:0, writeId:randomUUID(), state})).status, 200);
  const restored = await (await get(cookie)).json();
  assert.deepEqual(restored.state, state); assert.equal(restored.revision, 1);
  const other = await (await get((await signup()).cookie)).json();
  assert.notEqual(other.profileId, profile.profileId); assert.deepEqual(other.state, emptyState());
  assert.equal((await get()).status, 401);
});
test('stale writes cannot overwrite progress, retries of a committed request are idempotent', async t => {
  const {get, put, signup} = await start(t);
  const {cookie} = await signup(); await get(cookie);
  const body = {revision:0, writeId:randomUUID(), state:emptyState()};
  assert.equal((await put(cookie,body)).status, 200);
  assert.deepEqual(await (await put(cookie,body)).json(), {revision:1});
  assert.equal((await put(cookie,{...body,writeId:randomUUID()})).status,409);
  assert.equal((await (await get(cookie)).json()).revision,1);
});
test('API validates data and rejects cross-site writes or missing sessions', async t => {
  const {get, put, url, signup} = await start(t);
  const {cookie} = await signup(); await get(cookie);
  const body = {revision:0, writeId:randomUUID(), state:emptyState()};
  assert.equal((await put('', body)).status,401);
  assert.equal((await put(cookie,{...body,state:{bad:true}})).status,400);
  assert.equal((await put(cookie,{...body,state:{...emptyState(),companion:{bad:true}}})).status,400);
  assert.equal((await put(cookie,{...body,state:{...emptyState(),intelligence:{bad:true}}})).status,400);
  assert.equal((await put(cookie,body,{Origin:'https://unrelated.example'})).status,403);
  assert.equal((await put(cookie,body,{'X-Waypoint-Client':''})).status,403);
  assert.equal((await fetch(`${url}/api/progress/other`)).status,404);
  assert.equal((await put(cookie,body)).status,200);
});
test('production cookie is secure and database outage produces a safe failure', async t => {
  const {get, url, database, signup} = await start(t,{production:true});
  const {cookie, response} = await signup(); assert.match(response.headers.get('set-cookie'), /; Secure/);
  database.failing = true;
  const failed = await get(cookie); assert.equal(failed.status,503);
  assert.doesNotMatch(await failed.text(), /sensitive connection details/);
  assert.equal((await fetch(`${url}/api/health`)).status,503);
  database.failing = false; assert.equal((await fetch(`${url}/api/health`)).status,200);
});
test('static app is served with security headers; missing assets are not HTML', async t => {
  const {url} = await start(t);
  const response = await fetch(url);
  assert.equal(response.status,200); assert.match(await response.text(), /Prep Orbit AI/);
  assert.equal(response.headers.get('x-frame-options'),'DENY');
  assert.equal((await fetch(`${url}/assets/missing.js`)).status,404);
  const study=await fetch(`${url}/app/`);assert.equal(study.status,200);assert.match(await study.text(),/PrepOrbit AI/);
  const redirect=await fetch(`${url}/app`,{redirect:'manual'});assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'/app/');
  const icon=await fetch(`${url}/landing/logo-mark.svg`);assert.equal(icon.status,200);assert.match(icon.headers.get('content-type'),/image\/svg/);
  const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await fetch(`${url}/landing/not-found.png`)).status,404);
});

test('sign up validates input, rejects duplicates, and sign in/out manage the session', async t => {
  const {auth, me, get, signup, database} = await start(t);
  assert.equal((await auth('signup', {email:'not-an-email', password:'long enough pw'})).status, 400);
  assert.equal((await auth('signup', {email:'a@example.com', password:'short'})).status, 400);
  const {cookie} = await signup('  Student@Example.com ', 'correct horse battery');
  assert.deepEqual((await me(cookie)).user, {email:'student@example.com'});
  const stored = [...database.users.values()][0];
  assert.match(stored.passwordHash, /^scrypt\$32768\$8\$1\$/); assert.doesNotMatch(stored.passwordHash, /correct horse/);
  const dup = await auth('signup', {email:'student@example.com', password:'another password'});
  assert.equal(dup.status, 409);
  const wrong = await auth('signin', {email:'student@example.com', password:'wrong password'});
  assert.equal(wrong.status, 401);
  const missing = await auth('signin', {email:'nobody@example.com', password:'wrong password'});
  assert.equal(missing.status, 401); assert.deepEqual(await missing.json(), await wrong.json());
  const ok = await auth('signin', {email:'STUDENT@example.com', password:'correct horse battery'});
  assert.equal(ok.status, 200); const second = cookieOf(ok, 'waypoint_session');
  assert.notEqual(second, cookie);
  assert.equal((await get(second)).status, 200);
  const out = await auth('signout', {}, second);
  assert.match(out.headers.get('set-cookie'), /waypoint_session=; .*Max-Age=0/);
  assert.equal((await get(second)).status, 401); assert.equal((await me(second)).user, null);
  assert.equal((await get(cookie)).status, 200);
});
test('auth endpoints require same-origin JSON requests', async t => {
  const {auth} = await start(t);
  assert.equal((await auth('signup', {email:'x@example.com', password:'long enough pw'}, '', {Origin:'https://evil.example'})).status, 403);
  assert.equal((await auth('signin', {email:'x@example.com', password:'long enough pw'}, '', {'X-Waypoint-Client':''})).status, 403);
});
test('first sign-up adopts the progress this browser saved before accounts existed', async t => {
  const {database, get, signup} = await start(t);
  const anon = 'a'.repeat(64);
  const owner = createHash('sha256').update(anon).digest('hex');
  const state = emptyState(); state.reflections['wp-math-001'] = {text:'Saved before accounts.', updatedAt:1};
  database.rows.set(owner, {profileId:randomUUID(), state, revision:4});
  const {cookie, response} = await signup(undefined, undefined, `waypoint_student=${anon}`);
  assert.match(response.headers.getSetCookie().join('\n'), /waypoint_student=; .*Max-Age=0/);
  const restored = await (await get(cookie)).json();
  assert.deepEqual(restored.state, state); assert.equal(restored.revision, 4);
  assert.equal(database.rows.has(owner), false);
});
test('forgot password never reveals accounts; reset link works once and ends old sessions', async t => {
  const {auth, get, signup, sent} = await start(t);
  const {email, cookie} = await signup('reset@example.com', 'original password');
  const unknown = await auth('forgot', {email:'nobody@example.com'});
  const known = await auth('forgot', {email});
  assert.equal(unknown.status, 200); assert.deepEqual(await unknown.json(), await known.json());
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(sent.length, 1); assert.equal(sent[0].to, email);
  const token = /#reset=([a-f0-9]{64})$/.exec(sent[0].link)[1];
  assert.equal((await auth('reset', {token, password:'short'})).status, 400);
  const reset = await auth('reset', {token, password:'brand new password'});
  assert.equal(reset.status, 200); const fresh = cookieOf(reset, 'waypoint_session');
  assert.equal((await get(cookie)).status, 401, 'old session is signed out');
  assert.equal((await get(fresh)).status, 200);
  assert.equal((await auth('reset', {token, password:'third password!'})).status, 400, 'link is single-use');
  assert.equal((await auth('signin', {email, password:'original password'})).status, 401);
  assert.equal((await auth('signin', {email, password:'brand new password'})).status, 200);
  assert.equal((await auth('reset', {token:'f'.repeat(64), password:'brand new password'})).status, 400);
});
test('a newer reset link replaces the older one', async t => {
  const {auth, signup, sent} = await start(t);
  const {email} = await signup('twice@example.com', 'original password');
  await auth('forgot', {email}); await auth('forgot', {email});
  await new Promise(resolve => setTimeout(resolve, 50));
  const [first, second] = sent.map(m => /#reset=([a-f0-9]{64})$/.exec(m.link)[1]);
  assert.equal((await auth('reset', {token:first, password:'new password one'})).status, 400);
  assert.equal((await auth('reset', {token:second, password:'new password two'})).status, 200);
});
test('sign-in attempts and reset emails are rate limited', async t => {
  const {auth, signup, sent} = await start(t);
  const {email} = await signup('limit@example.com', 'original password');
  for (let i = 0; i < 10; i++) assert.equal((await auth('signin', {email, password:`wrong ${i} password`})).status, 401);
  assert.equal((await auth('signin', {email, password:'original password'})).status, 429);
  for (let i = 0; i < 5; i++) assert.equal((await auth('forgot', {email})).status, 200);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(sent.length, 3);
});

test('sign-up records student or tutor; admins see every account with dates and can change roles', async t => {
  const {url, auth, signup, database} = await start(t, {adminEmails:'Boss@Example.com'});
  const admin = await signup('boss@example.com');
  const student = await signup('kid@example.com');
  await signup('teach@example.com', 'correct horse battery', '', 'tutor');
  assert.equal((await auth('signup', {email:'bad@example.com', password:'correct horse battery', role:'admin'})).status, 400);
  const users = async cookie => fetch(`${url}/api/admin/users`, {headers:{cookie}});
  // Non-admins and signed-out visitors cannot list accounts.
  assert.equal((await users(student.cookie)).status, 403);
  assert.equal((await users('')).status, 401);
  const response = await users(admin.cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const list = (await response.json()).users;
  assert.equal(list.length, 3);
  const byEmail = Object.fromEntries(list.map(u => [u.email, u]));
  assert.equal(byEmail['kid@example.com'].role, 'student');
  assert.equal(byEmail['teach@example.com'].role, 'tutor');
  assert.equal(byEmail['boss@example.com'].admin, true);
  assert.equal(byEmail['kid@example.com'].admin, false);
  for (const u of list) { assert.ok(!Number.isNaN(Date.parse(u.createdAt))); assert.ok(!Number.isNaN(Date.parse(u.lastActiveAt))); assert.equal(u.passwordHash, undefined); assert.deepEqual(Object.keys(u).sort(), ['admin','createdAt','email','id','lastActiveAt','role']); }
  const setRole = (cookie, body) => fetch(`${url}/api/admin/user-role`, {method:'POST', headers:{cookie, 'Content-Type':'application/json', 'X-Waypoint-Client':'1'}, body:JSON.stringify(body)});
  const kid = byEmail['kid@example.com'];
  assert.equal((await setRole(student.cookie, {id:kid.id, role:'tutor'})).status, 403);
  assert.equal((await setRole(admin.cookie, {id:kid.id, role:'owner'})).status, 400);
  assert.equal((await setRole(admin.cookie, {id:randomUUID(), role:'tutor'})).status, 404);
  assert.equal((await setRole(admin.cookie, {id:kid.id, role:'tutor'})).status, 200);
  assert.equal(database.users.get(kid.id).role, 'tutor');
});

test('signed-in requests record last activity at most once per throttle window', async t => {
  const {get, signup, database} = await start(t);
  const {cookie} = await signup();
  const before = database.touches;
  await get(cookie); await get(cookie); await get(cookie);
  assert.equal(database.touches - before, 1);
});
