// Machine verification of math answer keys. Used by the bank tests and by the GPT question generator,
// so no math question reaches students on the strength of an author's (or a model's) say-so alone.
import {create, all} from 'mathjs';
const math = create(all, {number: 'number'});

// Turns the small LaTeX subset used in questions into mathjs syntax.
export function latexToMath(source) {
  let s = String(source).replace(/\\\(|\\\)/g, '').replace(/\\left|\\right/g, '');
  s = s.replace(/\^\{?\\circ\}?|°/g, '');
  for (let i = 0; i < 6; i++) s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '(($1)/($2))');
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)').replace(/\^\{([^{}]*)\}/g, '^($1)')
    .replace(/\\(cdot|times)/g, '*').replace(/\\pi/g, 'pi').replace(/\\div/g, '/').replace(/\\(,|;|!| )/g, '')
    .replace(/[−–]/g, '-').replace(/\\%/g, '%').replace(/\{|\}/g, '');
  return s.trim();
}
// Pulls the numeric value out of a choice such as "6 days", "$1,250", "\(\frac{3}{4}\)" or "12%".
export function choiceValue(choice) {
  const inner = /\\\((.*)\\\)/.exec(choice)?.[1];
  let s = inner !== undefined ? latexToMath(inner) : String(choice).replace(/\$/g, '').trim();
  s = s.replace(/(\d),(\d{3})/g, '$1$2');
  if (inner === undefined) s = (/^-?[\d.]+(\s*\/\s*[\d.]+)?/.exec(s) ?? [''])[0];
  if (!s) return null;
  try { const v = math.evaluate(s); return typeof v === 'number' && Number.isFinite(v) ? v : null; } catch { return null; }
}
const close = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
function sprValue(answer) {
  const s = answer.trim();
  return s.includes('/') ? s.split('/').map(Number).reduce((a, b) => a / b) : Number(s);
}
function evalAt(expr, scope) { const v = math.evaluate(latexToMath(expr), scope); return typeof v === 'number' ? v : NaN; }

// Returns a list of problems; empty means the key is machine-verified.
export function verifyMathKey(q, random = Math.random) {
  const problems = [];
  const check = q.check;
  if (!check) return ['missing check'];
  try {
    if (check.kind === 'value') {
      const value = math.evaluate(latexToMath(check.expr));
      if (typeof value !== 'number' || !Number.isFinite(value)) return ['check did not evaluate to a number'];
      if (q.type === 'spr') {
        if (!q.answers.every(a => close(sprValue(a), value))) problems.push(`spr answers do not all equal ${value}`);
      } else {
        const values = q.choices.map(choiceValue);
        if (values[q.correct] === null) problems.push('correct choice has no numeric value');
        else if (!close(values[q.correct], value)) problems.push(`correct choice is ${values[q.correct]}, check gives ${value}`);
        values.forEach((v, i) => { if (i !== q.correct && v !== null && close(v, value)) problems.push(`distractor ${'ABCD'[i]} equals the answer`); });
      }
    } else if (check.kind === 'equivalent') {
      if (q.type !== 'mcq') return ['equivalent checks need choices'];
      const points = Array.from({length: 6}, () => Object.fromEntries(check.vars.map(v => [v, Math.round((random() * 7 + 1.3) * 1000) / 1000])));
      const same = choice => points.every(p => { const a = evalAt(check.expr, p), b = evalAt(choice.replace(/^.*?\\\(|\\\).*$/g, ''), p); return Number.isFinite(a) && Number.isFinite(b) && close(a, b); });
      if (!same(q.choices[q.correct])) problems.push('correct choice is not equivalent to the check expression');
      q.choices.forEach((c, i) => { if (i !== q.correct && same(c)) problems.push(`distractor ${'ABCD'[i]} is also equivalent`); });
    } else problems.push('unknown check kind');
  } catch (error) { problems.push(`check failed: ${error.message}`); }
  return problems;
}
