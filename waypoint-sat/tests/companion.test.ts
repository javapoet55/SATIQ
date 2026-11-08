import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, parseState, localDay, activityStats, createSession, resumeSession} from '../src/model.ts';
import {companionOf, openTutor, checkTutor, startPlanTask, completePlanTask, planCompletionAttempt, taskSet, editReflection, confirmAnalysis, SAMPLE_ATTEMPT} from '../src/companion-model.ts';
const now = new Date(2026,10,7,12).getTime();
test('old profiles and backups remain valid without companion state', () => {
  const old = emptyState();
  assert.equal('companion' in old,false); assert.deepEqual(parseState(JSON.stringify(old)),old);
  assert.equal(companionOf(old).tutorQuestionId,'wp-math-001');
});
const focus = {math: 'Linear equations in one variable', rw: 'Transitions'};
const Q = {id: 'wp-math-001', type: 'mcq', correct: 1} as never;
const skillOf = (id: string) => ({'wp-math-001': 'Linear equations in one variable', 'sat-m-001': 'Linear equations in one variable', 'sat-m-002': 'Linear equations in one variable', 'wp-rw-001': 'Transitions'} as Record<string, string>)[id] ?? 'Other';
const practice = (id: string, selected: number | string, correct: boolean, at: number) => ({id: `a-${id}-${at}`, questionId: id, selected, correct, mode: 'practice' as const, sessionId: null, flagged: false, elapsedMs: 1000, submittedAt: at});
test('all budgets have the requested question targets and exact time totals', () => {
  for (const minutes of [10,20,30] as const) {
    const tasks = taskSet(minutes, focus);
    assert.equal(tasks.reduce((sum,t) => sum+t.time,0),minutes);
    assert.deepEqual(tasks.map(t => t.count),minutes === 10 ? [3,2,1] : minutes === 20 ? [5,3,1] : [5,3,1,3]);
    assert.equal(tasks[0].skill, focus.math); assert.equal(tasks[1].skill, focus.rw);
  }
});
test('a plan task needs the planned number of fresh answers in its skill, and completion survives budget changes', () => {
  let s = emptyState();
  s.attempts.push(practice('wp-math-001', 0, false, now - 1000));
  const task = taskSet(10, focus)[0];
  s = startPlanTask(s, task, 'sat-m-001', now);
  assert.equal(s.practice?.skill, focus.math); assert.equal(s.practiceQuestionId, 'sat-m-001');
  assert.equal(planCompletionAttempt(s, skillOf, now), undefined, 'answers from before the task do not count');
  s.attempts.push(practice('sat-m-001', 0, true, now + 1000), practice('wp-rw-001', 2, true, now + 1100), practice('sat-m-002', '6', true, now + 1200));
  assert.equal(planCompletionAttempt(s, skillOf, now + 1300), undefined, 'two in-skill answers are not enough for a 3-question task');
  assert.equal(completePlanTask(s, skillOf, now + 1300), s);
  s.attempts.push(practice('wp-math-001', 1, true, now + 1400));
  s = completePlanTask(s, skillOf, now + 1500);
  assert.equal(s.companion!.plans[localDay(now)].completed.algebra?.attemptId, s.attempts.at(-1)!.id);
  assert.equal(s.companion!.activeTask, null);
  s.companion!.plans[localDay(now)].minutes = 20;
  assert.ok(s.companion!.plans[localDay(now)].completed.algebra);
  assert.deepEqual(parseState(JSON.stringify(s)), s);
});
test('review needs an actual confirmed reflection and preserves existing strategy notes', () => {
  let s = openTutor(emptyState(),'wp-math-001');
  s.companion!.tutor['wp-math-001'].selected=0;
  s = checkTutor(s,Q,now);
  const id = s.attempts[0].id;
  assert.equal(s.attempts[0].correct, false);
  s.reflections['wp-math-001'] = {text:'My original strategy note',updatedAt:now-86400000};
  s = startPlanTask(s,taskSet(20, focus)[2],undefined,now+1000);
  s = editReflection(s,id,'I subtracted incorrectly.');
  assert.equal(planCompletionAttempt(s,skillOf,now+2000),undefined);
  s.companion!.analyses[id].opened=true;
  s = confirmAnalysis(s,id,now+3000);
  assert.ok(planCompletionAttempt(s,skillOf,now+4000));
  assert.equal(s.reflections['wp-math-001'].text,'My original strategy note');
  assert.equal(activityStats(s,now+4000).reflectedToday,true);
  const changed = editReflection(s,id,'My reasoning has changed.');
  assert.equal(changed.companion!.analyses[id].confirmedAt,null);
  assert.equal(planCompletionAttempt(changed,skillOf,now+5000),undefined);
  s = completePlanTask(s,skillOf,now+5000);
  assert.equal(s.companion!.plans[localDay(now)].completed.review?.attemptId,id);
});
test('sample reflections never complete plan activities or earn progress', () => {
  let s = openTutor(emptyState(),'wp-math-001');
  s = editReflection(s,SAMPLE_ATTEMPT,'Example arithmetic slip.');
  s.companion!.analyses[SAMPLE_ATTEMPT].opened=true;
  s = confirmAnalysis(s,SAMPLE_ATTEMPT,now);
  s.companion!.analysisAttemptId=SAMPLE_ATTEMPT;
  s.companion!.activeTask={date:localDay(now),taskId:'review',startedAt:now-1000,baselineAttemptIds:[]};
  assert.equal(planCompletionAttempt(s,skillOf,now),undefined);
  assert.equal(activityStats(s,now).reflectedToday,false);
  assert.equal(activityStats(s,now).streak,0);
});
test('guided checks, plan starts and confirmations are blocked during active tests', () => {
  let s = openTutor(emptyState(),'wp-math-001'); s.companion!.tutor['wp-math-001'].selected=1;
  const session = resumeSession(createSession(['wp-math-001','wp-rw-001','wp-math-002','wp-rw-002'],'test'),now);
  s.sessions=[session]; s.activeSessionId=session.id;
  assert.equal(checkTutor(s,Q,now),s); assert.equal(startPlanTask(s,taskSet(20, focus)[0],'sat-m-001',now),s);
  assert.equal(confirmAnalysis(s,SAMPLE_ATTEMPT,now),s);
});
test('companion state validation rejects invalid hints, unknown causes and dangling attempts', () => {
  const s = openTutor(emptyState(),'wp-math-001');
  s.companion!.tutor['wp-math-001'].hintLevel=4;
  assert.throws(() => parseState(JSON.stringify(s)));
  s.companion!.tutor['wp-math-001'].hintLevel=3;
  s.companion!.tutor['wp-math-001'].checkedAttemptId='missing';
  assert.throws(() => parseState(JSON.stringify(s)));
});
