import zipcodes from 'zipcodes';
import {SUBJECTS, SEARCH_RADII, CERTIFICATE_MINUTES, MIN_SESSION_MINUTES, MAX_SESSION_MINUTES, SESSION_DATE, validateProfile, displayName, distanceBand, formatHours} from '../src/data/tutoring-schema.ts';

const fail = (status, message) => Object.assign(new Error(message), {status});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9]{12}$/;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function lookupZip(zip) {
  const z = zipcodes.lookup(zip);
  return z ? {zip, city: z.city, state: z.state, lat: z.latitude, lon: z.longitude} : null;
}
export function miles(a, b) {
  const rad = d => d * Math.PI / 180, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---- Privacy: these functions are the only place that decides what one person may see about another.
// Until a request is accepted, other people see "Priya S." and never an email, ZIP code or exact distance.
export function ownProfile(row) {
  if (!row) return null;
  const complete = validateProfile({...row, guidelines: !!row.guidelinesAcceptedAt, zip: row.zip ?? undefined, grade: row.grade ?? undefined, linkedin: row.linkedin ?? undefined, school: row.school ?? undefined, bio: row.bio ?? undefined, availability: row.availability ?? undefined}, true).ok;
  return {fullName: row.fullName, roles: row.roles, zip: row.zip, city: row.city, state: row.state, grade: row.grade, subjectsWanted: row.subjectsWanted,
    linkedin: row.linkedin, school: row.school, subjects: row.subjects, bio: row.bio, availability: row.availability, radiusMiles: row.radiusMiles, accepting: row.accepting,
    guidelinesAccepted: !!row.guidelinesAcceptedAt, reviewed: !!row.reviewedAt, complete};
}
export function tutorCard(row, distance, relation) {
  return {id: row.userId, name: displayName(row.fullName), school: row.school, subjects: row.subjects, bio: row.bio, availability: row.availability, linkedin: row.linkedin,
    reviewed: !!row.reviewedAt, distance: distanceBand(distance), hours: Math.floor(row.confirmedMinutes / 60), certified: !!row.certified, relation};
}
export function shapeConnection(viewerId, c) {
  const asTutor = c.tutorId === viewerId;
  if (!asTutor && c.studentId !== viewerId) throw new Error('Connection does not belong to this viewer.');
  const open = c.status === 'accepted';
  const distance = c.studentLat != null && c.tutorLat != null ? distanceBand(miles({lat: c.studentLat, lon: c.studentLon}, {lat: c.tutorLat, lon: c.tutorLon})) : null;
  const other = asTutor
    ? {name: open ? c.studentName : displayName(c.studentName), grade: c.studentGrade, ...(open ? {email: c.studentEmail} : {})}
    : {name: open ? c.tutorName : displayName(c.tutorName), school: c.tutorSchool, linkedin: c.tutorLinkedin, subjects: c.tutorSubjects, ...(open ? {email: c.tutorEmail} : {})};
  return {id: c.id, role: asTutor ? 'tutor' : 'student', status: c.status, subject: c.subject, message: c.message, createdAt: c.createdAt, respondedAt: c.respondedAt, endedAt: c.endedAt,
    confirmedHours: Math.floor(c.confirmedMinutes / 60), distance, other};
}
const hourEntry = (row, nameKey) => ({id: row.id, date: row.date, minutes: row.minutes, note: row.note, status: row.status, name: row.connectionStatus === 'accepted' ? row[nameKey] : displayName(row[nameKey]), connectionId: row.connectionId});

// ---- Emails. They carry only a short name and a link to sign in; never contact details or free text a person typed.
const emailBody = (heading, lines, link, button) => ({
  text: `${heading}\n\n${lines.join('\n')}\n\n${button}: ${link}\n\nYou are receiving this because you have an account on PrepOrbit AI.`,
  html: `<p><strong>${esc(heading)}</strong></p>${lines.map(l => `<p>${esc(l)}</p>`).join('')}<p><a href="${esc(link)}">${esc(button)}</a></p><p style="color:#666;font-size:12px">You are receiving this because you have an account on PrepOrbit AI.</p>`,
});

export async function handleTutoring(ctx) {
  const {route, path, url, user, isAdmin, store, mailer, origin, json, readBody, limits} = ctx;
  const notify = (to, subject, content) => { Promise.resolve(mailer?.send?.({to, subject, ...content})).catch(() => console.error('A tutoring email could not be sent.')); };
  const uuid = v => { if (typeof v !== 'string' || !UUID.test(v)) throw fail(400, 'That request is not valid.'); return v; };

  // Anyone with a certificate's verification code may check it. The code is long enough that it cannot be guessed.
  if (route.startsWith('GET /api/verify/')) {
    if (!limits.verify.take(ctx.ip)) throw fail(429, 'Too many checks. Wait a few minutes and try again.');
    const code = decodeURIComponent(path.slice('/api/verify/'.length)).replace(/[\s-]/g, '').toUpperCase();
    const c = CODE.test(code) ? await store.certificateByCode(code) : null;
    if (!c) throw fail(404, 'No certificate matches that code.');
    json(200, {code: c.code, name: c.tutorName, hours: formatHours(c.minutes), students: c.students, firstDate: c.firstDate, lastDate: c.lastDate, issuedAt: c.issuedAt, revoked: !!c.revokedAt});
    return true;
  }
  if (!user) return false;

  // ---- Administrators
  if (path.startsWith('/api/admin/tutoring')) {
    if (!isAdmin) throw fail(403, 'Only administrators can manage tutoring.');
    if (route === 'GET /api/admin/tutoring') {
      const [tutors, reports] = await Promise.all([store.tutorsForAdmin(), store.reports('open')]);
      json(200, {
        tutors: tutors.map(t => ({id: t.userId, name: t.fullName, email: t.email, school: t.school, linkedin: t.linkedin, subjects: t.subjects, place: t.city ? `${t.city}, ${t.state}` : null, accepting: t.accepting, reviewed: !!t.reviewedAt,
          confirmedMinutes: t.confirmedMinutes, pendingMinutes: t.pendingMinutes, students: t.students, eligible: t.confirmedMinutes >= CERTIFICATE_MINUTES,
          certificate: t.certificateId ? {id: t.certificateId, code: t.certificateCode, issuedAt: t.certificateIssuedAt, hours: formatHours(t.certificateMinutes)} : null})),
        reports: reports.map(r => ({id: r.id, reason: r.reason, createdAt: r.createdAt, reporter: `${r.reporterName ?? 'Unknown'} (${r.reporterEmail})`, target: `${r.targetName ?? 'Unknown'} (${r.targetEmail})`})),
      });
      return true;
    }
    const body = await readBody(16 * 1024);
    if (route === 'POST /api/admin/tutoring/certificate') {
      const tutorId = uuid(body?.userId);
      const {code} = await store.issueCertificate(tutorId, user.email);
      const [email, issued] = await Promise.all([store.emailOf(tutorId), store.certificateByCode(code)]);
      if (email) notify(email, 'Your Prep Orbit certificate is ready', emailBody('Your certificate of community teaching is ready.', [`Thank you for teaching ${formatHours(issued.minutes)} hours with Prep Orbit.`, 'You can view, print or save it as a PDF from the link below.'], `${origin}/app/#verify/${code}`, 'View your certificate'));
      json(200, {code}); return true;
    }
    if (route === 'POST /api/admin/tutoring/revoke') {
      const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
      if (reason.length < 3) throw fail(400, 'Give a short reason for revoking the certificate.');
      if (!(await store.revokeCertificate(uuid(body?.id), reason))) throw fail(404, 'That certificate was not found or is already revoked.');
      json(200, {ok: true}); return true;
    }
    if (route === 'POST /api/admin/tutoring/review') {
      if (!(await store.setReviewed(uuid(body?.userId), body?.reviewed === true, user.email))) throw fail(404, 'That tutor was not found.');
      json(200, {ok: true}); return true;
    }
    if (route === 'POST /api/admin/tutoring/close-report') {
      if (!(await store.closeReport(uuid(body?.id), user.email))) throw fail(404, 'That report was not found or is already closed.');
      json(200, {ok: true}); return true;
    }
    throw fail(404, 'Unknown endpoint.');
  }

  // ---- Everyone signed in
  const mine = await store.getProfile(user.id);
  if (route === 'GET /api/tutoring/me') {
    const counts = await store.counts(user.id);
    const tutor = mine?.roles.includes('tutor');
    const [totals, certificate] = tutor ? await Promise.all([store.totals(user.id), store.activeCertificate(user.id)]) : [null, null];
    json(200, {profile: ownProfile(mine), counts, totals, certificate: certificate ? {code: certificate.code, issuedAt: certificate.issuedAt} : null}); return true;
  }
  if (route === 'POST /api/tutoring/profile') {
    const body = await readBody(16 * 1024);
    const checked = validateProfile(body, true);
    if (!checked.ok) throw fail(400, checked.error);
    const geo = lookupZip(checked.value.zip);
    if (!geo) throw fail(400, 'We could not find that ZIP code. Check it and try again.');
    // A signed-in person who has already agreed keeps that agreement; a first save must include it (validateProfile checks).
    const saved = await store.saveProfile(user.id, checked.value, geo, true);
    json(200, {profile: ownProfile(saved)}); return true;
  }
  if (!mine) throw fail(409, 'Create your tutoring profile first.');

  if (route === 'GET /api/tutoring/tutors') {
    if (!limits.search.take(user.id)) throw fail(429, 'You are searching very quickly. Wait a moment and try again.');
    if (!mine.roles.includes('student')) throw fail(403, 'Only students can search for tutors. Add the student role to your profile first.');
    if (!mine.zip || mine.lat == null) throw fail(409, 'Add your ZIP code to your profile to find tutors nearby.');
    const q = url.searchParams;
    const radius = Number(q.get('radius') ?? 10);
    if (!SEARCH_RADII.includes(radius)) throw fail(400, 'Choose 5, 10, 25 or 50 miles.');
    const subject = q.get('subject') || null;
    if (subject && !SUBJECTS.includes(subject)) throw fail(400, 'Choose a subject from the list.');
    const rows = await store.tutorsNear({viewerId: user.id, lat: mine.lat, lon: mine.lon, radius, subject});
    const found = rows.map(r => ({r, d: miles({lat: mine.lat, lon: mine.lon}, {lat: r.lat, lon: r.lon})})).filter(x => x.d <= radius && x.d <= x.r.radiusMiles)
      .sort((a, b) => a.d - b.d || b.r.confirmedMinutes - a.r.confirmedMinutes).slice(0, 30);
    const relations = new Map();
    for (const rel of await store.relationsWith(user.id, found.map(x => x.r.userId))) if (!relations.has(rel.tutorId)) relations.set(rel.tutorId, rel);
    json(200, {tutors: found.map(({r, d}) => {
      const rel = relations.get(r.userId);
      const declined = rel?.status === 'declined' && Date.now() - new Date(rel.respondedAt).getTime() < 30 * 86400000;
      return tutorCard(r, d, rel && ['pending', 'accepted'].includes(rel.status) ? {id: rel.id, status: rel.status} : declined ? {id: rel.id, status: 'unavailable'} : null);
    })}); return true;
  }
  if (route === 'POST /api/tutoring/connect') {
    const body = await readBody(16 * 1024);
    if (!mine.roles.includes('student') || !mine.zip || !mine.grade) throw fail(403, 'Finish your student profile (including ZIP code and grade) before asking a tutor for help.');
    const tutorId = uuid(body?.tutorId);
    if (tutorId === user.id) throw fail(400, 'You cannot send a request to yourself.');
    const tutor = await store.getProfile(tutorId);
    if (!tutor || !tutor.roles.includes('tutor') || !tutor.accepting || tutor.lat == null) throw fail(404, 'This tutor is not available.');
    if (miles({lat: mine.lat, lon: mine.lon}, {lat: tutor.lat, lon: tutor.lon}) > tutor.radiusMiles) throw fail(404, 'This tutor is not available.');
    const subject = body?.subject;
    if (typeof subject !== 'string' || !tutor.subjects.includes(subject)) throw fail(400, 'Choose a subject this tutor teaches.');
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (message.length < 10 || message.length > 500 || /[<>]/.test(message)) throw fail(400, 'Write a short note to the tutor (10–500 characters, no < or > symbols).');
    const id = await store.createRequest({studentId: user.id, tutorId, subject, message});
    const tutorEmail = await store.emailOf(tutorId);
    if (tutorEmail) notify(tutorEmail, 'A student would like your help', emailBody('A student nearby would like your help.', [`${displayName(mine.fullName)} asked for help with ${subject}.`, 'Sign in to read their note and accept or decline. You will only see their full name and email if you accept.'], `${origin}/app/#connections`, 'Open the request'));
    json(201, {id}); return true;
  }
  if (route === 'GET /api/tutoring/connections') {
    json(200, {connections: (await store.connectionsOf(user.id)).map(c => shapeConnection(user.id, c))}); return true;
  }
  if (route === 'POST /api/tutoring/respond') {
    const body = await readBody(4 * 1024);
    if (body?.decision !== 'accept' && body?.decision !== 'decline') throw fail(400, 'Choose accept or decline.');
    const done = await store.respond(uuid(body.id), user.id, body.decision === 'accept');
    if (!done) throw fail(404, 'This request is no longer waiting for an answer.');
    if (body.decision === 'accept') {
      const studentEmail = await store.emailOf(done.studentId);
      if (studentEmail) notify(studentEmail, 'Your tutor request was accepted', emailBody(`${displayName(mine.fullName)} accepted your request.`, ['Sign in to see how to reach them and plan your first session. Please read the safety tips first.'], `${origin}/app/#connections`, 'See your connection'));
    }
    json(200, {ok: true}); return true;
  }
  if (route === 'POST /api/tutoring/withdraw') {
    const body = await readBody(4 * 1024);
    if (!(await store.withdraw(uuid(body?.id), user.id))) throw fail(404, 'That request cannot be withdrawn.');
    json(200, {ok: true}); return true;
  }
  if (route === 'POST /api/tutoring/end') {
    const body = await readBody(4 * 1024);
    if (!(await store.end(uuid(body?.id), user.id))) throw fail(404, 'That connection cannot be ended.');
    json(200, {ok: true}); return true;
  }
  if (route === 'POST /api/tutoring/report') {
    const body = await readBody(8 * 1024);
    const c = await store.connection(uuid(body?.connectionId));
    if (!c || (c.studentId !== user.id && c.tutorId !== user.id)) throw fail(404, 'That connection was not found.');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 10 || reason.length > 500) throw fail(400, 'Tell us what happened in 10–500 characters.');
    const targetId = c.studentId === user.id ? c.tutorId : c.studentId;
    await store.report({reporterId: user.id, targetId, connectionId: c.id, reason});
    if (body?.block === true) await store.block(user.id, targetId);
    json(200, {ok: true, blocked: body?.block === true}); return true;
  }
  if (route === 'GET /api/tutoring/hours') {
    const tutor = mine.roles.includes('tutor');
    const [entries, totals, certificate, asStudent] = await Promise.all([tutor ? store.hoursAsTutor(user.id) : [], tutor ? store.totals(user.id) : null, tutor ? store.activeCertificate(user.id) : null, store.hoursAsStudent(user.id)]);
    json(200, {asTutor: tutor ? {entries: entries.map(e => hourEntry(e, 'studentName')), totals, certificate: certificate ? {code: certificate.code, issuedAt: certificate.issuedAt} : null} : null,
      asStudent: asStudent.map(e => hourEntry(e, 'tutorName'))}); return true;
  }
  if (route === 'POST /api/tutoring/hours') {
    const body = await readBody(8 * 1024);
    if (!mine.roles.includes('tutor')) throw fail(403, 'Only tutors can log teaching time.');
    const minutes = body?.minutes;
    if (!Number.isInteger(minutes) || minutes < MIN_SESSION_MINUTES || minutes > MAX_SESSION_MINUTES || minutes % 5) throw fail(400, `Enter a session length from ${MIN_SESSION_MINUTES} to ${MAX_SESSION_MINUTES} minutes, in steps of 5.`);
    if (typeof body?.date !== 'string' || !SESSION_DATE.test(body.date) || Number.isNaN(Date.parse(body.date))) throw fail(400, 'Choose the date of the session.');
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (note.length < 3 || note.length > 300 || /[<>]/.test(note)) throw fail(400, 'Add a short note about what you worked on (3–300 characters, no < or > symbols).');
    const {id, studentId} = await store.addHours({connectionId: uuid(body.connectionId), tutorId: user.id, date: body.date, minutes, note});
    const studentEmail = await store.emailOf(studentId);
    if (studentEmail) notify(studentEmail, 'Please confirm a tutoring session', emailBody(`${displayName(mine.fullName)} logged a ${formatHours(minutes)} hour session.`, ['Please confirm it was accurate. Only confirmed time counts toward a tutor’s certificate.'], `${origin}/app/#teaching`, 'Review the session'));
    json(201, {id}); return true;
  }
  if (route === 'POST /api/tutoring/hours/delete') {
    const body = await readBody(4 * 1024);
    if (!(await store.deleteHours(uuid(body?.id), user.id))) throw fail(404, 'That entry cannot be removed. Confirmed sessions are permanent.');
    json(200, {ok: true}); return true;
  }
  if (route === 'POST /api/tutoring/hours/decide') {
    const body = await readBody(4 * 1024);
    if (body?.decision !== 'confirm' && body?.decision !== 'dispute') throw fail(400, 'Choose confirm or dispute.');
    if (!(await store.decideHours(uuid(body.id), user.id, body.decision === 'confirm'))) throw fail(404, 'That session is not waiting for your answer.');
    json(200, {ok: true}); return true;
  }
  throw fail(404, 'Unknown endpoint.');
}
