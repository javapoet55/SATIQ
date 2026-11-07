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
  async close() { await this.pool.end(); }
  async assistantHistory(owner) {
    const {rows} = await this.pool.query(`SELECT request_id AS id, message, answer, context, created_at AS "createdAt"
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
      if (old?.status === 'completed') return {kind:'completed',answer:old.answer,context:old.context};
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
  async completeAssistant(owner,id,answer) {
    await this.pool.query(`UPDATE waypoint_assistant SET answer=$3,status='completed',updated_at=NOW() WHERE owner_hash=$1 AND request_id=$2`,[owner,id,answer]);
  }
  async failAssistant(owner,id) {
    await this.pool.query(`UPDATE waypoint_assistant SET status='failed',updated_at=NOW() WHERE owner_hash=$1 AND request_id=$2 AND status='pending'`,[owner,id]);
  }
}
