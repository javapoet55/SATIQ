import {randomBytes, randomUUID} from 'node:crypto';
import {CERTIFICATE_MINUTES, MAX_REQUESTS_PER_DAY, MAX_OPEN_REQUESTS, DECLINE_COOLDOWN_DAYS, MAX_SESSION_MINUTES, MAX_WEEKLY_MINUTES, LOG_WINDOW_DAYS} from '../src/data/tutoring-schema.ts';
import {analyzeHours} from './integrity.mjs';

// Every query that touches tutoring data lives here. Rows come back complete (including private
// fields such as full names and emails); server/tutoring.mjs decides what each viewer may see.
const PROFILE = `p.user_id AS "userId", p.full_name AS "fullName", p.roles, p.zip, p.city, p.state, p.lat, p.lon, p.grade,
  p.subjects_wanted AS "subjectsWanted", p.linkedin, p.school, p.subjects, p.bio, p.availability, p.radius_miles AS "radiusMiles",
  p.accepting, p.guidelines_accepted_at AS "guidelinesAcceptedAt", p.reviewed_at AS "reviewedAt"`;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const newCertificateCode = () => Array.from(randomBytes(12), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const fail = (code, message, status = 400) => Object.assign(new Error(message), {status, code});

export class TutoringStore {
  constructor(pool) { this.pool = pool; }
  async initialize() {
    const q = sql => this.pool.query(sql);
    await q(`CREATE TABLE IF NOT EXISTS waypoint_profiles (
      user_id UUID PRIMARY KEY REFERENCES waypoint_users(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL, roles TEXT[] NOT NULL,
      zip TEXT, city TEXT, state TEXT, lat DOUBLE PRECISION, lon DOUBLE PRECISION,
      grade TEXT, subjects_wanted TEXT[] NOT NULL DEFAULT '{}',
      linkedin TEXT, school TEXT, subjects TEXT[] NOT NULL DEFAULT '{}', bio TEXT, availability TEXT,
      radius_miles INTEGER NOT NULL DEFAULT 15, accepting BOOLEAN NOT NULL DEFAULT TRUE,
      guidelines_accepted_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ, reviewed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await q('CREATE INDEX IF NOT EXISTS waypoint_profiles_geo ON waypoint_profiles (lat, lon) WHERE zip IS NOT NULL');
    await q(`CREATE TABLE IF NOT EXISTS waypoint_connections (
      id UUID PRIMARY KEY,
      student_id UUID NOT NULL REFERENCES waypoint_users(id) ON DELETE CASCADE,
      tutor_id UUID NOT NULL REFERENCES waypoint_users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','withdrawn','ended')),
      subject TEXT NOT NULL, message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), responded_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
      CHECK (student_id <> tutor_id)
    )`);
    await q("CREATE UNIQUE INDEX IF NOT EXISTS waypoint_connections_active ON waypoint_connections (student_id, tutor_id) WHERE status IN ('pending','accepted')");
    await q('CREATE INDEX IF NOT EXISTS waypoint_connections_tutor ON waypoint_connections (tutor_id, status)');
    await q('CREATE INDEX IF NOT EXISTS waypoint_connections_student ON waypoint_connections (student_id, created_at DESC)');
    await q(`CREATE TABLE IF NOT EXISTS waypoint_blocks (
      blocker_id UUID NOT NULL REFERENCES waypoint_users(id) ON DELETE CASCADE,
      blocked_id UUID NOT NULL REFERENCES waypoint_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (blocker_id, blocked_id)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS waypoint_hours (
      id UUID PRIMARY KEY,
      connection_id UUID NOT NULL REFERENCES waypoint_connections(id) ON DELETE CASCADE,
      tutor_id UUID NOT NULL REFERENCES waypoint_users(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES waypoint_users(id) ON DELETE CASCADE,
      session_date DATE NOT NULL, minutes INTEGER NOT NULL CHECK (minutes BETWEEN 15 AND 240), note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','disputed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decided_at TIMESTAMPTZ
    )`);
    await q('CREATE INDEX IF NOT EXISTS waypoint_hours_tutor ON waypoint_hours (tutor_id, status)');
    await q('CREATE INDEX IF NOT EXISTS waypoint_hours_student ON waypoint_hours (student_id, status)');
    await q(`CREATE TABLE IF NOT EXISTS waypoint_certificates (
      id UUID PRIMARY KEY, code TEXT NOT NULL UNIQUE,
      tutor_id UUID NOT NULL REFERENCES waypoint_users(id) ON DELETE CASCADE,
      tutor_name TEXT NOT NULL, minutes INTEGER NOT NULL, students INTEGER NOT NULL,
      first_date DATE NOT NULL, last_date DATE NOT NULL,
      issued_by TEXT NOT NULL, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ, revoked_reason TEXT
    )`);
    await q('ALTER TABLE waypoint_certificates ADD COLUMN IF NOT EXISTS integrity JSONB');
    await q('ALTER TABLE waypoint_certificates ADD COLUMN IF NOT EXISTS review_note TEXT');
    await q('CREATE INDEX IF NOT EXISTS waypoint_certificates_tutor ON waypoint_certificates (tutor_id, issued_at DESC)');
    await q(`CREATE TABLE IF NOT EXISTS waypoint_reports (
      id UUID PRIMARY KEY,
      reporter_id UUID NOT NULL REFERENCES waypoint_users(id) ON DELETE CASCADE,
      target_id UUID NOT NULL REFERENCES waypoint_users(id) ON DELETE CASCADE,
      connection_id UUID REFERENCES waypoint_connections(id) ON DELETE SET NULL,
      reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_by TEXT, closed_at TIMESTAMPTZ
    )`);
  }

  async emailOf(userId) {
    const {rows} = await this.pool.query('SELECT email FROM waypoint_users WHERE id = $1', [userId]);
    return rows[0]?.email ?? null;
  }

  // ---- Profiles
  async getProfile(userId) {
    const {rows} = await this.pool.query(`SELECT ${PROFILE} FROM waypoint_profiles p WHERE p.user_id = $1`, [userId]);
    return rows[0] ?? null;
  }
  // geo is {zip, city, state, lat, lon} or null (no ZIP yet). Changing LinkedIn or school clears the admin review.
  async saveProfile(userId, c, geo, guidelinesAccepted) {
    const {rows} = await this.pool.query(`INSERT INTO waypoint_profiles
      (user_id, full_name, roles, zip, city, state, lat, lon, grade, subjects_wanted, linkedin, school, subjects, bio, availability, radius_miles, accepting, guidelines_accepted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, CASE WHEN $18 THEN NOW() END)
      ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, roles = EXCLUDED.roles, zip = EXCLUDED.zip, city = EXCLUDED.city,
        state = EXCLUDED.state, lat = EXCLUDED.lat, lon = EXCLUDED.lon, grade = EXCLUDED.grade, subjects_wanted = EXCLUDED.subjects_wanted,
        linkedin = EXCLUDED.linkedin, school = EXCLUDED.school, subjects = EXCLUDED.subjects, bio = EXCLUDED.bio, availability = EXCLUDED.availability,
        radius_miles = EXCLUDED.radius_miles, accepting = EXCLUDED.accepting,
        guidelines_accepted_at = COALESCE(waypoint_profiles.guidelines_accepted_at, EXCLUDED.guidelines_accepted_at),
        reviewed_at = CASE WHEN waypoint_profiles.linkedin IS NOT DISTINCT FROM EXCLUDED.linkedin AND waypoint_profiles.school IS NOT DISTINCT FROM EXCLUDED.school THEN waypoint_profiles.reviewed_at END,
        updated_at = NOW()
      RETURNING user_id`,
    [userId, c.fullName, c.roles, geo?.zip ?? null, geo?.city ?? null, geo?.state ?? null, geo?.lat ?? null, geo?.lon ?? null, c.grade, c.subjectsWanted, c.linkedin, c.school, c.subjects, c.bio, c.availability, c.radiusMiles, c.accepting, guidelinesAccepted]);
    return rows[0] ? this.getProfile(userId) : null;
  }
  async setReviewed(userId, reviewed, by) {
    const {rowCount} = await this.pool.query(`UPDATE waypoint_profiles SET reviewed_at = CASE WHEN $2 THEN NOW() END, reviewed_by = CASE WHEN $2 THEN $3 END WHERE user_id = $1 AND 'tutor' = ANY(roles)`, [userId, reviewed, by]);
    return rowCount > 0;
  }

  // ---- Search: tutors who accept students, near the given point, minus anyone blocked in either direction.
  async tutorsNear({viewerId, lat, lon, radius, subject}) {
    const dLat = radius / 69, dLon = radius / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    const {rows} = await this.pool.query(`SELECT ${PROFILE}, COALESCE(h.minutes, 0)::int AS "confirmedMinutes",
        EXISTS (SELECT 1 FROM waypoint_certificates c WHERE c.tutor_id = p.user_id AND c.revoked_at IS NULL) AS certified
      FROM waypoint_profiles p
      LEFT JOIN (SELECT tutor_id, SUM(minutes) AS minutes FROM waypoint_hours WHERE status = 'confirmed' GROUP BY tutor_id) h ON h.tutor_id = p.user_id
      WHERE 'tutor' = ANY(p.roles) AND p.accepting AND p.zip IS NOT NULL AND p.linkedin IS NOT NULL AND p.user_id <> $1
        AND p.lat BETWEEN $2 AND $3 AND p.lon BETWEEN $4 AND $5
        AND ($6::text IS NULL OR $6 = ANY(p.subjects))
        AND NOT EXISTS (SELECT 1 FROM waypoint_blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = $1))
      LIMIT 500`, [viewerId, lat - dLat, lat + dLat, lon - dLon, lon + dLon, subject ?? null]);
    return rows;
  }
  async relationsWith(viewerId, otherIds) {
    if (!otherIds.length) return [];
    const {rows} = await this.pool.query(`SELECT id, tutor_id AS "tutorId", status, responded_at AS "respondedAt" FROM waypoint_connections
      WHERE student_id = $1 AND tutor_id = ANY($2::uuid[]) ORDER BY created_at DESC`, [viewerId, otherIds]);
    return rows;
  }

  // ---- Connections
  async createRequest({studentId, tutorId, subject, message}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`req:${studentId}`]);
      const blocked = await client.query('SELECT 1 FROM waypoint_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [studentId, tutorId]);
      if (blocked.rowCount) throw fail('unavailable', 'This tutor is not available.', 404);
      const tutor = await client.query("SELECT accepting FROM waypoint_profiles WHERE user_id = $1 AND 'tutor' = ANY(roles) AND zip IS NOT NULL AND linkedin IS NOT NULL", [tutorId]);
      if (!tutor.rowCount || !tutor.rows[0].accepting) throw fail('unavailable', 'This tutor is not available.', 404);
      const existing = await client.query(`SELECT status, responded_at FROM waypoint_connections WHERE student_id = $1 AND tutor_id = $2 ORDER BY created_at DESC LIMIT 1`, [studentId, tutorId]);
      const last = existing.rows[0];
      if (last?.status === 'pending') throw fail('exists', 'You already have a request waiting for this tutor.', 409);
      if (last?.status === 'accepted') throw fail('exists', 'You are already connected with this tutor.', 409);
      if (last?.status === 'declined' && Date.now() - new Date(last.responded_at).getTime() < DECLINE_COOLDOWN_DAYS * 86400000) throw fail('cooldown', 'This tutor is not available right now. You can try again later.', 409);
      const recent = await client.query("SELECT COUNT(*)::int AS n FROM waypoint_connections WHERE student_id = $1 AND created_at > NOW() - INTERVAL '24 hours'", [studentId]);
      if (recent.rows[0].n >= MAX_REQUESTS_PER_DAY) throw fail('limit', `You can send up to ${MAX_REQUESTS_PER_DAY} requests a day. Try again tomorrow.`, 429);
      const open = await client.query("SELECT COUNT(*)::int AS n FROM waypoint_connections WHERE student_id = $1 AND status = 'pending'", [studentId]);
      if (open.rows[0].n >= MAX_OPEN_REQUESTS) throw fail('limit', `You already have ${MAX_OPEN_REQUESTS} requests waiting. Wait for replies or withdraw one.`, 429);
      const id = randomUUID();
      await client.query("INSERT INTO waypoint_connections (id, student_id, tutor_id, status, subject, message) VALUES ($1,$2,$3,'pending',$4,$5)", [id, studentId, tutorId, subject, message]);
      await client.query('COMMIT');
      return id;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  // Both people's profile and email are joined; the caller must shape the row for the viewer.
  async connectionsOf(userId) {
    const {rows} = await this.pool.query(`SELECT c.id, c.student_id AS "studentId", c.tutor_id AS "tutorId", c.status, c.subject, c.message,
        c.created_at AS "createdAt", c.responded_at AS "respondedAt", c.ended_at AS "endedAt",
        sp.full_name AS "studentName", sp.grade AS "studentGrade", sp.zip AS "studentZip", sp.lat AS "studentLat", sp.lon AS "studentLon", su.email AS "studentEmail",
        tp.full_name AS "tutorName", tp.school AS "tutorSchool", tp.linkedin AS "tutorLinkedin", tp.subjects AS "tutorSubjects", tp.zip AS "tutorZip", tp.lat AS "tutorLat", tp.lon AS "tutorLon", tu.email AS "tutorEmail",
        COALESCE((SELECT SUM(minutes) FROM waypoint_hours h WHERE h.connection_id = c.id AND h.status = 'confirmed'), 0)::int AS "confirmedMinutes"
      FROM waypoint_connections c
      JOIN waypoint_profiles sp ON sp.user_id = c.student_id JOIN waypoint_users su ON su.id = c.student_id
      JOIN waypoint_profiles tp ON tp.user_id = c.tutor_id JOIN waypoint_users tu ON tu.id = c.tutor_id
      WHERE c.student_id = $1 OR c.tutor_id = $1 ORDER BY c.created_at DESC LIMIT 200`, [userId]);
    return rows;
  }
  async connection(id) {
    const {rows} = await this.pool.query('SELECT id, student_id AS "studentId", tutor_id AS "tutorId", status, responded_at AS "respondedAt" FROM waypoint_connections WHERE id = $1', [id]);
    return rows[0] ?? null;
  }
  async respond(id, tutorId, accept) {
    const {rows} = await this.pool.query(`UPDATE waypoint_connections SET status = $3, responded_at = NOW() WHERE id = $1 AND tutor_id = $2 AND status = 'pending' RETURNING id, student_id AS "studentId"`, [id, tutorId, accept ? 'accepted' : 'declined']);
    return rows[0] ?? null;
  }
  async withdraw(id, studentId) {
    const {rowCount} = await this.pool.query("UPDATE waypoint_connections SET status = 'withdrawn', responded_at = NOW() WHERE id = $1 AND student_id = $2 AND status = 'pending'", [id, studentId]);
    return rowCount > 0;
  }
  async end(id, userId) {
    const {rowCount} = await this.pool.query("UPDATE waypoint_connections SET status = 'ended', ended_at = NOW() WHERE id = $1 AND (student_id = $2 OR tutor_id = $2) AND status = 'accepted'", [id, userId]);
    return rowCount > 0;
  }
  async block(blockerId, blockedId) {
    await this.pool.query('INSERT INTO waypoint_blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [blockerId, blockedId]);
    await this.pool.query(`UPDATE waypoint_connections SET status = CASE WHEN status = 'pending' THEN 'withdrawn' ELSE 'ended' END, ended_at = NOW()
      WHERE status IN ('pending','accepted') AND ((student_id = $1 AND tutor_id = $2) OR (student_id = $2 AND tutor_id = $1))`, [blockerId, blockedId]);
  }
  async report({reporterId, targetId, connectionId, reason}) {
    const id = randomUUID();
    await this.pool.query('INSERT INTO waypoint_reports (id, reporter_id, target_id, connection_id, reason) VALUES ($1,$2,$3,$4,$5)', [id, reporterId, targetId, connectionId, reason]);
    return id;
  }
  async reports(status = 'open') {
    const {rows} = await this.pool.query(`SELECT r.id, r.reason, r.status, r.created_at AS "createdAt", r.connection_id AS "connectionId",
        rp.full_name AS "reporterName", ru.email AS "reporterEmail", tp.full_name AS "targetName", tu.email AS "targetEmail", r.target_id AS "targetId"
      FROM waypoint_reports r JOIN waypoint_users ru ON ru.id = r.reporter_id JOIN waypoint_users tu ON tu.id = r.target_id
      LEFT JOIN waypoint_profiles rp ON rp.user_id = r.reporter_id LEFT JOIN waypoint_profiles tp ON tp.user_id = r.target_id
      WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 200`, [status]);
    return rows;
  }
  async closeReport(id, by) {
    const {rowCount} = await this.pool.query("UPDATE waypoint_reports SET status = 'closed', closed_by = $2, closed_at = NOW() WHERE id = $1 AND status = 'open'", [id, by]);
    return rowCount > 0;
  }
  async counts(userId) {
    const {rows} = await this.pool.query(`SELECT
      (SELECT COUNT(*) FROM waypoint_connections WHERE tutor_id = $1 AND status = 'pending')::int AS "incomingRequests",
      (SELECT COUNT(*) FROM waypoint_hours WHERE student_id = $1 AND status = 'pending')::int AS "hoursToConfirm"`, [userId]);
    return rows[0];
  }

  // ---- Teaching hours. Only hours the student confirms count toward a certificate.
  async addHours({connectionId, tutorId, date, minutes, note}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hours:${tutorId}`]);
      const c = await client.query("SELECT student_id, responded_at FROM waypoint_connections WHERE id = $1 AND tutor_id = $2 AND status = 'accepted'", [connectionId, tutorId]);
      if (!c.rowCount) throw fail('connection', 'Log hours for a student you are connected with.', 404);
      const day = await client.query(`SELECT ($1::date > (NOW() AT TIME ZONE 'UTC')::date + 1) AS future, ($1::date < ($2::timestamptz AT TIME ZONE 'UTC')::date - 1) AS early`, [date, c.rows[0].responded_at]);
      if (day.rows[0].future) throw fail('date', 'That date is in the future.');
      if (day.rows[0].early) throw fail('date', 'That date is before you connected with this student.');
      const old = await client.query(`SELECT ($1::date < (NOW() AT TIME ZONE 'UTC')::date - $2::int) AS old`, [date, LOG_WINDOW_DAYS]);
      if (old.rows[0].old) throw fail('date', `Log sessions within ${LOG_WINDOW_DAYS} days of when they happen.`);
      const dup = await client.query('SELECT 1 FROM waypoint_hours WHERE connection_id = $1 AND session_date = $2 AND minutes = $3 AND note = $4', [connectionId, date, minutes, note]);
      if (dup.rowCount) throw fail('duplicate', 'You already logged this session.', 409);
      const sameDay = await client.query('SELECT COALESCE(SUM(minutes), 0)::int AS m FROM waypoint_hours WHERE tutor_id = $1 AND session_date = $2 AND status <> $3', [tutorId, date, 'disputed']);
      if (sameDay.rows[0].m + minutes > 480) throw fail('daily', 'That would be more than 8 hours of teaching in one day.');
      const withStudent = await client.query('SELECT COALESCE(SUM(minutes), 0)::int AS m FROM waypoint_hours WHERE connection_id = $1 AND session_date = $2 AND status <> $3', [connectionId, date, 'disputed']);
      if (withStudent.rows[0].m + minutes > MAX_SESSION_MINUTES) throw fail('studentDay', 'That would be more than 4 hours with one student in a day.');
      const week = await client.query(`SELECT COALESCE(SUM(minutes) FILTER (WHERE session_date BETWEEN $2::date - 6 AND $2::date), 0)::int AS before, COALESCE(SUM(minutes) FILTER (WHERE session_date BETWEEN $2::date AND $2::date + 6), 0)::int AS after
        FROM waypoint_hours WHERE tutor_id = $1 AND status <> 'disputed'`, [tutorId, date]);
      if (Math.max(week.rows[0].before, week.rows[0].after) + minutes > MAX_WEEKLY_MINUTES) throw fail('weekly', 'That would be more than 40 hours of teaching in one week.');
      const waiting = await client.query("SELECT COUNT(*)::int AS n FROM waypoint_hours WHERE tutor_id = $1 AND status = 'pending'", [tutorId]);
      if (waiting.rows[0].n >= 60) throw fail('pending', 'Many sessions are still waiting for confirmation. Ask your students to confirm them first.', 429);
      const id = randomUUID();
      await client.query('INSERT INTO waypoint_hours (id, connection_id, tutor_id, student_id, session_date, minutes, note) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, connectionId, tutorId, c.rows[0].student_id, date, minutes, note]);
      await client.query('COMMIT');
      return {id, studentId: c.rows[0].student_id};
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async deleteHours(id, tutorId) {
    const {rowCount} = await this.pool.query("DELETE FROM waypoint_hours WHERE id = $1 AND tutor_id = $2 AND status <> 'confirmed'", [id, tutorId]);
    return rowCount > 0;
  }
  async decideHours(id, studentId, confirm) {
    const {rows} = await this.pool.query(`UPDATE waypoint_hours SET status = $3, decided_at = NOW() WHERE id = $1 AND student_id = $2 AND status = 'pending' RETURNING id, tutor_id AS "tutorId"`, [id, studentId, confirm ? 'confirmed' : 'disputed']);
    return rows[0] ?? null;
  }
  async hoursAsTutor(tutorId) {
    const {rows} = await this.pool.query(`SELECT h.id, h.connection_id AS "connectionId", to_char(h.session_date, 'YYYY-MM-DD') AS date, h.minutes, h.note, h.status, h.created_at AS "createdAt",
        sp.full_name AS "studentName", c.status AS "connectionStatus" FROM waypoint_hours h JOIN waypoint_profiles sp ON sp.user_id = h.student_id
        JOIN waypoint_connections c ON c.id = h.connection_id
      WHERE h.tutor_id = $1 ORDER BY h.session_date DESC, h.created_at DESC LIMIT 300`, [tutorId]);
    return rows;
  }
  async hoursAsStudent(studentId) {
    const {rows} = await this.pool.query(`SELECT h.id, to_char(h.session_date, 'YYYY-MM-DD') AS date, h.minutes, h.note, h.status, tp.full_name AS "tutorName", c.status AS "connectionStatus"
      FROM waypoint_hours h JOIN waypoint_profiles tp ON tp.user_id = h.tutor_id JOIN waypoint_connections c ON c.id = h.connection_id WHERE h.student_id = $1 ORDER BY h.status = 'pending' DESC, h.session_date DESC LIMIT 200`, [studentId]);
    return rows;
  }
  // What the tutor sees: raw confirmed time, and the time that counts toward the certificate (after the per-student limit).
  async totals(tutorId) {
    const {rows} = await this.pool.query(`SELECT COALESCE(SUM(minutes) FILTER (WHERE status = 'pending'), 0)::int AS pending,
        to_char(MIN(session_date) FILTER (WHERE status = 'confirmed'), 'YYYY-MM-DD') AS "firstDate", to_char(MAX(session_date) FILTER (WHERE status = 'confirmed'), 'YYYY-MM-DD') AS "lastDate"
      FROM waypoint_hours WHERE tutor_id = $1`, [tutorId]);
    const a = (await this.integrityFor([tutorId])).get(tutorId);
    return {...rows[0], confirmed: a.rawMinutes, counted: a.countedMinutes, students: a.students, overCap: a.rawMinutes - a.countedMinutes};
  }
  // Integrity analysis for many tutors at once (one query per table, never one per tutor).
  async integrityFor(tutorIds, db = this.pool) {
    const result = new Map(tutorIds.map(id => [id, null]));
    if (!tutorIds.length) return result;
    // Sequential: this may run on a transaction client, which cannot run queries in parallel.
    const sessions = await db.query(`SELECT tutor_id AS "tutorId", student_id AS "studentId", to_char(session_date, 'YYYY-MM-DD') AS date, minutes, note,
          (EXTRACT(EPOCH FROM created_at) * 1000)::float8 AS "createdAt", (EXTRACT(EPOCH FROM decided_at) * 1000)::float8 AS "decidedAt"
        FROM waypoint_hours WHERE tutor_id = ANY($1) AND status = 'confirmed'`, [tutorIds]);
    const stats = await db.query(`SELECT tutor_id AS "tutorId", COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'disputed')::int AS disputed FROM waypoint_hours WHERE tutor_id = ANY($1) GROUP BY tutor_id`, [tutorIds]);
    const reciprocal = await db.query("SELECT student_id AS \"tutorId\", tutor_id AS \"studentId\" FROM waypoint_connections WHERE student_id = ANY($1) AND status IN ('accepted','ended')", [tutorIds]);
    const studentIds = [...new Set(sessions.rows.map(r => r.studentId))];
    const people = studentIds.length ? await db.query(`SELECT p.user_id AS id, p.full_name AS name, (EXTRACT(EPOCH FROM u.created_at) * 1000)::float8 AS "joinedAt" FROM waypoint_profiles p JOIN waypoint_users u ON u.id = p.user_id WHERE p.user_id = ANY($1)`, [studentIds]) : {rows: []};
    const students = Object.fromEntries(people.rows.map(r => [r.id, {name: r.name, joinedAt: r.joinedAt}]));
    for (const id of tutorIds) {
      result.set(id, analyzeHours({
        sessions: sessions.rows.filter(r => r.tutorId === id), students,
        reciprocal: reciprocal.rows.filter(r => r.tutorId === id).map(r => r.studentId),
        stats: stats.rows.find(r => r.tutorId === id) ?? {total: 0, disputed: 0},
      }));
    }
    return result;
  }

  // ---- Certificates: issued only by an administrator, only at or above the hour threshold, and checked inside one locked transaction.
  async issueCertificate(tutorId, issuedBy, reviewNote = '') {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hours:${tutorId}`]);
      const p = await client.query("SELECT full_name FROM waypoint_profiles WHERE user_id = $1 AND 'tutor' = ANY(roles)", [tutorId]);
      if (!p.rowCount) throw fail('tutor', 'That tutor was not found.', 404);
      const a = (await this.integrityFor([tutorId], client)).get(tutorId);
      if (!a.eligible) throw fail('hours', a.rawMinutes >= CERTIFICATE_MINUTES ? 'This tutor has 100 confirmed hours, but not 100 that count: at most 25 hours with any one student count toward a certificate.' : 'This tutor has not reached 100 confirmed hours yet.', 409);
      if (a.needsNote && reviewNote.trim().length < 10) throw fail('review', 'This tutor has high-priority flags. Write a short note (at least 10 characters) saying what you checked before issuing the certificate.', 409);
      const t = await client.query("SELECT to_char(MIN(session_date), 'YYYY-MM-DD') AS first, to_char(MAX(session_date), 'YYYY-MM-DD') AS last FROM waypoint_hours WHERE tutor_id = $1 AND status = 'confirmed'", [tutorId]);
      const total = {minutes: a.countedMinutes, students: a.students, ...t.rows[0]};
      await client.query("UPDATE waypoint_certificates SET revoked_at = NOW(), revoked_reason = 'Replaced by a newer certificate' WHERE tutor_id = $1 AND revoked_at IS NULL", [tutorId]);
      const id = randomUUID(), code = newCertificateCode();
      await client.query(`INSERT INTO waypoint_certificates (id, code, tutor_id, tutor_name, minutes, students, first_date, last_date, issued_by, integrity, review_note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, code, tutorId, p.rows[0].full_name, total.minutes, total.students, total.first, total.last, issuedBy, JSON.stringify({rawMinutes: a.rawMinutes, countedMinutes: a.countedMinutes, flags: a.flags}), reviewNote.trim().slice(0, 500) || null]);
      await client.query('COMMIT');
      return {id, code};
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async certificateByCode(code) {
    const {rows} = await this.pool.query(`SELECT id, code, tutor_id AS "tutorId", tutor_name AS "tutorName", minutes, students, to_char(first_date, 'YYYY-MM-DD') AS "firstDate", to_char(last_date, 'YYYY-MM-DD') AS "lastDate",
      issued_at AS "issuedAt", revoked_at AS "revokedAt" FROM waypoint_certificates WHERE code = $1`, [code]);
    return rows[0] ?? null;
  }
  async activeCertificate(tutorId) {
    const {rows} = await this.pool.query('SELECT id, code, minutes, issued_at AS "issuedAt" FROM waypoint_certificates WHERE tutor_id = $1 AND revoked_at IS NULL ORDER BY issued_at DESC LIMIT 1', [tutorId]);
    return rows[0] ?? null;
  }
  async revokeCertificate(id, reason) {
    const {rowCount} = await this.pool.query('UPDATE waypoint_certificates SET revoked_at = NOW(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL', [id, reason]);
    return rowCount > 0;
  }
  async tutorsForAdmin() {
    const {rows} = await this.pool.query(`SELECT ${PROFILE}, u.email, u.created_at AS "joinedAt",
        COALESCE(h.confirmed, 0)::int AS "confirmedMinutes", COALESCE(h.pending, 0)::int AS "pendingMinutes", COALESCE(h.students, 0)::int AS students,
        c.id AS "certificateId", c.code AS "certificateCode", c.issued_at AS "certificateIssuedAt", c.minutes AS "certificateMinutes"
      FROM waypoint_profiles p JOIN waypoint_users u ON u.id = p.user_id
      LEFT JOIN (SELECT tutor_id, SUM(minutes) FILTER (WHERE status = 'confirmed') AS confirmed, SUM(minutes) FILTER (WHERE status = 'pending') AS pending,
                   COUNT(DISTINCT student_id) FILTER (WHERE status = 'confirmed') AS students FROM waypoint_hours GROUP BY tutor_id) h ON h.tutor_id = p.user_id
      LEFT JOIN LATERAL (SELECT id, code, issued_at, minutes FROM waypoint_certificates WHERE tutor_id = p.user_id AND revoked_at IS NULL ORDER BY issued_at DESC LIMIT 1) c ON TRUE
      WHERE 'tutor' = ANY(p.roles) ORDER BY COALESCE(h.confirmed, 0) DESC, p.created_at DESC LIMIT 500`);
    return rows;
  }
}
