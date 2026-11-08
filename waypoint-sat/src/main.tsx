import {Brand} from './Brand';
import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {questions, allQuestions, questionById} from './data/questions';
import {STORAGE_KEY, emptyState, parseState, uid, createSession, remaining, resumeSession, pauseSession, navigateSession, finishSession, activityStats, localDay, dayOffset, type State, type Route, type Attempt, type Session, type Choice} from './model';
import './styles.css';
import './accessibility.css';
import './companion.css';
import './navigation.css';
import {Intro, Choices, Solution} from './StudyComponents';
import {CompanionScreens} from './CompanionScreens';
import {IntelligenceScreens} from './IntelligenceScreens';
import {TopicTests} from './TopicTests';
import {topicById} from './data/test-topics';
import {AssistantScreen} from './AssistantScreen';
import {companionOf, freshTutor, openTutor, testInProgress} from './companion-model';
import {loadServerSnapshot, useServerStore, clearServerCache, SignInRequired, type ProgressStore, type ServerSnapshot} from './server-store';
import {AuthScreen, fetchAccount, signOutRequest, resetTokenFromHash, type AccountUser} from './auth';
import './auth.css';

const keys = Object.fromEntries(allQuestions.map(q => [q.id, q.correct]));
const studioRoutes: Route[] = ['dashboard','practice','test','review'];
const companionRoutes: Route[] = ['plan','tutor','analysis','assistant'];
const intelligenceRoutes: Route[] = ['adaptive','work','pacing','similar','weekly','handwriting'];
const routes: Route[] = [...studioRoutes,...companionRoutes,...intelligenceRoutes];
const routeLabels: Record<Route,string> = {dashboard:'Dashboard',practice:'Question Practice',test:'Practice Test',review:'Answer Review',plan:'Daily Plan',tutor:'Guided Tutor',analysis:'Mistake Analysis',adaptive:'Adaptive Practice',work:'Explain My Work',pacing:'Pacing Coach',similar:'Similar Questions',weekly:'Weekly Summary',handwriting:'Handwritten Work',assistant:'AI Assistant'};
const getRoute = (): Route => routes.includes(location.hash.slice(1) as Route) ? location.hash.slice(1) as Route : 'dashboard';
const clock = (ms: number) => { const seconds = Math.ceil(ms / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
function download(value: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function useLocalStore() {
  const initial = useRef<{state: State; error: string; damaged: string | null} | null>(null);
  if (!initial.current) {
    try { const raw = localStorage.getItem(STORAGE_KEY); initial.current = {state: raw ? parseState(raw) : emptyState(), error: '', damaged: null}; }
    catch (error) {
      let damaged: string | null = null; try { damaged = localStorage.getItem(STORAGE_KEY); } catch { /* Storage denied. */ }
      initial.current = {state: emptyState(), error: `Saved progress could not be read. ${String(error)}`, damaged};
    }
  }
  const [state, setState] = useState(initial.current.state);
  const current = useRef(state);
  const [error, setError] = useState(initial.current.error);
  const damaged = useRef(initial.current.damaged);
  const commit = (update: (s: State) => State) => {
    const next = update(current.current);
    if (next === current.current) return;
    current.current = next; setState(next);
    try {
      if (damaged.current !== null) throw new Error('Existing damaged data is preserved. Export it, then choose Start fresh to enable saving.');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setError('');
    } catch (e) { setError(`Changes are only in memory. Keep this tab open and export a backup. ${String(e)}`); }
  };
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try { const next = parseState(event.newValue); current.current = next; setState(next); setError(''); }
      catch { setError('Another tab wrote unreadable progress. Keep this tab open and export a backup.'); }
    };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, []);
  return {state, current, commit, error, retry: () => {
    try { if (damaged.current !== null) throw new Error('Export the preserved data and choose Start fresh first.'); localStorage.setItem(STORAGE_KEY, JSON.stringify(current.current)); setError(''); } catch (e) { setError(`Unable to save. ${String(e)}`); }
  }, exportData: () => download(damaged.current ?? JSON.stringify(current.current, null, 2), 'preporbit-ai-progress.json'), reset: () => {
    damaged.current = null; commit(() => emptyState());
  }};
}

function App({store}: {store: ProgressStore}) {
  const {state, commit} = store;
  const importInput = useRef<HTMLInputElement>(null);
  const [route, setRoute] = useState<Route>(getRoute);
  const isCompanion = companionRoutes.includes(route);
  const isIntelligence = intelligenceRoutes.includes(route);
  const [menuOpen,setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false),[route]);
  const [now, setNow] = useState(Date.now());
  const [hint, setHint] = useState(false);
  const [notice, setNotice] = useState('');
  const [reviewScope, setReviewScope] = useState('latest');
  const [reviewFilter, setReviewFilter] = useState('all');
  const dialog = useRef<HTMLDialogElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const test = state.sessions.find(s => s.id === state.activeSessionId);
  const q = questionById(state.practiceQuestionId);
  const draft = state.drafts[q.id] ?? {selected: null, checkedAttemptId: null, elapsedMs: 0};
  const checkedAttempt = state.attempts.find(a => a.id === draft.checkedAttemptId);
  const practiceRef = useRef({route, id: q.id}); practiceRef.current = {route, id: q.id};
  const navigate = (next: Route) => { if (next === route) return; location.hash = next; };
  useEffect(() => { const change = () => setRoute(getRoute()); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => { document.title = `PrepOrbit AI · ${routeLabels[route]}`; document.getElementById('page-title')?.focus({preventScroll: true}); window.scrollTo(0, 0); }, [route]);
  useEffect(() => { setHint(false); }, [q.id]);
  useEffect(() => {
    const tick = () => {
      const time = Date.now(); setNow(time);
      const s = store.current.current;
      const active = s.sessions.find(t => t.id === s.activeSessionId);
      if (active?.status === 'running' && remaining(active, time) === 0) {
        commit(prev => finishSession(prev, active.id, time, keys));
        dialog.current?.close(); setReviewScope(active.id); setNotice(active.topicId ? 'Time is up. Your practice test was submitted automatically.' : 'Time is up. Your demo was submitted automatically.');
        location.hash = 'review';
      }
    };
    tick(); const timer = window.setInterval(tick, 500);
    window.addEventListener('focus', tick); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, []);
  useEffect(() => {
    let previous = Date.now();
    const timer = window.setInterval(() => {
      const time = Date.now(); const delta = Math.min(1500, time - previous); previous = time;
      if (document.visibilityState !== 'visible') return;
      if (practiceRef.current.route === 'tutor') {
        commit(s => {if (testInProgress(s)) return s; const c = companionOf(s); const id = c.tutorQuestionId; const t = c.tutor[id] ?? freshTutor(); if (t.checkedAttemptId) return s; return {...s,companion:{...c,tutor:{...c.tutor,[id]:{...t,elapsedMs:t.elapsedMs + delta}}}};});
        return;
      }
      if (practiceRef.current.route !== 'practice') return;
      const id = practiceRef.current.id;
      commit(s => { const d = s.drafts[id] ?? {selected: null, checkedAttemptId: null, elapsedMs: 0}; if (d.checkedAttemptId) return s; return {...s, drafts: {...s.drafts, [id]: {...d, elapsedMs: d.elapsedMs + delta}}}; });
    }, 1000); return () => clearInterval(timer);
  }, []);
  const updateTest = (change: (s: Session, now: number) => Session) => commit(s => {
    const active = s.sessions.find(t => t.id === s.activeSessionId); if (!active) return s;
    const time = Date.now();
    if (active.status === 'running' && remaining(active, time) === 0) {
      dialog.current?.close(); setReviewScope(active.id); setReviewFilter('all');
      setNotice(active.topicId ? 'Time is up. Your practice test was submitted automatically.' : 'Time is up. Your demo was submitted automatically.'); location.hash = 'review';
      return finishSession(s, active.id, time, keys);
    }
    return {...s, sessions: s.sessions.map(t => t.id === active.id ? change(t, time) : t)};
  });
  const newTest = () => {
    const session = createSession(questions.map(q => q.id));
    commit(s => ({...s, sessions: [...s.sessions, session], activeSessionId: session.id}));
    setNotice('A fresh demo is ready. Earlier results remain in Answer Review.');
  };
  const finish = () => {
    if (!test) return;
    commit(s => finishSession(s, test.id, Date.now(), keys));
    dialog.current?.close(); setReviewScope(test.id); setReviewFilter('all'); navigate('review');
    setNotice('Demo submitted. Review your actual answers below.');
  };
  const check = () => {
    if (draft.selected === null || checkedAttempt) return;
    const a: Attempt = {id: uid(), questionId: q.id, selected: draft.selected, correct: q.correct === draft.selected, mode: 'practice', sessionId: null, flagged: false, elapsedMs: draft.elapsedMs, submittedAt: Date.now()};
    commit(s => ({...s, attempts: [...s.attempts, a], reviewAttemptId: a.id, drafts: {...s.drafts, [q.id]: {...draft, checkedAttemptId: a.id}}}));
  };
  const choosePractice = (id: string) => commit(s => ({...s, practiceQuestionId: id}));
  const stats = activityStats(state, now);
  const originalFirstCount=stats.first.filter(a=>questions.some(q=>q.id===a.questionId)).length;
  const accuracy = (attempts: Attempt[]) => attempts.length ? `${Math.round(attempts.filter(a => a.correct).length / attempts.length * 100)}%` : '—';
  const tasks = [
    {title: 'Find your algebra rhythm', detail: 'Math · check one answer', done: stats.todayAttempts.some(a => questionById(a.questionId).section === 'math'), action: () => {choosePractice('wp-math-001'); navigate('practice');}, label: 'Practice →'},
    {title: 'Connect the ideas', detail: 'Reading & Writing · check one answer', done: stats.todayAttempts.some(a => questionById(a.questionId).section === 'rw'), action: () => {choosePractice('wp-rw-001'); navigate('practice');}, label: 'Practice →'},
    {title: 'Turn a mistake into a win', detail: 'Review an attempt · save a reflection', done: stats.reflectedToday, action: () => {setReviewScope('latest'); navigate('review');}, label: 'Review →'},
  ];
  const dashboard = <>
    <Intro tag="YOUR DAILY CHECK-IN" title="Small steps. Real progress.">Welcome{state.attempts.length ? ' back' : ''}. Let’s make today count.</Intro>
    <div className="grid"><section><div className="card hero"><div className="row"><span className="eyebrow">ESTIMATED SAT SCORE</span><span className="pill">Local study progress</span></div><div className="score unavailable">Not available</div><p className="muted">A validated scoring method is needed before estimating a score.</p><div className="activity-chart" role="img" aria-label={`Answers checked over the last seven days: ${Array.from({length: 7}, (_, i) => { const day = localDay(dayOffset(now, i - 6)); return `${day}: ${state.attempts.filter(a => localDay(a.submittedAt) === day && a.selected !== null).length}`; }).join(', ')}`}>
      {Array.from({length: 7}, (_, i) => {const day = dayOffset(now, i - 6); const count = state.attempts.filter(a => localDay(a.submittedAt) === localDay(day) && a.selected !== null).length; const max = Math.max(1, ...Array.from({length: 7}, (_, j) => state.attempts.filter(a => localDay(a.submittedAt) === localDay(dayOffset(now, j - 6)) && a.selected !== null).length)); return <div className="chart-column" key={i}><span>{count}</span><div className="chart-track"><i style={{height: `${count / max * 100}%`}} /></div><small>{new Date(day).toLocaleDateString(undefined, {weekday: 'short'})}</small></div>;})}
    </div><div className="row muted chart-caption"><span>LAST 7 DAYS</span><span>ANSWERS CHECKED · INCLUDES RETRIES</span></div></div>
    <div className="card spaced"><div className="row"><h2>Your plan for today</h2><span className="pill">{tasks.filter(t => t.done).length} of 3 complete</span></div>{tasks.map((t, i) => <div className="task" key={t.title}><span className="num">{t.done ? '✓' : i + 1}</span><div><h3>{t.title}</h3><small>{t.done ? 'Completed today' : t.detail}</small></div><button className={i === 0 ? 'primary' : ''} onClick={t.action}>{t.label}</button></div>)}</div></section>
    <section><div className="card"><div className="row"><h2>Keep the spark.</h2><span className="sun" aria-hidden="true">☀</span></div><p className="muted">{stats.streak ? <>You’ve practiced <strong>{stats.streak} {stats.streak === 1 ? 'day' : 'days'} in a row.</strong></> : 'Your first question starts a new streak.'}</p><div className="days">{Array.from({length: 7}, (_, i) => {const day = dayOffset(now, i - 6); const active = stats.days.has(localDay(day)); return <div className="day" key={i} aria-label={`${new Date(day).toLocaleDateString()}: ${active ? 'practiced' : 'no practice'}`}><span>{new Date(day).toLocaleDateString(undefined, {weekday: 'narrow'})}</span><b className={active ? 'complete' : ''}>{active ? '✓' : '·'}</b></div>;})}</div><p className="small">Check a practice answer or submit an answered demo question to keep your streak going.</p></div>
    <div className="card spaced"><h2>Skills in motion</h2><div className="stats">{(['math', 'rw'] as const).map(subject => {const attempts = stats.first.filter(a => questionById(a.questionId).section === subject); return <div key={subject}><span className="muted">{subject === 'math' ? 'Math' : 'Reading & Writing'}</span><strong>{accuracy(attempts)}</strong><div className="bar"><i style={{width: attempts.length ? accuracy(attempts) : '0%'}} /></div><small>{attempts.length} first {attempts.length === 1 ? 'attempt' : 'attempts'}</small></div>;})}</div><p className="muted small spaced">First-attempt accuracy includes unanswered submitted questions. Retries never replace first attempts.</p></div>
    <div className="card spaced milestone"><span className="eyebrow">NEXT MILESTONE</span><h2 className="solution-title">Meet the test format.</h2><p className="muted">Try a short timed demo and build confidence.</p><button className="spaced" onClick={() => navigate('test')}>Open practice test →</button></div><div className="card spaced"><span className="eyebrow">LEARNING COMPANION</span><h2 className="solution-title">Make room for study.</h2><p className="muted">Choose a daily plan, work through progressive hints, and reflect on your reasoning.</p><button className="primary spaced" onClick={() => navigate('plan')}>Open daily plan →</button></div></section></div>
  </>;
  const practice = <>
    <Intro tag="FOCUSED PRACTICE" title="One question at a time.">Build understanding, then build speed.</Intro>
    <div className="tabs" aria-label="Practice subject">{(['math','rw'] as const).map(section => <button key={section} className={q.section === section ? 'active' : ''} aria-pressed={q.section === section} onClick={() => choosePractice(questions.find(q => q.section === section)!.id)}>{section === 'math' ? 'Math' : 'Reading & Writing'}</button>)}</div>
    <div className="study"><section className="card question"><div className="row"><span className="pill">{q.skill} · {q.difficulty}</span><span className="muted">Question {questions.filter(x => x.section === q.section).findIndex(x => x.id === q.id) + 1} of 2 · <span aria-label="Time spent on this practice question">{clock(draft.elapsedMs)}</span></span></div><p className="questiontext">{q.text}</p>
      <Choices question={q} selected={draft.selected} reveal={!!checkedAttempt} onSelect={selected => commit(s => ({...s, drafts: {...s.drafts, [q.id]: {...draft, selected, checkedAttemptId: null, elapsedMs: checkedAttempt ? 0 : draft.elapsedMs}}}))} />
      {hint && <div className="feedback" role="status"><strong>A small nudge</strong><p>{q.hint}</p></div>}
      {checkedAttempt && <div className="feedback" role="status"><strong>{checkedAttempt.correct ? '✓ That’s right.' : '↻ Good opportunity to learn.'}</strong><p>{q.steps.map(s => s[1]).join(' ')}</p><small>{state.attempts.filter(a => a.questionId === q.id).length > 1 ? 'Retry saved. Your first attempt is preserved.' : 'First attempt saved.'}</small></div>}
      <div className="row questionfooter"><button aria-expanded={hint} onClick={() => setHint(!hint)}>✧ {hint ? 'Hide hint' : 'Give me a hint'}</button>{checkedAttempt ? <button className="primary" onClick={() => {commit(s => ({...s, reviewAttemptId: checkedAttempt.id})); setReviewScope('latest'); setReviewFilter('all'); navigate('review');}}>Worked solution →</button> : <button className="primary" disabled={draft.selected === null} onClick={check}>Check answer →</button>}</div>
      <div className="row spaced"><button onClick={() => {const next = questions.filter(x => x.section === q.section).find(x => x.id !== q.id)!; choosePractice(next.id);}}>Next practice question →</button>{checkedAttempt && <button onClick={() => commit(s => ({...s, drafts: {...s.drafts, [q.id]: {selected: null, checkedAttemptId: null, elapsedMs: 0}}}))}>Try again</button>}</div>
    </section><section><div className="card"><span className="eyebrow">TODAY’S FOCUS</span><h2 className="solution-title">Understand the why.</h2><p className="muted">Take your time. Hints and explanations are here whenever you need them.</p><div className="bar spaced"><i style={{width: `${originalFirstCount / 4 * 100}%`}} /></div><small className="muted">{originalFirstCount} of 4 original questions attempted</small></div><div className="card spaced"><h3>A useful habit</h3><p className="muted spaced">Before choosing, say what the question is asking in your own words.</p><button className="spaced" onClick={() => {commit(s => openTutor(s,q.id)); navigate('tutor');}}>Open guided tutor →</button></div></section></div>
  </>;
  const ended = test && ['submitted', 'expired'].includes(test.status);
  const timeLeft = test ? remaining(test, now) : 300000;
  const testView = <>
    <div className="intro"><span className="eyebrow">QUICK INTERACTION DEMO</span><h2>Four questions. Five minutes.</h2><p className="muted">A short mixed-skills demo of the controls. Not a full SAT simulation.</p></div>
    <div className="testhead row"><div><strong>Mixed skills · Demo module</strong><p className="muted">Practice navigation and pacing · {test?.status ?? 'ready'}</p></div><div className="row"><span className={`timer ${timeLeft <= 60000 ? 'low-time' : ''}`} aria-label={`${clock(timeLeft)} remaining`}>{clock(timeLeft)}</span>{!ended && <button onClick={() => {
      if (!test) { const t = resumeSession(createSession(questions.map(q => q.id)), Date.now()); commit(s => ({...s, sessions: [...s.sessions, t], activeSessionId: t.id})); }
      else updateTest((s, time) => s.status === 'running' ? pauseSession(s, time) : resumeSession(s, time));
    }}>{test?.status === 'running' ? 'Pause demo' : test?.status === 'paused' ? 'Resume demo' : 'Begin demo'}</button>}</div></div>
    <p className="sr-only" role="status">{test?.status === 'running' && timeLeft <= 60000 ? timeLeft <= 10000 ? 'Ten seconds or less remaining.' : 'One minute or less remaining.' : ''}</p>
    {ended ? <div className="card"><span className="pill">{test.status === 'expired' ? 'Time expired · auto-submitted' : 'Demo complete'}</span><h2 className="spaced">{state.attempts.filter(a => a.sessionId === test.id && a.correct).length} of 4 correct</h2><p className="muted spaced">This short mixed-skills demo does not produce an estimated SAT score.</p><div className="row spaced"><button className="primary" onClick={() => {setReviewScope(test.id); setReviewFilter('all'); navigate('review');}}>Review demo answers →</button><button onClick={newTest}>Start a new demo</button></div></div> : <>
    {!test && <div className="feedback ready-note">Begin when you’re ready. The countdown continues across screens and reloads. Pause is available for this demo only. Questions and solutions also appear in focused practice.</div>}
    {test?.status === 'paused' && <div className="feedback ready-note" role="status">Demo paused. Resume to answer or change review flags.</div>}
    {(() => {const index = test?.currentIndex ?? 0; const question = questionById(test?.questionIds[index] ?? questions[0].id); const running = test?.status === 'running'; return <div className="study"><section className="card question"><div className="row"><span className="pill">Question {index + 1} of 4</span><button disabled={!running} aria-pressed={test?.flags.includes(question.id) ?? false} onClick={() => updateTest(s => ({...s, flags: s.flags.includes(question.id) ? s.flags.filter(id => id !== question.id) : [...s.flags, question.id]}))}>{test?.flags.includes(question.id) ? '⚑ Marked for review' : '⚐ Mark for review'}</button></div><p className="questiontext">{question.text}</p><Choices question={question} selected={test?.answers[question.id] ?? null} locked={!running} onSelect={selected => updateTest(s => s.status !== 'running' ? s : {...s, answers: {...s.answers, [question.id]: selected}})} />
    <div className="row questionfooter"><button disabled={!test || index === 0} onClick={() => updateTest((s, time) => navigateSession(s, index - 1, time))}>← Back</button>{index < 3 ? <button className="primary" disabled={!test} onClick={() => updateTest((s, time) => navigateSession(s, index + 1, time))}>Next question →</button> : <button className="primary" disabled={!test} onClick={() => dialog.current?.showModal()}>Finish module →</button>}</div></section><section className="card"><h3>Question navigator</h3><p className="muted">Move freely in this module.</p><div className="navgrid">{questions.map((question, i) => { const answered = test?.answers[question.id] != null; const flag = test?.flags.includes(question.id); return <button key={question.id} disabled={!test} aria-label={`Question ${i + 1}${answered ? ', answered' : ', unanswered'}${flag ? ', marked' : ''}`} aria-current={index === i ? 'step' : undefined} className={`${answered ? 'answered' : ''} ${index === i ? 'current' : ''} ${flag ? 'flag' : ''}`} onClick={() => updateTest((s, time) => navigateSession(s, i, time))}>{i + 1}{flag && <span className="flag-symbol"> ⚑</span>}</button>;})}</div><p className="legend">Filled: answered<br/>Dark: current<br/>Orange border and ⚑: marked</p><p className="muted spaced">{Object.values(test?.answers ?? {}).filter(a => a !== null).length} of 4 answered<br/>{test?.flags.length ?? 0} marked for review</p><button ref={submitButton} className="spaced" disabled={!test} onClick={() => dialog.current?.showModal()}>Finish module</button><p className="legend spaced">{store.error ? 'Save failed · export a backup' : store.syncStatus ?? 'Answers save on this device.'}</p></section></div>;})()}</>}
  </>;
  const scopes = [...state.sessions].reverse().filter(s => ['submitted', 'expired'].includes(s.status));
  const scoped = reviewScope === 'latest' ? state.attempts : state.attempts.filter(a => a.sessionId === reviewScope);
  const reviewAttempts = [...scoped].reverse().filter(a => reviewFilter === 'all' || (reviewFilter === 'incorrect' ? !a.correct : a.flagged));
  const reviewAttempt = reviewAttempts.find(a => a.id === state.reviewAttemptId) ?? reviewAttempts[0];
  const reviewQuestion = reviewAttempt ? questionById(reviewAttempt.questionId) : null;
  const review = <>
    <Intro tag="LEARN FROM EVERY ATTEMPT" title="Make the next one click.">Review your saved answers, understand the solution, and leave a note for next time.</Intro>
    {state.attempts.length === 0 ? <div className="card"><h2>Your learning story starts here.</h2><p className="muted spaced">Check a practice answer or finish the demo to see your actual attempt and a worked solution.</p><button className="primary spaced" onClick={() => navigate('practice')}>Start practicing →</button></div> : <>
    <div className="review-controls"><label>Session<select value={reviewScope} onChange={e => {setReviewScope(e.target.value); commit(s => ({...s, reviewAttemptId: null}));}}><option value="latest">All attempts · newest first</option>{scopes.map((s, i) => <option key={s.id} value={s.id}>{s.topicId ? topicById(s.topicId)?.name : `Demo ${scopes.length - i}`} · {new Date(s.submittedAt!).toLocaleString()}</option>)}</select></label><label>Show<select value={reviewFilter} onChange={e => setReviewFilter(e.target.value)}><option value="all">All outcomes</option><option value="incorrect">Incorrect & unanswered</option><option value="flagged">Marked for review</option></select></label><label>Attempt<select value={reviewAttempt?.id ?? ''} onChange={e => commit(s => ({...s, reviewAttemptId: e.target.value}))}>{reviewAttempts.length === 0 && <option value="">No matching attempts</option>}{reviewAttempts.map(a => <option key={a.id} value={a.id}>{questionById(a.questionId).skill} · {a.selected === null ? 'Unanswered' : a.correct ? 'Correct' : 'Incorrect'} · {a.mode} · {new Date(a.submittedAt).toLocaleString()}</option>)}</select></label></div>
    {reviewAttempt && reviewQuestion ? <><div className="review-summary muted">{reviewAttempt.mode === 'test' ? state.sessions.find(s=>s.id===reviewAttempt.sessionId)?.topicId ? 'Submitted topic test' : 'Submitted demo' : 'Checked practice'} · {new Date(reviewAttempt.submittedAt).toLocaleString()} · {clock(reviewAttempt.elapsedMs)} spent{reviewAttempt.flagged ? ' · ⚑ Marked for review' : ''}</div><div className="grid"><section className="card question"><div className="row"><span className="pill">{reviewAttempt.selected === null ? 'Unanswered' : reviewAttempt.correct ? '✓ Correct' : '↻ Worth another look'}</span><span className="muted">{reviewQuestion.skill}</span></div><p className="questiontext">{reviewQuestion.text}</p><Choices question={reviewQuestion} selected={reviewAttempt.selected} locked reveal />{reviewAttempt.selected === null && <p className="spaced">You left this question unanswered.</p>}
    <div className="spaced"><label htmlFor="reflection"><h3>What will you try next time?</h3></label><textarea id="reflection" value={state.reflections[reviewQuestion.id]?.text ?? ''} placeholder="Write a note to your future self…" onChange={e => {const text = e.target.value; commit(s => ({...s, reflections: {...s.reflections, [reviewQuestion.id]: {text, updatedAt: Date.now()}}}));}} /><div className="row"><button onClick={() => {store.retry(); setNotice('Reflection save requested. See the save status below.');}}>Save reflection</button><span role="status" className="small muted">{store.error ? 'Not saved · see storage message' : store.syncStatus ?? (state.reflections[reviewQuestion.id] ? 'Saved on this device' : 'Notes save automatically as you type')}</span></div></div></section><section><Solution question={reviewQuestion}/><button className="primary spaced" onClick={() => {if(reviewQuestion.id.startsWith('pt-'))navigate('test');else {choosePractice(reviewQuestion.id); navigate('practice');}}}>Return to practice →</button>{!reviewQuestion.id.startsWith('pt-')&&<button className="spaced wide" onClick={() => {commit(s => ({...s,companion:{...companionOf(s),analysisAttemptId:reviewAttempt.id}})); navigate('analysis');}}>Explore mistake analysis →</button>}</section></div></> : <div className="card"><h2>No matching attempts.</h2><p className="muted spaced">Choose another session or show all outcomes.</p></div>}</>}
  </>;
  return <><a className="skip-link" href="#main-content" onClick={e => {e.preventDefault(); document.getElementById('page-title')?.focus();}}>Skip to content</a><div className={`shell ${isIntelligence ? 'intelligence-shell' : isCompanion ? 'companion-shell' : ''}`}><aside className={`app-sidebar ${menuOpen ? 'menu-open' : ''}`}><div className="sidebar-brand-row"><Brand/><button className="menu-toggle" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="sidebar-nav" onClick={() => setMenuOpen(!menuOpen)}>☰ Menu</button></div><div className="eyebrow sidebar-subtitle">SAT STUDIO</div><nav id="sidebar-nav" className="sidebar-nav" aria-label="Main navigation">{[
      {id:'studio',label:'SAT Studio',destinations:studioRoutes,icons:['◫','✎','◷','✓']},
      {id:'companion',label:'Learning Companion',destinations:companionRoutes,icons:['◫','✧','↻','✦']},
      {id:'intelligence',label:'Practice Intelligence',destinations:intelligenceRoutes,icons:['↗','✎','◷','↻','◫','▧']},
    ].map(group => <section className="nav-group" key={group.id} aria-labelledby={`nav-${group.id}`}><h2 id={`nav-${group.id}`} className="nav-group-title">{group.label}</h2>{group.destinations.map((p,i) => <button key={p} className={route === p ? 'active' : ''} aria-current={route === p ? 'page' : undefined} onClick={() => {setMenuOpen(false); navigate(p);}}><span aria-hidden="true">{group.icons[i]}</span><span>{routeLabels[p]}</span></button>)}</section>)}</nav><div className="sidebar-bottom"><a className="sidebar-assistant" href="#assistant" onClick={() => setMenuOpen(false)}><span className="sidebar-assistant-icon" aria-hidden="true">✦</span><span><strong>AI Assistant</strong><small>Ask a question ↗</small></span></a><div className="profile">YOUR NEXT CHAPTER<br/><strong>Starts with one question.</strong><br/><br/>{store.account ? <>Signed in as<br/><strong className="account-email">{store.account.email}</strong></> : store.hosted ? 'Personal study profile' : 'Local student · This device'}<br/>PrepOrbit AI · v1.0</div></div></aside><main id="main-content" className={isCompanion || isIntelligence ? 'companion-main' : undefined}><header><span className="eyebrow">{isCompanion ? route === 'assistant' ? 'LEARNING / AI ASSISTANT' : route === 'plan' ? 'YOUR STUDY SPACE' : route === 'tutor' ? 'PRACTICE / GUIDED TUTOR' : 'REVIEW / MISTAKE ANALYSIS' : 'YOUR STUDY SPACE'}</span><div className="header-actions"><a className="header-assistant" href="#assistant" onClick={() => setMenuOpen(false)}><span aria-hidden="true">✦</span> AI Assistant <span aria-hidden="true">↗</span></a><span className="muted header-date">{new Date(now).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</span><span className="avatar" aria-label={store.account ? `Signed in as ${store.account.email}` : 'Personal study profile'}>{store.account ? store.account.email[0].toUpperCase() : 'P'}</span>{store.account && <button className="signout" title={`Signed in as ${store.account.email}`} onClick={store.account.signOut}>Sign out</button>}</div></header>
    {store.error && <div className="storage-error" role="alert"><strong>Progress is not saved.</strong><p>{store.error}</p><div className="row spaced"><button onClick={store.retry}>Retry saving</button><button onClick={store.exportData}>Export backup</button>{store.sessionEnded ? <button className="primary" onClick={() => location.reload()}>Sign in again</button> : store.conflict ? <button onClick={() => {if (confirm('Load the server copy? Export any pending changes first.')) store.loadServerCopy?.();}}>Reload server copy</button> : <button onClick={() => {if (confirm('Start fresh? This replaces saved progress for this study profile. Export a backup first.')) store.reset();}}>Start fresh</button>}</div></div>}
    {notice && <div className="notice row" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    {test?.status === 'running' && route !== 'test' && <div className="notice row"><span>{test.topicId?'Topic practice is running':'Demo is running'} · {clock(remaining(test, now))} remaining</span><button onClick={() => navigate('test')}>{test.topicId?'Return to practice test':'Return to demo'}</button></div>}
    {route === 'assistant' ? <AssistantScreen store={store}/> : isIntelligence ? <IntelligenceScreens store={store} route={route} now={now} navigate={navigate} notify={setNotice}/> : isCompanion ? <CompanionScreens store={store} route={route as 'plan' | 'tutor' | 'analysis'} now={now} navigate={navigate} notify={setNotice}/> : {dashboard,practice,test:<TopicTests store={store} now={now} legacy={testView} notify={setNotice} onReview={id => {setReviewScope(id);setReviewFilter('all');navigate('review');}}/>,review}[route as 'dashboard' | 'practice' | 'test' | 'review']}
    <footer>Original practice content · Not affiliated with College Board.<br/>{store.hosted ? <>Personal study profile · {store.syncStatus}.<br/>{store.account ? 'Your account restores this progress on any device.' : 'This browser’s private cookie restores your progress from Railway PostgreSQL.'}</> : 'Progress is stored in this browser on this device.'} <button className="text-button" onClick={store.exportData}>Export progress backup</button>{store.importData && <><button className="text-button" onClick={() => importInput.current?.click()}>Import progress backup</button><input type="file" ref={importInput} accept=".json,application/json" hidden aria-label="Progress backup file" onChange={async e => {const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try {if (file.size > 1024 * 1024) throw new Error('Backup exceeds the 1 MB limit.'); const raw = await file.text(); parseState(raw); if (confirm('Replace this study profile with the imported backup? A copy of your current progress will download first.')) {store.importData!(raw); setNotice('Backup imported. Wait for “Saved to Railway database” before closing.');}} catch (error) {setNotice(`Import failed: ${error instanceof Error ? error.message : String(error)}`);}}}/></>}</footer>
    </main></div><dialog ref={dialog} aria-labelledby="submit-title" onClose={() => submitButton.current?.focus()}><h2 id="submit-title">Finish this demo module?</h2><p>{4 - Object.values(test?.answers ?? {}).filter(a => a !== null).length} unanswered · {test?.flags.length ?? 0} marked. Submitting ends the demo and opens your actual answers.</p><div className="row"><button autoFocus onClick={() => dialog.current?.close()}>Keep working</button><button className="primary" onClick={finish}>Submit & review</button></div></dialog></>;
}
function LocalApp() {return <App store={useLocalStore()}/>;}
function HostedApp({snapshot, user, onSignedOut}: {snapshot: ServerSnapshot; user: AccountUser; onSignedOut: () => void}) {
  const store = useServerStore(snapshot);
  const signOut = async () => {
    if (store.pending?.() && !confirm('Some progress has not reached the database yet. Sign out anyway? Unsaved changes will be lost.')) return;
    await signOutRequest(); clearServerCache(); onSignedOut();
  };
  return <App store={{...store, account:{email:user.email, signOut:() => {void signOut();}}}}/>;
}
const root = createRoot(document.getElementById('root')!);
const loading = (title: string, detail: string) => <div className="bootstrap card"><Brand/><h1>{title}</h1><p className="muted" role="status">{detail}</p></div>;
function showAuth(mode: 'signin' | 'signup' = 'signin') {
  const resetToken = resetTokenFromHash();
  root.render(<AuthScreen key={resetToken ?? mode} initialMode={mode} resetToken={resetToken} onSignedIn={user => {
    if (resetTokenFromHash()) history.replaceState(null, '', location.pathname);
    void openStudy(user);
  }}/>);
}
async function openStudy(user: AccountUser) {
  root.render(loading('Opening your study space…', 'Restoring your saved progress.'));
  try {
    const snapshot = await loadServerSnapshot();
    root.render(<HostedApp key={snapshot.profileId} snapshot={snapshot} user={user} onSignedOut={() => {location.hash = ''; showAuth();}}/>);
  } catch (error) {
    if (error instanceof SignInRequired) { showAuth(); return; }
    renderReconnect(error);
  }
}
function renderReconnect(error: unknown) {
  root.render(<div className="bootstrap card"><Brand/><h1>Let’s reconnect.</h1><p role="alert">{error instanceof Error ? error.message : 'The study server is unavailable.'}</p><p className="muted spaced">Your database progress and pending browser backup have not been replaced.</p><button className="primary spaced" onClick={startHosted}>Retry connection</button></div>);
}
function startHosted() {
  // A password-reset link always opens the reset form, even if someone is already signed in here.
  if (resetTokenFromHash()) { showAuth(); return; }
  root.render(loading('Opening your study space…', 'Checking your account.'));
  fetchAccount().then(user => user ? openStudy(user) : showAuth()).catch(renderReconnect);
}
window.addEventListener('hashchange', () => { if (import.meta.env.VITE_PERSISTENCE_MODE === 'server' && resetTokenFromHash()) showAuth(); });
if (import.meta.env.VITE_PERSISTENCE_MODE === 'server') startHosted(); else root.render(<LocalApp/>);
