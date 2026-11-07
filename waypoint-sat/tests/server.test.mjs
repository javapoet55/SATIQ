import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {emptyState} from '../src/model.ts';

class TestDatabase {
  rows = new Map(); failing = false;
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
}
async function start(t, options = {}) {
  const database = new TestDatabase(); const server = createApp({database, production:false, ...options});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const get = async (cookie = '') => fetch(`${url}/api/progress`, {headers:{cookie}});
  const put = async (cookie, body, extra = {}) => fetch(`${url}/api/progress`, {method:'PUT', headers:{cookie, 'Content-Type':'application/json', 'X-Waypoint-Client':'1', ...extra}, body:JSON.stringify(body)});
  return {database, url, get, put};
}
test('API isolates visitors using HttpOnly cookies and restores saved progress', async t => {
  const {get, put} = await start(t);
  const first = await get(); const cookie = first.headers.get('set-cookie').split(';')[0];
  assert.match(first.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const profile = await first.json();
  const state = emptyState(); state.reflections['wp-math-001'] = {text:'Keep the fixed fee separate.', updatedAt:Date.now()};
  assert.equal((await put(cookie, {revision:0, writeId:randomUUID(), state})).status, 200);
  const restored = await (await get(cookie)).json();
  assert.deepEqual(restored.state, state); assert.equal(restored.revision, 1);
  const other = await (await get()).json();
  assert.notEqual(other.profileId, profile.profileId); assert.deepEqual(other.state, emptyState());
});
test('stale writes cannot overwrite progress, retries of a committed request are idempotent', async t => {
  const {get, put} = await start(t);
  const first = await get(); const cookie = first.headers.get('set-cookie').split(';')[0];
  const body = {revision:0, writeId:randomUUID(), state:emptyState()};
  assert.equal((await put(cookie,body)).status, 200);
  assert.deepEqual(await (await put(cookie,body)).json(), {revision:1});
  assert.equal((await put(cookie,{...body,writeId:randomUUID()})).status,409);
  assert.equal((await (await get(cookie)).json()).revision,1);
});
test('API validates data and rejects cross-site writes or missing sessions', async t => {
  const {get, put, url} = await start(t);
  const first = await get(); const cookie = first.headers.get('set-cookie').split(';')[0];
  const body = {revision:0, writeId:randomUUID(), state:emptyState()};
  assert.equal((await put('', body)).status,401);
  assert.equal((await put(cookie,{...body,state:{bad:true}})).status,400);
  assert.equal((await put(cookie,{...body,state:{...emptyState(),companion:{bad:true}}})).status,400);
  assert.equal((await put(cookie,body,{Origin:'https://unrelated.example'})).status,403);
  assert.equal((await put(cookie,body,{'X-Waypoint-Client':''})).status,403);
  assert.equal((await fetch(`${url}/api/progress/other`)).status,404);
  assert.equal((await put(cookie,body)).status,200);
});
test('production cookie is secure and database outage produces a safe failure', async t => {
  const {get, url, database} = await start(t,{production:true});
  const response = await get(); assert.match(response.headers.get('set-cookie'), /; Secure/);
  database.failing = true;
  const failed = await get(); assert.equal(failed.status,503);
  assert.doesNotMatch(await failed.text(), /sensitive connection details/);
  assert.equal((await fetch(`${url}/api/health`)).status,503);
  database.failing = false; assert.equal((await fetch(`${url}/api/health`)).status,200);
});
test('static app is served with security headers; missing assets are not HTML', async t => {
  const {url} = await start(t);
  const response = await fetch(url);
  assert.equal(response.status,200); assert.match(await response.text(), /Waypoint/);
  assert.equal(response.headers.get('x-frame-options'),'DENY');
  assert.equal((await fetch(`${url}/assets/missing.js`)).status,404);
});
