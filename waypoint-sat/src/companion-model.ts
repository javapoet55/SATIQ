import {localDay, uid, type State, type Attempt} from './model.ts';
import {emptyCompanion, freshTutor, SAMPLE_ATTEMPT, type PlanTaskId, type Cause} from './companion-types.ts';
import {grade, type Question} from './data/question-schema.ts';
export {freshTutor, SAMPLE_ATTEMPT} from './companion-types.ts';
export const companionOf = (s: State) => s.companion ?? emptyCompanion();
// Help is paused while a timed module runs, and for the whole of a multi-module test.
export const testInProgress = (s: State) => s.sessions.some(t => t.id === s.activeSessionId && ['running','paused'].includes(t.status)) || !!s.runs?.some(r => r.status === 'active');
export function openTutor(s: State, questionId: string, reset = false): State {
  const c = companionOf(s);
  const d = s.drafts[questionId];
  const context = reset ? freshTutor() : c.tutor[questionId] ?? {...freshTutor(), ...(d ? {selected:d.selected, checkedAttemptId:d.checkedAttemptId, elapsedMs:d.elapsedMs} : {})};
  return {...s, companion:{...c, tutorQuestionId:questionId, tutor:{...c.tutor, [questionId]:context}}};
}
export function checkTutor(s: State, q: Question, now: number): State {
  if (testInProgress(s)) return s;
  const c = companionOf(s); const id = c.tutorQuestionId; const t = c.tutor[id] ?? freshTutor();
  if (t.selected === null || t.selected === '' || t.checkedAttemptId || id !== q.id) return s;
  const a: Attempt = {id:uid(), questionId:id, selected:t.selected, correct:grade(q, t.selected), mode:'practice', sessionId:null, flagged:false, elapsedMs:t.elapsedMs, submittedAt:now};
  return {...s, attempts:[...s.attempts,a], reviewAttemptId:a.id, companion:{...c, tutor:{...c.tutor,[id]:{...t,checkedAttemptId:a.id}}}};
}
export function analysisFor(s: State, id: string) {
  const c = companionOf(s);
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
export interface PlanTask {id: PlanTaskId; title: string; section?: 'math' | 'rw'; skill: string; count: number; time: number; icon: string; label: string; reason: string}
// The plan is built from the student's own first-attempt results: the weakest Math skill and the weakest
// Reading and Writing skill, plus a review of a missed question. Task ids are kept for saved-plan compatibility.
export function taskSet(minutes: 10 | 20 | 30, focus: {math: string; rw: string}): PlanTask[] {
  const tasks: PlanTask[] = [
    {id:'algebra',title:`Math focus: ${focus.math}`,section:'math',skill:focus.math,count:minutes === 10 ? 3 : 5,time:minutes === 10 ? 5 : 10,icon:'ƒ',label:'Priority skill',reason:'Your lowest-scoring Math skill so far, or the next one you have not tried.'},
    {id:'transitions',title:`Reading & Writing focus: ${focus.rw}`,section:'rw',skill:focus.rw,count:minutes === 10 ? 2 : 3,time:minutes === 10 ? 3 : 5,icon:'Aa',label:'Keep it fresh',reason:'Your lowest-scoring Reading and Writing skill so far, or the next one you have not tried.'},
    {id:'review',title:'Turn a mistake into a lesson',skill:'Mistake review',count:1,time:minutes === 10 ? 2 : 5,icon:'↻',label:'Reflect & revisit',reason:'Reflect on a question you missed and choose a strategy for next time.'},
  ];
  if (minutes === 30) tasks.push({id:'stretch',title:`Stretch: harder ${focus.math}`,section:'math',skill:focus.math,count:3,time:10,icon:'↗',label:'Optional stretch',reason:'Three more questions in your focus skill. Adaptive practice moves you up a level as you get them right.'});
  return tasks;
}
export function startPlanTask(s: State, task: PlanTask, firstQuestionId: string | undefined, now: number): State {
  if (testInProgress(s)) return s;
  const c = companionOf(s); const date = localDay(now); const plan = c.plans[date] ?? {minutes:20 as const,completed:{}};
  if (plan.completed[task.id]) return s;
  const activeTask = {date,taskId:task.id,startedAt:now,baselineAttemptIds:s.attempts.map(a => a.id),skill:task.skill,count:task.count};
  if (task.id === 'review') {
    const attempt = [...s.attempts].reverse().find(a => !a.correct) ?? s.attempts.at(-1);
    if (!attempt) return s;
    const record = analysisFor(s,attempt.id);
    return {...s, companion:{...c,activeTask,analysisAttemptId:attempt.id,analyses:{...c.analyses,[attempt.id]:{...record,opened:false,confirmedAt:null}},plans:{...c.plans,[date]:plan}}};
  }
  return {...s, practice:{section:task.section!,skill:task.skill,difficulty:'Any',adaptive:true}, ...(firstQuestionId ? {practiceQuestionId:firstQuestionId} : {}),
    companion:{...c,activeTask,plans:{...c.plans,[date]:plan}}};
}
// Progress toward the active practice task: new checked practice answers in the task's skill since it started.
export function planProgress(s: State, skillOf: (questionId: string) => string, now: number) {
  const c = companionOf(s); const active = c.activeTask;
  if (!active || active.taskId === 'review' || active.date !== localDay(now)) return null;
  const done = s.attempts.filter(a => a.mode === 'practice' && a.submittedAt >= active.startedAt && !active.baselineAttemptIds.includes(a.id) && skillOf(a.questionId) === active.skill);
  return {done: done.length, needed: active.count ?? 1, skill: active.skill ?? '', last: done.at(-1)};
}
export function planCompletionAttempt(s: State, skillOf: (questionId: string) => string, now: number): Attempt | undefined {
  if (testInProgress(s)) return;
  const c = companionOf(s); const active = c.activeTask;
  if (!active || active.date !== localDay(now)) return;
  if (active.taskId === 'review') {
    const id = c.analysisAttemptId;
    if (!id || id === SAMPLE_ATTEMPT) return;
    const analysis = c.analyses[id];
    return analysis?.confirmedAt !== null && analysis?.confirmedAt !== undefined && analysis.confirmedAt >= active.startedAt ? s.attempts.find(a => a.id === id) : undefined;
  }
  const progress = planProgress(s, skillOf, now);
  return progress && progress.done >= progress.needed ? progress.last : undefined;
}
export function completePlanTask(s: State, skillOf: (questionId: string) => string, now: number): State {
  const attempt = planCompletionAttempt(s,skillOf,now); const c = companionOf(s); const active = c.activeTask;
  if (!attempt || !active) return s;
  const plan = c.plans[active.date] ?? {minutes:20 as const,completed:{}};
  return {...s,companion:{...c,activeTask:null,plans:{...c.plans,[active.date]:{...plan,completed:{...plan.completed,[active.taskId]:{attemptId:attempt.id,completedAt:now}}}}}};
}
