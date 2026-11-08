import {Brand} from './Brand';
import {StudyHeader} from './StudyHeader';
import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {questionById, setGeneratedQuestions} from './data/bank';
import {STORAGE_KEY, emptyState, parseState, remaining, type State, type Route} from './model';
import './styles.css';
import './accessibility.css';
import './companion.css';
import './navigation.css';
import './studio.css';
import './typography.css';
import {CompanionScreens} from './CompanionScreens';
import {IntelligenceScreens} from './IntelligenceScreens';
import {AssistantScreen} from './AssistantScreen';
import {AdminScreen} from './AdminScreen';
import {Dashboard, Practice, TestScreen, Review, clock} from './StudioScreens';
import {companionOf, freshTutor, testInProgress} from './companion-model';
import {finishModule, runOf, filterOf, nextQuestion} from './practice-engine';
import {loadServerSnapshot, useServerStore, clearServerCache, SignInRequired, type ProgressStore, type ServerSnapshot} from './server-store';
import {AuthScreen, fetchAccount, signOutRequest, resetTokenFromHash, type AccountUser} from './auth';
import {ConfigContext, loadConfig, loadGeneratedQuestions, useConfig, type AppConfig} from './api';
import './auth.css';

const NAV: {id: string; label: string; icon: string; routes: Route[]}[] = [
  {id: 'dashboard', label: 'Home', icon: '⌂', routes: ['dashboard']},
  {id: 'practice', label: 'Practice', icon: '✎', routes: ['practice', 'tutor']},
  {id: 'test', label: 'Test', icon: '◷', routes: ['test', 'pacing']},
  {id: 'review', label: 'Review', icon: '✓', routes: ['review', 'analysis', 'work', 'handwriting']},
  {id: 'plan', label: 'Plan', icon: '◫', routes: ['plan', 'weekly']},
  {id: 'assistant', label: 'Ask AI', icon: '✦', routes: ['assistant']},
];
const ADMIN_NAV = {id: 'admin', label: 'Admin', icon: '⚙', routes: ['admin' as Route]};
const routeLabels: Record<Route, string> = {dashboard: 'Home', practice: 'Practice', tutor: 'Guided Tutor', test: 'Practice Tests', pacing: 'Pacing Coach', review: 'Answer Review', analysis: 'Mistake Reflection', work: 'Explain My Work', handwriting: 'Handwritten Work', plan: 'Daily Plan', weekly: 'Weekly Summary', assistant: 'Ask AI', admin: 'Admin', adaptive: 'Practice', similar: 'Practice'};
const ROUTES = Object.keys(routeLabels) as Route[];
// Older links to the separate adaptive and similar-question pages now open adaptive practice.
const getRoute = (): Route => { const r = location.hash.slice(1) as Route; return r === 'adaptive' || r === 'similar' ? 'practice' : ROUTES.includes(r) ? r : 'dashboard'; };
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
  const config = useConfig();
  const importInput = useRef<HTMLInputElement>(null);
  const [route, setRoute] = useState<Route>(getRoute);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [route]);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('');
  const [reviewScope, setReviewScope] = useState('latest');
  const navigate = (next: Route) => { if (next === route) return; location.hash = next; };
  const routeRef = useRef(route); routeRef.current = route;
  useEffect(() => {
    // Older links to the separate adaptive and similar-question pages open adaptive practice.
    const legacy = () => {
      if (location.hash !== '#adaptive' && location.hash !== '#similar') return;
      commit(s => { const f = {...filterOf(s), adaptive: true}; const q = nextQuestion(s, f); return {...s, practice: f, ...(q ? {practiceQuestionId: q.id} : {})}; });
      history.replaceState(null, '', '#practice');
    };
    legacy();
    const change = () => { legacy(); setRoute(getRoute()); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => { document.title = `PrepOrbit AI · ${routeLabels[route]}`; document.getElementById('page-title')?.focus({preventScroll: true}); window.scrollTo(0, 0); }, [route]);
  // Clock: when a running module's time is up, submit it and move a multi-module test forward.
  useEffect(() => {
    const tick = () => {
      const time = Date.now(); setNow(time);
      const s = store.current.current;
      const active = s.sessions.find(t => t.id === s.activeSessionId);
      if (active?.status === 'running' && remaining(active, time) === 0) {
        const run = runOf(s, active);
        commit(prev => finishModule(prev, active.id, time));
        const after = store.current.current; const nextRun = run && after.runs?.find(r => r.id === run.id);
        if (nextRun?.status === 'active') { setNotice('Time is up for this module. The next one is ready when you are.'); location.hash = 'test'; }
        else { setReviewScope(run ? `run:${run.id}` : active.id); setNotice('Time is up. Your test was submitted automatically.'); location.hash = 'review'; }
      }
    };
    tick(); const timer = window.setInterval(tick, 500);
    window.addEventListener('focus', tick); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, []);
  // Time-on-question for practice and the tutor (only while the tab is visible).
  useEffect(() => {
    let previous = Date.now();
    const timer = window.setInterval(() => {
      const time = Date.now(); const delta = Math.min(1500, time - previous); previous = time;
      if (document.visibilityState !== 'visible') return;
      if (routeRef.current === 'tutor') {
        commit(s => { if (testInProgress(s)) return s; const c = companionOf(s); const id = c.tutorQuestionId; const t = c.tutor[id] ?? freshTutor(); if (t.checkedAttemptId) return s; return {...s, companion: {...c, tutor: {...c.tutor, [id]: {...t, elapsedMs: t.elapsedMs + delta}}}}; });
        return;
      }
      if (routeRef.current !== 'practice') return;
      commit(s => { if (testInProgress(s)) return s; const id = s.practiceQuestionId; const d = s.drafts[id] ?? {selected: null, checkedAttemptId: null, elapsedMs: 0}; if (d.checkedAttemptId) return s; return {...s, drafts: {...s.drafts, [id]: {...d, elapsedMs: d.elapsedMs + delta}}}; });
    }, 1000); return () => clearInterval(timer);
  }, []);
  const test = state.sessions.find(s => s.id === state.activeSessionId);
  const nav = config.admin ? [...NAV, ADMIN_NAV] : NAV;
  const group = nav.find(g => g.routes.includes(route)) ?? NAV[0];
  const openReview = (scope: string) => { setReviewScope(scope); commit(s => ({...s, reviewAttemptId: null})); location.hash = 'review'; };
  const props = {store, now, navigate, notify: setNotice};
  const screen = route === 'dashboard' ? <Dashboard {...props}/> : route === 'practice' ? <Practice {...props}/> : route === 'test' ? <TestScreen {...props} onReview={openReview}/>
    : route === 'review' ? <Review {...props} scope={reviewScope} setScope={setReviewScope}/> : route === 'assistant' ? <AssistantScreen store={store}/>
    : route === 'admin' ? (config.admin ? <AdminScreen notify={setNotice}/> : <Dashboard {...props}/>)
    : ['plan', 'tutor', 'analysis'].includes(route) ? <CompanionScreens {...props} route={route as 'plan' | 'tutor' | 'analysis'}/> : <IntelligenceScreens {...props} route={route}/>;
  return <><a className="skip-link" href="#main-content" onClick={e => {e.preventDefault(); document.getElementById('page-title')?.focus();}}>Skip to content</a>
  <div className="shell"><aside className={`app-sidebar ${menuOpen ? 'menu-open' : ''}`}><div className="sidebar-brand-row"><Brand/><button className="menu-toggle" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="sidebar-nav" onClick={() => setMenuOpen(!menuOpen)}>☰ Menu</button></div><div className="eyebrow sidebar-subtitle">SAT STUDIO</div>
    <nav id="sidebar-nav" className="sidebar-nav simple-nav" aria-label="Main navigation">{nav.map(g => <button key={g.id} className={g === group ? 'active' : ''} aria-current={g === group ? 'page' : undefined} onClick={() => {setMenuOpen(false); setNotice(''); navigate(g.routes[0]);}}><span aria-hidden="true">{g.icon}</span><span>{g.label}</span></button>)}</nav>
    <div className="sidebar-bottom"><div className="profile">{store.account ? <>Signed in as<br/><strong className="account-email">{store.account.email}</strong></> : store.hosted ? 'Personal study profile' : 'Local student · This device'}<br/>PrepOrbit AI</div></div></aside>
  <main id="main-content" className="studio-main"><StudyHeader label={`${group.label.toUpperCase()}${group.routes.length > 1 && routeLabels[route] !== group.label ? ` / ${routeLabels[route].toUpperCase()}` : ''}`} home={route === 'dashboard'} now={now} email={store.account?.email} onSignOut={store.account?.signOut} onOpenAssistant={() => setMenuOpen(false)} assistantOpen={route === 'assistant'}/>
    {group.routes.length > 1 && <nav className="subnav" aria-label={`${group.label} pages`}>{group.routes.map(r => <a key={r} href={`#${r}`} className={r === route ? 'active' : ''} aria-current={r === route ? 'page' : undefined}>{routeLabels[r]}</a>)}</nav>}
    {store.error && <div className="storage-error" role="alert"><strong>Progress is not saved.</strong><p>{store.error}</p><div className="row spaced"><button onClick={store.retry}>Retry saving</button><button onClick={store.exportData}>Export backup</button>{store.sessionEnded ? <button className="primary" onClick={() => location.reload()}>Sign in again</button> : store.conflict ? <button onClick={() => {if (confirm('Load the server copy? Export any pending changes first.')) store.loadServerCopy?.();}}>Reload server copy</button> : <button onClick={() => {if (confirm('Start fresh? This replaces saved progress for this study profile. Export a backup first.')) store.reset();}}>Start fresh</button>}</div></div>}
    {notice && <div className="notice row" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    {test?.status === 'running' && route !== 'test' && <div className="notice row"><span>Test in progress · {clock(remaining(test, now))} left</span><button onClick={() => navigate('test')}>Return to test</button></div>}
    {screen}
    <footer>Original practice content · Not affiliated with College Board.<br/>{store.hosted ? <>{store.syncStatus}. {store.account ? 'Your account restores this progress on any device.' : ''}</> : 'Progress is stored in this browser on this device.'} <button className="text-button" onClick={store.exportData}>Export progress backup</button>{store.importData && <><button className="text-button" onClick={() => importInput.current?.click()}>Import progress backup</button><input type="file" ref={importInput} accept=".json,application/json" hidden aria-label="Progress backup file" onChange={async e => {const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try {if (file.size > 1024 * 1024) throw new Error('Backup exceeds the 1 MB limit.'); const raw = await file.text(); parseState(raw); if (confirm('Replace this study profile with the imported backup? A copy of your current progress will download first.')) {store.importData!(raw); setNotice('Backup imported. Wait for “Saved” before closing.');}} catch (error) {setNotice(`Import failed: ${error instanceof Error ? error.message : String(error)}`);}}}/></>}</footer>
  </main></div></>;
}
const LOCAL_CONFIG: AppConfig = {hosted: false, ai: false, admin: false, desmosKey: null};
function LocalApp() {return <ConfigContext.Provider value={LOCAL_CONFIG}><App store={useLocalStore()}/></ConfigContext.Provider>;}
function HostedApp({snapshot, user, config, onSignedOut}: {snapshot: ServerSnapshot; user: AccountUser; config: AppConfig; onSignedOut: () => void}) {
  const store = useServerStore(snapshot);
  const signOut = async () => {
    if (store.pending?.() && !confirm('Some progress has not reached the database yet. Sign out anyway? Unsaved changes will be lost.')) return;
    await signOutRequest(); clearServerCache(); onSignedOut();
  };
  return <ConfigContext.Provider value={config}><App store={{...store, account:{email:user.email, signOut:() => {void signOut();}}}}/></ConfigContext.Provider>;
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
    // Settings and approved AI-generated questions are optional extras: the app still opens without them.
    const [snapshot, settings, generated] = await Promise.all([loadServerSnapshot(), loadConfig().catch(() => ({ai: false, admin: false, desmosKey: null})), loadGeneratedQuestions().catch(() => [])]);
    setGeneratedQuestions(generated);
    root.render(<HostedApp key={snapshot.profileId} snapshot={snapshot} user={user} config={{hosted: true, ...settings}} onSignedOut={() => {location.hash = ''; showAuth();}}/>);
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
