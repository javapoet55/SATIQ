// Shared by the browser and the server (imported with explicit .ts extensions under node --experimental-strip-types).
export type Subject = 'math' | 'rw';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type QuestionType = 'mcq' | 'spr';
export type MathCheck =
  | {kind: 'value'; expr: string}
  | {kind: 'equivalent'; expr: string; vars: string[]};
export interface Question {
  id: string; section: Subject; domain: string; skill: string; difficulty: Difficulty; type: QuestionType;
  passage?: string; text: string;
  choices: string[]; correct: number;          // mcq: index of the right choice. spr: -1
  answers?: string[];                          // spr: accepted answers ("2/3", ".6666" …)
  steps: string[][]; why: string; hint: string;
  distractors?: (string | null)[];             // mcq: why each wrong choice is tempting (null for the right one)
  check?: MathCheck;                           // math: machine check of the key (tests + generator)
  work?: {variable: string; solution: number}; // single-variable linear question usable in Explain My Work
  source?: 'original' | 'generated';
}
export type Choice = number | string | null;

export const DOMAINS: Record<Subject, {domain: string; skills: string[]}[]> = {
  math: [
    {domain: 'Algebra', skills: ['Linear equations in one variable', 'Linear functions', 'Linear equations in two variables', 'Systems of two linear equations', 'Linear inequalities']},
    {domain: 'Advanced Math', skills: ['Equivalent expressions', 'Nonlinear equations and systems', 'Nonlinear functions']},
    {domain: 'Problem-Solving and Data Analysis', skills: ['Ratios, rates, proportions, and units', 'Percentages', 'One-variable data', 'Two-variable data', 'Probability', 'Inference from samples']},
    {domain: 'Geometry and Trigonometry', skills: ['Area and volume', 'Lines, angles, and triangles', 'Right triangles and trigonometry', 'Circles']},
  ],
  rw: [
    {domain: 'Craft and Structure', skills: ['Words in Context', 'Text Structure and Purpose', 'Cross-Text Connections']},
    {domain: 'Information and Ideas', skills: ['Central Ideas and Details', 'Command of Evidence (Textual)', 'Command of Evidence (Quantitative)', 'Inferences']},
    {domain: 'Standard English Conventions', skills: ['Boundaries', 'Form, Structure, and Sense']},
    {domain: 'Expression of Ideas', skills: ['Transitions', 'Rhetorical Synthesis']},
  ],
};
export const ALL_SKILLS = Object.values(DOMAINS).flat().flatMap(d => d.skills);
export const domainOf = (section: Subject, skill: string) => DOMAINS[section].find(d => d.skills.includes(skill))?.domain;
export const QUESTION_ID = /^[a-z0-9][a-z0-9:-]{1,79}$/;
export const SPR_INPUT = /^-?(\d{0,5}(\.\d{0,4})?|\d{1,4}\/\d{1,4})$/;

// Student-produced responses follow SAT rules: equivalent fractions and decimals both count,
// and a decimal must be precise to the space available (at least 3 decimal places if not exact).
function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+|\d+\/\d+)$/.test(s)) return null;
  if (s.includes('/')) { const [a, b] = s.replace('-', '').split('/').map(Number); if (!b) return null; return (s.startsWith('-') ? -1 : 1) * a / b; }
  return Number(s);
}
export function gradeSpr(q: Question, response: string): boolean {
  const value = parseNumber(response);
  if (value === null) return false;
  const decimals = /\.(\d+)$/.exec(response.trim())?.[1].length ?? 0;
  return (q.answers ?? []).some(answer => {
    const target = parseNumber(answer);
    if (target === null) return answer.trim() === response.trim();
    if (Math.abs(value - target) < 1e-9) return true;
    return !response.includes('/') && decimals >= 3 && Math.abs(value - target) < 10 ** -decimals;
  });
}
export function grade(q: Question | undefined, choice: Choice): boolean {
  if (!q || choice === null) return false;
  if (q.type === 'spr') return typeof choice === 'string' && gradeSpr(q, choice);
  return choice === q.correct;
}
export const answerLabel = (q: Question, choice: Choice) =>
  choice === null || choice === '' ? 'Unanswered' : typeof choice === 'string' ? choice : `${'ABCD'[choice]}. ${q.choices[choice] ?? ''}`;
export const correctLabel = (q: Question) => q.type === 'spr' ? (q.answers ?? [])[0] ?? '' : `${'ABCD'[q.correct]}. ${q.choices[q.correct]}`;

// Structural validation used by tests, the generator, and the server before trusting a question.
export function validateQuestion(q: Question): string[] {
  const problems: string[] = [];
  const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (!QUESTION_ID.test(q.id ?? '')) problems.push('id');
  if (!['math', 'rw'].includes(q.section)) problems.push('section');
  if (!DOMAINS[q.section]?.some(d => d.domain === q.domain && d.skills.includes(q.skill))) problems.push('domain/skill');
  if (!['Easy', 'Medium', 'Hard'].includes(q.difficulty)) problems.push('difficulty');
  if (!text(q.text, 1200)) problems.push('text');
  if (q.passage !== undefined && !text(q.passage, 3000)) problems.push('passage');
  if (!text(q.why, 1200) || !text(q.hint, 500)) problems.push('why/hint');
  if (!Array.isArray(q.steps) || !q.steps.length || q.steps.length > 8 || !q.steps.every(s => Array.isArray(s) && s.length >= 2 && s.length <= 3 && s.every(x => typeof x === 'string' && x.length <= 600))) problems.push('steps');
  if (q.type === 'mcq') {
    if (!Array.isArray(q.choices) || q.choices.length !== 4 || !q.choices.every(c => text(c, 400)) || new Set(q.choices).size !== 4) problems.push('choices');
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) problems.push('correct');
    if (!Array.isArray(q.distractors) || q.distractors.length !== 4 || q.distractors.some((d, i) => i === q.correct ? d !== null : !text(d, 600))) problems.push('distractors');
  } else if (q.type === 'spr') {
    if (q.section !== 'math') problems.push('spr is math-only');
    if (!Array.isArray(q.answers) || !q.answers.length || !q.answers.every(a => SPR_INPUT.test(a)) || q.correct !== -1 || q.choices.length !== 0) problems.push('answers');
  } else problems.push('type');
  if (q.section === 'math' && !q.check) problems.push('math check');
  return problems;
}
