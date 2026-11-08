import {validateCompanion, type CompanionState} from './companion-types.ts';
import {validateIntelligence, type IntelligenceState} from './intelligence-types.ts';
import {QUESTION_ID, SPR_INPUT} from './data/question-schema.ts';
import {topicQuestions} from './data/test-questions.ts';
import {topicById} from './data/test-topics.ts';
export type Choice = number | string | null;
export type Tier = 'base' | 'easier' | 'harder';
export interface SessionConfig {kind: 'quick' | 'module'; title: string; section: 'rw' | 'math' | 'mixed'; durationMs: number; runId?: string; module?: number; tier?: Tier}
export interface TestRun {
  id: string; kind: 'full' | 'section'; sections: ('rw' | 'math')[]; moduleSessionIds: string[];
  status: 'active' | 'complete'; startedAt: number; completedAt: number | null;
}
export interface PracticeFilter {section: 'math' | 'rw'; skill: string; difficulty: 'Any' | 'Easy' | 'Medium' | 'Hard'; adaptive: boolean}
export type Route = 'dashboard' | 'practice' | 'test' | 'review' | 'plan' | 'tutor' | 'analysis' | 'adaptive' | 'work' | 'pacing' | 'similar' | 'weekly' | 'handwriting' | 'assistant' | 'admin' | 'tutors' | 'connections' | 'teaching' | 'tutorprofile';
export interface Attempt {
  id: string; questionId: string; selected: Choice; correct: boolean;
  mode: 'practice' | 'test'; sessionId: string | null; flagged: boolean;
  elapsedMs: number; submittedAt: number;
}
export interface Draft { selected: Choice; checkedAttemptId: string | null; elapsedMs: number }
export interface Session {
  id: string; questionIds: string[]; status: 'ready' | 'running' | 'paused' | 'submitted' | 'expired';
  answers: Record<string, Choice>; flags: string[]; currentIndex: number;
  startedAt: number | null; deadlineAt: number | null; remainingMs: number;
  submittedAt: number | null; questionElapsedMs: Record<string, number>; segmentStartedAt: number | null;
  config?: SessionConfig;
  // Topic practice (25 questions from one SAT domain); saved by earlier versions in this exact shape.
  topicId?: string; durationMs?: number;
}
export interface State {
  version: 1; attempts: Attempt[]; sessions: Session[]; activeSessionId: string | null;
  drafts: Record<string, Draft>; reflections: Record<string, {text: string; updatedAt: number}>;
  practiceQuestionId: string; reviewAttemptId: string | null;
  companion?: CompanionState;
  intelligence?: IntelligenceState;
  runs?: TestRun[];
  practice?: PracticeFilter;
}
export const STORAGE_KEY = 'waypoint-local-v1';
export const DEMO_MS = 5 * 60 * 1000;
export const MAX_SESSION_MS = 75 * 60 * 1000;
export const MAX_SESSION_QUESTIONS = 60;
export const emptyState = (): State => ({ version: 1, attempts: [], sessions: [], activeSessionId: null, drafts: {}, reflections: {}, practiceQuestionId: 'wp-math-001', reviewAttemptId: null });
export const uid = () => crypto.randomUUID();
export function createSession(ids: string[], id = uid(), config?: SessionConfig): Session {
  return {id, questionIds: ids, status: 'ready', answers: {}, flags: [], currentIndex: 0, startedAt: null, deadlineAt: null, remainingMs: config?.durationMs ?? DEMO_MS, submittedAt: null, questionElapsedMs: {}, segmentStartedAt: null, ...(config ? {config} : {})};
}
export function createTopicSession(topicId: string, id = uid()): Session {
  const topic = topicById(topicId); if (!topic) throw new Error('Unknown practice topic.');
  const ids = topicQuestions.filter(q => q.topicId === topicId).map(q => q.id);
  let seed = Array.from(id).reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 0);
  for (let i = ids.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const j = seed % (i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const durationMs = topic.minutes * 60000;
  return {...createSession(ids, id), topicId, durationMs, remainingMs: durationMs};
}
// Never more than what was left when the clock last started, even if the device clock jumps backwards.
export function remaining(session: Session, now: number): number {
  return session.status === 'running' ? Math.min(session.remainingMs, Math.max(0, (session.deadlineAt ?? now) - now)) : session.remainingMs;
}
function accrue(session: Session, now: number): Session {
  if (session.status !== 'running' || session.segmentStartedAt === null) return session;
  const id = session.questionIds[session.currentIndex];
  const end = Math.min(now, session.deadlineAt ?? now);
  return {...session, questionElapsedMs: {...session.questionElapsedMs, [id]: (session.questionElapsedMs[id] ?? 0) + Math.max(0, end - session.segmentStartedAt)}, segmentStartedAt: now};
}
export function resumeSession(session: Session, now: number): Session {
  if (!['ready', 'paused'].includes(session.status)) return session;
  return {...session, status: 'running', startedAt: session.startedAt ?? now, deadlineAt: now + session.remainingMs, segmentStartedAt: now};
}
export function pauseSession(session: Session, now: number): Session {
  if (session.status !== 'running' || remaining(session, now) === 0) return session;
  return {...accrue(session, now), status: 'paused', remainingMs: remaining(session, now), deadlineAt: null, segmentStartedAt: null};
}
export function navigateSession(session: Session, index: number, now: number): Session {
  if (index < 0 || index >= session.questionIds.length) return session;
  return {...accrue(session, now), currentIndex: index};
}
export function finishSession(state: State, id: string, now: number, gradeOrKeys: ((questionId: string, choice: Choice) => boolean) | Record<string, number>): State {
  const grade = typeof gradeOrKeys === 'function' ? gradeOrKeys : (questionId: string, choice: Choice) => choice === gradeOrKeys[questionId];
  const current = state.sessions.find(s => s.id === id);
  if (!current || !['running', 'paused'].includes(current.status)) return state;
  const expired = current.status === 'running' && remaining(current, now) === 0;
  const submittedAt = expired ? current.deadlineAt! : now;
  const session: Session = {...accrue(current, now), status: expired ? 'expired' : 'submitted', submittedAt, remainingMs: remaining(current, now), deadlineAt: null, segmentStartedAt: null};
  const attempts: Attempt[] = session.questionIds.map(questionId => ({id: `${id}:${questionId}`, questionId, selected: session.answers[questionId] ?? null, correct: grade(questionId, session.answers[questionId] ?? null), mode: 'test', sessionId: id, flagged: session.flags.includes(questionId), elapsedMs: session.questionElapsedMs[questionId] ?? 0, submittedAt}));
  return {...state, sessions: state.sessions.map(s => s.id === id ? session : s), attempts: [...state.attempts, ...attempts], reviewAttemptId: attempts[0].id};
}
export const localDay = (time: number) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function dayOffset(now: number, offset: number): number { const d = new Date(now); d.setDate(d.getDate() + offset); return d.getTime(); }
export function activityStats(state: State, now: number) {
  const first = [...new Map([...state.attempts].reverse().map(a => [a.questionId, a])).values()];
  const days = new Set(state.attempts.filter(a => a.selected !== null).map(a => localDay(a.submittedAt)));
  let streak = 0;
  // Yesterday's streak stays alive until the end of today.
  let offset = days.has(localDay(now)) ? 0 : -1;
  while (days.has(localDay(dayOffset(now, offset)))) { streak++; offset--; }
  const todayAttempts = state.attempts.filter(a => localDay(a.submittedAt) === localDay(now) && a.selected !== null);
  const reflectedToday = Object.entries(state.reflections).some(([id, r]) => r.text.trim() && localDay(r.updatedAt) === localDay(now) && state.attempts.some(a => a.questionId === id)) || Object.entries(state.companion?.analyses ?? {}).some(([id,a]) => a.confirmedAt !== null && a.reflection.trim() && localDay(a.confirmedAt) === localDay(now) && state.attempts.some(attempt => attempt.id === id));
  return {first, days, streak, todayAttempts, reflectedToday};
}

// Treat storage as untrusted input: invalid records must never silently become progress.
export function parseState(raw: string): State {
  const s = JSON.parse(raw);
  const qid = (v: unknown) => typeof v === 'string' && QUESTION_ID.test(v);
  const choice = (v: unknown) => v === null || (Number.isInteger(v) && Number(v) >= 0 && Number(v) < 4) || (typeof v === 'string' && v.length <= 7 && (v === '' || SPR_INPUT.test(v)));
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const nullableTime = (v: unknown) => v === null || num(v);
  const record = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!s || s.version !== 1 || !Array.isArray(s.attempts) || !Array.isArray(s.sessions) || !record(s.drafts) || !record(s.reflections) || !qid(s.practiceQuestionId) || !(s.activeSessionId === null || typeof s.activeSessionId === 'string') || !(s.reviewAttemptId === null || typeof s.reviewAttemptId === 'string')) throw new Error('Unsupported or damaged saved data.');
  if (s.attempts.length > 20000 || s.sessions.length > 2000) throw new Error('Saved history is too large.');
  for (const a of s.attempts) if (!a || typeof a.id !== 'string' || !qid(a.questionId) || !choice(a.selected) || typeof a.correct !== 'boolean' || !['practice', 'test'].includes(a.mode) || !(a.sessionId === null || typeof a.sessionId === 'string') || typeof a.flagged !== 'boolean' || !num(a.elapsedMs) || !num(a.submittedAt)) throw new Error('Invalid attempt.');
  for (const [id, d] of Object.entries(s.drafts) as [string, Draft][]) if (!qid(id) || !d || !choice(d.selected) || !(d.checkedAttemptId === null || s.attempts.some((a: Attempt) => a.id === d.checkedAttemptId)) || !num(d.elapsedMs)) throw new Error('Invalid practice draft.');
  for (const r of Object.values(s.reflections) as {text: string; updatedAt: number}[]) if (!r || typeof r.text !== 'string' || r.text.length > 5000 || !num(r.updatedAt)) throw new Error('Invalid reflection.');
  for (const t of s.sessions as Session[]) {
    const c = t?.config;
    if (c !== undefined && (!record(c) || !['quick', 'module'].includes(c.kind) || typeof c.title !== 'string' || c.title.length > 120 || !['rw', 'math', 'mixed'].includes(c.section) || !num(c.durationMs) || c.durationMs > MAX_SESSION_MS || !(c.runId === undefined || typeof c.runId === 'string') || !(c.module === undefined || [1, 2].includes(c.module)) || !(c.tier === undefined || ['base', 'easier', 'harder'].includes(c.tier)))) throw new Error('Invalid test settings.');
    if (t && (!(t.topicId === undefined || (typeof t.topicId === 'string' && !!topicById(t.topicId))) || !(t.durationMs === undefined || (num(t.durationMs) && t.durationMs <= MAX_SESSION_MS)))) throw new Error('Invalid topic practice.');
    const limit = c?.durationMs ?? t?.durationMs ?? DEMO_MS;
    if (t?.topicId !== undefined) { const expected = topicQuestions.filter(q => q.topicId === t.topicId).map(q => q.id); if (!Array.isArray(t.questionIds) || t.questionIds.length !== expected.length || !expected.every(id => t.questionIds.includes(id))) throw new Error('Invalid topic practice.'); }
    if (!t || typeof t.id !== 'string' || !Array.isArray(t.questionIds) || t.questionIds.length < 1 || t.questionIds.length > MAX_SESSION_QUESTIONS || new Set(t.questionIds).size !== t.questionIds.length || !t.questionIds.every(qid) || !['ready', 'running', 'paused', 'submitted', 'expired'].includes(t.status) || !record(t.answers) || !Object.entries(t.answers).every(([id, v]) => t.questionIds.includes(id) && choice(v)) || !Array.isArray(t.flags) || !t.flags.every(id => t.questionIds.includes(id)) || !Number.isInteger(t.currentIndex) || t.currentIndex < 0 || t.currentIndex >= t.questionIds.length || !num(t.remainingMs) || t.remainingMs > limit || !nullableTime(t.startedAt) || !nullableTime(t.deadlineAt) || !nullableTime(t.segmentStartedAt) || !nullableTime(t.submittedAt) || !record(t.questionElapsedMs) || !Object.values(t.questionElapsedMs).every(num) || (t.status === 'running' && (t.deadlineAt === null || t.segmentStartedAt === null))) throw new Error('Invalid practice test.');
  }
  if (s.activeSessionId !== null && !s.sessions.some((t: Session) => t.id === s.activeSessionId)) throw new Error('Missing active session.');
  if (s.runs !== undefined) {
    if (!Array.isArray(s.runs) || s.runs.length > 500) throw new Error('Invalid test runs.');
    for (const r of s.runs as TestRun[]) if (!record(r) || typeof r.id !== 'string' || !['full', 'section'].includes(r.kind) || !Array.isArray(r.sections) || !r.sections.length || r.sections.length > 2 || !r.sections.every(x => ['rw', 'math'].includes(x)) || !Array.isArray(r.moduleSessionIds) || r.moduleSessionIds.length > 4 || !r.moduleSessionIds.every(id => s.sessions.some((t: Session) => t.id === id)) || !['active', 'complete'].includes(r.status) || !num(r.startedAt) || !nullableTime(r.completedAt)) throw new Error('Invalid test run.');
  }
  if (s.practice !== undefined) {
    const p = s.practice;
    if (!record(p) || !['math', 'rw'].includes(p.section) || typeof p.skill !== 'string' || p.skill.length > 80 || !['Any', 'Easy', 'Medium', 'Hard'].includes(p.difficulty) || typeof p.adaptive !== 'boolean') throw new Error('Invalid practice settings.');
  }
  if (s.companion !== undefined) validateCompanion(s.companion, s.attempts);
  if (s.intelligence !== undefined) validateIntelligence(s.intelligence);
  return s as State;
}
