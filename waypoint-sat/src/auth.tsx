import React, {useEffect, useRef, useState} from 'react';

export type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';
export interface AccountUser {email: string}
const MIN = 8;

async function post(path: string, body: unknown): Promise<{ok: boolean; status: number; data: {message?: string; user?: AccountUser}}> {
  const response = await fetch(path, {method:'POST', credentials:'same-origin', cache:'no-store', headers:{'Content-Type':'application/json','X-Waypoint-Client':'1'}, body:JSON.stringify(body), signal:AbortSignal.timeout(20000)});
  let data = {};
  try { data = await response.json(); } catch { /* Non-JSON error page. */ }
  return {ok: response.ok, status: response.status, data};
}
export async function fetchAccount(): Promise<AccountUser | null> {
  const response = await fetch('/api/auth/me', {credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('The study server is temporarily unavailable. Retry to reconnect.');
  const data = await response.json();
  return data.user && typeof data.user.email === 'string' ? data.user : null;
}
export async function signOutRequest() {
  await post('/api/auth/signout', {}).catch(() => undefined);
}
// Reset links look like https://host/#reset=<64 hex characters>.
export function resetTokenFromHash(): string | null {
  const match = /^#reset=([a-f0-9]{64})$/.exec(location.hash);
  return match ? match[1] : null;
}

const titles: Record<AuthMode, [string, string]> = {
  signin: ['Welcome back.', 'Sign in to pick up where you left off.'],
  signup: ['Create your study account.', 'Your progress saves to your account, so it follows you to any device.'],
  forgot: ['Forgot your password?', 'Enter your account email. We’ll send a link to choose a new password.'],
  reset: ['Choose a new password.', 'Pick something you haven’t used here before. You’ll be signed in afterwards.'],
};

export function AuthScreen({initialMode = 'signin', resetToken, onSignedIn}: {initialMode?: AuthMode; resetToken?: string | null; onSignedIn: (user: AccountUser) => void}) {
  const [mode, setModeState] = useState<AuthMode>(resetToken ? 'reset' : initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const setMode = (next: AuthMode) => { setModeState(next); setError(''); setMessage(''); setPassword(''); setConfirm(''); setShow(false); };
  useEffect(() => { document.title = `Waypoint · ${{signin:'Sign in', signup:'Create account', forgot:'Forgot password', reset:'Reset password'}[mode]}`; if (firstRender.current) firstRender.current = false; else heading.current?.focus(); }, [mode]);
  const needsConfirm = mode === 'signup' || mode === 'reset';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setError(''); setMessage('');
    if (needsConfirm) {
      if (password.length < MIN) { setError(`Use at least ${MIN} characters for your password.`); return; }
      if (password !== confirm) { setError('The two passwords don’t match.'); return; }
    }
    setBusy(true);
    try {
      const result = mode === 'signin' ? await post('/api/auth/signin', {email, password})
        : mode === 'signup' ? await post('/api/auth/signup', {email, password})
        : mode === 'forgot' ? await post('/api/auth/forgot', {email})
        : await post('/api/auth/reset', {token: resetToken, password});
      if (!result.ok) { setError(result.data.message || 'Something went wrong. Try again.'); return; }
      if (mode === 'forgot') { setMessage(result.data.message || 'If an account uses that email, a reset link is on its way.'); return; }
      if (result.data.user) onSignedIn(result.data.user);
    } catch {
      setError('Could not reach the study server. Check your connection and try again.');
    } finally { setBusy(false); }
  };
  const [title, lead] = titles[mode];
  const button = {signin:'Sign in', signup:'Create account', forgot:'Send reset link', reset:'Save new password'}[mode];
  return <main className="auth-page" id="main-content">
    <div className="auth card">
      <div className="brand">✳ <span>way</span>point</div>
      <div className="eyebrow">SAT STUDIO</div>
      <h1 ref={heading} tabIndex={-1}>{title}</h1>
      <p className="muted">{lead}</p>
      {mode === 'signup' && <p className="small muted auth-note">Already studied in this browser? That progress moves into your new account.</p>}
      <form onSubmit={submit} aria-describedby={error ? 'auth-error' : undefined}>
        {mode !== 'reset' && <div className="auth-field"><label htmlFor="auth-email">Email</label>
          <input id="auth-email" type="email" name="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/>
        </div>}
        {mode !== 'forgot' && <div className="auth-field"><label htmlFor="auth-password">{mode === 'reset' ? 'New password' : 'Password'}</label>
          <span className="password-row">
            <input id="auth-password" type={show ? 'text' : 'password'} name="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={mode === 'signin' ? undefined : MIN} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} aria-describedby={needsConfirm ? 'password-help' : undefined}/>
            <button type="button" className="text-button" aria-pressed={show} aria-label="Show password" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          </span>
          {needsConfirm && <small id="password-help" className="muted">At least {MIN} characters. A short phrase works well.</small>}
        </div>}
        {needsConfirm && <div className="auth-field"><label htmlFor="auth-confirm">Confirm password</label>
          <input id="auth-confirm" type={show ? 'text' : 'password'} name="confirm" autoComplete="new-password" required maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)}/>
        </div>}
        {error && <p id="auth-error" className="auth-error" role="alert">{error}</p>}
        {message && <p className="auth-message" role="status">{message}</p>}
        <button type="submit" className="primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : button}</button>
      </form>
      <div className="auth-links">
        {mode === 'signin' && <><button type="button" className="text-button" onClick={() => setMode('forgot')}>Forgot password?</button><span>New here? <button type="button" className="text-button" onClick={() => setMode('signup')}>Create an account</button></span></>}
        {mode === 'signup' && <span>Have an account? <button type="button" className="text-button" onClick={() => setMode('signin')}>Sign in</button></span>}
        {(mode === 'forgot' || mode === 'reset') && <button type="button" className="text-button" onClick={() => { if (mode === 'reset') history.replaceState(null, '', location.pathname); setMode('signin'); }}>← Back to sign in</button>}
        {mode === 'reset' && <button type="button" className="text-button" onClick={() => { history.replaceState(null, '', location.pathname); setMode('forgot'); }}>Need a new link?</button>}
      </div>
    </div>
    <p className="small muted auth-foot">Original practice content · Not affiliated with College Board.</p>
  </main>;
}
