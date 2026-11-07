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
test('all budgets have the requested question targets and exact time totals', () => {
  for (const minutes of [10,20,30] as const) {
    const tasks = taskSet(minutes);
    assert.equal(tasks.reduce((sum,t) => sum+t.time,0),minutes);
    assert.deepEqual(tasks.map(t => t.count),minutes === 10 ? [3,2,2] : minutes === 20 ? [5,3,2] : [5,3,2,5]);
  }
});
test('plan task needs a fresh checked attempt and completion survives budget changes', () => {
  let s = openTutor(emptyState(),'wp-math-001');
  s.companion!.tutor['wp-math-001'].selected = 0;
  s = checkTutor(s,1,now - 1000);
  s = startPlanTask(s,'algebra',now);
  assert.equal(planCompletionAttempt(s,now),undefined);
  assert.equal(completePlanTask(s,now),s);
  s.companion!.tutor['wp-math-001'].selected = 1;
  s = checkTutor(s,1,now + 1000);
  assert.equal(checkTutor(s,1,now+1100),s);
  s = completePlanTask(s,now+1500);
  assert.equal(s.companion!.plans[localDay(now)].completed.algebra?.attemptId,s.attempts[1].id);
  s.companion!.plans[localDay(now)].minutes = 10;
  assert.ok(s.companion!.plans[localDay(now)].completed.algebra);
  assert.equal(activityStats(s,now+2000).first[0].correct,false);
  assert.deepEqual(parseState(JSON.stringify(s)),s);
});
test('review needs an actual confirmed reflection and preserves existing strategy notes', () => {
  let s = openTutor(emptyState(),'wp-math-001');
  s.companion!.tutor['wp-math-001'].selected=0;
  s = checkTutor(s,1,now);
  const id = s.attempts[0].id;
  s.reflections['wp-math-001'] = {text:'My original strategy note',updatedAt:now-86400000};
  s = startPlanTask(s,'review',now+1000);
  s = editReflection(s,id,'I subtracted incorrectly.');
  assert.equal(planCompletionAttempt(s,now+2000),undefined);
  s.companion!.analyses[id].opened=true;
  s = confirmAnalysis(s,id,now+3000);
  assert.ok(planCompletionAttempt(s,now+4000));
  assert.equal(s.reflections['wp-math-001'].text,'My original strategy note');
  assert.equal(activityStats(s,now+4000).reflectedToday,true);
  const changed = editReflection(s,id,'My reasoning has changed.');
  assert.equal(changed.companion!.analyses[id].confirmedAt,null);
  assert.equal(planCompletionAttempt(changed,now+5000),undefined);
  s = completePlanTask(s,now+5000);
  assert.equal(s.companion!.plans[localDay(now)].completed.review?.attemptId,id);
});
test('sample reflections never complete plan activities or earn progress', () => {
  let s = openTutor(emptyState(),'wp-math-001');
  s = editReflection(s,SAMPLE_ATTEMPT,'Example arithmetic slip.');
  s.companion!.analyses[SAMPLE_ATTEMPT].opened=true;
  s = confirmAnalysis(s,SAMPLE_ATTEMPT,now);
  s.companion!.analysisAttemptId=SAMPLE_ATTEMPT;
  s.companion!.activeTask={date:localDay(now),taskId:'review',startedAt:now-1000,baselineAttemptIds:[]};
  assert.equal(planCompletionAttempt(s,now),undefined);
  assert.equal(activityStats(s,now).reflectedToday,false);
  assert.equal(activityStats(s,now).streak,0);
});
test('guided checks, plan starts and confirmations are blocked during active tests', () => {
  let s = openTutor(emptyState(),'wp-math-001'); s.companion!.tutor['wp-math-001'].selected=1;
  const session = resumeSession(createSession(['wp-math-001','wp-rw-001','wp-math-002','wp-rw-002'],'test'),now);
  s.sessions=[session]; s.activeSessionId=session.id;
  assert.equal(checkTutor(s,1,now),s); assert.equal(startPlanTask(s,'algebra',now),s);
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
