import {useEffect, useId, useState} from 'react';
import {Brand} from './Brand';
import {verifyCertificate, type VerifiedCertificate} from './tutoring-api';
import {dateText} from './TutoringParts';

const dashed = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');

// A round "stamped" seal. The text runs around the edge; the rough outline comes from a small displacement filter.
export function Stamp({year}: {year: string}) {
  const id = useId().replace(/:/g, '');
  return <svg className="stamp" viewBox="0 0 160 160" role="img" aria-label={`Prep Orbit AI verified seal, ${year}`}>
    <defs>
      <path id={`${id}-arc`} d="M 80 80 m -58 0 a 58 58 0 1 1 116 0 a 58 58 0 1 1 -116 0"/>
      <filter id={`${id}-rough`} x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="1.7"/></filter>
    </defs>
    <g filter={`url(#${id}-rough)`} fill="none" stroke="currentColor">
      <circle cx="80" cy="80" r="75" strokeWidth="3.2"/><circle cx="80" cy="80" r="69" strokeWidth="1"/><circle cx="80" cy="80" r="46" strokeWidth="1.6"/>
      <text fill="currentColor" stroke="none" fontSize="10.5" fontWeight="700" fontFamily="Helvetica, Arial, sans-serif"><textPath href={`#${id}-arc`} textLength="355" lengthAdjust="spacing">PREP ORBIT AI · VERIFIED VOLUNTEER TUTOR · </textPath></text>
      <path fill="currentColor" stroke="none" d="M80 52l4.6 9.9 10.8 1.3-8 7.4 2.1 10.7L80 75.9l-9.5 5.4 2.1-10.7-8-7.4 10.8-1.3z"/>
      <text x="80" y="98" textAnchor="middle" fill="currentColor" stroke="none" fontSize="11" fontWeight="800" letterSpacing="1.5" fontFamily="Helvetica, Arial, sans-serif">VERIFIED</text>
      <text x="80" y="111" textAnchor="middle" fill="currentColor" stroke="none" fontSize="9" fontWeight="700" letterSpacing="1" fontFamily="Helvetica, Arial, sans-serif">{year}</text>
    </g>
  </svg>;
}

export function CertificateSheet({data, sample = false}: {data: VerifiedCertificate; sample?: boolean}) {
  const plural = data.students === 1 ? 'student' : 'students';
  const year = String(new Date(data.issuedAt).getFullYear());
  return <article className={`cert-sheet cert-print ${data.revoked ? 'revoked' : ''}`} aria-label={`Certificate of community teaching for ${data.name}`}>
    <div className="cert-frame">
      <div className="cert-top"><Brand/>{sample && <span className="cert-sample">SAMPLE</span>}</div>
      <p className="cert-kicker">CERTIFICATE OF COMMUNITY TEACHING</p>
      <p className="cert-lead">This certifies that</p>
      <h2 className="cert-name">{data.name}</h2>
      <p className="cert-text">volunteered <strong>{data.hours} hours</strong> of confirmed one-to-one tutoring through Prep Orbit AI, helping <strong>{data.students} {plural}</strong> in their community learn and grow, between {dateText(data.firstDate)} and {dateText(data.lastDate)}.</p>
      <div className="cert-bottom">
        <div className="cert-meta"><span>Issued {dateText(data.issuedAt)}</span><span>Certificate no. {dashed(data.code)}</span></div>
        <Stamp year={year}/>
        <div className="cert-sign"><span className="cert-line" aria-hidden="true"/><span>Program Administrator, Prep Orbit AI</span></div>
      </div>
      <p className="cert-foot">Verify at {location.origin}/app/#verify/{data.code}. This certificate recognizes participation and contribution; it does not guarantee college admission.</p>
      {data.revoked && <div className="cert-revoked" role="status">This certificate has been revoked and is no longer valid.</div>}
    </div>
  </article>;
}

export const SAMPLE_CERTIFICATE: VerifiedCertificate = {code: 'SAMPLE000000', name: 'Your Name Here', hours: '100', students: 6, firstDate: '2026-01-12', lastDate: '2026-11-02', issuedAt: '2026-11-09T12:00:00Z', revoked: false};

// Public page behind a certificate's link: anyone can check that it is real.
export function VerifyPage({code}: {code: string}) {
  const [state, setState] = useState<{status: 'loading'} | {status: 'error'; message: string} | {status: 'ok'; data: VerifiedCertificate}>({status: 'loading'});
  useEffect(() => { document.title = 'PrepOrbit AI · Certificate verification'; verifyCertificate(code).then(data => setState({status: 'ok', data})).catch(e => setState({status: 'error', message: e instanceof Error ? e.message : 'Could not check this certificate.'})); }, [code]);
  return <main className="verify-page" id="main-content">
    <div className="verify-bar no-print"><Brand/><button className="text-button" onClick={() => { if (history.length > 1) history.back(); else location.hash = ''; }}>← Back to PrepOrbit AI</button></div>
    {state.status === 'loading' && <p className="muted" role="status">Checking this certificate…</p>}
    {state.status === 'error' && <div className="card verify-result" role="alert"><h1>We couldn’t verify this certificate.</h1><p>{state.message}</p><p className="muted">Check that the link or code was copied completely. If you think this is a mistake, ask the person who gave it to you.</p></div>}
    {state.status === 'ok' && <>
      <div className={`verify-banner no-print ${state.data.revoked ? 'bad' : 'good'}`} role="status"><strong>{state.data.revoked ? '✗ This certificate has been revoked.' : '✓ Verified. This certificate was issued by Prep Orbit AI.'}</strong>
        {!state.data.revoked && <button className="primary" onClick={() => window.print()}>Print or save as PDF</button>}</div>
      <div className="cert-scroll" tabIndex={0} role="region" aria-label="Certificate"><CertificateSheet data={state.data}/></div>
    </>}
  </main>;
}
