// Shared by the browser and the server: what a tutoring profile holds, how it is validated, and
// how names are shortened before two people are connected. Keep this file free of imports so the
// server can load it directly.

export type Role = 'student' | 'tutor';
export const ROLES: Role[] = ['student', 'tutor'];

export const SUBJECTS = ['SAT Math', 'SAT Reading & Writing', 'Algebra', 'Geometry', 'Precalculus & Calculus', 'Statistics', 'English & Writing', 'Biology', 'Chemistry', 'Physics', 'Computer Science', 'Other'] as const;
export const GRADES = ['8th grade or below', '9th grade', '10th grade', '11th grade', '12th grade', 'College'] as const;
export const SEARCH_RADII = [5, 10, 25, 50] as const;
export const MAX_SUBJECTS = 6;

// A tutor earns a certificate after this much confirmed teaching time.
export const CERTIFICATE_HOURS = 100;
export const CERTIFICATE_MINUTES = CERTIFICATE_HOURS * 60;
export const MIN_SESSION_MINUTES = 15;
export const MAX_SESSION_MINUTES = 240;
// Limits that keep invitations from turning into spam.
export const MAX_REQUESTS_PER_DAY = 5;
export const MAX_OPEN_REQUESTS = 10;
export const DECLINE_COOLDOWN_DAYS = 30;

export interface ProfileInput {
  fullName: string; roles: Role[]; guidelines: boolean;
  zip?: string; grade?: string; subjectsWanted?: string[];
  linkedin?: string; school?: string; subjects?: string[]; bio?: string; availability?: string; radiusMiles?: number; accepting?: boolean;
}
export interface CleanProfile {
  fullName: string; roles: Role[]; zip: string | null; grade: string | null; subjectsWanted: string[];
  linkedin: string | null; school: string | null; subjects: string[]; bio: string | null; availability: string | null; radiusMiles: number; accepting: boolean;
}

// Letters from any language plus the few marks real names use. No digits, links or symbols, so a name
// can safely appear in an email or a certificate.
const NAME_PART = /^[\p{L}\p{M}][\p{L}\p{M}'’.-]*$/u;
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  const parts = name.split(' ');
  if (name.length < 3 || name.length > 80 || parts.length < 2 || parts.length > 6) return null;
  return parts.every(p => NAME_PART.test(p)) ? name : null;
}
// "Priya Sharma" -> "Priya S.": what other people see until a connection is accepted.
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? 'Member';
  const initial = Array.from(parts[parts.length - 1])[0];
  return `${parts[0]} ${initial.toUpperCase()}.`;
}

// Only public LinkedIn profile addresses are accepted, and they are stored in one standard form.
export function normalizeLinkedIn(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([A-Za-z0-9%_-]{3,100})\/?(?:[?#].*)?$/i.exec(value.trim());
  return match ? `https://www.linkedin.com/in/${match[1]}` : null;
}

const list = (value: unknown, allowed: readonly string[], max: number): string[] | null => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const picked = [...new Set(value)];
  return picked.every(v => typeof v === 'string' && allowed.includes(v)) ? picked as string[] : null;
};
const text = (value: unknown, min: number, max: number): string | null | undefined => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const t = value.trim().replace(/[ \t]+/g, ' ');
  return t.length >= min && t.length <= max && !/[<>]/.test(t) ? t : undefined;
};

export type Validated = {ok: true; value: CleanProfile} | {ok: false; error: string};
// complete=false is used at sign-up (name, role, guidelines). complete=true is the full profile, which
// a tutor needs before appearing in search and a student needs before searching.
export function validateProfile(input: unknown, complete: boolean): Validated {
  const bad = (error: string): Validated => ({ok: false, error});
  const p = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const fullName = cleanName(p.fullName);
  if (!fullName) return bad('Enter your first and last name using letters only.');
  const roles = Array.isArray(p.roles) ? [...new Set(p.roles)].filter((r): r is Role => ROLES.includes(r as Role)) : [];
  if (!roles.length || (Array.isArray(p.roles) && roles.length !== new Set(p.roles).size)) return bad('Choose whether you are a student, a tutor, or both.');
  if (p.guidelines !== true) return bad('Please read and agree to the community guidelines.');
  const zip = typeof p.zip === 'string' && p.zip.trim() ? p.zip.trim() : null;
  if (zip && !/^\d{5}$/.test(zip)) return bad('Enter a 5-digit US ZIP code.');
  const grade = p.grade === undefined || p.grade === null || p.grade === '' ? null : typeof p.grade === 'string' && (GRADES as readonly string[]).includes(p.grade) ? p.grade : undefined;
  if (grade === undefined) return bad('Choose a grade from the list.');
  const subjectsWanted = list(p.subjectsWanted, SUBJECTS, MAX_SUBJECTS);
  const subjects = list(p.subjects, SUBJECTS, MAX_SUBJECTS);
  if (!subjectsWanted || !subjects) return bad(`Choose up to ${MAX_SUBJECTS} subjects from the list.`);
  const linkedinRaw = typeof p.linkedin === 'string' ? p.linkedin.trim() : '';
  const linkedin = linkedinRaw ? normalizeLinkedIn(linkedinRaw) : null;
  if (linkedinRaw && !linkedin) return bad('Use the address of your LinkedIn profile, like linkedin.com/in/your-name.');
  const school = text(p.school, 2, 100); const bio = text(p.bio, 20, 600); const availability = text(p.availability, 3, 200);
  if (school === undefined) return bad('School must be 2–100 characters with no < or > symbols.');
  if (bio === undefined) return bad('Your bio must be 20–600 characters with no < or > symbols.');
  if (availability === undefined) return bad('Availability must be 3–200 characters with no < or > symbols.');
  const radiusMiles = p.radiusMiles === undefined ? 15 : Number.isInteger(p.radiusMiles) && (p.radiusMiles as number) >= 1 && (p.radiusMiles as number) <= 50 ? p.radiusMiles as number : NaN;
  if (Number.isNaN(radiusMiles)) return bad('Travel distance must be between 1 and 50 miles.');
  if (complete) {
    if (!zip) return bad('Enter your ZIP code so we can find people nearby.');
    if (roles.includes('student') && !grade) return bad('Choose your grade.');
    if (roles.includes('tutor')) {
      if (!linkedin) return bad('Tutors need to add their LinkedIn profile address.');
      if (!school) return bad('Tell students which school or university you attend or graduated from.');
      if (!subjects.length) return bad('Choose at least one subject you can teach.');
      if (!bio) return bad('Write a short bio (at least 20 characters) so students know who you are.');
    }
  }
  return {ok: true, value: {fullName, roles, zip, grade, subjectsWanted, linkedin, school: school ?? null, subjects, bio: bio ?? null, availability: availability ?? null, radiusMiles, accepting: p.accepting !== false}};
}

// Exact distances are never shown, only a band, so nobody can work out where someone lives.
export function distanceBand(miles: number): string {
  return miles < 2 ? 'Within 2 miles' : miles < 5 ? 'Within 5 miles' : miles < 10 ? 'Within 10 miles' : miles < 25 ? 'Within 25 miles' : 'Within 50 miles';
}
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0$/, '');
}
export const SESSION_DATE = /^\d{4}-\d{2}-\d{2}$/;
