export type Cause = 'calculation' | 'concept' | 'reading' | 'unsure';
export type PlanTaskId = 'algebra' | 'transitions' | 'review' | 'stretch';
import {QUESTION_ID, SPR_INPUT} from './data/question-schema.ts';
export interface TutorContext {
  selected: number | string | null; checkedAttemptId: string | null; elapsedMs: number;
  hintLevel: number; composer: string; messages: {role: 'user' | 'tutor'; text: string}[];
}
export interface AnalysisRecord {
  reflection: string; opened: boolean; cause: Cause; confirmedAt: number | null;
}
export interface PlanRecord {
  minutes: 10 | 20 | 30;
  completed: Partial<Record<PlanTaskId, {attemptId: string; completedAt: number}>>;
}
export interface CompanionState {
  tutorQuestionId: string; tutor: Record<string, TutorContext>;
  analysisAttemptId: string | null; analyses: Record<string, AnalysisRecord>;
  plans: Record<string, PlanRecord>;
  activeTask: {date: string; taskId: PlanTaskId; startedAt: number; baselineAttemptIds: string[]; skill?: string; count?: number} | null;
}
export const SAMPLE_ATTEMPT = 'sample-wp-math-001';
export const CAUSES: Cause[] = ['calculation', 'concept', 'reading', 'unsure'];
export const TASK_IDS: PlanTaskId[] = ['algebra', 'transitions', 'review', 'stretch'];
export const emptyCompanion = (): CompanionState => ({tutorQuestionId:'wp-math-001', tutor:{}, analysisAttemptId:null, analyses:{}, plans:{}, activeTask:null});
export const freshTutor = (): TutorContext => ({selected:null, checkedAttemptId:null, elapsedMs:0, hintLevel:0, composer:'', messages:[]});

export function validateCompanion(value: unknown, attempts: {id: string; questionId: string}[]) {
  const c = value as CompanionState;
  const record = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const day = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00`));
  const attempt = (id: unknown) => typeof id === 'string' && attempts.some(a => a.id === id);
  const analysisId = (id: unknown) => id === SAMPLE_ATTEMPT || attempt(id);
  const invalid = () => {throw new Error('Invalid Learning Companion data.');};
  if (!record(c) || !QUESTION_ID.test(String(c.tutorQuestionId)) || !record(c.tutor) || !record(c.analyses) || !record(c.plans) || !(c.analysisAttemptId === null || analysisId(c.analysisAttemptId))) invalid();
  for (const [id,t] of Object.entries(c.tutor)) {
    if (!QUESTION_ID.test(id) || !record(t) || !(t.selected === null || (Number.isInteger(t.selected) && Number(t.selected) >= 0 && Number(t.selected) < 4) || (typeof t.selected === 'string' && (t.selected === '' || SPR_INPUT.test(t.selected)))) || !num(t.elapsedMs) || !(t.checkedAttemptId === null || attempts.some(a => a.id === t.checkedAttemptId && a.questionId === id)) || !Number.isInteger(t.hintLevel) || t.hintLevel < 0 || t.hintLevel > 3 || typeof t.composer !== 'string' || t.composer.length > 500 || !Array.isArray(t.messages) || t.messages.length > 60 || !t.messages.every(m => record(m) && ['user','tutor'].includes(m.role) && typeof m.text === 'string' && m.text.length <= 2000)) invalid();
  }
  for (const [id,a] of Object.entries(c.analyses)) if (!analysisId(id) || !record(a) || typeof a.reflection !== 'string' || a.reflection.length > 5000 || typeof a.opened !== 'boolean' || !CAUSES.includes(a.cause) || !(a.confirmedAt === null || (num(a.confirmedAt) && a.opened && a.reflection.trim()))) invalid();
  for (const [date,p] of Object.entries(c.plans)) {
    if (!day(date) || !record(p) || ![10,20,30].includes(p.minutes) || !record(p.completed)) invalid();
    for (const [id,done] of Object.entries(p.completed)) if (!TASK_IDS.includes(id as PlanTaskId) || !record(done) || !done || !attempt(done.attemptId) || !num(done.completedAt)) invalid();
  }
  if (c.activeTask !== null) {
    const t = c.activeTask;
    if (!record(t) || !day(t.date) || !TASK_IDS.includes(t.taskId) || !num(t.startedAt) || !Array.isArray(t.baselineAttemptIds) || !t.baselineAttemptIds.every(attempt) || !(t.skill === undefined || (typeof t.skill === 'string' && t.skill.length <= 80)) || !(t.count === undefined || (Number.isInteger(t.count) && t.count >= 1 && t.count <= 10))) invalid();
  }
}
