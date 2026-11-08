import pg from 'pg';
import {randomUUID} from 'node:crypto';

export class PostgresStore {
  constructor(connectionString) {
    if (!connectionString) throw new Error('DATABASE_URL is required.');
    this.pool = new pg.Pool({connectionString, max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000});
    this.pool.on('error', () => console.error('Database connection lost; subsequent requests will reconnect.'));
  }
  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS waypoint_progress (
      owner_hash TEXT PRIMARY KEY,
      profile_id UUID NOT NULL UNIQUE,
      state JSONB NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      last_write_id UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS waypoint_assistant (
      owner_hash TEXT NOT NULL REFERENCES waypoint_progress(owner_hash) ON DELETE CASCADE,
      request_id UUID NOT NULL, message TEXT NOT NULL, answer TEXT,
      status TEXT NOT NULL DEFAULT 'pending', requests INTEGER NOT NULL DEFAULT 1, context JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (owner_hash, request_id)
    )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS waypoint_assistant_created ON waypoint_assistant(created_at)');
    await this.pool.query("ALTER TABLE waypoint_assistant ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb");
    await this.pool.query(`CREATE TABLE IF NOT EXISTS waypoint_users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS waypoint_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES waypoint_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS waypoint_sessions_user ON waypoint_sessions (user_id)');
    await this.pool.query(`CREATE TABLE IF NOT EXISTS waypoint_password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES waypoint_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS waypoint_password_resets_user ON waypoint_password_resets (user_id)');
    await this.pool.query(`CREATE TABLE IF NOT EXISTS waypoint_questions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      payload JSONB NOT NULL,
      verification JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_by TEXT,
      decided_at TIMESTAMPTZ
    )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS waypoint_questions_status ON waypoint_questions (status, created_at DESC)');
    await this.pool.query(`CREATE TABLE IF NOT EXISTS waypoint_ai_usage (
      owner_hash TEXT NOT NULL,
      day DATE NOT NULL,
      feature TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_hash, day, feature)
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS waypoint_insights (
      owner_hash TEXT NOT NULL,
      day TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (owner_hash, day, kind)
    )`);
  }
  async health() { await this.pool.query('SELECT 1'); }
  async get(owner, initial) {
    await this.pool.query('INSERT INTO waypoint_progress (owner_hash, profile_id, state) VALUES ($1, $2, $3::jsonb) ON CONFLICT (owner_hash) DO NOTHING', [owner, randomUUID(), JSON.stringify(initial)]);
    const {rows} = await this.pool.query('SELECT profile_id AS "profileId", state, revision FROM waypoint_progress WHERE owner_hash = $1', [owner]);
    return rows[0];
  }
  async put(owner, revision, state, writeId) {
    const {rows} = await this.pool.query(`UPDATE waypoint_progress SET state = $1::jsonb, revision = revision + 1, last_write_id = $2, updated_at = NOW()
      WHERE owner_hash = $3 AND revision = $4 RETURNING revision`, [JSON.stringify(state), writeId, owner, revision]);
    if (rows[0]) return rows[0];
    // Retrying a request whose response was lost must not duplicate or overwrite a save.
    const existing = await this.pool.query('SELECT revision FROM waypoint_progress WHERE owner_hash = $1 AND last_write_id = $2', [owner, writeId]);
    return existing.rows[0] ?? null;
  }
  // Moves a pre-account (cookie-only) profile and its assistant history onto an account,
  // only if the account has no progress yet. One transaction, so nothing is half-moved.
  async claimProgress(fromOwner, toOwner) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const moved = await client.query(`INSERT INTO waypoint_progress (owner_hash, profile_id, state, revision, last_write_id, updated_at)
        SELECT $2, gen_random_uuid(), state, revision, last_write_id, NOW() FROM waypoint_progress
        WHERE owner_hash = $1 AND NOT EXISTS (SELECT 1 FROM waypoint_progress WHERE owner_hash = $2)
        ON CONFLICT (owner_hash) DO NOTHING RETURNING owner_hash`, [fromOwner, toOwner]);
      if (!moved.rows[0]) { await client.query('ROLLBACK'); return false; }
      await client.query('UPDATE waypoint_assistant SET owner_hash = $2 WHERE owner_hash = $1', [fromOwner, toOwner]);
      const old = await client.query('DELETE FROM waypoint_progress WHERE owner_hash = $1 RETURNING profile_id', [fromOwner]);
      // Keep the profile ID so a pending browser backup from before sign-up still matches and gets saved.
      await client.query('UPDATE waypoint_progress SET profile_id = $2 WHERE owner_hash = $1', [toOwner, old.rows[0].profile_id]);
      await client.query('COMMIT');
      return true;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  // Accounts
  async createUser(email, passwordHash) {
    const {rows} = await this.pool.query('INSERT INTO waypoint_users (id, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id, email', [randomUUID(), email, passwordHash]);
    return rows[0] ?? null;
  }
  async findUserByEmail(email) {
    const {rows} = await this.pool.query('SELECT id, email, password_hash AS "passwordHash" FROM waypoint_users WHERE email = $1', [email]);
    return rows[0] ?? null;
  }
  async createSession(tokenHash, userId, expiresAt) {
    await this.pool.query('DELETE FROM waypoint_sessions WHERE expires_at < NOW()');
    await this.pool.query('INSERT INTO waypoint_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, new Date(expiresAt)]);
  }
  async getSessionUser(tokenHash) {
    const {rows} = await this.pool.query(`SELECT u.id, u.email FROM waypoint_sessions s JOIN waypoint_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`, [tokenHash]);
    return rows[0] ?? null;
  }
  async deleteSession(tokenHash) { await this.pool.query('DELETE FROM waypoint_sessions WHERE token_hash = $1', [tokenHash]); }
  async createPasswordReset(tokenHash, userId, expiresAt) {
    // Only the newest link works.
    await this.pool.query('DELETE FROM waypoint_password_resets WHERE user_id = $1 OR expires_at < NOW()', [userId]);
    await this.pool.query('INSERT INTO waypoint_password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, new Date(expiresAt)]);
  }
  // Atomically spends a reset token, sets the new password and signs out every existing session.
  async resetPassword(tokenHash, passwordHash) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows} = await client.query(`UPDATE waypoint_password_resets SET used_at = NOW()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING user_id`, [tokenHash]);
      if (!rows[0]) { await client.query('ROLLBACK'); return null; }
      const userId = rows[0].user_id;
      const user = await client.query('UPDATE waypoint_users SET password_hash = $1, password_changed_at = NOW() WHERE id = $2 RETURNING id, email', [passwordHash, userId]);
      await client.query('DELETE FROM waypoint_sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM waypoint_password_resets WHERE user_id = $1 AND token_hash <> $2', [userId, tokenHash]);
      await client.query('COMMIT');
      return user.rows[0];
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  // AI usage: one atomic counter per student, UTC day, and feature. Returns false once the daily limit is reached.
  async takeAiUsage(owner, feature, limit) {
    const {rows} = await this.pool.query(`INSERT INTO waypoint_ai_usage (owner_hash, day, feature, count) VALUES ($1, CURRENT_DATE, $2, 1)
      ON CONFLICT (owner_hash, day, feature) DO UPDATE SET count = waypoint_ai_usage.count + 1 WHERE waypoint_ai_usage.count < $3
      RETURNING count`, [owner, feature, limit]);
    return rows.length > 0;
  }
  async getInsight(owner, day, kind) {
    const {rows} = await this.pool.query('SELECT text, created_at AS "createdAt" FROM waypoint_insights WHERE owner_hash = $1 AND day = $2 AND kind = $3', [owner, day, kind]);
    return rows[0] ?? null;
  }
  async saveInsight(owner, day, kind, text) {
    await this.pool.query(`INSERT INTO waypoint_insights (owner_hash, day, kind, text) VALUES ($1, $2, $3, $4)
      ON CONFLICT (owner_hash, day, kind) DO UPDATE SET text = EXCLUDED.text, created_at = NOW()`, [owner, day, kind, text]);
  }
  // Generated questions
  async saveGeneratedQuestion(question, status, verification, createdBy) {
    await this.pool.query('INSERT INTO waypoint_questions (id, status, payload, verification, created_by) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)',
      [question.id, status, JSON.stringify(question), JSON.stringify(verification), createdBy]);
  }
  async listGeneratedQuestions(status, limit = 200) {
    const {rows} = await this.pool.query(`SELECT id, status, payload, verification, created_by AS "createdBy", created_at AS "createdAt", decided_by AS "decidedBy", decided_at AS "decidedAt"
      FROM waypoint_questions WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2`, [status, limit]);
    return rows;
  }
  async decideGeneratedQuestion(id, status, decidedBy) {
    const {rowCount} = await this.pool.query(`UPDATE waypoint_questions SET status = $2, decided_by = $3, decided_at = NOW()
      WHERE id = $1 AND status IN ('pending', 'flagged', 'approved', 'rejected')`, [id, status, decidedBy]);
    return rowCount > 0;
  }
  async approvedQuestions() {
    const {rows} = await this.pool.query("SELECT payload FROM waypoint_questions WHERE status = 'approved' ORDER BY created_at");
    return rows.map(r => r.payload);
  }
  async close() { await this.pool.end(); }
  async assistantHistory(owner) {
    const {rows} = await this.pool.query(`SELECT request_id AS id, message, answer, context, details, created_at AS "createdAt"
      FROM waypoint_assistant WHERE owner_hash=$1 AND status='completed' ORDER BY created_at DESC LIMIT 20`,[owner]);
    return rows.reverse();
  }
  async reserveAssistant(owner, id, message, context) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize reservations across instances, including the global daily allowance.
      await client.query('SELECT pg_advisory_xact_lock(192837465)');
      const old = (await client.query('SELECT * FROM waypoint_assistant WHERE owner_hash=$1 AND request_id=$2',[owner,id])).rows[0];
      if (old && old.message !== message) return {kind:'mismatch'};
      if (old?.status === 'completed') return {kind:'completed',answer:old.answer,context:old.context,details:old.details};
      const busy = await client.query(`SELECT 1 FROM waypoint_assistant WHERE owner_hash=$1 AND status='pending' AND updated_at > NOW()-INTERVAL '90 seconds' LIMIT 1`,[owner]);
      if (busy.rowCount) return {kind:'busy'};
      const counts = (await client.query(`SELECT COALESCE(SUM(requests),0)::int AS total, COALESCE(SUM(requests) FILTER (WHERE owner_hash=$1),0)::int AS personal FROM waypoint_assistant WHERE updated_at > NOW()-INTERVAL '24 hours'`,[owner])).rows[0];
      if (counts.total >= 500 || counts.personal >= 30) return {kind:'limit'};
      await client.query(`INSERT INTO waypoint_assistant(owner_hash,request_id,message,context) VALUES($1,$2,$3,$4::jsonb)
        ON CONFLICT(owner_hash,request_id) DO UPDATE SET status='pending',requests=waypoint_assistant.requests+1,context=EXCLUDED.context,updated_at=NOW()`,[owner,id,message,JSON.stringify(context)]);
      await client.query('COMMIT');
      return {kind:'reserved'};
    } finally {await client.query('ROLLBACK').catch(()=>{});client.release();}
  }
  async completeAssistant(owner,id,answer,details={}) {
    await this.pool.query(`UPDATE waypoint_assistant SET answer=$3,details=$4::jsonb,status='completed',updated_at=NOW() WHERE owner_hash=$1 AND request_id=$2`,[owner,id,answer,JSON.stringify(details)]);
  }
  async failAssistant(owner,id) {
    await this.pool.query(`UPDATE waypoint_assistant SET status='failed',updated_at=NOW() WHERE owner_hash=$1 AND request_id=$2 AND status='pending'`,[owner,id]);
  }
}
