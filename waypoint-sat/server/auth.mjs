import {randomBytes, createHash, scrypt, timingSafeEqual} from 'node:crypto';

// scrypt parameters are stored with every hash so they can be raised later without
// invalidating existing passwords. N=2^15, r=8 needs 32 MiB per hash.
const SCRYPT = {N: 2 ** 15, r: 8, p: 1, keylen: 64};
const MAXMEM = 96 * 1024 * 1024;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function derive(password, salt, {N, r, p, keylen}) {
  return new Promise((resolve, reject) => scrypt(password.normalize('NFKC'), salt, keylen, {N, r, p, maxmem: MAXMEM}, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(password, Buffer.from(salt, 'base64'), {N: Number(N), r: Number(r), p: Number(p), keylen: expected.length});
  return key.length === expected.length && timingSafeEqual(key, expected);
}
// Used when an email has no account so sign-in takes the same time either way.
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, dummyHash);
}
export const newToken = () => randomBytes(32).toString('hex');
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export const TOKEN = /^[a-f0-9]{64}$/;

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}
export function passwordProblem(value) {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters for your password.`;
  if (value.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters for your password.`;
  if (!value.trim()) return 'Your password cannot be only spaces.';
  return null;
}

// Fixed-window limiter held in memory. The service runs one replica; a restart resets it.
export class RateLimiter {
  constructor({limit, windowMs, now = () => Date.now()}) { this.limit = limit; this.windowMs = windowMs; this.now = now; this.hits = new Map(); }
  take(key) {
    const time = this.now();
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.reset <= time) this.hits.delete(k);
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= time) { this.hits.set(key, {count: 1, reset: time + this.windowMs}); return true; }
    entry.count++;
    return entry.count <= this.limit;
  }
  clear(key) { this.hits.delete(key); }
}

// Railway blocks outbound SMTP on most plans, so email goes through an HTTPS API (Resend).
// Without RESEND_API_KEY the link is written to the service log, which only project members can read.
export function createMailer({apiKey = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM || 'PrepOrbit AI <onboarding@resend.dev>'} = {}) {
  return {
    configured: !!apiKey,
    async sendPasswordReset({to, link}) {
      if (!apiKey) {
        console.warn(`[password-reset] Email delivery is not configured (set RESEND_API_KEY). Reset link for ${to}: ${link}`);
        return;
      }
      const text = `Someone asked to reset the password for your PrepOrbit AI SAT Studio account.\n\nOpen this link within 60 minutes to choose a new password:\n${link}\n\nIf you did not ask for this, you can ignore this email. Your password will not change.`;
      const html = `<p>Someone asked to reset the password for your PrepOrbit AI SAT Studio account.</p><p><a href="${link}">Choose a new password</a> (the link works for 60 minutes and only once).</p><p>If you did not ask for this, you can ignore this email. Your password will not change.</p>`;
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({from, to: [to], subject: 'Reset your PrepOrbit AI password', text, html}), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
    },
  };
}
