import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {createBank} from '../server/bank.mjs';
import {revealsAnswer} from '../server/study-ai.mjs';
import {generateOne, validSpec, toQuestion} from '../server/generator.mjs';
import {emptyState} from '../src/model.ts';

class Database {
  rows = new Map(); users = new Map(); sessions = new Map(); usage = new Map(); insights = new Map(); generated = new Map();
  async health() {}
  async get(owner, state) { if (!this.rows.has(owner)) this.rows.set(owner, {profileId: randomUUID(), state, revision: 0}); return this.rows.get(owner); }
  async put(owner, revision, state) { const row = this.rows.get(owner); if (row.revision !== revision) return null; row.state = state; row.revision++; return {revision: row.revision}; }
  async claimProgress() { return false; }
  async createUser(email, passwordHash) { if ([...this.users.values()].some(u => u.email === email)) return null; const u = {id: randomUUID(), email, passwordHash}; this.users.set(u.id, u); return {id: u.id, email}; }
  async findUserByEmail(email) { return [...this.users.values()].find(u => u.email === email) ?? null; }
  async createSession(hash, userId) { this.sessions.set(hash, userId); }
  async getSessionUser(hash) { const u = this.users.get(this.sessions.get(hash)); return u ? {id: u.id, email: u.email} : null; }
  async takeAiUsage(owner, feature, limit) { const k = `${owner}|${feature}`; const n = this.usage.get(k) ?? 0; if (n >= limit) return false; this.usage.set(k, n + 1); return true; }
  async getInsight(owner, day, kind) { return this.insights.get(`${owner}|${day}|${kind}`) ?? null; }
  async saveInsight(owner, day, kind, text) { this.insights.set(`${owner}|${day}|${kind}`, {text, createdAt: new Date()}); }
  async saveGeneratedQuestion(question, status, verification, createdBy) { this.generated.set(question.id, {id: question.id, status, payload: question, verification, createdBy, createdAt: new Date().toISOString()}); }
  async listGeneratedQuestions(status) { return [...this.generated.values()].filter(r => !status || r.status === status); }
  async decideGeneratedQuestion(id, status) { const r = this.generated.get(id); if (!r) return false; r.status = status; return true; }
  async assistantHistory() { return []; }
  async approvedQuestions() { return [...this.generated.values()].filter(r => r.status === 'approved').map(r => r.payload); }
}
function fakeAI(handlers = {}) {
  const calls = [];
  return {calls, configured: true, model: 'fake',
    text: async opts => { calls.push(opts); return handlers.text ? handlers.text(opts) : 'A helpful reply.'; },
    json: async opts => { calls.push(opts); return handlers.json(opts); }};
}
async function start(t, {ai = fakeAI(), admins = 'boss@example.com'} = {}) {
  const database = new Database();
  const server = createApp({database, ai, bank: createBank(database), adminEmails: admins, production: false, mailer: {configured: false, sendPasswordReset: async () => {}}});
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const signup = async (email = `s-${randomUUID()}@example.com`) => {
    const r = await fetch(`${url}/api/auth/signup`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Waypoint-Client': '1'}, body: JSON.stringify({email, password: 'test password one'})});
    assert.equal(r.status, 200); return r.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('waypoint_session='));
  };
  const post = (cookie, path, body) => fetch(`${url}${path}`, {method: 'POST', headers: {cookie, 'Content-Type': 'application/json', 'X-Waypoint-Client': '1'}, body: JSON.stringify(body)});
  const get = (cookie, path) => fetch(`${url}${path}`, {headers: {cookie}});
  const saveState = async (cookie, mutate) => {
    const snap = await (await get(cookie, '/api/progress')).json();
    const state = mutate(structuredClone(snap.state));
    const r = await fetch(`${url}/api/progress`, {method: 'PUT', headers: {cookie, 'Content-Type': 'application/json', 'X-Waypoint-Client': '1'}, body: JSON.stringify({revision: snap.revision, writeId: randomUUID(), state})});
    assert.equal(r.status, 200, await r.text());
  };
  return {database, url, signup, post, get, saveState, ai};
}
const attempt = (questionId, selected, correct) => ({id: randomUUID(), questionId, selected, correct, mode: 'practice', sessionId: null, flagged: false, elapsedMs: 1000, submittedAt: Date.now()});

test('config reports AI and admin status per signed-in user', async t => {
  const {signup, get} = await start(t);
  const student = await signup();
  assert.deepEqual(await (await get(student, '/api/config')).json(), {ai: true, admin: false, desmosKey: null});
  const boss = await signup('BOSS@example.com');
  assert.equal((await (await get(boss, '/api/config')).json()).admin, true);
  assert.equal((await get('', '/api/config')).status, 401);
});
test('saved progress accepts typed answers, bank questions, and multi-module test runs', async t => {
  const {signup, saveState} = await start(t);
  const cookie = await signup();
  await saveState(cookie, s => {
    s.attempts.push(attempt('sat-m-002', '6', true), attempt('sat-r-001', 1, true));
    const sid = randomUUID();
    s.sessions.push({id: sid, questionIds: ['sat-m-001', 'sat-m-002'], status: 'submitted', answers: {'sat-m-002': '6'}, flags: [], currentIndex: 1, startedAt: 1, deadlineAt: null, remainingMs: 1000, submittedAt: 2, questionElapsedMs: {}, segmentStartedAt: null, config: {kind: 'module', title: 'Math · Module 1', section: 'math', durationMs: 120000, runId: 'r1', module: 1, tier: 'base'}});
    s.runs = [{id: 'r1', kind: 'section', sections: ['math'], moduleSessionIds: [sid], status: 'active', startedAt: 1, completedAt: null}];
    s.practice = {section: 'math', skill: 'Circles', difficulty: 'Any', adaptive: true};
    return s;
  });
});
test('the tutor never states the key before the student has checked an answer', async t => {
  const ai = fakeAI({text: () => 'Good thinking! The correct answer is B, 6 days.'});
  const {signup, post, saveState} = await start(t, {ai});
  const cookie = await signup();
  const before = await (await post(cookie, '/api/ai/tutor', {questionId: 'wp-math-001', selected: 0, hintLevel: 0, history: [], message: 'Just tell me the answer'})).json();
  assert.doesNotMatch(before.reply, /correct answer is B/);
  assert.match(before.reply, /find/);
  assert.match(ai.calls[0].instructions, /has NOT checked/);
  assert.match(ai.calls[0].input[0].content, /Answer key: B\. 6 days/);
  await saveState(cookie, s => { s.attempts.push(attempt('wp-math-001', 0, false)); return s; });
  const after = await (await post(cookie, '/api/ai/tutor', {questionId: 'wp-math-001', selected: 0, hintLevel: 0, history: [], message: 'Why was I wrong?'})).json();
  assert.match(after.reply, /correct answer is B/);
  assert.match(ai.calls[1].instructions, /already checked/);
});
test('tutor requests are validated, limited per day, and blocked during tests', async t => {
  const {signup, post, saveState, database} = await start(t);
  const cookie = await signup();
  assert.equal((await post(cookie, '/api/ai/tutor', {questionId: 'no-such-question', message: 'hi'})).status, 404);
  assert.equal((await post(cookie, '/api/ai/tutor', {questionId: 'wp-math-001', message: ''})).status, 400);
  const owner = [...database.rows.keys()][0];
  database.usage.set(`${owner}|tutor`, 80);
  const limited = await post(cookie, '/api/ai/tutor', {questionId: 'wp-math-001', message: 'hint please'});
  assert.equal(limited.status, 429);
  await saveState(cookie, s => { s.runs = [{id: 'r', kind: 'full', sections: ['rw', 'math'], moduleSessionIds: [], status: 'active', startedAt: 1, completedAt: null}]; return s; });
  assert.equal((await post(cookie, '/api/ai/explain-work', {questionId: 'wp-math-001', lines: ['18 + 7d = 60']})).status, 409);
});
test('explain-work runs the algebra checker on the server and asks AI only to explain it', async t => {
  const ai = fakeAI({text: () => 'In line 3, 60 − 18 is 42, not 28.'});
  const {signup, post} = await start(t, {ai});
  const cookie = await signup();
  const r = await (await post(cookie, '/api/ai/explain-work', {questionId: 'wp-math-001', lines: ['18 + 7d = 60', '7d = 60 - 18', '7d = 28', 'd = 4']})).json();
  assert.deepEqual(r.results.map(x => x.status), ['correct', 'correct', 'incorrect', 'pending']);
  assert.match(r.explanation, /42/);
  assert.match(ai.calls[0].input[0].content, /Line 3: 7d = 28 -> incorrect/);
  assert.equal((await post(cookie, '/api/ai/explain-work', {questionId: 'sat-r-001', lines: ['x = 1']})).status, 400);
});
test('handwriting transcription accepts only image data and returns the lines', async t => {
  const ai = fakeAI({json: () => ({lines: ['18 + 7d = 60', ' 7d = 42 ', ''], legible: true})});
  const {signup, post} = await start(t, {ai});
  const cookie = await signup();
  assert.equal((await post(cookie, '/api/ai/handwriting', {image: 'https://example.com/x.png'})).status, 400);
  const r = await (await post(cookie, '/api/ai/handwriting', {image: 'data:image/jpeg;base64,AAAA', variable: 'd'})).json();
  assert.deepEqual(r.lines, ['18 + 7d = 60', '7d = 42']);
  assert.equal(ai.calls[0].input[0].content[1].image_url, 'data:image/jpeg;base64,AAAA');
  const blank = fakeAI({json: () => ({lines: [], legible: false})});
  const env = await start(t, {ai: blank});
  const c2 = await env.signup();
  assert.equal((await env.post(c2, '/api/ai/handwriting', {image: 'data:image/png;base64,AAAA'})).status, 422);
});
test('coach notes need saved activity and are cached for the day', async t => {
  const ai = fakeAI({text: () => 'You answered 1 question this week.'});
  const {signup, post, saveState} = await start(t, {ai});
  const cookie = await signup();
  assert.equal((await (await post(cookie, '/api/ai/insight', {kind: 'daily', timezone: 'America/Los_Angeles'})).json()).text, null);
  assert.equal(ai.calls.length, 0);
  await saveState(cookie, s => { s.attempts.push(attempt('sat-m-001', 0, true)); return s; });
  const first = await (await post(cookie, '/api/ai/insight', {kind: 'weekly', timezone: 'America/Los_Angeles'})).json();
  const second = await (await post(cookie, '/api/ai/insight', {kind: 'weekly', timezone: 'America/Los_Angeles'})).json();
  assert.equal(first.text, second.text); assert.equal(second.cached, true); assert.equal(ai.calls.length, 1);
  assert.match(ai.calls[0].input[0].content, /"totalAttempts":1/);
});
test('the assistant context grades typed answers with SAT rules', async t => {
  const {signup, get, saveState} = await start(t);
  const cookie = await signup();
  await saveState(cookie, s => { s.attempts.push(attempt('sat-m-014', '64', false)); return s; });
  const r = await (await get(cookie, '/api/assistant?timezone=UTC')).json();
  assert.equal(r.context.weeklyAccuracy, 100);
  assert.equal(r.context.recentAttempts[0].selectedAnswer, '64');
});

const goodMath = {passage: '', text: String.raw`If \(5x - 3 = 22\), what is the value of \(x\)?`, choices: ['3.8', '5', '25', '19'], correct_index: 1, answers: [],
  steps: [{title: 'Add 3', explanation: 'Undo the subtraction.', work: '5x = 25'}, {title: 'Divide', explanation: 'Divide by 5.', work: 'x = 5'}], why: 'Undo operations in reverse order.', hint: 'Add 3 first.',
  distractor_explanations: ['Subtracting 3 instead of adding.', '', 'This is 5x, not x.', 'Adding 22 and 3 then dividing wrongly.'], check_kind: 'value', check_expr: '(22+3)/5', check_vars: []};
const spec = {section: 'math', skill: 'Linear equations in one variable', difficulty: 'Easy', type: 'mcq', count: 1};
test('generated questions pass only when the math check and a blind solve both agree', async () => {
  const solver = answer => fakeAI({json: o => o.schema.name === 'sat_question' ? goodMath : {reasoning: '…', answer}});
  const verified = await generateOne(solver('B'), spec);
  assert.equal(verified.status, 'pending'); assert.equal(verified.question.source, 'generated'); assert.equal(verified.verification.blindSolve.agrees, true);
  assert.equal((await generateOne(solver('C'), spec)).status, 'flagged');
  const wrongKey = fakeAI({json: o => o.schema.name === 'sat_question' ? {...goodMath, correct_index: 2, distractor_explanations: ['Subtracting 3 instead of adding.', 'Correct value, wrong place.', '', 'Adding instead.']} : {reasoning: '', answer: 'C'}});
  const rejected = await generateOne(wrongKey, spec);
  assert.equal(rejected.status, 'rejected'); assert.match(rejected.verification.problems.join(' '), /math check/);
  assert.equal(wrongKey.calls.length, 1, 'no blind solve is paid for after a failed check');
  const noCheck = await generateOne(fakeAI({json: () => ({...goodMath, check_kind: 'none'})}), spec);
  assert.equal(noCheck.status, 'rejected');
  const dup = await generateOne(solver('B'), spec, {existingTexts: new Set([goodMath.text.toLowerCase()])});
  assert.equal(dup.status, 'rejected');
  assert.equal(validSpec({section: 'math', skill: 'Transitions', difficulty: 'Easy'}), null);
  assert.equal(validSpec({section: 'rw', skill: 'Transitions', difficulty: 'Hard', type: 'spr', count: 99}).count, 5);
  assert.equal(toQuestion(goodMath, spec).distractors[1], null);
});
test('admins generate, review, and approve; only approved questions reach students', async t => {
  const ai = fakeAI({json: o => o.schema.name === 'sat_question' ? goodMath : {reasoning: '', answer: 'B'}});
  const {signup, post, get} = await start(t, {ai});
  const student = await signup(); const boss = await signup('boss@example.com');
  assert.equal((await post(student, '/api/admin/generate', {...spec, count: 2})).status, 403);
  assert.equal((await post(boss, '/api/admin/generate', {...spec, skill: 'Not a skill'})).status, 400);
  const started = await post(boss, '/api/admin/generate', {...spec, count: 2});
  assert.equal(started.status, 202);
  let jobs; for (let i = 0; i < 50; i++) { jobs = (await (await get(boss, '/api/admin/jobs')).json()).jobs; if (jobs[0].status === 'done') break; await new Promise(r => setTimeout(r, 20)); }
  assert.equal(jobs[0].status, 'done');
  assert.deepEqual(jobs[0].results.map(r => r.status), ['pending', 'rejected'], 'the second copy is a duplicate');
  const pending = (await (await get(boss, '/api/admin/questions?status=pending')).json()).questions;
  assert.equal(pending.length, 1);
  assert.deepEqual((await (await get(student, '/api/questions')).json()).questions, []);
  assert.equal((await post(boss, '/api/admin/decide', {id: pending[0].id, decision: 'approve'})).status, 200);
  const live = (await (await get(student, '/api/questions')).json()).questions;
  assert.equal(live.length, 1); assert.equal(live[0].id, pending[0].id);
  const tutor = await post(student, '/api/ai/tutor', {questionId: live[0].id, message: 'hint?'});
  assert.equal(tutor.status, 200, 'approved questions work with the tutor');
});
test('answer-leak detector catches direct statements but allows guidance', () => {
  const q = {type: 'mcq', choices: ['4 days', '6 days', '8 days', '11 days'], correct: 1};
  for (const leak of ['The answer is B.', 'The correct choice is (B).', 'Choice B is correct!', 'You should pick B.', '6 days is the correct answer.']) assert.equal(revealsAnswer(leak, q), true, leak);
  for (const ok of ['What do you get when you subtract 18 from 60?', 'Choice A forgets to subtract the fee.', 'Try dividing 42 by 7.']) assert.equal(revealsAnswer(ok, q), false, ok);
  const spr = {type: 'spr', answers: ['6']};
  assert.equal(revealsAnswer('So x = 6.', spr), true);
  assert.equal(revealsAnswer('Now 4x = 24. What next?', spr), false);
});

test('security policy allows only the desmos.com calculator frame and no outside scripts', async t => {
  const {url} = await start(t);
  const csp = (await fetch(url + '/api/health')).headers.get('content-security-policy');
  assert.match(csp, /frame-src https:\/\/www\.desmos\.com;/);
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});
