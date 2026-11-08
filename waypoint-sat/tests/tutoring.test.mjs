// Tutor matching against a real PostgreSQL database. Set DATABASE_URL (any scratch database); the test
// creates its own users and removes them afterwards. Skipped when no database is configured.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../server/database.mjs';
import {createApp} from '../server/app.mjs';
import {shapeConnection, miles, lookupZip} from '../server/tutoring.mjs';
import {displayName, cleanName, normalizeLinkedIn, validateProfile, distanceBand, formatHours} from '../src/data/tutoring-schema.ts';

const DB = process.env.DATABASE_URL;

test('names are shortened, LinkedIn addresses normalised, and profiles validated', () => {
  assert.equal(displayName('Priya Sharma'), 'Priya S.');
  assert.equal(displayName('Ana María de la Cruz'), 'Ana C.');
  assert.equal(displayName('Émile Zola'), 'Émile Z.');
  assert.equal(cleanName('  Priya   Sharma '), 'Priya Sharma');
  for (const bad of ['Priya', 'Priya <b>S</b>', 'http://x.co Smith', 'Priya 123', '']) assert.equal(cleanName(bad), null, bad);
  assert.equal(cleanName('李 小龍'), '李 小龍');
  assert.equal(normalizeLinkedIn('linkedin.com/in/priya-s-123/'), 'https://www.linkedin.com/in/priya-s-123');
  assert.equal(normalizeLinkedIn('https://uk.linkedin.com/in/priya-s?utm=1'), 'https://www.linkedin.com/in/priya-s');
  for (const bad of ['https://evil.com/in/priya', 'https://linkedin.com.evil.com/in/priya', 'https://linkedin.com/company/x', 'javascript:alert(1)', 'linkedin.com/in/a']) assert.equal(normalizeLinkedIn(bad), null, bad);
  assert.equal(distanceBand(1.2), 'Within 2 miles'); assert.equal(distanceBand(7), 'Within 10 miles');
  assert.equal(formatHours(90), '1.5'); assert.equal(formatHours(120), '2'); assert.equal(formatHours(6000), '100');
  const signup = {fullName: 'Priya Sharma', roles: ['tutor'], guidelines: true};
  assert.equal(validateProfile(signup, false).ok, true);
  assert.equal(validateProfile({...signup, guidelines: false}, false).ok, false);
  assert.equal(validateProfile({...signup, roles: ['admin']}, false).ok, false);
  assert.equal(validateProfile({...signup, roles: []}, false).ok, false);
  assert.equal(validateProfile(signup, true).ok, false, 'a tutor needs ZIP, LinkedIn, school, subjects and a bio');
  assert.equal(validateProfile({...signup, bio: 'I like <script>'}, false).ok, false);
});

test('the privacy shaper hides a student until a request is accepted', () => {
  const row = {id: 'c1', studentId: 's', tutorId: 't', status: 'pending', subject: 'SAT Math', message: 'Hi', createdAt: 1, respondedAt: null, endedAt: null, confirmedMinutes: 125,
    studentName: 'Alex Morgan', studentGrade: '11th grade', studentEmail: 'alex@example.com', studentLat: 42.37, studentLon: -72.52,
    tutorName: 'Priya Sharma', tutorSchool: 'UMass', tutorLinkedin: 'https://www.linkedin.com/in/priya-s', tutorSubjects: ['SAT Math'], tutorEmail: 'priya@example.com', tutorLat: 42.4, tutorLon: -72.5};
  const pendingTutorView = shapeConnection('t', row);
  assert.equal(pendingTutorView.other.name, 'Alex M.'); assert.equal(pendingTutorView.other.email, undefined);
  assert.doesNotMatch(JSON.stringify(pendingTutorView), /Morgan|alex@example|42\.37/);
  const pendingStudentView = shapeConnection('s', row);
  assert.equal(pendingStudentView.other.name, 'Priya S.'); assert.doesNotMatch(JSON.stringify(pendingStudentView), /Sharma|priya@example/);
  const accepted = {...row, status: 'accepted'};
  assert.deepEqual([shapeConnection('t', accepted).other.name, shapeConnection('t', accepted).other.email], ['Alex Morgan', 'alex@example.com']);
  assert.deepEqual([shapeConnection('s', accepted).other.name, shapeConnection('s', accepted).other.email], ['Priya Sharma', 'priya@example.com']);
  assert.equal(shapeConnection('t', {...row, status: 'ended'}).other.name, 'Alex M.', 'details close again when a connection ends');
  assert.equal(shapeConnection('s', accepted).confirmedHours, 2);
  assert.throws(() => shapeConnection('stranger', row));
  assert.ok(miles({lat: 37.7725, lon: -122.4147}, {lat: 37.7725, lon: -122.4147}) < 0.01);
  assert.equal(lookupZip('00000'), null); assert.equal(lookupZip('01003').city, 'Amherst');
});

test('tutor matching end to end', {skip: DB ? false : 'Set DATABASE_URL to run the PostgreSQL tutoring tests.'}, async t => {
  const database = new PostgresStore(DB);
  await database.initialize();
  const run = randomUUID().slice(0, 8);
  const sent = [];
  const mailer = {configured: true, sendPasswordReset: async () => {}, send: async mail => { sent.push(mail); }};
  const server = createApp({database, adminEmails: `boss-${run}@example.com`, production: false, mailer});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const users = [];
  t.after(async () => {
    for (const email of users) await database.pool.query('DELETE FROM waypoint_users WHERE email = $1', [email]);
    await new Promise(r => server.close(r)); await database.close();
  });
  const headers = cookie => ({cookie, 'Content-Type': 'application/json', 'X-Waypoint-Client': '1'});
  const post = (cookie, path, body) => fetch(url + path, {method: 'POST', headers: headers(cookie), body: JSON.stringify(body)});
  const get = (cookie, path) => fetch(url + path, {headers: {cookie}});
  const signup = async (label, fullName, roles, extra = {}) => {
    const email = `${label}-${run}@example.com`; users.push(email);
    const r = await fetch(url + '/api/auth/signup', {method: 'POST', headers: headers(''), body: JSON.stringify({email, password: 'test password one', fullName, roles, guidelines: true, ...extra})});
    assert.equal(r.status, 200, await r.text());
    return {email, cookie: r.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('waypoint_session='))};
  };
  const tutorProfile = (fullName, zip, extra = {}) => ({fullName, roles: ['tutor'], guidelines: true, zip, linkedin: 'linkedin.com/in/' + fullName.toLowerCase().replace(/\W+/g, '-') + '-' + run, school: 'UMass Amherst',
    subjects: ['SAT Math', 'Algebra'], bio: 'Third-year math major who loves helping students get unstuck.', availability: 'Weekday evenings', radiusMiles: 15, ...extra});
  const studentProfile = (fullName, zip, extra = {}) => ({fullName, roles: ['student'], guidelines: true, zip, grade: '11th grade', subjectsWanted: ['SAT Math'], ...extra});

  // Sign-up asks for a role, a real name, and the guidelines.
  assert.equal((await fetch(url + '/api/auth/signup', {method: 'POST', headers: headers(''), body: JSON.stringify({email: `x-${run}@example.com`, password: 'test password one', fullName: 'Solo', roles: ['student'], guidelines: true})})).status, 400);
  assert.equal((await fetch(url + '/api/auth/signup', {method: 'POST', headers: headers(''), body: JSON.stringify({email: `x-${run}@example.com`, password: 'test password one', fullName: 'Solo Name', roles: ['student'], guidelines: false})})).status, 400);
  assert.equal((await fetch(url + '/api/auth/signup', {method: 'POST', headers: headers(''), body: JSON.stringify({email: `x-${run}@example.com`, password: 'test password one', fullName: 'Solo Name', roles: ['wizard'], guidelines: true})})).status, 400);

  const priya = await signup('priya', 'Priya Sharma', ['tutor']);
  const far = await signup('far', 'Faraway Tutor', ['tutor']);
  const alex = await signup('alex', 'Alex Morgan', ['student']);
  const both = await signup('both', 'Sam Rivera', ['student', 'tutor']);
  const boss = await signup('boss', 'Boss Admin', ['student']);
  assert.equal((await (await get(priya.cookie, '/api/tutoring/me')).json()).profile.complete, false, 'sign-up alone does not make a searchable profile');

  // Profile rules.
  assert.equal((await post(priya.cookie, '/api/tutoring/profile', tutorProfile('Priya Sharma', '00000'))).status, 400, 'unknown ZIP');
  assert.equal((await post(priya.cookie, '/api/tutoring/profile', tutorProfile('Priya Sharma', '01002', {linkedin: 'https://evil.com/in/priya'}))).status, 400, 'LinkedIn must be linkedin.com');
  assert.equal((await post(priya.cookie, '/api/tutoring/profile', tutorProfile('Priya Sharma', '01002', {school: undefined}))).status, 400);
  assert.equal((await post(alex.cookie, '/api/tutoring/profile', studentProfile('Alex Morgan', '01002', {grade: undefined}))).status, 400, 'students need a grade');
  for (const [who, body] of [[priya, tutorProfile('Priya Sharma', '01002')], [far, tutorProfile('Faraway Tutor', '94103')], [alex, studentProfile('Alex Morgan', '01003')], [both, {...tutorProfile('Sam Rivera', '01002'), roles: ['student', 'tutor'], grade: '12th grade'}]]) {
    const r = await post(who.cookie, '/api/tutoring/profile', body); assert.equal(r.status, 200, await r.text());
  }
  const mine = (await (await get(priya.cookie, '/api/tutoring/me')).json()).profile;
  assert.equal(mine.complete, true); assert.equal(mine.city, 'Amherst'); assert.equal(mine.fullName, 'Priya Sharma');

  // Search: nearby only, short names, no contact details, no ZIP.
  assert.equal((await get(priya.cookie, '/api/tutoring/tutors')).status, 403, 'tutors cannot search');
  const found = await (await get(alex.cookie, '/api/tutoring/tutors?radius=25')).json();
  const names = found.tutors.map(x => x.name).sort();
  assert.deepEqual(names, ['Priya S.', 'Sam R.']);
  assert.doesNotMatch(JSON.stringify(found), /Sharma|Rivera|Morgan|@example|01002|01003|latitude|lat"/);
  assert.match(found.tutors[0].distance, /^Within \d+ miles?$/); assert.equal(found.tutors[0].linkedin.startsWith('https://www.linkedin.com/in/'), true);
  assert.equal((await (await get(alex.cookie, '/api/tutoring/tutors?radius=25&subject=Chemistry')).json()).tutors.length, 0);
  assert.equal((await get(alex.cookie, '/api/tutoring/tutors?radius=7')).status, 400);
  assert.equal((await (await get(alex.cookie, '/api/tutoring/tutors?radius=5')).json()).tutors.every(x => x.distance !== 'Within 50 miles'), true);
  await post(both.cookie, '/api/tutoring/profile', {...tutorProfile('Sam Rivera', '01002'), roles: ['student', 'tutor'], grade: '12th grade', accepting: false});
  assert.deepEqual((await (await get(alex.cookie, '/api/tutoring/tutors?radius=25')).json()).tutors.map(x => x.name), ['Priya S.'], 'tutors who pause new students are hidden');

  // Invitation: the tutor's email names the student as "Alex M." and nothing else personal.
  const priyaId = found.tutors.find(x => x.name === 'Priya S.').id;
  assert.equal((await post(alex.cookie, '/api/tutoring/connect', {tutorId: priyaId, subject: 'Chemistry', message: 'Could you help me with algebra?'})).status, 400, 'subject must be one the tutor teaches');
  assert.equal((await post(alex.cookie, '/api/tutoring/connect', {tutorId: priyaId, subject: 'SAT Math', message: 'hi'})).status, 400);
  const outsideRadius = (await (await get(alex.cookie, '/api/tutoring/tutors?radius=50')).json()).tutors.find(x => x.name === 'Faraway T.');
  assert.equal(outsideRadius, undefined);
  assert.equal((await post(priya.cookie, '/api/tutoring/connect', {tutorId: priyaId, subject: 'SAT Math', message: 'Trying to connect to myself.'})).status, 403, 'tutor-only accounts cannot request');
  const invite = await post(alex.cookie, '/api/tutoring/connect', {tutorId: priyaId, subject: 'SAT Math', message: 'Could you help me get ready for the March SAT?'});
  assert.equal(invite.status, 201, await invite.clone().text());
  const connectionId = (await invite.json()).id;
  await new Promise(r => setTimeout(r, 50));
  assert.equal(sent.length, 1); assert.equal(sent[0].to, priya.email);
  assert.match(sent[0].text, /Alex M\./); assert.doesNotMatch(JSON.stringify(sent[0]), /Morgan|March SAT|alex-/);
  assert.equal((await post(alex.cookie, '/api/tutoring/connect', {tutorId: priyaId, subject: 'SAT Math', message: 'Sending the same request again.'})).status, 409);
  assert.equal((await (await get(alex.cookie, '/api/tutoring/tutors?radius=25')).json()).tutors[0].relation.status, 'pending');

  // What each side sees before and after acceptance.
  let tutorView = (await (await get(priya.cookie, '/api/tutoring/connections')).json()).connections[0];
  assert.equal(tutorView.other.name, 'Alex M.'); assert.equal(tutorView.other.email, undefined); assert.equal(tutorView.message, 'Could you help me get ready for the March SAT?');
  assert.doesNotMatch(JSON.stringify(tutorView), /Morgan|alex-/);
  assert.equal((await post(alex.cookie, '/api/tutoring/respond', {id: connectionId, decision: 'accept'})).status, 404, 'a student cannot accept their own request');
  assert.equal((await post(both.cookie, '/api/tutoring/respond', {id: connectionId, decision: 'accept'})).status, 404, 'a stranger cannot answer it');
  assert.equal((await post(priya.cookie, '/api/tutoring/hours', {connectionId, date: new Date().toISOString().slice(0, 10), minutes: 60, note: 'Algebra review'})).status, 404, 'no hours before accepting');
  assert.equal((await post(priya.cookie, '/api/tutoring/respond', {id: connectionId, decision: 'accept'})).status, 200);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(sent.length, 2); assert.equal(sent[1].to, alex.email); assert.doesNotMatch(JSON.stringify(sent[1]), /Sharma|priya-/);
  tutorView = (await (await get(priya.cookie, '/api/tutoring/connections')).json()).connections[0];
  assert.deepEqual([tutorView.other.name, tutorView.other.email], ['Alex Morgan', alex.email]);
  const studentView = (await (await get(alex.cookie, '/api/tutoring/connections')).json()).connections[0];
  assert.deepEqual([studentView.other.name, studentView.other.email], ['Priya Sharma', priya.email]);
  assert.equal((await post(priya.cookie, '/api/tutoring/respond', {id: connectionId, decision: 'decline'})).status, 404, 'an answered request cannot be answered again');

  // Hours: logged by the tutor, counted only once the student confirms.
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await post(alex.cookie, '/api/tutoring/hours', {connectionId, date: today, minutes: 60, note: 'Not a tutor'})).status, 403);
  for (const bad of [{minutes: 10}, {minutes: 241}, {minutes: 62}, {date: '2999-01-01'}, {date: 'yesterday'}, {note: ''}, {note: '<b>x</b>'}]) assert.equal((await post(priya.cookie, '/api/tutoring/hours', {connectionId, date: today, minutes: 60, note: 'Algebra review', ...bad})).status, 400, JSON.stringify(bad));
  const logged = await post(priya.cookie, '/api/tutoring/hours', {connectionId, date: today, minutes: 90, note: 'Linear equations and word problems'});
  assert.equal(logged.status, 201, await logged.clone().text());
  const hourId = (await logged.json()).id;
  assert.equal((await post(priya.cookie, '/api/tutoring/hours', {connectionId, date: today, minutes: 90, note: 'Linear equations and word problems'})).status, 409, 'duplicate entry');
  await new Promise(r => setTimeout(r, 50));
  assert.match(sent.at(-1).text, /1\.5 hour/); assert.equal(sent.at(-1).to, alex.email);
  assert.equal((await (await get(priya.cookie, '/api/tutoring/hours')).json()).asTutor.totals.confirmed, 0);
  assert.equal((await (await get(alex.cookie, '/api/tutoring/me')).json()).counts.hoursToConfirm, 1);
  assert.equal((await post(priya.cookie, '/api/tutoring/hours/decide', {id: hourId, decision: 'confirm'})).status, 404, 'tutors cannot confirm their own hours');
  assert.equal((await post(alex.cookie, '/api/tutoring/hours/decide', {id: hourId, decision: 'confirm'})).status, 200);
  const hours = await (await get(priya.cookie, '/api/tutoring/hours')).json();
  assert.equal(hours.asTutor.totals.confirmed, 90); assert.equal(hours.asTutor.entries[0].name, 'Alex Morgan');
  assert.equal((await post(priya.cookie, '/api/tutoring/hours/delete', {id: hourId})).status, 404, 'confirmed time is permanent');
  assert.equal((await post(alex.cookie, '/api/tutoring/hours/decide', {id: hourId, decision: 'dispute'})).status, 404);

  // Certificates: administrators only, and only from 100 confirmed hours.
  const priyaProfile = await database.pool.query('SELECT id AS user_id FROM waypoint_users WHERE email = $1', [priya.email]);
  const tutorId = priyaProfile.rows[0].user_id;
  assert.equal((await post(priya.cookie, '/api/admin/tutoring/certificate', {userId: tutorId})).status, 403);
  assert.equal((await get(priya.cookie, '/api/admin/tutoring')).status, 403);
  assert.equal((await post(boss.cookie, '/api/admin/tutoring/certificate', {userId: tutorId})).status, 409, 'under 100 hours');
  const overview = await (await get(boss.cookie, '/api/admin/tutoring')).json();
  const row = overview.tutors.find(x => x.email === priya.email);
  assert.deepEqual([row.confirmedMinutes, row.eligible, row.certificate], [90, false, null]);
  // Fast-forward: 99 more hours of confirmed sessions (hours can only be added through the app one at a time).
  const studentId = (await database.pool.query('SELECT id AS user_id FROM waypoint_users WHERE email = $1', [alex.email])).rows[0].user_id;
  const days = Array.from({length: 33}, (_, i) => `2025-01-${String(i % 28 + 1).padStart(2, '0')}`);
  for (let i = 0; i < 33; i++) await database.pool.query("INSERT INTO waypoint_hours (id, connection_id, tutor_id, student_id, session_date, minutes, note, status) VALUES ($1,$2,$3,$4,$5,180,$6,'confirmed')", [randomUUID(), connectionId, tutorId, studentId, days[i], `Session ${i}`]);
  const issued = await post(boss.cookie, '/api/admin/tutoring/certificate', {userId: tutorId});
  assert.equal(issued.status, 200, await issued.clone().text());
  const {code} = await issued.json();
  assert.match(code, /^[A-HJKMNP-TV-Z2-9]{12}$/);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(sent.at(-1).to, priya.email); assert.match(sent.at(-1).text, new RegExp(`#verify/${code}`));
  const verified = await (await fetch(`${url}/api/verify/${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8).toLowerCase()}`)).json();
  assert.deepEqual([verified.name, verified.hours, verified.students, verified.revoked], ['Priya Sharma', '100.5', 1, false]);
  assert.doesNotMatch(JSON.stringify(verified), /Alex|Morgan|@/);
  assert.equal((await fetch(`${url}/api/verify/AAAAAAAAAAAA`)).status, 404); assert.equal((await fetch(`${url}/api/verify/short`)).status, 404);
  assert.equal((await (await get(priya.cookie, '/api/tutoring/me')).json()).certificate.code, code);
  assert.equal((await post(boss.cookie, '/api/admin/tutoring/revoke', {id: (await (await get(boss.cookie, '/api/admin/tutoring')).json()).tutors.find(x => x.email === priya.email).certificate.id, reason: 'Issued in error'})).status, 200);
  assert.equal((await (await fetch(`${url}/api/verify/${code}`)).json()).revoked, true);
  assert.equal((await post(boss.cookie, '/api/admin/tutoring/review', {userId: tutorId, reviewed: true})).status, 200);
  assert.equal((await (await get(alex.cookie, '/api/tutoring/tutors?radius=25')).json()).tutors[0].reviewed, true);
  // Changing the LinkedIn address clears the review.
  await post(priya.cookie, '/api/tutoring/profile', tutorProfile('Priya Sharma', '01002', {linkedin: 'linkedin.com/in/priya-new-' + run}));
  assert.equal((await (await get(alex.cookie, '/api/tutoring/tutors?radius=25')).json()).tutors[0].reviewed, false);

  // Reports and blocks end the connection and hide each person from the other.
  assert.equal((await post(alex.cookie, '/api/tutoring/report', {connectionId, reason: 'short'})).status, 400);
  assert.equal((await post(both.cookie, '/api/tutoring/report', {connectionId, reason: 'I am not part of this connection at all.'})).status, 404);
  assert.equal((await post(alex.cookie, '/api/tutoring/report', {connectionId, reason: 'Asked to meet somewhere private.', block: true})).status, 200);
  assert.equal((await (await get(alex.cookie, '/api/tutoring/connections')).json()).connections[0].status, 'ended');
  assert.equal((await (await get(alex.cookie, '/api/tutoring/tutors?radius=25')).json()).tutors.length, 0);
  assert.equal((await post(alex.cookie, '/api/tutoring/connect', {tutorId: priyaId, subject: 'SAT Math', message: 'Trying to reach out again.'})).status, 404);
  const reports = (await (await get(boss.cookie, '/api/admin/tutoring')).json()).reports;
  assert.equal(reports.length >= 1, true); assert.match(reports[0].reason, /private/);
  assert.equal((await post(boss.cookie, '/api/admin/tutoring/close-report', {id: reports[0].id})).status, 200);

  // Declines start a cool-down, and per-day request limits stop spam.
  const sam = await signup('sam2', 'Sam Student', ['student']); await post(sam.cookie, '/api/tutoring/profile', studentProfile('Sam Student', '01002'));
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const tutor = await signup(`t${i}`, `Tutor Number${'abcdefg'[i]}`, ['tutor']);
    assert.equal((await post(tutor.cookie, '/api/tutoring/profile', tutorProfile(`Tutor Number${'abcdefg'[i]}`, '01002'))).status, 200);
    ids.push(tutor);
  }
  const list = (await (await get(sam.cookie, '/api/tutoring/tutors?radius=25')).json()).tutors.filter(x => x.name.startsWith('Tutor N'));
  assert.equal(list.length, 6);
  const statuses = [];
  for (const tutor of list) statuses.push((await post(sam.cookie, '/api/tutoring/connect', {tutorId: tutor.id, subject: 'Algebra', message: 'Could you help me with algebra please?'})).status);
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429], 'five requests a day');
  const theirs = (await (await get(sam.cookie, '/api/tutoring/connections')).json()).connections.find(c => c.status === 'pending');
  const first = (await Promise.all(ids.map(async u => ({u, c: (await (await get(u.cookie, '/api/tutoring/connections')).json()).connections[0]})))).find(x => x.c?.id === theirs.id);
  assert.equal((await post(first.u.cookie, '/api/tutoring/respond', {id: theirs.id, decision: 'decline'})).status, 200);
  const afterDecline = (await (await get(sam.cookie, '/api/tutoring/tutors?radius=25')).json()).tutors.filter(x => x.relation?.status === 'unavailable');
  assert.equal(afterDecline.length, 1, 'a declined tutor shows as unavailable without saying so');
  assert.equal((await post(sam.cookie, '/api/tutoring/connect', {tutorId: afterDecline[0].id, subject: 'Algebra', message: 'Asking again right away please.'})).status, 409, '30-day cool-down after a decline');
  // Withdrawing frees a slot.
  const pending = (await (await get(sam.cookie, '/api/tutoring/connections')).json()).connections.filter(c => c.status === 'pending');
  assert.equal((await post(sam.cookie, '/api/tutoring/withdraw', {id: pending[0].id})).status, 200);
  assert.equal((await post(sam.cookie, '/api/tutoring/withdraw', {id: pending[0].id})).status, 404);
  // Signed-out visitors get nothing.
  assert.equal((await fetch(url + '/api/tutoring/tutors')).status, 401); assert.equal((await fetch(url + '/api/tutoring/connections')).status, 401);
});
