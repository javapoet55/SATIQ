import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {adminUsers, adminSetRole, type AdminUser, type UserRole} from './api';

// Chart colors: validated categorical slots 1–2 (blue, orange) on the white card surface (all six checks pass).
const ROLE_COLOR: Record<UserRole, string> = {student: '#2a78d6', tutor: '#eb6834'};
const ROLE_LABEL: Record<UserRole, string> = {student: 'Students', tutor: 'Tutors'};
const DAY = 86400000;
type Range = 'days' | 'weeks' | 'months';
const RANGES: {id: Range; label: string; count: number}[] = [{id: 'days', label: '30 days', count: 30}, {id: 'weeks', label: '12 weeks', count: 12}, {id: 'months', label: '12 months', count: 12}];

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const startOfWeek = (t: number) => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const startOfMonth = (t: number) => { const d = new Date(startOfDay(t)); d.setDate(1); return d.getTime(); };
const shift = (t: number, range: Range, n: number) => { const d = new Date(t); if (range === 'months') d.setMonth(d.getMonth() + n); else d.setDate(d.getDate() + n * (range === 'weeks' ? 7 : 1)); return d.getTime(); };
const fmtDate = (t: number, opts: Intl.DateTimeFormatOptions) => new Date(t).toLocaleDateString(undefined, opts);
const fmtFull = (iso: string) => new Date(iso).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
export function relative(iso: string | null, now = Date.now()) {
  if (!iso) return 'Never';
  const diff = now - new Date(iso).getTime();
  if (diff < 5 * 60000) return 'Just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
  if (diff < DAY) return `${Math.round(diff / 3600000)} hr ago`;
  const days = Math.floor((startOfDay(now) - startOfDay(new Date(iso).getTime())) / DAY);
  if (days <= 1) return 'Yesterday';
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

export interface Period {start: number; label: string; long: string; student: number; tutor: number}
export function signupSeries(users: AdminUser[], range: Range, now = Date.now()): Period[] {
  const count = RANGES.find(r => r.id === range)!.count;
  const floor = range === 'days' ? startOfDay : range === 'weeks' ? startOfWeek : startOfMonth;
  const first = shift(floor(now), range, -(count - 1));
  const periods: Period[] = Array.from({length: count}, (_, i) => {
    const start = shift(first, range, i);
    const label = range === 'months' ? fmtDate(start, {month: 'short'}) : fmtDate(start, {month: 'short', day: 'numeric'});
    const long = range === 'days' ? fmtDate(start, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'})
      : range === 'weeks' ? `Week of ${fmtDate(start, {month: 'short', day: 'numeric', year: 'numeric'})}` : fmtDate(start, {month: 'long', year: 'numeric'});
    return {start, label, long, student: 0, tutor: 0};
  });
  for (const u of users) {
    const t = new Date(u.createdAt).getTime();
    if (t < first) continue;
    let i = periods.length - 1; while (i > 0 && periods[i].start > t) i--;
    periods[i][u.role]++;
  }
  return periods;
}
export const ACTIVITY_BUCKETS = ['Today', '1–7 days ago', '8–30 days ago', '31–90 days ago', 'Over 90 days', 'Never'] as const;
export function activityBuckets(users: AdminUser[], now = Date.now()) {
  const counts = ACTIVITY_BUCKETS.map(label => ({label, student: 0, tutor: 0}));
  const today = startOfDay(now);
  for (const u of users) {
    let i = 5;
    if (u.lastActiveAt) {
      const t = new Date(u.lastActiveAt).getTime();
      const days = Math.max(0, Math.ceil((today - startOfDay(t)) / DAY));
      i = t >= today ? 0 : days <= 7 ? 1 : days <= 30 ? 2 : days <= 90 ? 3 : 4;
    }
    counts[i][u.role]++;
  }
  return counts;
}
// Whole-number y-axis: about four steps of 1, 2, 5, 10, 20, 50… so every tick is a real count.
export function yTicks(v: number) {
  const raw = Math.max(1, v / 4), mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw)!;
  const max = Math.max(step, Math.ceil(v / step) * step);
  return {max, ticks: Array.from({length: max / step + 1}, (_, i) => i * step)};
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null); const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el); return () => ro.disconnect();
  }, []);
  return [ref, width];
}
// A bar segment with 4px rounded corners only on its free (data) end.
const segment = (x: number, y: number, w: number, h: number, round: boolean) => {
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h}Z`;
};
// Horizontal version: anchored at the left baseline, rounded only on the right (data) end.
const hsegment = (x: number, y: number, w: number, h: number, round: boolean) => {
  const r = round ? Math.min(4, h / 2, w) : 0;
  return `M${x},${y}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h - r}${r ? `Q${x + w},${y + h} ${x + w - r},${y + h}` : ''}H${x}Z`;
};
function Legend() {
  return <div className="viz-legend" aria-hidden="true">{(['student', 'tutor'] as const).map(r => <span key={r}><i style={{background: ROLE_COLOR[r]}}/>{ROLE_LABEL[r]}</span>)}</div>;
}
interface Tip {x: number; y: number; title: string; student: number; tutor: number}
function Tooltip({tip}: {tip: Tip | null}) {
  if (!tip) return null;
  return <div className="viz-tooltip" style={{left: tip.x, top: tip.y}} role="status">
    <strong>{tip.title}</strong>
    {(['student', 'tutor'] as const).map(r => <div key={r}><i style={{background: ROLE_COLOR[r]}}/>{ROLE_LABEL[r]}<b>{tip[r]}</b></div>)}
    <div className="viz-tooltip-total">Total<b>{tip.student + tip.tutor}</b></div>
  </div>;
}

function SignupChart({periods}: {periods: Period[]}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const H = 220, left = 34, right = 8, top = 10, bottom = 26;
  const plotW = Math.max(100, width - left - right), plotH = H - top - bottom;
  const {max, ticks} = yTicks(Math.max(1, ...periods.map(p => p.student + p.tutor)));
  const slot = plotW / periods.length, barW = Math.max(3, Math.min(36, slot * 0.62));
  const every = Math.ceil(periods.length / Math.max(1, Math.floor(plotW / 52)));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const show = (i: number) => { const p = periods[i]; const total = p.student + p.tutor; setHover(i);
    const cx = left + slot * i + slot / 2, side = cx + barW / 2 + 10 + 160 <= width ? cx + barW / 2 + 10 : cx - barW / 2 - 10 - 160;
    setTip({x: Math.max(0, side), y: Math.max(0, Math.min(H - 110, y(total) - 40)), title: p.long, student: p.student, tutor: p.tutor}); };
  const hide = () => { setHover(null); setTip(null); };
  return <div className="viz-plot" ref={ref} onMouseLeave={hide}>
    <svg width={width} height={H} role="img" aria-label={`Sign-ups by period. ${periods.reduce((s, p) => s + p.student, 0)} students and ${periods.reduce((s, p) => s + p.tutor, 0)} tutors in this range.`}>
      {ticks.map(t => <g key={t}><line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-baseline' : 'viz-grid'}/><text x={left - 8} y={y(t) + 4} textAnchor="end" className="viz-axis">{t}</text></g>)}
      {periods.map((p, i) => {
        const x = left + slot * i + (slot - barW) / 2; const total = p.student + p.tutor;
        const sH = (p.student / max) * plotH, tH = (p.tutor / max) * plotH, gap = p.student && p.tutor ? 2 : 0;
        return <g key={p.start} opacity={hover === null || hover === i ? 1 : 0.45}>
          {p.student > 0 && <path d={segment(x, y(p.student), barW, sH, !p.tutor)} fill={ROLE_COLOR.student}/>}
          {p.tutor > 0 && <path d={segment(x, y(total), barW, Math.max(1, tH - gap), true)} fill={ROLE_COLOR.tutor}/>}
          {i % every === 0 && <text x={left + slot * i + slot / 2} y={H - 8} textAnchor="middle" className="viz-axis">{p.label}</text>}
          <rect x={left + slot * i} y={top} width={slot} height={plotH} fill="transparent" tabIndex={0} aria-label={`${p.long}: ${p.student} students, ${p.tutor} tutors`}
            onMouseEnter={() => show(i)} onFocus={() => show(i)} onBlur={hide}/>
        </g>;
      })}
    </svg>
    <Tooltip tip={tip}/>
  </div>;
}

function ActivityChart({buckets}: {buckets: ReturnType<typeof activityBuckets>}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const labelW = 112, valueW = 40, rowH = 32, barH = 14;
  const plotW = Math.max(60, width - labelW - valueW);
  const max = Math.max(1, ...buckets.map(b => b.student + b.tutor));
  const H = buckets.length * rowH;
  const show = (i: number) => {
    const b = buckets[i]; const end = labelW + ((b.student + b.tutor) / max) * plotW + 40;
    const fits = end + 170 <= width;
    setHover(i); setTip({x: fits ? end : Math.max(0, width - 170), y: fits ? Math.max(0, i * rowH - 30) : i * rowH + rowH + 4, title: `Last active: ${b.label}`, student: b.student, tutor: b.tutor});
  };
  const hide = () => { setHover(null); setTip(null); };
  return <div className="viz-plot" ref={ref} onMouseLeave={hide}>
    <svg width={width} height={H} role="img" aria-label={`Accounts by last activity: ${buckets.map(b => `${b.label} ${b.student + b.tutor}`).join(', ')}.`}>
      <line x1={labelW} x2={labelW} y1={0} y2={H} className="viz-baseline"/>
      {buckets.map((b, i) => {
        const cy = i * rowH + (rowH - barH) / 2, total = b.student + b.tutor;
        const sW = (b.student / max) * plotW, tW = (b.tutor / max) * plotW, gap = b.student && b.tutor ? 2 : 0;
        return <g key={b.label} opacity={hover === null || hover === i ? 1 : 0.45}>
          <text x={labelW - 10} y={cy + barH - 2} textAnchor="end" className="viz-label">{b.label}</text>
          {b.student > 0 && <path d={hsegment(labelW, cy, sW, barH, !b.tutor)} fill={ROLE_COLOR.student}/>}
          {b.tutor > 0 && <path d={hsegment(labelW + sW + gap, cy, Math.max(1, tW - gap), barH, true)} fill={ROLE_COLOR.tutor}/>}
          <text x={labelW + sW + tW + 8} y={cy + barH - 2} className="viz-value">{total}</text>
          <rect x={0} y={i * rowH} width={width} height={rowH} fill="transparent" tabIndex={0} aria-label={`${b.label}: ${b.student} students, ${b.tutor} tutors`}
            onMouseEnter={() => show(i)} onFocus={() => show(i)} onBlur={hide}/>
        </g>;
      })}
    </svg>
    <Tooltip tip={tip}/>
  </div>;
}

type SortKey = 'email' | 'role' | 'createdAt' | 'lastActiveAt';
const PAGE = 50;
const csvCell = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

export function AdminUsers({notify}: {notify: (t: string) => void}) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  const [range, setRange] = useState<Range>('weeks');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [sort, setSort] = useState<{key: SortKey; dir: 1 | -1}>({key: 'createdAt', dir: -1});
  const [limit, setLimit] = useState(PAGE);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const load = () => adminUsers().then(u => { setUsers(u); setLoadedAt(Date.now()); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  const now = loadedAt;

  const stats = useMemo(() => {
    const list = users ?? [];
    const since = (days: number, field: 'createdAt' | 'lastActiveAt') => list.filter(u => u[field] && now - new Date(u[field]!).getTime() <= days * DAY).length;
    return {total: list.length, students: list.filter(u => u.role === 'student').length, tutors: list.filter(u => u.role === 'tutor').length,
      active7: since(7, 'lastActiveAt'), active30: since(30, 'lastActiveAt'), new30: since(30, 'createdAt'), new7: since(7, 'createdAt')};
  }, [users, now]);
  const periods = useMemo(() => signupSeries(users ?? [], range, now), [users, range, now]);
  const buckets = useMemo(() => activityBuckets(users ?? [], now), [users, now]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (users ?? []).filter(u => (roleFilter === 'all' || u.role === roleFilter) && (!q || u.email.toLowerCase().includes(q)));
    const val = (u: AdminUser) => sort.key === 'email' ? u.email : sort.key === 'role' ? u.role : u[sort.key] ? new Date(u[sort.key]!).getTime() : -Infinity;
    return list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [users, query, roleFilter, sort]);
  useEffect(() => setLimit(PAGE), [query, roleFilter, sort]);

  const changeRole = (u: AdminUser, role: UserRole) => adminSetRole(u.id, role).then(() => {
    setUsers(list => list && list.map(x => x.id === u.id ? {...x, role} : x));
    notify(`${u.email} is now a ${role}.`);
  }).catch(e => setError(e.message));
  const exportCsv = () => {
    const lines = [['Email', 'Role', 'Signed up', 'Last active'], ...rows.map(u => [u.email, u.role, u.createdAt, u.lastActiveAt ?? ''])].map(r => r.map(csvCell).join(','));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], {type: 'text/csv'}));
    const a = document.createElement('a'); a.href = url; a.download = `preporbit-users-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const header = (key: SortKey, label: string) => <th aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
    <button className="sort" onClick={() => setSort(s => ({key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'email' || key === 'role' ? 1 : -1}))}>{label}<span aria-hidden="true">{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</span></button></th>;
  const pct = (n: number) => stats.total ? `${Math.round((n / stats.total) * 100)}%` : '—';

  if (error && !users) return <div className="storage-error" role="alert"><p>{error}</p><button onClick={load}>Retry</button></div>;
  if (!users) return <p className="muted">Loading accounts…</p>;
  return <section aria-labelledby="users-heading">
    {error && <div className="storage-error" role="alert"><p>{error}</p></div>}
    <div className="row"><h2 id="users-heading">Users overview</h2><div className="row"><span className="caption">Updated {new Date(loadedAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}</span><button onClick={load}>Refresh</button></div></div>

    <div className="kpis spaced">
      <div className="kpi"><span>Total accounts</span><strong>{stats.total}</strong><small>{stats.new7} new this week</small></div>
      <div className="kpi"><span><i style={{background: ROLE_COLOR.student}}/>Students</span><strong>{stats.students}</strong><small>{pct(stats.students)} of accounts</small></div>
      <div className="kpi"><span><i style={{background: ROLE_COLOR.tutor}}/>Tutors</span><strong>{stats.tutors}</strong><small>{pct(stats.tutors)} of accounts</small></div>
      <div className="kpi"><span>Active · last 7 days</span><strong>{stats.active7}</strong><small>{pct(stats.active7)} · {stats.active30} in 30 days</small></div>
      <div className="kpi"><span>New · last 30 days</span><strong>{stats.new30}</strong><small>{pct(stats.new30)} of accounts</small></div>
    </div>

    <div className="viz-grid-2 spaced">
      <div className="card viz-card">
        <div className="row viz-head"><div><h3>Sign-ups</h3><p className="caption">New accounts per {range === 'days' ? 'day' : range === 'weeks' ? 'week' : 'month'}</p></div>
          <div className="segmented" role="group" aria-label="Sign-up time range">{RANGES.map(r => <button key={r.id} className={range === r.id ? 'active' : ''} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>)}</div></div>
        <Legend/>
        <SignupChart periods={periods}/>
      </div>
      <div className="card viz-card">
        <div className="viz-head"><h3>Last active</h3><p className="caption">Accounts by how recently they used the app</p></div>
        <Legend/>
        <ActivityChart buckets={buckets}/>
      </div>
    </div>

    <div className="card spaced users-card">
      <div className="row users-toolbar">
        <h3>All users <span className="caption">({rows.length}{rows.length !== users.length ? ` of ${users.length}` : ''})</span></h3>
        <div className="row">
          <input type="search" placeholder="Search email" aria-label="Search users by email" value={query} onChange={e => setQuery(e.target.value)}/>
          <select aria-label="Filter by role" value={roleFilter} onChange={e => setRoleFilter(e.target.value as 'all' | UserRole)}><option value="all">All roles</option><option value="student">Students</option><option value="tutor">Tutors</option></select>
          <button onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="users-table">
          <thead><tr>{header('email', 'Email')}{header('role', 'Role')}{header('createdAt', 'Signed up')}{header('lastActiveAt', 'Last active')}</tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={4} className="muted">{users.length ? 'No users match this search.' : 'No one has signed up yet.'}</td></tr>
              : rows.slice(0, limit).map(u => <tr key={u.id}>
                <td className="email"><a href={`mailto:${u.email}`}>{u.email}</a>{u.admin && <span className="pill admin-pill">Admin</span>}</td>
                <td><label className="role-cell"><i style={{background: ROLE_COLOR[u.role]}} aria-hidden="true"/><select aria-label={`Role for ${u.email}`} value={u.role} onChange={e => changeRole(u, e.target.value as UserRole)}><option value="student">Student</option><option value="tutor">Tutor</option></select></label></td>
                <td title={fmtFull(u.createdAt)}>{fmtDate(new Date(u.createdAt).getTime(), {month: 'short', day: 'numeric', year: 'numeric'})}<small>{relative(u.createdAt, now)}</small></td>
                <td title={u.lastActiveAt ? fmtFull(u.lastActiveAt) : 'No activity recorded'}>{u.lastActiveAt ? <>{fmtDate(new Date(u.lastActiveAt).getTime(), {month: 'short', day: 'numeric', year: 'numeric'})}<small>{relative(u.lastActiveAt, now)}</small></> : <span className="muted">Never</span>}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <div className="spaced"><button onClick={() => setLimit(l => l + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button></div>}
    </div>
  </section>;
}
