import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession, resumeSession, pauseSession, navigateSession, remaining, finishSession, emptyState, activityStats, parseState, DEMO_MS, localDay, dayOffset} from '../src/model.ts';
const ids = ['wp-math-001', 'wp-rw-001', 'wp-math-002', 'wp-rw-002'];
const keys = Object.fromEntries(ids.map((id, i) => [id, [1,2,2,0][i]]));
test('deadline survives delayed ticks, reload and pause/resume', () => {
  let session = resumeSession(createSession(ids, 'demo'), 1000);
  assert.equal(remaining(session, 11000), 290000);
  session = pauseSession(session, 11000);
  assert.equal(remaining(session, 50000), 290000);
  session = resumeSession(session, 50000);
  const s = {...emptyState(), sessions: [session], activeSessionId: 'demo'};
  const restored = parseState(JSON.stringify(s));
  assert.equal(remaining(restored.sessions[0], 100000), 240000);
  assert.equal(remaining(restored.sessions[0], 1000000), 0);
});
test('submission preserves actual answers, unanswered, flags, timing and is idempotent', () => {
  let session = resumeSession(createSession(ids, 'demo'), 1000);
  session.answers[ids[0]] = 1; session.flags = [ids[0], ids[2]];
  session = navigateSession(session, 1, 5000);
  const state = finishSession({...emptyState(), activeSessionId:'demo', sessions:[session]}, 'demo', 9000, keys);
  assert.equal(state.attempts.length, 4);
  assert.equal(state.attempts[0].selected, 1);
  assert.equal(state.attempts[0].correct, true);
  assert.equal(state.attempts[1].selected, null);
  assert.equal(state.attempts[2].flagged, true);
  assert.equal(state.attempts[0].elapsedMs, 4000);
  assert.equal(state.attempts[1].elapsedMs, 4000);
  assert.equal(state.sessions[0].status, 'submitted');
  assert.equal(finishSession(state, 'demo', 10000, keys), state);
  assert.deepEqual(parseState(JSON.stringify(state)), state);
});
test('expiry is stamped at deadline and cannot gain extra elapsed time', () => {
  const session = resumeSession(createSession(ids, 'demo'), 1000);
  const state = finishSession({...emptyState(), sessions: [session]}, 'demo', 1000000, keys);
  assert.equal(state.sessions[0].status, 'expired');
  assert.equal(state.attempts[0].submittedAt, DEMO_MS + 1000);
  assert.equal(state.attempts[0].elapsedMs, DEMO_MS);
  assert.equal(state.attempts.filter(a => a.correct).length, 0);
});
test('first attempts are preserved, empty submissions do not earn streaks', () => {
  const time = new Date(2026, 10, 7, 14).getTime();
  let state = emptyState();
  state.attempts = [
    {id:'first', questionId:ids[0], selected:0, correct:false, mode:'practice', sessionId:null, flagged:false, elapsedMs:10, submittedAt:dayOffset(time,-1)},
    {id:'retry', questionId:ids[0], selected:1, correct:true, mode:'practice', sessionId:null, flagged:false, elapsedMs:10, submittedAt:time}
  ];
  const stats = activityStats(state, time);
  assert.equal(stats.first[0].id, 'first'); assert.equal(stats.streak, 2);
  assert.equal(stats.todayAttempts.length, 1);
  state = finishSession({...emptyState(), sessions:[resumeSession(createSession(ids,'empty'), time)]}, 'empty', time+1000, keys);
  assert.equal(activityStats(state, time+1000).streak, 0);
});
test('streak handles local calendar dates and gaps', () => {
  const now = new Date(2026, 10, 7, 12).getTime();
  const state = emptyState();
  for (const offset of [-3,-2,-1]) state.attempts.push({id:String(offset), questionId:ids[0], selected:0, correct:false, mode:'practice', sessionId:null, flagged:false, elapsedMs:0, submittedAt:dayOffset(now,offset)});
  assert.equal(activityStats(state, now).streak, 3);
  assert.equal(activityStats(state, dayOffset(now, 1)).streak, 0);
  assert.equal(localDay(dayOffset(new Date(2026, 10, 1, 12).getTime(), -1)), '2026-10-31');
});
test('invalid saved data is rejected instead of fabricating progress', () => {
  assert.throws(() => parseState('{broken'));
  assert.throws(() => parseState(JSON.stringify({...emptyState(), sessions: [{}]})));
  assert.throws(() => parseState(JSON.stringify({...emptyState(), version:2})));
  const s = {...emptyState(), sessions:[createSession(ids,'a')], activeSessionId:'a'};
  assert.deepEqual(parseState(JSON.stringify(s)), s);
});
