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
}
