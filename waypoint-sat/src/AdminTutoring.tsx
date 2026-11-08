import {useCallback, useEffect, useState} from 'react';
import {adminTutoring, adminIssueCertificate, adminRevokeCertificate, adminReviewTutor, adminCloseReport, type AdminTutor, type AdminReport} from './tutoring-api';
import {CERTIFICATE_MINUTES, formatHours} from './data/tutoring-schema';
import {dateText} from './TutoringParts';

type Tab = 'ready' | 'tutors' | 'issued' | 'reports';
const msg = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Try again.';

export function AdminTutoring({notify}: {notify: (t: string) => void}) {
  const [tab, setTab] = useState<Tab>('ready');
  const [tutors, setTutors] = useState<AdminTutor[] | null>(null);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { const r = await adminTutoring(); setTutors(r.tutors); setReports(r.reports); setError(''); } catch (e) { setError(msg(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, done: string) => { if (busy) return; setBusy(true); setError(''); try { await fn(); notify(done); await load(); } catch (e) { setError(msg(e)); } finally { setBusy(false); } };
  const ready = (tutors ?? []).filter(t => t.eligible && !t.certificate);
  const issued = (tutors ?? []).filter(t => t.certificate);
  const tabs: [Tab, string][] = [['ready', `Ready for certificate (${ready.length})`], ['tutors', `All tutors (${tutors?.length ?? 0})`], ['issued', `Issued (${issued.length})`], ['reports', `Reports (${reports.length})`]];
  const tutorRow = (t: AdminTutor) => <article className="card spaced admin-row" key={t.id}>
    <div className="row"><h3>{t.name}</h3><span className="row small">{t.reviewed && <span className="pill good">✓ Reviewed</span>}{!t.accepting && <span className="pill">Not accepting students</span>}</span></div>
    <p className="muted small">{t.email}{t.place ? ` · ${t.place}` : ''}{t.school ? ` · ${t.school}` : ''}</p>
    <p className="small">{t.subjects.join(', ') || 'No subjects yet'}{t.linkedin && <> · <a href={t.linkedin} target="_blank" rel="noopener noreferrer nofollow">LinkedIn ↗</a></>}</p>
    <p className="small"><strong>{formatHours(t.countedMinutes)} / {CERTIFICATE_MINUTES / 60} hours count</strong> · {formatHours(t.confirmedMinutes)} confirmed · {t.students} student{t.students === 1 ? '' : 's'}{t.pendingMinutes ? ` · ${formatHours(t.pendingMinutes)} waiting for students` : ''}</p>
    {t.flags.length > 0 && <ul className="flags" aria-label={`Integrity checks for ${t.name}`}>{t.flags.map(f => <li key={f.code} className={f.severity}><strong>{f.severity === 'high' ? 'High priority' : f.severity === 'review' ? 'Look closer' : 'Note'}:</strong> {f.message}</li>)}</ul>}
    {t.perStudent.length > 0 && <details className="small"><summary>Time with each student</summary><table className="mini-table"><thead><tr><th scope="col">Student</th><th scope="col">Confirmed</th><th scope="col">Counted</th></tr></thead><tbody>{t.perStudent.map(s => <tr key={s.name}><th scope="row">{s.name}</th><td>{formatHours(s.minutes)} h</td><td>{formatHours(s.counted)} h</td></tr>)}</tbody></table></details>}
    <div className="row">
      <button disabled={busy} onClick={() => act(() => adminReviewTutor(t.id, !t.reviewed), t.reviewed ? 'Review badge removed.' : 'Marked as reviewed.')}>{t.reviewed ? 'Remove reviewed badge' : 'Mark profile as reviewed'}</button>
      {t.certificate ? <span className="row small"><a href={`#verify/${t.certificate.code}`}>View certificate</a>
        <button disabled={busy} onClick={() => { const reason = prompt('Why is this certificate being revoked? (shown only to administrators)'); if (reason && reason.trim().length >= 3) void act(() => adminRevokeCertificate(t.certificate!.id, reason.trim()), 'Certificate revoked.'); }}>Revoke</button></span>
        : <button className="primary" disabled={busy || !t.eligible} title={t.eligible ? undefined : 'Needs 100 confirmed hours'} onClick={() => {
          let note = '';
          if (t.needsNote) { const answer = prompt(`${t.name} has high-priority flags:\n\n${t.flags.filter(f => f.severity === 'high').map(f => `• ${f.message}`).join('\n')}\n\nWrite what you checked (for example, you emailed the students). This note is saved with the certificate.`); if (!answer || answer.trim().length < 10) return; note = answer.trim(); }
          if (confirm(`Issue a stamped certificate to ${t.name} for ${formatHours(t.countedMinutes)} hours? Their full name will appear on it.`)) void act(() => adminIssueCertificate(t.id, note), 'Certificate issued. The tutor has been emailed.');
        }}>Generate certificate</button>}
    </div></article>;
  const list = tab === 'ready' ? ready : tab === 'issued' ? issued : tutors ?? [];
  return <section aria-label="Tutoring administration">
    {error && <div className="storage-error" role="alert"><p>{error}</p></div>}
    <div className="tabs spaced" aria-label="Tutoring queues">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tutors === null && !error ? <p className="muted" role="status">Loading…</p> : tab === 'reports' ? (reports.length === 0 ? <div className="card"><p className="muted">No open reports.</p></div> : reports.map(r => <article className="card spaced admin-row" key={r.id}>
      <p className="small muted">{dateText(r.createdAt)} · reported by {r.reporter} about {r.target}</p><p>{r.reason}</p>
      <button disabled={busy} onClick={() => act(() => adminCloseReport(r.id), 'Report closed.')}>Close report</button></article>))
      : list.length === 0 ? <div className="card"><p className="muted">{tab === 'ready' ? 'No tutor has reached 100 confirmed hours yet.' : 'Nothing here yet.'}</p></div> : list.map(tutorRow)}
  </section>;
}
