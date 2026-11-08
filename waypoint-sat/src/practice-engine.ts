// Question selection, skill statistics, and test assembly. Pure functions so they are easy to test.
import {questions, questionById} from './data/bank';
import {DOMAINS, grade, type Question, type Subject, type Difficulty} from './data/question-schema';
import type {State, Attempt, PracticeFilter, Session, SessionConfig, TestRun, Tier, Choice} from './model';
import {createSession, finishSession, uid} from './model';

export const defaultFilter = (section: Subject = 'math'): PracticeFilter => ({section, skill: 'All skills', difficulty: 'Any', adaptive: true});
export const filterOf = (s: State): PracticeFilter => s.practice ?? defaultFilter(questionById(s.practiceQuestionId).section);
export const LEVELS: Difficulty[] = ['Easy', 'Medium', 'Hard'];
export const gradeById = (questionId: string, choice: Choice) => grade(questionById(questionId), choice);

export function pool(filter: PracticeFilter): Question[] {
  return questions().filter(q => q.section === filter.section && (filter.skill === 'All skills' || q.skill === filter.skill || q.domain === filter.skill));
}
// First attempt per question decides "seen" and accuracy; retries never overwrite it.
export function firstAttempts(s: State): Map<string, Attempt> {
  const first = new Map<string, Attempt>();
  for (const a of s.attempts) if (!first.has(a.questionId)) first.set(a.questionId, a);
  return first;
}
// Adaptive ladder: an unaided correct answer steps up a level; a miss steps down.
export function adaptiveLevel(s: State, filter: PracticeFilter): Difficulty {
  const recent = s.attempts.filter(a => a.mode === 'practice' && pool(filter).some(q => q.id === a.questionId)).slice(-3);
  if (!recent.length) return 'Medium';
  let level = LEVELS.indexOf(questionById(recent[recent.length - 1].questionId).difficulty as Difficulty);
  const last = recent[recent.length - 1];
  level = last.correct ? Math.min(2, level + 1) : Math.max(0, level - 1);
  return LEVELS[level];
}
// Picks the next question: unseen first, then ones answered wrong, then anything except the current one.
export function nextQuestion(s: State, filter: PracticeFilter, currentId?: string): Question | undefined {
  const candidates = pool(filter);
  if (!candidates.length) return undefined;
  const level = filter.adaptive ? adaptiveLevel(s, filter) : filter.difficulty;
  const first = firstAttempts(s);
  const wrongIds = new Set(s.attempts.filter(a => !a.correct).map(a => a.questionId));
  const rightIds = new Set(s.attempts.filter(a => a.correct).map(a => a.questionId));
  const score = (q: Question) => (q.id === currentId ? 100 : 0) + (level !== 'Any' && q.difficulty !== level ? 10 + Math.abs(LEVELS.indexOf(q.difficulty) - LEVELS.indexOf(level as Difficulty)) : 0)
    + (first.has(q.id) ? (wrongIds.has(q.id) && !rightIds.has(q.id) ? 3 : 6) : 0);
  return [...candidates].sort((a, b) => score(a) - score(b) || candidates.indexOf(a) - candidates.indexOf(b))[0];
}
export function moreLikeThis(s: State, q: Question): Question | undefined {
  return nextQuestion(s, {section: q.section, skill: q.skill, difficulty: q.difficulty, adaptive: false}, q.id) ?? undefined;
}
export interface SkillStat {section: Subject; domain: string; skill: string; attempted: number; correct: number; available: number; accuracy: number | null}
export function skillStats(s: State): SkillStat[] {
  const first = firstAttempts(s);
  return (['math', 'rw'] as Subject[]).flatMap(section => DOMAINS[section].flatMap(d => d.skills.map(skill => {
    const items = questions().filter(q => q.section === section && q.skill === skill);
    const tried = items.map(q => first.get(q.id)).filter((a): a is Attempt => !!a);
    const correct = tried.filter(a => a.correct).length;
    return {section, domain: d.domain, skill, attempted: tried.length, correct, available: items.length, accuracy: tried.length ? Math.round(correct / tried.length * 100) : null};
  })));
}
// Weakest = lowest accuracy among attempted skills; ties and untouched skills fall back to bank order.
export function prioritySkill(s: State, section: Subject): SkillStat {
  const stats = skillStats(s).filter(x => x.section === section && x.available > 0);
  const tried = stats.filter(x => x.attempted > 0 && (x.accuracy ?? 100) < 100).sort((a, b) => (a.accuracy! - b.accuracy!) || (b.attempted - a.attempted));
  return tried[0] ?? stats.find(x => x.attempted === 0) ?? stats[0];
}

// ---- Tests ----
// Real Digital SAT modules: Reading & Writing 27 questions in 32 minutes; Math 22 questions in 35 minutes.
export const REAL = {rw: {size: 27, minutes: 32}, math: {size: 22, minutes: 35}} as const;
const shuffle = <T,>(list: T[], seed: number) => { const a = [...list]; let x = seed || 1; for (let i = a.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) % 2147483648; const j = x % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// Each module draws half of the section's bank at most, so module 2 always has fresh questions.
export const moduleSize = (section: Subject) => Math.max(1, Math.min(REAL[section].size, Math.floor(questions().filter(q => q.section === section).length / 2)));
export const moduleMs = (section: Subject, size: number) => Math.round(REAL[section].minutes * 60000 * size / REAL[section].size);
const blend: Record<Tier, Record<Difficulty, number>> = {base: {Easy: 1, Medium: 1, Hard: 1}, easier: {Easy: 3, Medium: 2, Hard: 0.25}, harder: {Easy: 0.25, Medium: 2, Hard: 3}};
export function pickModule(section: Subject, size: number, tier: Tier, exclude: Set<string>, seed: number): string[] {
  const available = shuffle(questions().filter(q => q.section === section && !exclude.has(q.id)), seed);
  const weights = blend[tier];
  const total = LEVELS.reduce((sum, l) => sum + weights[l], 0);
  const picked: Question[] = [];
  for (const level of LEVELS) picked.push(...available.filter(q => q.difficulty === level).slice(0, Math.round(size * weights[level] / total)));
  for (const q of available) if (picked.length < size && !picked.includes(q)) picked.push(q);
  // Within a module, easier questions come first, as on the real test's ordering within a domain.
  return picked.slice(0, size).sort((a, b) => LEVELS.indexOf(a.difficulty) - LEVELS.indexOf(b.difficulty)).map(q => q.id);
}
export function quickCheck(seed = Date.now()): Session {
  const ids = [...pickModule('rw', 5, 'base', new Set(), seed), ...pickModule('math', 5, 'base', new Set(), seed + 7)];
  return createSession(ids, uid(), {kind: 'quick', title: 'Quick check · 10 mixed questions', section: 'mixed', durationMs: 13 * 60000});
}
export function moduleConfig(section: Subject, module: 1 | 2, tier: Tier, runId: string, size: number): SessionConfig {
  const name = section === 'rw' ? 'Reading and Writing' : 'Math';
  return {kind: 'module', title: `${name} · Module ${module}${module === 2 ? tier === 'harder' ? ' (harder)' : ' (easier)' : ''}`, section, durationMs: moduleMs(section, size), runId, module, tier};
}
export function startRun(s: State, kind: 'full' | 'section', sections: Subject[], now: number): State {
  const run: TestRun = {id: uid(), kind, sections, moduleSessionIds: [], status: 'active', startedAt: now, completedAt: null};
  const size = moduleSize(sections[0]);
  const session = createSession(pickModule(sections[0], size, 'base', new Set(), now), uid(), moduleConfig(sections[0], 1, 'base', run.id, size));
  run.moduleSessionIds.push(session.id);
  return {...s, runs: [...(s.runs ?? []), run], sessions: [...s.sessions, session], activeSessionId: session.id};
}
// The plan of modules for a run, in order.
export const runPlan = (run: TestRun) => run.sections.flatMap(section => [{section, module: 1 as const}, {section, module: 2 as const}]);
// After a module ends: route module 2 by module-1 performance (60% or better → harder), or move to the next section.
export function advanceRun(s: State, runId: string, now: number): State {
  const run = s.runs?.find(r => r.id === runId);
  if (!run || run.status !== 'active') return s;
  const plan = runPlan(run);
  const done = run.moduleSessionIds.length;
  // The finished last module stays selected so the results screen can show the whole run.
  if (done >= plan.length) return {...s, runs: s.runs!.map(r => r.id === runId ? {...r, status: 'complete', completedAt: now} : r)};
  const next = plan[done];
  const used = new Set(run.moduleSessionIds.flatMap(id => s.sessions.find(x => x.id === id)?.questionIds ?? []));
  let tier: Tier = 'base';
  if (next.module === 2) {
    const m1 = s.sessions.find(x => x.id === run.moduleSessionIds[done - 1]);
    const right = m1 ? m1.questionIds.filter(id => gradeById(id, m1.answers[id] ?? null)).length : 0;
    tier = m1 && right / m1.questionIds.length >= 0.6 ? 'harder' : 'easier';
  }
  const size = moduleSize(next.section);
  const session = createSession(pickModule(next.section, size, tier, used, now), uid(), moduleConfig(next.section, next.module, tier, run.id, size));
  return {...s, sessions: [...s.sessions, session], activeSessionId: session.id, runs: s.runs!.map(r => r.id === runId ? {...r, moduleSessionIds: [...r.moduleSessionIds, session.id]} : r)};
}
export const runOf = (s: State, session?: Session) => session?.config?.runId ? s.runs?.find(r => r.id === session.config!.runId) : undefined;
// Ends the current module (submitted or timed out) and moves a multi-module run forward.
export function finishModule(s: State, sessionId: string, now: number): State {
  const before = s.sessions.find(x => x.id === sessionId);
  let next = finishSessionGraded(s, sessionId, now);
  const run = runOf(next, before);
  if (run && next !== s) next = advanceRun(next, run.id, now);
  return next;
}
// Stops a multi-module run early: the current module is submitted and no further modules start.
export function stopRun(s: State, runId: string, now: number): State {
  const run = s.runs?.find(r => r.id === runId);
  if (!run || run.status !== 'active') return s;
  const current = s.sessions.find(x => x.id === s.activeSessionId && x.config?.runId === runId);
  let next = current && ['running', 'paused'].includes(current.status) ? finishSessionGraded(s, current.id, now) : s;
  if (current && current.status === 'ready') next = {...next, sessions: next.sessions.filter(x => x.id !== current.id), activeSessionId: run.moduleSessionIds.length > 1 ? run.moduleSessionIds[run.moduleSessionIds.length - 2] : null,
    runs: next.runs!.map(r => r.id === runId ? {...r, moduleSessionIds: r.moduleSessionIds.filter(id => id !== current.id)} : r)};
  return {...next, runs: next.runs!.map(r => r.id === runId ? {...r, status: 'complete', completedAt: now} : r)};
}
const finishSessionGraded = (s: State, id: string, now: number) => finishSession(s, id, now, gradeById);
export const activeRun = (s: State) => s.runs?.find(r => r.status === 'active');
