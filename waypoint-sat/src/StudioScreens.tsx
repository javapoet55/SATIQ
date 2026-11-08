import {useEffect, useRef, useState} from 'react';
import type {ProgressStore} from './server-store';
import type {Route, Attempt, Session, State, Choice} from './model';
import {uid, remaining, resumeSession, pauseSession, navigateSession, activityStats, localDay, dayOffset, createTopicSession} from './model';
import {testTopics, topicById} from './data/test-topics';
import {questions, questionById} from './data/bank';
import {DOMAINS, grade, answerLabel, type Question, type Subject} from './data/question-schema';
import {Intro, AnswerInput, QuestionBody, WrongChoiceNote, Solution, MathTools, hasAnswer} from './StudyComponents';
import {MathText, plain} from './MathText';
import {filterOf, pool, nextQuestion, moreLikeThis, adaptiveLevel, skillStats, prioritySkill, firstAttempts, quickCheck, startRun, finishModule, stopRun, runOf, runPlan, activeRun, moduleSize, moduleMs, REAL} from './practice-engine';
import {companionOf, openTutor, testInProgress, planProgress, completePlanTask} from './companion-model';
import {useConfig, coachNote, timezone} from './api';
import {intelligenceOf} from './intelligence-model';

export const clock = (ms: number) => { const seconds = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(seconds / 3600); const m = Math.floor(seconds % 3600 / 60); return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
const sectionName = (s: Subject | 'mixed') => s === 'math' ? 'Math' : s === 'rw' ? 'Reading & Writing' : 'Mixed';
type Props = {store: ProgressStore; now: number; navigate: (r: Route) => void; notify: (t: string) => void};
const skillOf = (id: string) => questionById(id).skill;
// Display name for any test session: adaptive module, quick check, topic practice, or the original demo.
export const sessionTitle = (s: Session) => s.config?.title ?? (s.topicId ? `${topicById(s.topicId)?.name ?? 'Topic'} · topic practice` : 'Original 4-question demo');

// Banner shown while a daily-plan practice activity is under way.
export function PlanBanner({store, now, navigate, notify}: Props) {
  const progress = planProgress(store.state, skillOf, now);
  if (!progress) return null;
  const ready = progress.done >= progress.needed;
  return <div className={`plan-banner ${ready ? 'ready' : ''}`} role="status"><span><strong>Daily plan:</strong> {Math.min(progress.done, progress.needed)} of {progress.needed} questions in {progress.skill}</span>
    {ready ? <button className="primary" onClick={() => {store.commit(s => completePlanTask(s, skillOf, Date.now())); notify('Plan activity complete. Nice work.'); navigate('plan');}}>Complete activity →</button> : <button className="text-button" onClick={() => navigate('plan')}>Back to plan</button>}</div>;
}

// ---------------- Home ----------------
export function Dashboard({store, now, navigate}: Props) {
  const {state} = store; const config = useConfig();
  const stats = activityStats(state, now);
  const skills = skillStats(state);
  const first = firstAttempts(state);
  const sectionAccuracy = (section: Subject) => { const rows = [...first.values()].filter(a => questionById(a.questionId).section === section); return {n: rows.length, pct: rows.length ? Math.round(rows.filter(a => a.correct).length / rows.length * 100) : null}; };
  const focus = {math: prioritySkill(state, 'math'), rw: prioritySkill(state, 'rw')};
  const covered = skills.filter(s => s.attempted > 0).length;
  const counts = Array.from({length: 7}, (_, i) => { const day = localDay(dayOffset(now, i - 6)); return state.attempts.filter(a => localDay(a.submittedAt) === day && a.selected !== null).length; });
  const max = Math.max(1, ...counts);
  const practiceSkill = (section: Subject, skill: string) => { const filter = {section, skill, difficulty: 'Any' as const, adaptive: true}; const q = nextQuestion(state, filter); store.commit(s => ({...s, practice: filter, ...(q ? {practiceQuestionId: q.id} : {})})); navigate('practice'); };
  return <>
    <Intro tag="YOUR DAILY CHECK-IN" title="Small steps. Real progress.">Welcome{state.attempts.length ? ' back' : ''}. Let’s make today count.</Intro>
    <div className="grid"><section>
      <div className="card hero"><div className="row"><span className="eyebrow">YOUR PROGRESS</span><span className="pill">{covered} of {skills.length} skills started</span></div>
        <div className="section-scores">{(['rw', 'math'] as Subject[]).map(section => { const a = sectionAccuracy(section); return <div key={section}><span>{sectionName(section)}</span><strong>{a.pct === null ? '—' : `${a.pct}%`}</strong><small>{a.n} first {a.n === 1 ? 'attempt' : 'attempts'}</small></div>; })}</div>
        <p className="muted small">First-attempt accuracy. A predicted SAT score needs much more data, so we don’t show one yet.</p>
        <div className="activity-chart" role="img" aria-label={`Answers checked over the last seven days: ${counts.join(', ')}`}>{counts.map((count, i) => <div className="chart-column" key={i}><span>{count}</span><div className="chart-track"><i style={{height: `${count / max * 100}%`}}/></div><small>{new Date(dayOffset(now, i - 6)).toLocaleDateString(undefined, {weekday: 'short'})}</small></div>)}</div>
        <div className="row muted chart-caption"><span>LAST 7 DAYS</span><span>ANSWERS CHECKED</span></div></div>
      <div className="card spaced"><div className="row"><h2>Your focus skills</h2><button className="text-button" onClick={() => navigate('plan')}>Open today’s plan →</button></div>
        {(['math', 'rw'] as Subject[]).map(section => <div className="task" key={section}><span className="num">{section === 'math' ? 'ƒ' : 'Aa'}</span><div><h3>{focus[section].skill}</h3><small>{sectionName(section)} · {focus[section].accuracy === null ? 'not tried yet' : `${focus[section].correct} of ${focus[section].attempted} right on first try`}</small></div><button className={section === 'math' ? 'primary' : ''} onClick={() => practiceSkill(section, focus[section].skill)}>Practice →</button></div>)}
      </div>
      <SkillMap state={state} onPractice={practiceSkill}/>
    </section><section>
      <div className="card"><div className="row"><h2>Keep the spark.</h2><span className="sun" aria-hidden="true">☀</span></div><p className="muted">{stats.streak ? <>You’ve practiced <strong>{stats.streak} {stats.streak === 1 ? 'day' : 'days'} in a row.</strong></> : 'Your first question starts a new streak.'}</p><div className="days">{Array.from({length: 7}, (_, i) => { const day = dayOffset(now, i - 6); const active = stats.days.has(localDay(day)); return <div className="day" key={i} aria-label={`${new Date(day).toLocaleDateString()}: ${active ? 'practiced' : 'no practice'}`}><span>{new Date(day).toLocaleDateString(undefined, {weekday: 'narrow'})}</span><b className={active ? 'complete' : ''}>{active ? '✓' : '·'}</b></div>; })}</div></div>
      {config.ai && <CoachNote kind="daily" hasData={state.attempts.length > 0}/>}
      <div className="card spaced milestone"><span className="eyebrow">NEXT MILESTONE</span><h2 className="solution-title">Rehearse test day.</h2><p className="muted">Take a timed, adaptive practice test with the calculator and reference sheet.</p><button className="spaced" onClick={() => navigate('test')}>Open practice tests →</button></div>
    </section></div>
  </>;
}
function SkillMap({state, onPractice}: {state: State; onPractice: (section: Subject, skill: string) => void}) {
  const stats = skillStats(state);
  return <div className="card spaced"><h2>Skill map</h2><p className="muted small">Every Digital SAT skill. Tap one to practice it.</p>
    {(['rw', 'math'] as Subject[]).map(section => <div key={section} className="skill-section"><h3>{sectionName(section)}</h3>{DOMAINS[section].map(d => <div key={d.domain}><span className="sectionlabel">{d.domain.toUpperCase()}</span><div className="skill-chips">{d.skills.map(skill => { const s = stats.find(x => x.section === section && x.skill === skill)!; return <button key={skill} className={`skill-chip ${s.accuracy === null ? '' : s.accuracy >= 80 ? 'strong' : s.accuracy >= 50 ? 'ok' : 'weak'}`} onClick={() => onPractice(section, skill)} aria-label={`${skill}: ${s.accuracy === null ? 'not started' : `${s.accuracy}% on first attempts`}`}><span>{skill}</span><small>{s.accuracy === null ? `${s.available} questions` : `${s.accuracy}%`}</small></button>; })}</div></div>)}</div>)}</div>;
}
export function CoachNote({kind, hasData}: {kind: 'daily' | 'weekly'; hasData: boolean}) {
  const [note, setNote] = useState<{text: string | null; loading: boolean; error: string}>({text: null, loading: false, error: ''});
  const load = (refresh = false) => { setNote(n => ({...n, loading: true, error: ''})); coachNote({kind, timezone: timezone(), refresh}).then(r => setNote({text: r.text, loading: false, error: ''})).catch(e => setNote({text: null, loading: false, error: e.message})); };
  useEffect(() => { if (hasData) load(); }, [kind, hasData]);
  return <div className="card spaced coach-note" aria-live="polite"><span className="eyebrow">✦ PREPORBIT AI COACH</span><h2 className="solution-title">{kind === 'weekly' ? 'Your week in a few lines' : 'Today’s note'}</h2>
    {!hasData ? <p className="muted">Answer a few questions and your coach note appears here.</p> : note.loading ? <p className="muted">Writing your note…</p> : note.error ? <><p className="muted">{note.error}</p><button onClick={() => load()}>Try again</button></> : note.text ? <><p>{note.text}</p><p className="caption">Written by AI from your saved answers. Refreshes once a {kind === 'weekly' ? 'week' : 'day'}.</p></> : <p className="muted">Not enough activity yet.</p>}</div>;
}

// ---------------- Practice ----------------
export function Practice({store, now, navigate, notify}: Props) {
  const {state, commit} = store;
  const filter = filterOf(state);
  const set = pool(filter);
  const current = questionById(state.practiceQuestionId);
  const q = set.some(x => x.id === current.id) ? current : nextQuestion(state, filter) ?? current;
  useEffect(() => { if (q.id !== state.practiceQuestionId) commit(s => ({...s, practiceQuestionId: q.id})); }, [q.id]);
  const [hint, setHint] = useState(false); const [showSolution, setShowSolution] = useState(false);
  useEffect(() => { setHint(false); setShowSolution(false); }, [q.id]);
  const draft = state.drafts[q.id] ?? {selected: null, checkedAttemptId: null, elapsedMs: 0};
  const checked = state.attempts.find(a => a.id === draft.checkedAttemptId);
  const first = firstAttempts(state);
  const tried = set.filter(x => first.has(x.id)).length;
  const blocked = testInProgress(state);
  const setFilter = (patch: Partial<typeof filter>) => {
    const next = {...filter, ...patch};
    if (patch.section && patch.section !== filter.section) next.skill = 'All skills';
    const nq = nextQuestion(state, next);
    commit(s => ({...s, practice: next, ...(nq ? {practiceQuestionId: nq.id} : {})}));
  };
  const go = (target?: Question) => { if (target) commit(s => ({...s, practiceQuestionId: target.id})); };
  const check = () => {
    if (!hasAnswer(draft.selected) || checked) return;
    const a: Attempt = {id: uid(), questionId: q.id, selected: draft.selected, correct: grade(q, draft.selected), mode: 'practice', sessionId: null, flagged: false, elapsedMs: draft.elapsedMs, submittedAt: Date.now()};
    commit(s => ({...s, attempts: [...s.attempts, a], reviewAttemptId: a.id, drafts: {...s.drafts, [q.id]: {...draft, checkedAttemptId: a.id}}}));
  };
  const retries = state.attempts.filter(a => a.questionId === q.id).length;
  if (blocked) return <><Intro tag="PRACTICE" title="Finish your test first.">Practice and AI help reopen when your test is done.</Intro><div className="card"><p>You have a practice test in progress. Finish it or stop it to return to practice.</p><button className="primary spaced" onClick={() => navigate('test')}>Return to test →</button></div></>;
  return <>
    <Intro tag="PRACTICE" title="One question at a time.">Choose a skill, or let adaptive mode pick the right level for you.</Intro>
    <PlanBanner store={store} now={now} navigate={navigate} notify={notify}/>
    <div className="practice-controls">
      <div className="tabs" aria-label="Practice section">{(['rw', 'math'] as Subject[]).map(section => <button key={section} className={filter.section === section ? 'active' : ''} aria-pressed={filter.section === section} onClick={() => setFilter({section})}>{sectionName(section)}</button>)}</div>
      <label>Skill<select value={filter.skill} onChange={e => setFilter({skill: e.target.value})}><option value="All skills">All skills</option>{DOMAINS[filter.section].map(d => <optgroup key={d.domain} label={d.domain}><option value={d.domain}>All of {d.domain}</option>{d.skills.map(skill => <option key={skill} value={skill}>{skill}</option>)}</optgroup>)}</select></label>
      <label>Level<select value={filter.adaptive ? 'Adaptive' : filter.difficulty} onChange={e => setFilter(e.target.value === 'Adaptive' ? {adaptive: true, difficulty: 'Any'} : {adaptive: false, difficulty: e.target.value as typeof filter.difficulty})}><option value="Adaptive">Adaptive (recommended)</option><option value="Any">Any level</option><option value="Easy">Easy</option><option value="Medium">Medium</option><option value="Hard">Hard</option></select></label>
    </div>
    <div className="study"><section className="card question">
      <div className="row"><span className="pill">{q.skill} · {q.difficulty}{q.type === 'spr' ? ' · Typed answer' : ''}</span><span className="muted"><span aria-label="Time spent on this question">{clock(draft.elapsedMs)}</span></span></div>
      <QuestionBody question={q}/>
      <AnswerInput question={q} selected={draft.selected} reveal={!!checked} locked={!!checked} onSelect={selected => commit(s => ({...s, drafts: {...s.drafts, [q.id]: {...draft, selected, checkedAttemptId: null}}}))}/>
      {hint && !checked && <div className="feedback" role="status"><strong>A small nudge</strong><p><MathText text={q.hint}/></p></div>}
      {checked && <div className={`feedback ${checked.correct ? 'right' : 'miss'}`} role="status"><strong>{checked.correct ? '✓ That’s right.' : q.type === 'spr' ? `Not quite. Accepted answer: ${(q.answers ?? [])[0]}` : '↻ Good opportunity to learn.'}</strong>
        <WrongChoiceNote question={q} selected={checked.selected}/>
        <p><MathText text={q.steps.map(s => s[1]).join(' ')}/></p><small>{retries > 1 ? 'Retry saved. Your first attempt is kept for your stats.' : 'First attempt saved.'}</small></div>}
      <div className="row questionfooter">{!checked ? <><button aria-expanded={hint} onClick={() => setHint(!hint)}>✧ {hint ? 'Hide hint' : 'Hint'}</button><button className="primary" disabled={!hasAnswer(draft.selected)} onClick={check}>Check answer →</button></> : <><button onClick={() => setShowSolution(!showSolution)} aria-expanded={showSolution}>{showSolution ? 'Hide full solution' : 'Full solution'}</button><button className="primary" onClick={() => go(nextQuestion(state, filter, q.id))}>Next question →</button></>}</div>
      <div className="row spaced practice-actions">
        {!checked && <button onClick={() => go(nextQuestion(state, filter, q.id))}>Skip →</button>}
        {checked && <button onClick={() => go(moreLikeThis(state, q))}>More like this</button>}
        {checked && <button onClick={() => commit(s => ({...s, drafts: {...s.drafts, [q.id]: {selected: null, checkedAttemptId: null, elapsedMs: 0}}}))}>Try again</button>}
        <button onClick={() => {commit(s => openTutor(s, q.id)); navigate('tutor');}}>✦ Ask the tutor</button>
        {q.work && checked && <button onClick={() => {commit(s => ({...s, intelligence: {...intelligenceOf(s), workQuestionId: q.id, workDraft: ''}})); navigate('work');}}>Check my steps</button>}
      </div>
    </section>
    <section>
      {q.section === 'math' && <div className="card"><span className="eyebrow">TEST-DAY TOOLS</span><MathTools/></div>}
      <div className={`card ${q.section === 'math' ? 'spaced' : ''}`}><span className="eyebrow">THIS SET</span><h2 className="solution-title">{filter.skill === 'All skills' ? `All ${sectionName(filter.section)} skills` : filter.skill}</h2>
        <div className="bar spaced"><i style={{width: `${set.length ? tried / set.length * 100 : 0}%`}}/></div><small className="muted">{tried} of {set.length} questions tried{filter.adaptive ? ` · adaptive level: ${adaptiveLevel(state, filter)}` : ''}</small>
        {filter.adaptive && <p className="caption spaced">Adaptive mode moves you up a level after a correct answer and down after a miss.</p>}</div>
      {checked && showSolution && <div className="spaced"><Solution question={q} selected={checked.selected}/></div>}
    </section></div>
  </>;
}

// ---------------- Test ----------------
export function TestScreen({store, now, navigate, notify, onReview}: Props & {onReview: (scope: string) => void}) {
  const {state, commit} = store;
  const dialog = useRef<HTMLDialogElement>(null); const submitButton = useRef<HTMLButtonElement>(null);
  const test = state.sessions.find(s => s.id === state.activeSessionId);
  const run = runOf(state, test);
  const ended = !test || ['submitted', 'expired'].includes(test.status);
  const update = (change: (s: Session, time: number) => Session) => commit(s => {
    const active = s.sessions.find(t => t.id === s.activeSessionId); if (!active) return s;
    const time = Date.now();
    if (active.status === 'running' && remaining(active, time) === 0) return finishModule(s, active.id, time);
    return {...s, sessions: s.sessions.map(t => t.id === active.id ? change(t, time) : t)};
  });
  const finish = () => {
    if (!test) return;
    const wasLast = !run || run.moduleSessionIds.length >= runPlan(run).length;
    commit(s => finishModule(s, test.id, Date.now()));
    dialog.current?.close();
    if (wasLast) { onReview(run ? `run:${run.id}` : test.id); notify('Test submitted. Your answers are ready to review.'); }
    else notify('Module submitted. The next module is ready when you are.');
  };
  const begin = (factory: (s: State) => State) => commit(s => factory(s));
  if (!test || (ended && !(run?.status === 'active'))) return <TestPicker state={state} lastEnded={test && ended ? test : undefined} onReview={onReview}
    onStart={(kind, sections) => { begin(s => kind === 'quick' ? (() => { const t = quickCheck(Date.now()); return {...s, sessions: [...s.sessions, t], activeSessionId: t.id}; })() : startRun(s, kind, sections, Date.now())); notify(''); }}
    onTopic={topicId => { begin(s => { const t = createTopicSession(topicId); return {...s, sessions: [...s.sessions, t], activeSessionId: t.id}; }); notify(''); }}/>;
  const index = test.currentIndex; const question = questionById(test.questionIds[index]);
  const running = test.status === 'running'; const timeLeft = remaining(test, now);
  const answered = test.questionIds.filter(id => hasAnswer(test.answers[id] ?? null)).length;
  const plan = run ? runPlan(run) : []; const step = run ? run.moduleSessionIds.indexOf(test.id) : 0;
  const betweenSections = run && step > 0 && plan[step].section !== plan[step - 1].section;
  if (test.status === 'ready') return <>
    <Intro tag="PRACTICE TEST" title={sessionTitle(test)}>{test.questionIds.length} questions · {clock(test.remainingMs)} on the clock{run ? ` · part ${step + 1} of ${plan.length}` : ''}</Intro>
    <div className="card"><h2>{step === 0 ? 'Ready when you are.' : betweenSections ? 'Section complete. Take a short break.' : 'Module 1 complete.'}</h2>
      <p className="muted spaced">{betweenSections ? 'On test day you get a 10-minute break between Reading and Writing and Math. Stretch, drink some water, and start Math when you’re ready.' : step > 0 ? `Your Module 2 is ${test.config?.tier === 'harder' ? 'the harder version' : 'the easier version'}, chosen from how you did on Module 1, just like the real adaptive SAT.` : 'The timer starts when you begin. You can move between questions and mark any for review.'}</p>
      <ul className="spaced test-rules"><li>Typed-answer math questions accept fractions or decimals.</li><li>{test.config?.section === 'math' || test.config?.section === 'mixed' ? 'The calculator and reference sheet are available in Math.' : 'No calculator is used in Reading and Writing.'}</li><li>Hints and AI help are paused until the test ends.</li></ul>
      <div className="row spaced"><button className="primary" onClick={() => update((s, time) => resumeSession(s, time))}>Begin {test.config?.kind === 'module' ? `module` : 'test'} →</button>{run && <button onClick={() => { if (confirm('Stop this test? Answers so far are saved and graded, and no more modules start.')) { commit(s => stopRun(s, run.id, Date.now())); onReview(`run:${run.id}`); } }}>Stop test</button>}</div></div>
  </>;
  return <>
    <div className="testhead row"><div><strong>{sessionTitle(test)}</strong><p className="muted">{answered} of {test.questionIds.length} answered · {test.flags.length} marked{run ? ` · part ${step + 1} of ${plan.length}` : ''}</p></div>
      <div className="row"><span className={`timer ${timeLeft <= 5 * 60000 ? 'low-time' : ''}`} aria-label={`${clock(timeLeft)} remaining`}>{clock(timeLeft)}</span><button onClick={() => update((s, time) => s.status === 'running' ? pauseSession(s, time) : resumeSession(s, time))}>{running ? 'Pause' : 'Resume'}</button></div></div>
    <p className="sr-only" role="status">{running && timeLeft <= 60000 ? 'One minute or less remaining.' : running && timeLeft <= 5 * 60000 ? 'Five minutes or less remaining.' : ''}</p>
    {test.status === 'paused' && <div className="feedback ready-note" role="status">Paused. The real SAT can’t be paused, but at home you can. Resume to keep going.</div>}
    <div className="study"><section className="card question"><div className="row"><span className="pill">Question {index + 1} of {test.questionIds.length}</span><button disabled={!running} aria-pressed={test.flags.includes(question.id)} onClick={() => update(s => ({...s, flags: s.flags.includes(question.id) ? s.flags.filter(id => id !== question.id) : [...s.flags, question.id]}))}>{test.flags.includes(question.id) ? '⚑ Marked for review' : '⚐ Mark for review'}</button></div>
      <QuestionBody question={question}/>
      <AnswerInput question={question} selected={test.answers[question.id] ?? null} locked={!running} onSelect={selected => update(s => s.status !== 'running' ? s : {...s, answers: {...s.answers, [question.id]: selected}})}/>
      <div className="row questionfooter"><button disabled={index === 0} onClick={() => update((s, time) => navigateSession(s, index - 1, time))}>← Back</button>{index < test.questionIds.length - 1 ? <button className="primary" onClick={() => update((s, time) => navigateSession(s, index + 1, time))}>Next →</button> : <button className="primary" onClick={() => dialog.current?.showModal()}>Finish {run ? 'module' : 'test'} →</button>}</div></section>
    <section>{question.section === 'math' && <div className="card"><MathTools/></div>}
      <div className={`card ${question.section === 'math' ? 'spaced' : ''}`}><h3>Question navigator</h3><div className="navgrid">{test.questionIds.map((id, i) => { const a = hasAnswer(test.answers[id] ?? null); const flag = test.flags.includes(id); return <button key={id} aria-label={`Question ${i + 1}${a ? ', answered' : ', unanswered'}${flag ? ', marked' : ''}`} aria-current={index === i ? 'step' : undefined} className={`${a ? 'answered' : ''} ${index === i ? 'current' : ''} ${flag ? 'flag' : ''}`} onClick={() => update((s, time) => navigateSession(s, i, time))}>{i + 1}{flag && <span className="flag-symbol"> ⚑</span>}</button>; })}</div>
        <p className="legend">Filled: answered · Dark: current · ⚑ marked</p><button ref={submitButton} className="spaced" onClick={() => dialog.current?.showModal()}>Finish {run ? 'module' : 'test'}</button><p className="legend spaced">{store.error ? 'Save failed · export a backup' : store.syncStatus ?? 'Answers save on this device.'}</p></div></section></div>
    <dialog ref={dialog} aria-labelledby="submit-title" onClose={() => submitButton.current?.focus()}><h2 id="submit-title">Finish this {run ? 'module' : 'test'}?</h2><p>{test.questionIds.length - answered} unanswered · {test.flags.length} marked. {run && step < plan.length - 1 ? 'You can’t return to this module after you submit.' : 'Submitting ends the test and opens your results.'}</p><div className="row"><button autoFocus onClick={() => dialog.current?.close()}>Keep working</button><button className="primary" onClick={finish}>Submit</button></div></dialog>
  </>;
}
function TestPicker({state, lastEnded, onStart, onTopic, onReview}: {state: State; lastEnded?: Session; onStart: (kind: 'quick' | 'full' | 'section', sections: Subject[]) => void; onTopic: (topicId: string) => void; onReview: (scope: string) => void}) {
  const [topicSection, setTopicSection] = useState<Subject>('math');
  const rw = moduleSize('rw'), math = moduleSize('math');
  const lastRun = lastEnded ? runOf(state, lastEnded) : undefined;
  const sessions = lastRun ? lastRun.moduleSessionIds.map(id => state.sessions.find(s => s.id === id)!).filter(Boolean) : lastEnded ? [lastEnded] : [];
  const minutes = (ms: number) => Math.round(ms / 60000);
  const options: {kind: 'quick' | 'full' | 'section'; sections: Subject[]; title: string; detail: string}[] = [
    {kind: 'full', sections: ['rw', 'math'], title: 'Full-length adaptive test', detail: `4 modules · ${2 * rw} Reading & Writing + ${2 * math} Math questions · about ${minutes(2 * moduleMs('rw', rw) + 2 * moduleMs('math', math))} minutes plus a break`},
    {kind: 'section', sections: ['rw'], title: 'Reading & Writing section', detail: `2 adaptive modules · ${2 * rw} questions · ${minutes(2 * moduleMs('rw', rw))} minutes`},
    {kind: 'section', sections: ['math'], title: 'Math section', detail: `2 adaptive modules · ${2 * math} questions · ${minutes(2 * moduleMs('math', math))} minutes · calculator allowed`},
    {kind: 'quick', sections: [], title: 'Quick check', detail: '10 mixed questions · 13 minutes'},
  ];
  return <>
    <Intro tag="PRACTICE TESTS" title="Rehearse test day.">Timed like the Digital SAT. Module 2 gets harder or easier based on how you do in Module 1.</Intro>
    {sessions.length > 0 && <div className="card results-card"><span className="eyebrow">LATEST RESULTS</span><h2>{sessions.reduce((n, s) => n + state.attempts.filter(a => a.sessionId === s.id && a.correct).length, 0)} of {sessions.reduce((n, s) => n + s.questionIds.length, 0)} correct</h2>
      <div className="module-results">{sessions.map(s => <div key={s.id}><span>{sessionTitle(s)}</span><strong>{state.attempts.filter(a => a.sessionId === s.id && a.correct).length} / {s.questionIds.length}</strong>{s.status === 'expired' && <small>Time ran out</small>}</div>)}</div>
      <p className="caption">We don’t convert this to an SAT score yet: a reliable estimate needs many more student results to calibrate the questions.</p>
      <button className="primary spaced" onClick={() => onReview(lastRun ? `run:${lastRun.id}` : lastEnded!.id)}>Review answers →</button></div>}
    <div className="test-options">{options.map(o => <article key={o.title} className="card test-option"><h2 className="solution-title">{o.title}</h2><p className="muted">{o.detail}</p><button className={o.kind === 'full' ? 'primary' : ''} onClick={() => onStart(o.kind, o.sections)}>Start →</button></article>)}</div>
    <h2 className="spaced section-heading">Topic practice</h2><p className="muted">25 questions from one SAT domain, timed: 40 minutes for Math topics, 30 for Reading and Writing.</p>
    <div className="tabs spaced" aria-label="Topic section">{(['math', 'rw'] as Subject[]).map(sec => <button key={sec} aria-pressed={topicSection === sec} className={topicSection === sec ? 'active' : ''} onClick={() => setTopicSection(sec)}>{sectionName(sec)}</button>)}</div>
    <div className="test-options topic-options">{testTopics.filter(t => t.section === topicSection).map(t => <article key={t.id} className="card test-option"><span className="topic-icon" aria-hidden="true">{t.icon}</span><h3>{t.name}</h3><p className="muted small">{t.description}</p><button aria-label={`Start ${t.name} topic practice`} onClick={() => onTopic(t.id)}>Start 25 questions →</button></article>)}</div>
    {(rw < REAL.rw.size || math < REAL.math.size) && <p className="caption spaced">Modules are currently {rw} of {REAL.rw.size} (Reading & Writing) and {math} of {REAL.math.size} (Math) questions, at real SAT pacing. They grow to full length as new questions are added.</p>}
  </>;
}

// ---------------- Review ----------------
export function Review({store, navigate, scope, setScope, notify}: Props & {scope: string; setScope: (s: string) => void}) {
  const {state, commit} = store;
  const [filter, setFilter] = useState('all');
  const ended = [...state.sessions].reverse().filter(s => ['submitted', 'expired'].includes(s.status));
  const runs = [...(state.runs ?? [])].reverse().filter(r => r.status === 'complete');
  const loose = ended.filter(s => !s.config?.runId);
  const runSessions = (id: string) => state.runs?.find(r => r.id === id)?.moduleSessionIds ?? [];
  const scoped = scope === 'latest' ? state.attempts : scope === 'practice' ? state.attempts.filter(a => a.mode === 'practice') : scope.startsWith('run:') ? state.attempts.filter(a => a.sessionId && runSessions(scope.slice(4)).includes(a.sessionId)) : state.attempts.filter(a => a.sessionId === scope);
  const list = [...scoped].reverse().filter(a => filter === 'all' || (filter === 'incorrect' ? !a.correct : a.flagged));
  const attempt = list.find(a => a.id === state.reviewAttemptId) ?? list[0];
  const q = attempt ? questionById(attempt.questionId) : null;
  const label = (a: Attempt) => `${plain(questionById(a.questionId).skill)} · ${a.selected === null || a.selected === '' ? 'Unanswered' : a.correct ? 'Correct' : 'Incorrect'} · ${a.mode} · ${new Date(a.submittedAt).toLocaleString()}`;
  return <>
    <Intro tag="REVIEW" title="Make the next one click.">Go through your answers, see why each wrong choice is tempting, and leave a note for next time.</Intro>
    {state.attempts.length === 0 ? <div className="card"><h2>Your learning story starts here.</h2><p className="muted spaced">Check a practice answer or finish a test to review it here.</p><button className="primary spaced" onClick={() => navigate('practice')}>Start practicing →</button></div> : <>
      <div className="review-controls"><label>Show attempts from<select value={scope} onChange={e => {setScope(e.target.value); commit(s => ({...s, reviewAttemptId: null}));}}><option value="latest">Everything · newest first</option><option value="practice">Practice only</option>{runs.map(r => <option key={r.id} value={`run:${r.id}`}>{r.kind === 'full' ? 'Full-length test' : `${r.sections[0] === 'rw' ? 'Reading & Writing' : 'Math'} section`} · {new Date(r.startedAt).toLocaleString()}</option>)}{loose.map(s => <option key={s.id} value={s.id}>{sessionTitle(s)} · {new Date(s.submittedAt!).toLocaleString()}</option>)}</select></label>
        <label>Filter<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All outcomes</option><option value="incorrect">Incorrect & unanswered</option><option value="flagged">Marked for review</option></select></label>
        <label>Question<select value={attempt?.id ?? ''} onChange={e => commit(s => ({...s, reviewAttemptId: e.target.value}))}>{list.length === 0 && <option value="">No matching attempts</option>}{list.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)}</select></label></div>
      {attempt && q ? <><div className="review-summary muted">{attempt.mode === 'test' ? 'Test answer' : 'Practice answer'} · {new Date(attempt.submittedAt).toLocaleString()} · {clock(attempt.elapsedMs)} spent{attempt.flagged ? ' · ⚑ Marked for review' : ''}</div>
        <div className="grid"><section className="card question"><div className="row"><span className="pill">{attempt.selected === null || attempt.selected === '' ? 'Unanswered' : attempt.correct ? '✓ Correct' : '↻ Worth another look'}</span><span className="muted">{q.skill} · {q.difficulty}</span></div>
          <QuestionBody question={q}/><AnswerInput question={q} selected={attempt.selected} locked reveal/>
          {q.type === 'spr' && <p className="spaced">Your answer: <strong>{answerLabel(q, attempt.selected)}</strong></p>}
          <WrongChoiceNote question={q} selected={attempt.selected}/>
          <div className="spaced"><label htmlFor="reflection"><h3>What will you try next time?</h3></label><textarea id="reflection" maxLength={5000} value={state.reflections[q.id]?.text ?? ''} placeholder="Write a note to your future self…" onChange={e => {const text = e.target.value; commit(s => ({...s, reflections: {...s.reflections, [q.id]: {text, updatedAt: Date.now()}}}));}}/><div className="row"><span role="status" className="small muted">{store.error ? 'Not saved · see the message above' : store.syncStatus ?? 'Notes save automatically as you type'}</span></div></div></section>
        <section><Solution question={q} selected={attempt.selected}/>
          <div className="review-actions"><button className="primary" onClick={() => { const next = moreLikeThis(state, q); if (next) commit(s => ({...s, practice: {section: q.section, skill: q.skill, difficulty: 'Any', adaptive: true}, practiceQuestionId: next.id})); navigate('practice'); }}>Practice this skill →</button>
            <button onClick={() => {commit(s => openTutor(s, q.id)); navigate('tutor');}}>✦ Talk it through with the tutor</button>
            <button onClick={() => {commit(s => ({...s, companion: {...companionOf(s), analysisAttemptId: attempt.id}})); navigate('analysis');}}>Reflect on this mistake →</button></div></section></div></> : <div className="card"><h2>No matching attempts.</h2><p className="muted spaced">Choose another set or show all outcomes.</p></div>}</>}
  </>;
}
