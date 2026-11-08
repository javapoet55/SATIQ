import {useEffect, useState} from 'react';
import {Intro, AnswerInput, QuestionBody, Solution} from './StudyComponents';
import {DOMAINS, type Subject} from './data/question-schema';
import {setGeneratedQuestions} from './data/bank';
import {AdminUsers} from './AdminUsers';
import {adminList, adminJobs, adminGenerate, adminDecide, loadGeneratedQuestions, type GeneratedRow, type Job} from './api';

const STATUS_LABEL: Record<string, string> = {pending: 'Verified · awaiting review', flagged: 'Needs a careful look', approved: 'Live for students', rejected: 'Rejected'};
export function AdminScreen({notify}: {notify: (t: string) => void}) {
  const [view, setView] = useState<'users' | 'questions'>('users');
  return <>
    <Intro tag="ADMIN" title="Run PrepOrbit.">See who has signed up and how active they are, and grow the question bank.</Intro>
    <div className="tabs" role="group" aria-label="Admin section">{([['users', 'Users'], ['questions', 'Question bank']] as const).map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div>
    {view === 'users' ? <AdminUsers notify={notify}/> : <QuestionAdmin notify={notify}/>}
  </>;
}
function QuestionAdmin({notify}: {notify: (t: string) => void}) {
  const [section, setSection] = useState<Subject>('math');
  const [skill, setSkill] = useState(DOMAINS.math[0].skills[0]);
  const [difficulty, setDifficulty] = useState('Medium');
  const [type, setType] = useState('mcq');
  const [count, setCount] = useState(3);
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState<GeneratedRow[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => { adminList(tab).then(setRows).catch(e => setError(e.message)); adminJobs().then(setJobs).catch(() => {}); };
  useEffect(() => { setRows(null); refresh(); }, [tab]);
  const running = jobs.some(j => j.status === 'running');
  useEffect(() => { if (!running) return; const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [running, tab]);
  const generate = () => { setError(''); adminGenerate({section, skill, difficulty, type: section === 'math' ? type : 'mcq', count}).then(() => { notify('Generation started. Each question takes about a minute.'); refresh(); }).catch(e => setError(e.message)); };
  const decide = (id: string, decision: 'approve' | 'reject') => adminDecide(id, decision).then(async () => {
    notify(decision === 'approve' ? 'Approved. Students will see it in practice and tests.' : 'Rejected.');
    setGeneratedQuestions(await loadGeneratedQuestions().catch(() => [])); refresh();
  }).catch(e => setError(e.message));
  return <>
    <p className="muted admin-lead">GPT writes questions. A math checker and a second, blind AI solve verify each answer key. Nothing reaches students until you approve it.</p>
    {error && <div className="storage-error" role="alert"><p>{error}</p></div>}
    <div className="card"><h2>Generate questions</h2><div className="admin-form">
      <label>Section<select value={section} onChange={e => { const s = e.target.value as Subject; setSection(s); setSkill(DOMAINS[s][0].skills[0]); }}><option value="math">Math</option><option value="rw">Reading & Writing</option></select></label>
      <label>Skill<select value={skill} onChange={e => setSkill(e.target.value)}>{DOMAINS[section].map(d => <optgroup key={d.domain} label={d.domain}>{d.skills.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>)}</select></label>
      <label>Difficulty<select value={difficulty} onChange={e => setDifficulty(e.target.value)}>{['Easy', 'Medium', 'Hard'].map(d => <option key={d}>{d}</option>)}</select></label>
      {section === 'math' && <label>Format<select value={type} onChange={e => setType(e.target.value)}><option value="mcq">Multiple choice</option><option value="spr">Typed answer</option></select></label>}
      <label>How many<select value={count} onChange={e => setCount(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></label>
      <button className="primary" disabled={running} onClick={generate}>{running ? 'Generating…' : 'Generate →'}</button></div>
      {jobs.slice(0, 3).map(j => <p key={j.id} className="caption">{new Date(j.startedAt).toLocaleTimeString()} · {j.spec.count} × {j.spec.skill} ({j.spec.difficulty}) · {j.status === 'running' ? `working… ${j.results.length} of ${j.spec.count} done` : `${j.results.filter(r => r.status === 'pending').length} verified, ${j.results.filter(r => r.status === 'flagged').length} flagged, ${j.results.filter(r => r.status === 'rejected' || r.status === 'error').length} rejected`}</p>)}
    </div>
    <div className="tabs spaced" aria-label="Review queue">{['pending', 'flagged', 'approved', 'rejected'].map(s => <button key={s} className={tab === s ? 'active' : ''} aria-pressed={tab === s} onClick={() => setTab(s)}>{STATUS_LABEL[s]}</button>)}</div>
    {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card"><p className="muted">Nothing here yet.</p></div> : rows.map(row => <article className="card spaced admin-row" key={row.id}>
      <div className="row"><span className="pill">{row.payload.section === 'math' ? 'Math' : 'R&W'} · {row.payload.skill} · {row.payload.difficulty}{row.payload.type === 'spr' ? ' · typed' : ''}</span><span className="caption">{new Date(row.createdAt).toLocaleString()} · {row.createdBy}</span></div>
      <QuestionBody question={row.payload}/>{row.payload.type === 'mcq' ? <AnswerInput question={row.payload} selected={row.payload.correct} locked reveal/> : <p>Accepted answers: <strong>{(row.payload.answers ?? []).join(', ')}</strong></p>}
      <div className="verification"><strong>Verification</strong><ul>
        {row.payload.section === 'math' && <li>Math check: {row.verification.mathCheck === 'passed' ? '✓ passed' : (row.verification.problems ?? []).join('; ') || 'not run'}</li>}
        {row.verification.blindSolve && <li>Blind solve: answered <strong>{row.verification.blindSolve.answer}</strong> · {row.verification.blindSolve.agrees ? '✓ matches the key' : '✗ disagrees with the key. Check the question carefully.'}</li>}
        {row.status === 'rejected' && (row.verification.problems ?? []).length > 0 && <li>Problems: {(row.verification.problems ?? []).join('; ')}</li>}</ul></div>
      <div className="row"><button onClick={() => setOpen(open === row.id ? null : row.id)}>{open === row.id ? 'Hide solution' : 'Show solution & wrong-answer notes'}</button><div className="row">{row.status !== 'approved' && row.status !== 'rejected' && <button className="primary" onClick={() => decide(row.id, 'approve')}>Approve</button>}{row.status === 'approved' && <button onClick={() => decide(row.id, 'reject')}>Retire</button>}{row.status !== 'rejected' && row.status !== 'approved' && <button onClick={() => decide(row.id, 'reject')}>Reject</button>}</div></div>
      {open === row.id && <div className="spaced"><Solution question={row.payload}/></div>}
    </article>)}
  </>;
}
