import {useEffect, useRef, useState} from 'react';
import {Intro, QuestionBody} from './StudyComponents';
import {MathText} from './MathText';
import type {ProgressStore} from './server-store';
import type {Route, Session} from './model';
import {testInProgress} from './companion-model';
import {intelligenceOf, weekBounds} from './intelligence-model';
import type {IntelligenceState} from './intelligence-types';
import {checkWork, type StepResult} from './work-check';
import {questions, questionById} from './data/bank';
import {useConfig, explainMyWork, transcribePhoto, photoToDataUrl} from './api';
import {CoachNote, sessionTitle} from './StudioScreens';
import {adaptiveQuestions, variantQuestion} from './data/intelligence-content';
import './intelligence.css';

type Props = {store: ProgressStore; route: Route; now: number; navigate: (r: Route) => void; notify: (t: string) => void};
const format = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
const SAMPLE = '18 + 7d = 60\n7d = 60 − 18\n7d = 28\nd = 4';
const legacy = new Map([...adaptiveQuestions, ...['Foundation', 'Medium', 'Stretch'].flatMap(level => [0, 1, 2].map(i => variantQuestion(level, i)))].map(q => [q.id, q]));
const sectionOf = (id: string) => legacy.has(id) ? 'math' : questionById(id).section;
const skillName = (id: string) => legacy.get(id)?.skill ?? questionById(id).skill;

function Steps({results}: {results: StepResult[]}) {
  return <div role="status">{results.map((s, i) => <div className={`walkstep ${s.status === 'incorrect' ? 'error' : ''}`} key={i}><span className="num">{s.status === 'correct' ? '✓' : i + 1}</span><div><code>{s.line}</code><p className="note">{s.status === 'incorrect' ? 'First incorrect step · ' : s.status === 'uncertain' ? 'Please clarify · ' : ''}{s.reason}</p></div></div>)}</div>;
}
function AiExplain({questionId, lines, results}: {questionId: string; lines: string[]; results: StepResult[]}) {
  const {ai} = useConfig();
  const [state, setState] = useState<{text: string; loading: boolean; error: string}>({text: '', loading: false, error: ''});
  useEffect(() => setState({text: '', loading: false, error: ''}), [lines.join('\n'), questionId]);
  if (!ai || !results.some(r => r.status !== 'correct')) return null;
  return <div className="spaced">{state.text ? <div className="callout ai-callout"><strong>✦ PrepOrbit AI</strong><p><MathText text={state.text}/></p></div>
    : <button className="full" disabled={state.loading} onClick={() => { setState({text: '', loading: true, error: ''}); explainMyWork({questionId, lines}).then(r => setState({text: r.explanation, loading: false, error: ''})).catch(e => setState({text: '', loading: false, error: e.message})); }}>{state.loading ? 'Explaining…' : '✦ Explain my mistake'}</button>}
    {state.error && <p className="caption error-text" role="alert">{state.error}</p>}</div>;
}

export function IntelligenceScreens({store, route, now, navigate, notify}: Props) {
  const config = useConfig();
  const data = intelligenceOf(store.state);
  const update = (fn: (d: IntelligenceState) => IntelligenceState) => store.commit(s => ({...s, intelligence: fn(intelligenceOf(s))}));
  const workable = questions().filter(q => q.work);
  const workQ = questionById(data.workQuestionId && workable.some(q => q.id === data.workQuestionId) ? data.workQuestionId : 'wp-math-001');
  const [workResult, setWorkResult] = useState<StepResult[] | null>(null);
  const [sessionId, setSessionId] = useState(''), [paceIndex, setPaceIndex] = useState(0), [paceFilter, setPaceFilter] = useState('all');
  const [audience, setAudience] = useState('student'), [previous, setPrevious] = useState(false);
  const [image, setImage] = useState(''), [reading, setReading] = useState(false), [readError, setReadError] = useState(''), [confirmed, setConfirmed] = useState(false), [handResult, setHandResult] = useState<StepResult[] | null>(null);
  const photoRef = useRef('');
  useEffect(() => () => { if (photoRef.current) URL.revokeObjectURL(photoRef.current); }, []);
  useEffect(() => { setWorkResult(null); setHandResult(null); setConfirmed(false); }, [workQ.id]);
  const title = (tag: string, text: string, desc: string) => <Intro tag={tag} title={text}>{desc}</Intro>;
  const blocked = testInProgress(store.state) && ['work', 'handwriting'].includes(route);
  if (blocked) return <>{title('REVIEW', 'Give the test your full focus.', 'Your review tools will be here after the test.')}<div className="card"><p>Finish or stop your practice test before using these tools.</p><button className="primary spaced" onClick={() => navigate('test')}>Return to test →</button></div></>;
  const picker = <label className="analysis-selector">Question<select value={workQ.id} onChange={e => update(d => ({...d, workQuestionId: e.target.value, workDraft: e.target.value === 'wp-math-001' ? SAMPLE : '', handwrittenLines: ['']}))}>{workable.map(q => <option key={q.id} value={q.id}>{q.skill} · {q.difficulty} · {q.id === 'wp-math-001' ? 'tool rental' : q.id}</option>)}</select></label>;

  if (route === 'work') return <div className="intelligence">{title('REVIEW / EXPLAIN MY WORK', 'Let’s find the turning point.', 'Type your solution one line at a time. The checker finds the first step that goes off track.')}{picker}
    <div className="feature-grid"><section><div className="card"><span className="pill">{workQ.skill}</span><QuestionBody question={workQ}/>
      <label htmlFor="work-draft"><strong>Your solution, one equation per line (use {workQ.work!.variable})</strong></label>
      <textarea className="codearea" id="work-draft" maxLength={5000} value={data.workDraft} onChange={e => {update(d => ({...d, workDraft: e.target.value})); setWorkResult(null);}}/>
      <div className="row">{workQ.id === 'wp-math-001' && <button onClick={() => {update(d => ({...d, workDraft: SAMPLE})); setWorkResult(null);}}>Use example work</button>}<button className="primary" disabled={!data.workDraft.trim()} onClick={() => setWorkResult(checkWork(data.workDraft, workQ.work!.variable, workQ.work!.solution))}>Check my steps →</button></div>
      <p className="note">Each line is checked by algebra, not guessed. Use numbers, {workQ.work!.variable}, +, −, ×, / and parentheses.</p></div></section>
    <section><div className="card"><span className="sectionlabel">STEP-BY-STEP FEEDBACK</span>{!workResult ? <div className="pending"><h2>Your thinking goes here.</h2><p className="note">Check your steps to find the first line that no longer matches the original equation.</p></div>
      : <><Steps results={workResult}/>{workResult.every(r => r.status === 'correct') && <div className="callout">Every line checks out. Make sure your last line states the value of {workQ.work!.variable}.</div>}<AiExplain questionId={workQ.id} lines={data.workDraft.split('\n')} results={workResult}/></>}</div>
      <div className="card soft spaced"><h3>Different methods are welcome.</h3><p className="note">The checker accepts any valid order of steps. It flags notation it can’t read instead of marking it wrong.</p></div></section></div></div>;

  if (route === 'pacing') {
    const ended = store.state.sessions.filter(s => ['submitted', 'expired'].includes(s.status));
    const session: Session | undefined = ended.find(s => s.id === sessionId) ?? ended.at(-1);
    const times = session ? session.questionIds.map(id => session.questionElapsedMs[id] ?? 0) : [];
    const outcomes = session ? session.questionIds.map(id => store.state.attempts.find(a => a.sessionId === session.id && a.questionId === id)?.correct ?? false) : [];
    const total = times.reduce((a, b) => a + b, 0);
    const reference = session ? (session.config?.durationMs ?? 300000) / session.questionIds.length : 75000;
    return <div className="intelligence">{title('TEST / PACING COACH', 'Make time work for you.', 'See where your time went and pick one habit for next time.')}
      <div className="row"><label>Test <select value={session?.id ?? ''} onChange={e => {setSessionId(e.target.value); setPaceIndex(0);}}>{!session && <option value="">No finished test yet</option>}{[...ended].reverse().map(s => <option value={s.id} key={s.id}>{sessionTitle(s)} · {new Date(s.submittedAt!).toLocaleString()}</option>)}</select></label></div>
      {!times.length ? <div className="card spaced"><h2>Finish a practice test to see your pacing.</h2><button className="primary spaced" onClick={() => navigate('test')}>Open practice tests →</button></div> : <>
      <div className="metric-grid"><Metric label="TOTAL TIME" value={format(total)} detail="Time on questions"/><Metric label="AVERAGE" value={format(total / times.length)} detail={`Target pace ${format(reference)}`}/><Metric label="ACCURACY" value={`${Math.round(outcomes.filter(Boolean).length / times.length * 100)}%`} detail={`${outcomes.filter(Boolean).length} of ${times.length} correct`}/></div>
      <div className="feature-grid"><section className="card"><h2>Where your time went</h2><p className="note">Target pace: {format(reference)} per question, the real SAT’s average for this section.</p>{times.map((t, i) => <div className="chart-row" key={i}><span>Q{i + 1}</span><div className="timebar"><i style={{width: `${Math.max(1, t / Math.max(reference * 2, ...times) * 100)}%`, background: t > reference ? '#ba8658' : undefined}}/></div><strong>{format(t)}</strong></div>)}
        <div className="row spaced"><h3>Take a closer look</h3><select aria-label="Filter question timings" value={paceFilter} onChange={e => setPaceFilter(e.target.value)}><option value="all">All questions</option><option value="slow">Slower than target</option><option value="missed">Incorrect answers</option></select></div>
        <div className="pace-grid">{times.map((t, i) => paceFilter === 'slow' && t <= reference || paceFilter === 'missed' && outcomes[i] ? null : <button key={i} className={`${t > reference ? 'slow ' : ''}${paceIndex === i ? 'active' : ''}`} onClick={() => setPaceIndex(i)} aria-label={`Question ${i + 1}, ${format(t)}, ${outcomes[i] ? 'correct' : 'incorrect'}`}><strong>{i + 1}</strong><small>{format(t)}</small><small>{outcomes[i] ? '✓' : '↻'}</small></button>)}</div></section>
      <section><div className="card subtle"><span className="sectionlabel">QUESTION {paceIndex + 1} · {skillName(session!.questionIds[paceIndex])}</span><h2 className="spaced">{format(times[paceIndex] ?? 0)} · {outcomes[paceIndex] ? 'Correct' : 'Needs review'}</h2><p className="note">{(times[paceIndex] ?? 0) > reference * 1.5 ? 'Well over target. If you’re stuck with no clear next step, mark it and come back.' : 'Within a reasonable range for this section.'}</p></div>
        <div className="card spaced"><h2>Make a deliberate return.</h2><p className="muted spaced">If a question takes more than twice the target with no progress, mark it, move on, and return at the end.</p><button className="primary full spaced" onClick={() => update(d => ({...d, pacingGoal: !d.pacingGoal}))}>{data.pacingGoal ? '✓ Pacing goal saved · Clear' : 'Use this pacing goal'}</button></div></section></div></>}</div>;
  }

  if (route === 'weekly') {
    const [start, end] = weekBounds(now, previous);
    const unique = new Map<string, {correct: boolean; elapsedMs: number; submittedAt: number}>();
    for (const a of [...store.state.attempts, ...intelligenceOf(store.state).attempts]) if (a.submittedAt >= start && a.submittedAt < end && !unique.has(a.questionId)) unique.set(a.questionId, a);
    const rows = [...unique.entries()].map(([id, a]) => ({...a, section: sectionOf(id), skill: skillName(id)}));
    const correct = rows.filter(r => r.correct).length;
    const days = new Set(rows.map(r => new Date(r.submittedAt).toDateString())).size;
    const skills = [...new Set(rows.map(r => r.skill))].map(skill => { const rs = rows.filter(r => r.skill === skill); return {skill, n: rs.length, c: rs.filter(r => r.correct).length}; }).sort((a, b) => a.c / a.n - b.c / b.n);
    const who = audience === 'parent' ? 'Your student' : 'You';
    return <div className="intelligence">{title('PLAN / WEEKLY SUMMARY', audience === 'parent' ? 'A window into the week.' : 'Look how far you’ve come.', 'Your real answers this week, with a next step.')}
      <div className="row no-print"><div className="tabs">{['student', 'parent'].map(v => <button key={v} className={audience === v ? 'active' : ''} onClick={() => setAudience(v)}>{v === 'student' ? 'Student view' : 'Parent view'}</button>)}</div><select aria-label="Summary week" value={previous ? 'previous' : 'current'} onChange={e => setPrevious(e.target.value === 'previous')}><option value="current">This week</option><option value="previous">Last week</option></select></div>
      <div className="card hero"><span className="eyebrow">{new Date(start).toLocaleDateString()} — {new Date(end - 1).toLocaleDateString()}</span><h2 className="report-title">{rows.length ? 'Small steps are adding up.' : 'Your learning story starts here.'}</h2><p className="muted">{rows.length ? `${who} answered ${rows.length} different questions on ${days} ${days === 1 ? 'day' : 'days'}.` : 'Answer a practice question to start this week’s summary.'}</p></div>
      <div className="metric-grid"><Metric label="QUESTIONS" value={String(rows.length)} detail="First try on each question"/><Metric label="ACCURACY" value={rows.length ? `${Math.round(correct / rows.length * 100)}%` : '—'} detail={`${correct} / ${rows.length} correct`}/><Metric label="TIME" value={`${Math.round(rows.reduce((s, r) => s + r.elapsedMs, 0) / 60000)}m`} detail="On answered questions"/></div>
      <div className="feature-grid"><section className="card"><h2>By section</h2>{(['rw', 'math'] as const).map(section => { const rs = rows.filter(r => r.section === section); return <div className="skillrow" key={section}><div className="row"><span>{section === 'rw' ? 'Reading & Writing' : 'Math'}</span><strong>{rs.length ? `${Math.round(rs.filter(r => r.correct).length / rs.length * 100)}%` : 'No activity'}</strong></div><div className="bar"><i style={{width: `${rs.length ? rs.filter(r => r.correct).length / rs.length * 100 : 0}%`}}/></div><small>{rs.filter(r => r.correct).length} / {rs.length} correct</small></div>; })}
        {skills.length > 0 && <><h3 className="spaced">Skills this week</h3>{skills.map(s => <div className="row skill-line" key={s.skill}><span>{s.skill}</span><strong>{s.c}/{s.n}</strong></div>)}</>}</section>
      <section>{config.ai && !previous && <CoachNote kind="weekly" hasData={rows.length > 0}/>}
        <div className="card spaced"><h3>{audience === 'parent' ? 'A question to ask' : 'A reflection for you'}</h3><p className="questiontext">“Which strategy made a tricky question more manageable?”</p><button className="full no-print" onClick={() => window.print()}>Print / save summary</button><p className="note">Parent view changes the wording only. Nothing is sent to anyone.</p></div></section></div></div>;
  }

  // Handwritten work
  const upload = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/heic'].includes(file.type) || file.size > 15 * 1024 * 1024) { notify('Choose a PNG, JPEG, or WebP photo up to 15 MB.'); return; }
    if (photoRef.current) URL.revokeObjectURL(photoRef.current);
    photoRef.current = URL.createObjectURL(file); setImage(photoRef.current); setConfirmed(false); setHandResult(null); setReadError('');
    if (config.ai) {
      setReading(true);
      photoToDataUrl(file).then(dataUrl => transcribePhoto({image: dataUrl, variable: workQ.work!.variable}))
        .then(r => update(d => ({...d, handwrittenLines: r.lines})))
        .catch(e => { setReadError(e.message); update(d => ({...d, handwrittenLines: ['']})); })
        .finally(() => setReading(false));
    } else update(d => ({...d, handwrittenLines: ['']}));
  };
  const lines = data.handwrittenLines;
  return <div className="intelligence">{title('REVIEW / HANDWRITTEN WORK', 'Your scratch work has a story.', config.ai ? 'Snap a photo of your work. AI reads it, you confirm it, then the checker finds the first wrong step.' : 'Add a photo, type what you wrote, then the checker finds the first wrong step.')}{picker}
    <div className="feature-grid"><section><div className="card"><QuestionBody question={workQ}/>
      <div className="upload-zone spaced"><span className="big-icon">↑</span><h3 className="spaced">Add a clear photo of your work</h3><p className="note">PNG, JPEG, or WebP</p><label htmlFor="work-photo">Choose or take a photo</label><input id="work-photo" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {upload(e.target.files?.[0]); e.target.value = '';}}/>
        {workQ.id === 'wp-math-001' && <button className="spaced" onClick={() => {if (photoRef.current) URL.revokeObjectURL(photoRef.current); photoRef.current = ''; setImage('sample'); setConfirmed(false); setHandResult(null); update(d => ({...d, handwrittenLines: SAMPLE.split('\n')}));}}>Use sample work</button>}</div>
      {image && image !== 'sample' && <div className="preview-wrap"><img src={image} alt="Your scratch work"/></div>}
      {image === 'sample' && <div className="paper spaced"><small>SAMPLE</small>{SAMPLE.split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>}
      <p className="note">{config.ai ? 'Your photo is sent to the AI only to read it. It isn’t stored.' : 'Your photo stays in this browser.'} The confirmed lines are saved with your profile.</p></div></section>
    <section className="card"><span className="sectionlabel">STEP 1 · CONFIRM WHAT YOU WROTE</span><h2 className="spaced">Read it back, then check.</h2>
      {!image ? <div className="pending">Add a photo{workQ.id === 'wp-math-001' ? ' or use the sample' : ''} to start.</div> : reading ? <div className="pending" role="status">Reading your handwriting…</div> : <>
      {readError && <p className="caption error-text" role="alert">{readError} You can type the lines instead.</p>}
      <p className="note">{config.ai && !readError ? 'Fix anything the AI misread. It copies your work as written, including mistakes.' : `Type each line of your work using ${workQ.work!.variable}.`}</p>
      <div className="transcript">{lines.map((line, i) => <label key={i}>Line {i + 1}<input aria-label={`Transcription line ${i + 1}`} maxLength={300} value={line} onChange={e => {const v = e.target.value; update(d => ({...d, handwrittenLines: d.handwrittenLines.map((l, j) => i === j ? v : l)})); setConfirmed(false); setHandResult(null);}}/></label>)}</div>
      <div className="row">{lines.length < 12 && <button onClick={() => update(d => ({...d, handwrittenLines: [...d.handwrittenLines, '']}))}>+ Add line</button>}{lines.length > 1 && <button onClick={() => update(d => ({...d, handwrittenLines: d.handwrittenLines.slice(0, -1)}))}>− Remove last line</button>}</div>
      <button className="primary full spaced" disabled={!lines.some(l => l.trim())} onClick={() => {setConfirmed(true); setHandResult(checkWork(lines.join('\n'), workQ.work!.variable, workQ.work!.solution));}}>{confirmed ? '✓ Confirmed · checked below' : 'This matches my work · check it →'}</button>
      {handResult && <div className="spaced"><span className="sectionlabel">STEP 2 · CHECKED STEPS</span><Steps results={handResult}/><AiExplain questionId={workQ.id} lines={lines} results={handResult}/></div>}</>}
    </section></div></div>;
}
function Metric({label, value, detail}: {label: string; value: string; detail: string}) { return <div className="metric"><span className="sectionlabel">{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
