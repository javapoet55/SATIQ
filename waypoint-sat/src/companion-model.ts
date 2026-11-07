import {localDay, uid, type State, type Attempt} from './model.ts';
import {emptyCompanion, freshTutor, SAMPLE_ATTEMPT, type PlanTaskId, type Cause} from './companion-types.ts';
export {freshTutor, SAMPLE_ATTEMPT} from './companion-types.ts';
export const companionOf = (s: State) => s.companion ?? emptyCompanion();
export const testInProgress = (s: State) => s.sessions.some(t => t.id === s.activeSessionId && ['running','paused'].includes(t.status));
export function openTutor(s: State, questionId: string, reset = false): State {
  const c = companionOf(s);
  const d = s.drafts[questionId];
  const context = reset ? freshTutor() : c.tutor[questionId] ?? {...freshTutor(), ...(d ? {selected:d.selected, checkedAttemptId:d.checkedAttemptId, elapsedMs:d.elapsedMs} : {})};
  return {...s, companion:{...c, tutorQuestionId:questionId, tutor:{...c.tutor, [questionId]:context}}};
}
export function checkTutor(s: State, correct: number, now: number): State {
  if (testInProgress(s)) return s;
  const c = companionOf(s); const id = c.tutorQuestionId; const t = c.tutor[id] ?? freshTutor();
  if (t.selected === null || t.checkedAttemptId) return s;
  const a: Attempt = {id:uid(), questionId:id, selected:t.selected, correct:t.selected === correct, mode:'practice', sessionId:null, flagged:false, elapsedMs:t.elapsedMs, submittedAt:now};
  return {...s, attempts:[...s.attempts,a], reviewAttemptId:a.id, companion:{...c, tutor:{...c.tutor,[id]:{...t,checkedAttemptId:a.id}}}};
}
export function analysisFor(s: State, id: string) {
  const c = companionOf(s); const attempt = s.attempts.find(a => a.id === id);
  return c.analyses[id] ?? {reflection:'', opened:false, cause:'calculation' as Cause, confirmedAt:null};
}
export function editReflection(s: State, id: string, text: string): State {
  const c = companionOf(s); const a = analysisFor(s,id);
  // The per-attempt reasoning draft is separate from the student's saved strategy note.
  return {...s, companion:{...c, analyses:{...c.analyses, [id]:{...a,reflection:text,opened:false,confirmedAt:null}}}};
}
export function confirmAnalysis(s: State, id: string, now: number): State {
  if (testInProgress(s)) return s;
  const c = companionOf(s); const a = analysisFor(s,id);
  if (!a.opened || !a.reflection.trim()) return s;
  return {...s, companion:{...c, analyses:{...c.analyses,[id]:{...a,confirmedAt:now}}}};
}
export const taskQuestion = (id: PlanTaskId) => id === 'transitions' ? 'wp-rw-001' : 'wp-math-001';
export function taskSet(minutes: 10 | 20 | 30) {
  const tasks: {id: PlanTaskId; title: string; skill: string; count: number; time: number; icon: string; label: string; reason: string}[] = [
    {id:'algebra',title:'Find your algebra rhythm',skill:'Linear equations',count:minutes === 10 ? 3 : 5,time:minutes === 10 ? 5 : 10,icon:'ƒ',label:'Priority skill',reason:'Practice separating a fixed fee from a changing daily cost.'},
    {id:'transitions',title:'Connect the ideas',skill:'Transitions',count:minutes === 10 ? 2 : 3,time:minutes === 10 ? 3 : 5,icon:'Aa',label:'Keep it fresh',reason:'Mix reading practice into your session after working with numbers.'},
    {id:'review',title:'Turn an attempt into a lesson',skill:'Mistake review',count:2,time:minutes === 10 ? 2 : 5,icon:'↻',label:'Reflect & revisit',reason:'Revisit a saved attempt and confirm a strategy for next time.'},
  ];
  if (minutes === 30) tasks.push({id:'stretch',title:'A little extra stretch',skill:'Linear equations · retry',count:5,time:10,icon:'↗',label:'Optional stretch',reason:'Try the original algebra question again with a fresh approach.'});
  return tasks;
}
export function startPlanTask(s: State, taskId: PlanTaskId, now: number): State {
  if (testInProgress(s)) return s;
  const c = companionOf(s); const date = localDay(now); const plan = c.plans[date] ?? {minutes:20 as const,completed:{}};
  if (!taskSet(plan.minutes).some(t => t.id === taskId) || plan.completed[taskId]) return s;
  const activeTask = {date,taskId,startedAt:now,baselineAttemptIds:s.attempts.map(a => a.id)};
  if (taskId === 'review') {
    const attempt = [...s.attempts].reverse().find(a => !a.correct) ?? s.attempts.at(-1);
    if (!attempt) return s;
    const record = analysisFor(s,attempt.id);
    return {...s, companion:{...c,activeTask,analysisAttemptId:attempt.id,analyses:{...c.analyses,[attempt.id]:{...record,opened:false,confirmedAt:null}},plans:{...c.plans,[date]:plan}}};
  }
  const next = openTutor(s,taskQuestion(taskId),true);
  return {...next,companion:{...next.companion!,activeTask,plans:{...c.plans,[date]:plan}}};
}
export function planCompletionAttempt(s: State, now: number): Attempt | undefined {
  if (testInProgress(s)) return;
  const c = companionOf(s); const active = c.activeTask;
  if (!active || active.date !== localDay(now)) return;
  if (active.taskId === 'review') {
    const id = c.analysisAttemptId;
    if (!id || id === SAMPLE_ATTEMPT) return;
    const analysis = c.analyses[id];
    return analysis?.confirmedAt !== null && analysis?.confirmedAt !== undefined && analysis.confirmedAt >= active.startedAt ? s.attempts.find(a => a.id === id) : undefined;
  }
  const context = c.tutor[taskQuestion(active.taskId)];
  return s.attempts.find(a => a.id === context?.checkedAttemptId && a.questionId === taskQuestion(active.taskId) && a.submittedAt >= active.startedAt && !active.baselineAttemptIds.includes(a.id));
}
export function completePlanTask(s: State, now: number): State {
  const attempt = planCompletionAttempt(s,now); const c = companionOf(s); const active = c.activeTask;
  if (!attempt || !active) return s;
  const plan = c.plans[active.date] ?? {minutes:20 as const,completed:{}};
  return {...s,companion:{...c,activeTask:null,plans:{...c.plans,[active.date]:{...plan,completed:{...plan.completed,[active.taskId]:{attemptId:attempt.id,completedAt:now}}}}}};
}
