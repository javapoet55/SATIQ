import React, {createContext, useCallback, useContext, useEffect, useState} from 'react';
import {Intro} from './StudyComponents';
import {GRADES, SUBJECTS, SEARCH_RADII, MAX_SUBJECTS, CERTIFICATE_MINUTES, MAX_SESSION_MINUTES, formatHours} from './data/tutoring-schema';
import {GuidelinesAgreement, RolePicker, Chips, choiceOf, rolesOf, hoursText, dateText, type RoleChoice} from './TutoringParts';
import * as api from './tutoring-api';
import type {Me, TutorCard, Connection, HoursData} from './tutoring-api';

// ---- Shared summary (profile and counts), used by the sidebar badge, the home prompt and every tutoring screen.
interface TutoringState {me: Me | null; loading: boolean; error: string; reload: () => Promise<void>}
const Ctx = createContext<TutoringState>({me: null, loading: false, error: '', reload: async () => {}});
export const useTutoring = () => useContext(Ctx);
const hrs = (minutes: number) => { const t = formatHours(minutes); return `${t} hour${t === '1' ? '' : 's'}`; };
const message = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Try again.';

export function TutoringProvider({enabled, children}: {enabled: boolean; children: React.ReactNode}) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!enabled) return;
    try { setMe(await api.loadMe()); setError(''); } catch (e) { setError(message(e)); } finally { setLoading(false); }
  }, [enabled]);
  useEffect(() => { void reload(); if (!enabled) return; const t = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 60000); return () => clearInterval(t); }, [reload, enabled]);
  return <Ctx.Provider value={{me, loading, error, reload}}>{children}</Ctx.Provider>;
}
export function useTutoringBadge(): number { const {me} = useTutoring(); return me ? me.counts.incomingRequests + me.counts.hoursToConfirm : 0; }

const Notice = ({text}: {text: string}) => text ? <div className="storage-error" role="alert"><p>{text}</p></div> : null;
const Pill = ({children, tone = ''}: {children: React.ReactNode; tone?: string}) => <span className={`pill ${tone}`}>{children}</span>;

// A short banner on the home page that points people to the next tutoring step.
export function TutoringPrompt() {
  const {me} = useTutoring();
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('tutoring-prompt') === '1'; } catch { return false; } });
  if (!me || hidden) return null;
  const p = me.profile;
  const {incomingRequests, hoursToConfirm} = me.counts;
  let text = '', href = '#tutors', action = 'Open';
  if (incomingRequests) { text = `You have ${incomingRequests} tutoring request${incomingRequests === 1 ? '' : 's'} waiting.`; href = '#connections'; action = 'View requests'; }
  else if (hoursToConfirm) { text = `${hoursToConfirm} tutoring session${hoursToConfirm === 1 ? '' : 's'} need${hoursToConfirm === 1 ? 's' : ''} your confirmation.`; href = '#teaching'; action = 'Review'; }
  else if (!p) { text = 'Meet a tutor nearby, or become one. It’s free.'; href = '#tutorprofile'; action = 'Set up tutoring'; }
  else if (!p.complete) { text = p.roles.includes('tutor') ? 'Finish your tutor profile so students nearby can find you.' : 'Add your ZIP code and grade to find tutors nearby.'; href = '#tutorprofile'; action = 'Finish profile'; }
  else return null;
  return <div className="notice row tutoring-prompt" role="status"><span>{text}</span><span className="row"><a className="button-link primary" href={href}>{action}</a>
    <button aria-label="Hide this message" onClick={() => { try { sessionStorage.setItem('tutoring-prompt', '1'); } catch { /* Storage denied. */ } setHidden(true); }}>×</button></span></div>;
}

// ---- My profile
function ProfileScreen({notify}: {notify: (t: string) => void}) {
  const {me, reload} = useTutoring();
  const p = me?.profile ?? null;
  const [choice, setChoice] = useState<RoleChoice>(p ? choiceOf(p.roles) : 'student');
  const [fullName, setFullName] = useState(p?.fullName ?? '');
  const [zip, setZip] = useState(p?.zip ?? '');
  const [grade, setGrade] = useState(p?.grade ?? '');
  const [wanted, setWanted] = useState<string[]>(p?.subjectsWanted ?? []);
  const [linkedin, setLinkedin] = useState(p?.linkedin ?? '');
  const [school, setSchool] = useState(p?.school ?? '');
  const [subjects, setSubjects] = useState<string[]>(p?.subjects ?? []);
  const [bio, setBio] = useState(p?.bio ?? '');
  const [availability, setAvailability] = useState(p?.availability ?? '');
  const [radius, setRadius] = useState(p?.radiusMiles ?? 15);
  const [accepting, setAccepting] = useState(p?.accepting ?? true);
  const [guidelines, setGuidelines] = useState(!!p?.guidelinesAccepted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isStudent = choice !== 'tutor', isTutor = choice !== 'student';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      await api.saveProfile({fullName, roles: rolesOf(choice), guidelines, zip, ...(isStudent ? {grade, subjectsWanted: wanted} : {}),
        ...(isTutor ? {linkedin, school, subjects, bio, availability, radiusMiles: radius, accepting} : {})});
      await reload(); notify('Profile saved.');
      if (isTutor) location.hash = 'teaching'; else location.hash = 'tutors';
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  return <>
    <Intro tag="TUTORS / MY PROFILE" title={p?.complete ? 'Your tutoring profile.' : 'Set up your tutoring profile.'}>Free, local, and private. Other people see only your first name and last initial until you accept a connection.</Intro>
    <form className="card tutoring-form" onSubmit={submit} aria-describedby={error ? 'profile-error' : undefined}>
      <RolePicker value={choice} onChange={setChoice}/>
      <div className="t-grid">
        <label className="t-field">Full name<input value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" required maxLength={80}/><small>Shown to others only after you connect.</small></label>
        <label className="t-field">ZIP code<input value={zip} onChange={e => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" autoComplete="postal-code" required pattern="\d{5}" maxLength={5}/><small>Used only to find people nearby. It is never shown.</small></label>
      </div>
      {isStudent && <fieldset className="t-section"><legend>For students</legend>
        <label className="t-field">Grade<select value={grade} onChange={e => setGrade(e.target.value)} required><option value="">Choose…</option>{GRADES.map(g => <option key={g}>{g}</option>)}</select></label>
        <Chips label="Subjects I want help with" options={SUBJECTS} value={wanted} onChange={setWanted} max={MAX_SUBJECTS}/></fieldset>}
      {isTutor && <fieldset className="t-section"><legend>For tutors</legend>
        <p className="muted small">Students see your school, subjects, bio and LinkedIn link when they search, so they can check you out before asking for help.</p>
        <div className="t-grid">
          <label className="t-field">LinkedIn profile<input type="url" inputMode="url" value={linkedin} onChange={e => setLinkedin(e.target.value)} required placeholder="https://www.linkedin.com/in/your-name"/></label>
          <label className="t-field">School or university<input value={school} onChange={e => setSchool(e.target.value)} required maxLength={100}/></label>
        </div>
        <Chips label="Subjects I can teach" options={SUBJECTS} value={subjects} onChange={setSubjects} max={MAX_SUBJECTS}/>
        <label className="t-field">About you<textarea value={bio} onChange={e => setBio(e.target.value)} required minLength={20} maxLength={600} rows={4} placeholder="Tell students who you are and how you like to teach."/><small>{bio.length}/600 · at least 20 characters</small></label>
        <div className="t-grid">
          <label className="t-field">When are you usually free?<input value={availability} onChange={e => setAvailability(e.target.value)} maxLength={200} placeholder="Weekday evenings, Saturday mornings"/></label>
          <label className="t-field">How far can you travel?<select value={radius} onChange={e => setRadius(Number(e.target.value))}>{[5, 10, 15, 25, 50].map(m => <option key={m} value={m}>Up to {m} miles</option>)}</select></label>
        </div>
        <label className="check-line"><input type="checkbox" checked={accepting} onChange={e => setAccepting(e.target.checked)}/><span>I’m open to new students right now</span></label>
        {p?.reviewed && <p className="small"><Pill tone="good">✓ Reviewed</Pill> An administrator reviewed your profile. Changing your LinkedIn address or school clears this until it is reviewed again.</p>}
      </fieldset>}
      <GuidelinesAgreement checked={guidelines} onChange={setGuidelines} locked={!!p?.guidelinesAccepted} id="profile-guidelines"/>
      {error && <p id="profile-error" className="auth-error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
    </form></>;
}

// ---- Find a tutor
function TutorResult({tutor, onSent, notify}: {tutor: TutorCard; onSent: (id: string) => void; notify: (t: string) => void}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(tutor.subjects[0] ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { await api.requestTutor({tutorId: tutor.id, subject, message: text}); notify(`Request sent. ${tutor.name} will get an email.`); setOpen(false); onSent(tutor.id); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const r = tutor.relation;
  return <article className="card tutor-card">
    <div className="row"><h3>{tutor.name}</h3><span className="row small">{tutor.reviewed && <Pill tone="good">✓ Reviewed</Pill>}{tutor.certified && <Pill tone="gold">★ Certified</Pill>}<Pill>{tutor.distance}</Pill></span></div>
    <p className="muted small">{tutor.school}{tutor.hours > 0 ? ` · ${tutor.hours} hour${tutor.hours === 1 ? '' : 's'} taught on Prep Orbit` : ''}</p>
    <p>{tutor.bio}</p>
    <div className="chips static">{tutor.subjects.map(s => <span key={s} className="chip on">{s}</span>)}</div>
    {tutor.availability && <p className="small"><strong>Usually free:</strong> {tutor.availability}</p>}
    <div className="row spaced">
      <a href={tutor.linkedin} target="_blank" rel="noopener noreferrer nofollow">LinkedIn profile ↗<span className="sr-only"> (opens in a new tab)</span></a>
      {r?.status === 'accepted' ? <Pill tone="good">Connected</Pill> : r?.status === 'pending' ? <Pill>Request sent</Pill> : r?.status === 'unavailable' ? <Pill>Not available right now</Pill>
        : <button className="primary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Cancel' : `Ask ${tutor.name.split(' ')[0]} for help`}</button>}
    </div>
    {open && <form className="request-form" onSubmit={send}>
      <label className="t-field">Subject<select value={subject} onChange={e => setSubject(e.target.value)}>{tutor.subjects.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="t-field">Your note to {tutor.name.split(' ')[0]}<textarea value={text} onChange={e => setText(e.target.value)} required minLength={10} maxLength={500} rows={3} placeholder="What do you want to work on, and when are you free?"/><small>{text.length}/500 · Please don’t include phone numbers or addresses. They see only your first name and last initial until they accept.</small></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
    </form>}
  </article>;
}
function FindTutors({notify}: {notify: (t: string) => void}) {
  const {me} = useTutoring();
  const [radius, setRadius] = useState<number>(10);
  const [subject, setSubject] = useState('');
  const [tutors, setTutors] = useState<TutorCard[] | null>(null);
  const [error, setError] = useState('');
  const p = me?.profile;
  const ready = !!p && p.roles.includes('student') && !!p.zip && !!p.grade;
  useEffect(() => {
    if (!ready) return;
    let live = true; setTutors(null); setError('');
    api.findTutors(radius, subject).then(t => { if (live) setTutors(t); }).catch(e => { if (live) setError(message(e)); });
    return () => { live = false; };
  }, [ready, radius, subject]);
  const markSent = (id: string) => setTutors(list => list && list.map(t => t.id === id ? {...t, relation: {id: '', status: 'pending'}} : t));
  return <>
    <Intro tag="TUTORS / FIND A TUTOR" title="Find a tutor near you.">Volunteer tutors in your community. Ask one for help by email invite; if they accept, you’ll arrange to meet in person.</Intro>
    {!ready ? <div className="card"><h2>{p ? 'Finish your student profile.' : 'Set up your profile first.'}</h2>
      <p className="muted">{p && !p.roles.includes('student') ? 'Add the student role to your profile to search for tutors.' : 'Add your ZIP code and grade so we can show tutors nearby. Your ZIP code is never shown to anyone.'}</p><a className="button-link primary" href="#tutorprofile">Open my profile</a></div> : <>
      <div className="card tutor-filters"><label>Distance<select value={radius} onChange={e => setRadius(Number(e.target.value))}>{SEARCH_RADII.map(m => <option key={m} value={m}>Within {m} miles</option>)}</select></label>
        <label>Subject<select value={subject} onChange={e => setSubject(e.target.value)}><option value="">Any subject</option>{SUBJECTS.map(s => <option key={s}>{s}</option>)}</select></label></div>
      <Notice text={error}/>
      {tutors === null && !error ? <p className="muted spaced" role="status">Looking for tutors…</p> : tutors && tutors.length === 0 ? <div className="card spaced"><h2>No tutors found yet.</h2><p className="muted">Try a wider distance or a different subject. More tutors join every week.</p></div>
        : tutors?.map(t => <TutorResult key={t.id} tutor={t} onSent={markSent} notify={notify}/>)}</>}
  </>;
}

// ---- Connections
function SafetyTips() {
  return <div className="card safety-tips"><h3>Before you meet</h3><ul><li>Meet in a public place, like a library or school.</li><li>Tell a parent, guardian or trusted adult where you’ll be and when.</li><li>Tutoring is free. Never pay or accept payment.</li><li>Something feel off? Use <strong>Report a problem</strong> any time.</li></ul></div>;
}
function ConnectionCard({c, onChange, notify}: {c: Connection; onChange: () => Promise<void>; notify: (t: string) => void}) {
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [block, setBlock] = useState(true);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return; setBusy(true); setError('');
    try { await fn(); notify(done); await onChange(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const asTutor = c.role === 'tutor';
  return <article className="card connection-card">
    <div className="row"><h3>{c.other.name}</h3><Pill tone={c.status === 'accepted' ? 'good' : ''}>{c.subject}</Pill></div>
    {asTutor && <p className="muted small">{[c.other.grade, c.distance].filter(Boolean).join(' · ')}</p>}
    {!asTutor && c.other.school && <p className="muted small">{c.other.school}</p>}
    {c.status === 'pending' && asTutor && <>
      <blockquote className="request-note">{c.message}</blockquote>
      <p className="small muted">You’ll see their full name and email only if you accept.</p>
      <div className="row"><button className="primary" disabled={busy} onClick={() => run(() => api.respondToRequest(c.id, 'accept'), 'Accepted. Their contact details are now shown below.')}>Accept</button>
        <button disabled={busy} onClick={() => run(() => api.respondToRequest(c.id, 'decline'), 'Declined. They won’t be told why.')}>Decline</button></div></>}
    {c.status === 'pending' && !asTutor && <><p className="small">You asked: “{c.message}”</p><p className="small muted">Waiting for {c.other.name.split(' ')[0]} to answer. They’ve been sent an email.</p>
      <button disabled={busy} onClick={() => run(() => api.withdrawRequest(c.id), 'Request withdrawn.')}>Withdraw request</button></>}
    {c.status === 'accepted' && <>
      <p><strong>{asTutor ? 'You’re teaching' : 'Your tutor'}:</strong> {c.other.name}</p>
      <p>Email: <a href={`mailto:${c.other.email}`}>{c.other.email}</a></p>
      {!asTutor && c.other.linkedin && <p><a href={c.other.linkedin} target="_blank" rel="noopener noreferrer nofollow">LinkedIn profile ↗</a></p>}
      <p className="muted small">Connected {c.respondedAt ? dateText(c.respondedAt) : ''}{c.confirmedHours ? ` · ${c.confirmedHours} confirmed hour${c.confirmedHours === 1 ? '' : 's'} together` : ''}</p>
      <div className="row">{asTutor && <a className="button-link" href="#teaching">Log a session</a>}
        <button disabled={busy} onClick={() => { if (confirm('End this connection? You’ll stop seeing each other’s contact details.')) void run(() => api.endConnection(c.id), 'Connection ended.'); }}>End connection</button>
        <button disabled={busy} aria-expanded={reporting} onClick={() => setReporting(!reporting)}>Report a problem</button></div></>}
    {(c.status === 'declined' || c.status === 'withdrawn' || c.status === 'ended') && <p className="muted small">{c.status === 'declined' ? (asTutor ? 'You declined this request.' : 'This tutor isn’t available right now.') : c.status === 'withdrawn' ? 'Request withdrawn.' : 'Connection ended.'}</p>}
    {c.status === 'pending' && asTutor && <button className="text-button" aria-expanded={reporting} onClick={() => setReporting(!reporting)}>Report a problem</button>}
    {reporting && <form className="request-form" onSubmit={e => { e.preventDefault(); void run(() => api.reportConnection(c.id, reason, block).then(() => { setReporting(false); setReason(''); }), block ? 'Reported and blocked. An administrator will review it.' : 'Reported. An administrator will review it.'); }}>
      <label className="t-field">What happened?<textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={10} maxLength={500} rows={3}/><small>{reason.length}/500 · Only administrators see this.</small></label>
      <label className="check-line"><input type="checkbox" checked={block} onChange={e => setBlock(e.target.checked)}/><span>Also end the connection and block this person</span></label>
      <button className="primary" disabled={busy}>Send report</button></form>}
    {error && <p className="auth-error" role="alert">{error}</p>}
  </article>;
}
function Connections({notify}: {notify: (t: string) => void}) {
  const {reload} = useTutoring();
  const [list, setList] = useState<Connection[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setList(await api.loadConnections()); setError(''); } catch (e) { setError(message(e)); } await reload(); }, [reload]);
  useEffect(() => { void load(); }, [load]);
  const group = (fn: (c: Connection) => boolean) => (list ?? []).filter(fn);
  const requests = group(c => c.status === 'pending' && c.role === 'tutor'), sent = group(c => c.status === 'pending' && c.role === 'student');
  const connected = group(c => c.status === 'accepted'), past = group(c => !['pending', 'accepted'].includes(c.status));
  const section = (title: string, items: Connection[]) => items.length > 0 && <section className="spaced" aria-label={title}><h2 className="solution-title">{title}</h2>{items.map(c => <ConnectionCard key={c.id} c={c} onChange={load} notify={notify}/>)}</section>;
  return <>
    <Intro tag="TUTORS / CONNECTIONS" title="Your connections.">Requests, tutors and students you’re connected with. Full names and emails appear here only after a request is accepted.</Intro>
    <Notice text={error}/>
    {list === null && !error ? <p className="muted" role="status">Loading…</p> : list && list.length === 0 ? <div className="card"><h2>No connections yet.</h2><p className="muted">Students can <a href="#tutors">find a tutor nearby</a>. Tutors will see requests here, and get an email when one arrives.</p></div> : <>
      {(connected.length > 0 || requests.length > 0 || sent.length > 0) && <SafetyTips/>}
      {section('Requests for you', requests)}{section('Connected', connected)}{section('Requests you sent', sent)}{section('Earlier', past)}</>}
  </>;
}

// ---- Teaching hours
const LENGTHS = Array.from({length: MAX_SESSION_MINUTES / 15}, (_, i) => (i + 1) * 15);
const today = () => new Date().toLocaleDateString('en-CA');
function Teaching({notify}: {notify: (t: string) => void}) {
  const {me, reload} = useTutoring();
  const [data, setData] = useState<HoursData | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectionId, setConnectionId] = useState('');
  const [date, setDate] = useState(today());
  const [minutes, setMinutes] = useState(60);
  const [note, setNote] = useState('');
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(async () => {
    try { const [h, c] = await Promise.all([api.loadHours(), api.loadConnections()]); setData(h); setConnections(c.filter(x => x.status === 'accepted' && x.role === 'tutor')); setError(''); }
    catch (e) { setError(message(e)); }
    await reload();
  }, [reload]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!connectionId && connections[0]) setConnectionId(connections[0].id); }, [connections, connectionId]);
  const act = async (fn: () => Promise<unknown>, done: string) => { if (busy) return; setBusy(true); setError(''); try { await fn(); notify(done); await load(); } catch (e) { setError(message(e)); } finally { setBusy(false); } };
  const t = data?.asTutor;
  const confirmed = t?.totals.counted ?? 0, pending = t?.totals.pending ?? 0, overCap = t?.totals.overCap ?? 0;
  const percent = Math.min(100, Math.floor(confirmed / CERTIFICATE_MINUTES * 100));
  const toConfirm = data?.asStudent.filter(e => e.status === 'pending') ?? [];
  const statusPill = (s: string) => s === 'confirmed' ? <Pill tone="good">✓ Confirmed</Pill> : s === 'pending' ? <Pill>Waiting for student</Pill> : <Pill tone="warn">Student disagreed</Pill>;
  return <>
    <Intro tag="TUTORS / TEACHING HOURS" title="Teaching hours.">Tutors log each session; the student confirms it. Only confirmed time counts toward the 100-hour certificate.</Intro>
    <Notice text={error}/>
    {data === null && !error && <p className="muted" role="status">Loading…</p>}
    {toConfirm.length > 0 && <section className="card" aria-label="Sessions to confirm"><h2 className="solution-title">Please confirm these sessions</h2>
      <p className="muted small">Confirm only what really happened. Your tutor can’t earn credit for a session until you do.</p>
      {toConfirm.map(e => <div key={e.id} className="hours-row"><div><strong>{e.name}</strong> · {dateText(e.date)} · {hoursText(e.minutes)}<br/><span className="muted small">{e.note}</span></div>
        <div className="row"><button className="primary" disabled={busy} onClick={() => act(() => api.decideHours(e.id, 'confirm'), 'Confirmed. Thank you!')}>Confirm</button>
          <button disabled={busy} onClick={() => act(() => api.decideHours(e.id, 'dispute'), 'Marked as not right. Your tutor can fix the entry.')}>That’s not right</button></div></div>)}</section>}
    {me?.profile && !me.profile.roles.includes('tutor') && data && toConfirm.length === 0 && <div className="card spaced"><h2>Want to teach too?</h2><p className="muted">Add the tutor role to your profile to log sessions and work toward a certificate.</p><a className="button-link primary" href="#tutorprofile">Open my profile</a></div>}
    {t && <>
      <section className="card spaced" aria-label="Progress to certificate"><div className="row"><h2 className="solution-title">Progress to your certificate</h2><strong>{formatHours(confirmed)} / 100 hours</strong></div>
        <div className="progress" role="progressbar" aria-label="Confirmed teaching hours" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{width: `${percent}%`}}/></div>
        <p className="muted small">{t.totals.students} student{t.totals.students === 1 ? '' : 's'} taught{pending ? ` · ${hrs(pending)} waiting for student confirmation` : ''}</p>
        <p className="muted small">To keep certificates meaningful, up to 25 hours with any one student count. You need at least 4 students to reach 100 hours.{overCap > 0 ? ` ${hrs(overCap)} so far went over that limit and do not count.` : ''}</p>
        {t.certificate ? <p><Pill tone="gold">★ Certificate issued</Pill> <a href={`#verify/${t.certificate.code}`}>View, print or save your certificate</a></p>
          : confirmed >= CERTIFICATE_MINUTES ? <p><Pill tone="good">100 hours reached</Pill> An administrator will review your hours and issue your certificate.</p>
          : <p className="small">{hrs(CERTIFICATE_MINUTES - confirmed)} more confirmed to go. A certificate with an official stamp is issued by an administrator.</p>}</section>
      <section className="card spaced" aria-label="Log a session"><h2 className="solution-title">Log a session</h2>
        {connections.length === 0 ? <p className="muted">You’ll be able to log sessions once a student accepts you. <a href="#connections">See your connections</a>.</p> :
          <form className="t-grid log-form" onSubmit={e => { e.preventDefault(); void act(() => api.logHours({connectionId, date, minutes, note}).then(() => setNote('')), 'Session logged. Your student has been asked to confirm it.'); }}>
            <label className="t-field">Student<select value={connectionId} onChange={e => setConnectionId(e.target.value)}>{connections.map(c => <option key={c.id} value={c.id}>{c.other.name} · {c.subject}</option>)}</select></label>
            <label className="t-field">Date<input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} required/></label>
            <label className="t-field">Length<select value={minutes} onChange={e => setMinutes(Number(e.target.value))}>{LENGTHS.map(m => <option key={m} value={m}>{hoursText(m)}</option>)}</select></label>
            <p className="muted small wide">Limits: up to 2 hours a day and 20 hours a week.</p>
            <label className="t-field wide">What did you work on?<input value={note} onChange={e => setNote(e.target.value)} required minLength={3} maxLength={300} placeholder="Linear equations and word problems"/></label>
            <button className="primary" disabled={busy}>Log session</button></form>}</section>
      <section className="spaced" aria-label="Logged sessions"><h2 className="solution-title">Your sessions</h2>
        {t.entries.length === 0 ? <div className="card"><p className="muted">Nothing logged yet.</p></div> : <div className="card">{(showAll ? t.entries : t.entries.slice(0, 10)).map(e => <div key={e.id} className="hours-row"><div><strong>{e.name}</strong> · {dateText(e.date)} · {hoursText(e.minutes)}<br/><span className="muted small">{e.note}</span></div>
          <div className="row">{statusPill(e.status)}{e.status !== 'confirmed' && <button disabled={busy} aria-label={`Remove session with ${e.name} on ${dateText(e.date)}`} onClick={() => act(() => api.deleteHours(e.id), 'Session removed.')}>Remove</button>}</div></div>)}{t.entries.length > 10 && <button className="text-button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${t.entries.length} sessions`}</button>}</div>}</section></>}
    {data && data.asStudent.some(e => e.status !== 'pending') && <section className="spaced" aria-label="Your past sessions as a student"><h2 className="solution-title">Sessions you’ve taken</h2><div className="card">{data.asStudent.filter(e => e.status !== 'pending').map(e => <div key={e.id} className="hours-row"><div><strong>{e.name}</strong> · {dateText(e.date)} · {hoursText(e.minutes)}</div>{statusPill(e.status)}</div>)}</div></section>}
  </>;
}

export function TutoringScreens({route, notify}: {route: 'tutors' | 'connections' | 'teaching' | 'tutorprofile'; notify: (t: string) => void}) {
  const {me, loading, error} = useTutoring();
  if (loading) return <p className="muted" role="status">Loading…</p>;
  if (error && !me) return <><Intro tag="TUTORS" title="Tutors.">Tutor matching is not reachable right now.</Intro><Notice text={error}/></>;
  return route === 'tutors' ? <FindTutors notify={notify}/> : route === 'connections' ? <Connections notify={notify}/> : route === 'teaching' ? <Teaching notify={notify}/> : <ProfileScreen key={me?.profile ? 'saved' : 'new'} notify={notify}/>;
}
