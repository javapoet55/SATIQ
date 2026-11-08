// Checks a student's line-by-line algebra for a single-variable linear equation.
// Each line must still have the original solution; the first line that does not is the turning point.
export type StepStatus = 'correct' | 'incorrect' | 'uncertain' | 'pending';
export interface StepResult {line: string; status: StepStatus; reason: string}
type Linear = {a: number; b: number};

function expression(text: string, variable: string): Linear {
  const v = variable.replace(/[^a-z]/gi, '').slice(0, 1) || 'x';
  const source = text.replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/\s/g, '')
    .replace(new RegExp(`(\\d|\\))(${v}|\\()`, 'g'), '$1*$2').replace(new RegExp(`(${v})(\\(|\\d)`, 'g'), '$1*$2');
  const tokens = source.match(new RegExp(`\\d+(?:\\.\\d+)?|${v}|[+*/()-]`, 'g')) ?? [];
  if (tokens.join('') !== source || tokens.length > 120) throw Error(`Use numbers, ${v}, +, −, ×, / and parentheses.`);
  let p = 0;
  const atom = (): Linear => {
    const t = tokens[p++];
    if (t === '+') return atom();
    if (t === '-') { const x = atom(); return {a: -x.a, b: -x.b}; }
    if (t === '(') { const x = sum(); if (tokens[p++] !== ')') throw Error('A bracket is missing.'); return x; }
    if (t === v) return {a: 1, b: 0};
    if (t === undefined || !/^\d/.test(t)) throw Error('A number or variable is missing.');
    return {a: 0, b: Number(t)};
  };
  const product = (): Linear => {
    let x = atom();
    while (tokens[p] === '*' || tokens[p] === '/') {
      const op = tokens[p++], y = atom();
      if (op === '*') { if (x.a && y.a) throw Error('This line is not linear.'); x = {a: x.a * y.b + y.a * x.b, b: x.b * y.b}; }
      else { if (y.a || y.b === 0) throw Error('This division is not supported.'); x = {a: x.a / y.b, b: x.b / y.b}; }
    }
    return x;
  };
  const sum = (): Linear => {
    let x = product();
    while (tokens[p] === '+' || tokens[p] === '-') { const sign = tokens[p++] === '+' ? 1 : -1, y = product(); x = {a: x.a + sign * y.a, b: x.b + sign * y.b}; }
    return x;
  };
  const result = sum();
  if (p !== tokens.length || !Number.isFinite(result.a) || !Number.isFinite(result.b)) throw Error('This expression could not be read.');
  return result;
}
export function checkWork(draft: string, variable = 'd', solution = 6): StepResult[] {
  const lines = draft.split(/\n/).map(x => x.trim()).filter(Boolean).slice(0, 12);
  let stopped = false;
  return lines.map(line => {
    if (stopped) return {line, status: 'pending', reason: 'Depends on the earlier step.'};
    try {
      const parts = line.split('=');
      if (parts.length !== 2) throw Error(`Write one equation per line using ${variable}.`);
      const l = expression(parts[0], variable), r = expression(parts[1], variable);
      const a = l.a - r.a, b = l.b - r.b;
      if (Math.abs(a) < 1e-9) throw Error(`This line does not pin down a single value of ${variable}.`);
      if (Math.abs(-b / a - solution) > 1e-7) { stopped = true; return {line, status: 'incorrect', reason: `This equation no longer has the same solution as the original. Recheck the operation from the line before.`}; }
      return {line, status: 'correct', reason: 'Still equivalent to the original equation.'};
    } catch (e) {
      stopped = true;
      return {line, status: 'uncertain', reason: e instanceof Error ? e.message : 'This line could not be checked.'};
    }
  });
}
