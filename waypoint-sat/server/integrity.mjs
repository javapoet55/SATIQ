import {CERTIFICATE_MINUTES, MAX_MINUTES_PER_STUDENT} from '../src/data/tutoring-schema.ts';

// Certificate integrity. Pure functions: the store gathers the rows, this file decides what counts and what looks unusual.
// Hours are self-logged and confirmed by the student, so two friends could confirm each other's sessions. Three layers help:
// (1) at most MAX_MINUTES_PER_STUDENT with any one student counts, (2) pattern flags are shown to the administrator, and
// (3) an administrator must write a review note before issuing a certificate that carries a "high" flag.
const DAY = 86400000;
const dayNumber = date => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const hours = minutes => { const h = Math.round(minutes / 6) / 10; return `${Number.isInteger(h) ? h : h.toFixed(1)} hours`; };

/**
 * sessions: confirmed sessions [{studentId, date: 'YYYY-MM-DD', minutes, note, createdAt: ms, decidedAt: ms|null}]
 * students: {[studentId]: {name, joinedAt: ms}}   reciprocal: array of student ids who also tutor this tutor (or are tutored by them)
 * stats: {disputed, total} counts of this tutor's sessions
 */
export function analyzeHours({sessions, students = {}, reciprocal = [], stats = {disputed: 0, total: sessions.length}}) {
  const byStudent = new Map();
  for (const s of sessions) byStudent.set(s.studentId, (byStudent.get(s.studentId) ?? 0) + s.minutes);
  const perStudent = [...byStudent].map(([studentId, minutes]) => ({studentId, name: students[studentId]?.name ?? 'Unknown student', minutes, counted: Math.min(minutes, MAX_MINUTES_PER_STUDENT)})).sort((a, b) => b.minutes - a.minutes);
  const rawMinutes = perStudent.reduce((sum, s) => sum + s.minutes, 0), countedMinutes = perStudent.reduce((sum, s) => sum + s.counted, 0);
  const flags = [], add = (code, severity, message) => flags.push({code, severity, message});
  const n = sessions.length;

  const over = perStudent.filter(s => s.minutes > s.counted);
  if (over.length) add('student_cap', 'info', `${hours(over.reduce((sum, s) => sum + s.minutes - s.counted, 0))} with ${plural(over.length, 'student')} went over the ${hours(MAX_MINUTES_PER_STUDENT)} per-student limit and do not count.`);
  if (perStudent.length < 4 && n) add('few_students', 'info', `Only ${plural(perStudent.length, 'student')} so far. At least 4 are needed to reach 100 counted hours.`);

  const mutual = perStudent.filter(s => reciprocal.includes(s.studentId));
  if (mutual.length) add('reciprocal', 'high', `${mutual.map(s => s.name).join(', ')} ${mutual.length === 1 ? 'also tutors' : 'also tutor'} this person, a common way to trade confirmations.`);

  if (countedMinutes >= CERTIFICATE_MINUTES && n) {
    const first = Math.min(...sessions.map(s => dayNumber(s.date))), last = Math.max(...sessions.map(s => dayNumber(s.date))), span = last - first + 1;
    if (span < 30) add('fast', 'high', `${hours(rawMinutes)} were logged across only ${plural(span, 'day')}.`);
  }
  if (n >= 5) {
    const quick = sessions.filter(s => s.decidedAt && s.decidedAt - s.createdAt < 10 * 60000).length;
    if (quick / n >= 0.6) add('fast_confirm', 'review', `${quick} of ${n} sessions were confirmed within 10 minutes of being logged.`);
    const late = sessions.filter(s => s.createdAt - Date.parse(`${s.date}T00:00:00Z`) > 14 * DAY).length;
    if (late / n >= 0.5) add('backdated', 'review', `${late} of ${n} sessions were logged more than 2 weeks after the session date.`);
    const perCreatedDay = new Map();
    for (const s of sessions) { const k = new Date(s.createdAt).toISOString().slice(0, 10); perCreatedDay.set(k, (perCreatedDay.get(k) ?? 0) + 1); }
    const [batchDay, batchCount] = [...perCreatedDay].sort((a, b) => b[1] - a[1])[0];
    if (batchCount >= 6) add('batch', 'review', `${batchCount} sessions were all logged on ${batchDay}.`);
    const notes = new Map();
    for (const s of sessions) { const k = s.note.trim().toLowerCase(); notes.set(k, (notes.get(k) ?? 0) + 1); }
    const [note, count] = [...notes].sort((a, b) => b[1] - a[1])[0];
    if (count >= 5 && count / n >= 0.3) add('repeated_notes', 'review', `The same note (“${note.slice(0, 40)}”) appears on ${count} sessions.`);
  }
  if (n >= 20) {
    const lengths = new Map();
    for (const s of sessions) lengths.set(s.minutes, (lengths.get(s.minutes) ?? 0) + 1);
    const [minutes, count] = [...lengths].sort((a, b) => b[1] - a[1])[0];
    if (count / n >= 0.9) add('uniform', 'review', `${count} of ${n} sessions are exactly ${minutes} minutes.`);
  }
  const days = [...new Set(sessions.map(s => dayNumber(s.date)))].sort((a, b) => a - b);
  let streak = 1, best = days.length ? 1 : 0;
  for (let i = 1; i < days.length; i++) { streak = days[i] === days[i - 1] + 1 ? streak + 1 : 1; best = Math.max(best, streak); }
  if (best >= 21) add('streak', 'review', `Taught on ${best} days in a row.`);
  if (rawMinutes && perStudent[0].minutes / rawMinutes > 0.5 && perStudent.length > 1) add('dominant', 'review', `${perStudent[0].name} accounts for ${Math.round(perStudent[0].minutes / rawMinutes * 100)}% of the logged time.`);
  const fresh = perStudent.filter(s => {
    const joined = students[s.studentId]?.joinedAt, firstSession = Math.min(...sessions.filter(x => x.studentId === s.studentId).map(x => Date.parse(`${x.date}T00:00:00Z`)));
    return joined && firstSession - joined < 3 * DAY;
  });
  if (fresh.length >= 2 && fresh.length / perStudent.length >= 0.5) add('new_accounts', 'review', `${fresh.length} of ${perStudent.length} students created their accounts within 3 days of their first session.`);
  if (stats.total >= 5 && stats.disputed / stats.total >= 0.25) add('disputes', 'review', `Students disputed ${stats.disputed} of ${stats.total} logged sessions.`);

  const order = {high: 0, review: 1, info: 2};
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  return {rawMinutes, countedMinutes, students: perStudent.filter(s => s.counted > 0).length, eligible: countedMinutes >= CERTIFICATE_MINUTES, perStudent, flags, needsNote: flags.some(f => f.severity === 'high')};
}
