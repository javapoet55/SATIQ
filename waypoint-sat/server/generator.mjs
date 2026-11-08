// AI question generation with independent verification. Nothing generated reaches students until an admin approves it.
// Gates: (1) strict JSON schema, (2) structural validation, (3) machine math check, (4) a blind solve by a second call
// that never sees the key. Items failing 1-3 are rejected; a blind-solve disagreement is flagged for careful review.
import {randomUUID} from 'node:crypto';
import {validateQuestion, gradeSpr, domainOf, DOMAINS} from '../src/data/question-schema.ts';
import {verifyMathKey} from './question-check.mjs';

const str = {type: 'string'};
const generationSchema = {name: 'sat_question', schema: {type: 'object', additionalProperties: false,
  required: ['passage', 'text', 'choices', 'correct_index', 'answers', 'steps', 'why', 'hint', 'distractor_explanations', 'check_kind', 'check_expr', 'check_vars'],
  properties: {passage: str, text: str, choices: {type: 'array', items: str}, correct_index: {type: 'integer'}, answers: {type: 'array', items: str},
    steps: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['title', 'explanation', 'work'], properties: {title: str, explanation: str, work: str}}},
    why: str, hint: str, distractor_explanations: {type: 'array', items: str},
    check_kind: {type: 'string', enum: ['value', 'equivalent', 'none']}, check_expr: str, check_vars: {type: 'array', items: str}}}};
const solveSchema = {name: 'blind_solve', schema: {type: 'object', additionalProperties: false, required: ['reasoning', 'answer'],
  properties: {reasoning: str, answer: str}}};

function brief({section, skill, difficulty, type}) {
  const common = `Write ONE original Digital SAT ${section === 'math' ? 'Math' : 'Reading and Writing'} question for the skill "${skill}" at ${difficulty} difficulty. It must be completely original: do not copy or closely paraphrase College Board or other published questions, copyrighted passages, song lyrics, or poems. Use realistic, factually accurate content; when unsure of a real-world fact, use a clearly fictional scenario. Exactly one answer must be defensibly correct.
Fields: steps = 2-4 worked-solution steps (title, explanation, optional short work line). why = a one-sentence strategy for next time. hint = a nudge that does not give the answer away. distractor_explanations = 4 strings aligned with choices: for each wrong choice explain the specific mistake that leads to it; use "" for the correct choice.`;
  if (section === 'rw') return `${common}
Reading and Writing format: passage = 25-150 words (for Cross-Text Connections, "Text 1: ..." and "Text 2: ..." separated by a blank line; for Rhetorical Synthesis, bullet notes starting with "While researching a topic, a student has taken the following notes:"; for blanks use ______). text = the SAT-style question stem. choices = exactly 4. correct_index = 0-3. answers = []. check_kind = "none", check_expr = "", check_vars = [].`;
  return `${common}
Math format: passage = "". Put math in LaTeX inline delimiters \\( ... \\) (dollar signs mean money only). ${type === 'spr'
    ? 'This is a student-produced response: choices = [], correct_index = -1, answers = accepted numeric answers as plain strings (integers, decimals, or a/b fractions; at most 5 characters, a minus sign allowed).'
    : 'choices = exactly 4 distinct options; each wrong option must come from a plausible student error. correct_index = 0-3. answers = [].'}
Machine check (required): check_kind = "value" with check_expr = a mathjs expression that computes the numeric answer directly from the question's numbers (e.g. "(60-18)/7", "sqrt(9^2+12^2)", "45/(45+35)"), and the correct choice must state that number; OR check_kind = "equivalent" (multiple choice only) with check_expr = the original expression in mathjs syntax using explicit * for multiplication, and check_vars = its variables, when the choices are algebraic expressions. Never use check_kind "none" for Math.`;
}

export function toQuestion(raw, spec) {
  const steps = (raw.steps ?? []).slice(0, 6).map(s => s.work ? [s.title, s.explanation, s.work] : [s.title, s.explanation]);
  const mcq = spec.type !== 'spr';
  const q = {id: `gen-${randomUUID().slice(0, 12)}`, section: spec.section, domain: domainOf(spec.section, spec.skill), skill: spec.skill,
    difficulty: spec.difficulty, type: mcq ? 'mcq' : 'spr', ...(raw.passage?.trim() ? {passage: raw.passage.trim()} : {}), text: raw.text?.trim(),
    choices: mcq ? raw.choices : [], correct: mcq ? raw.correct_index : -1, ...(mcq ? {} : {answers: raw.answers}),
    steps, why: raw.why, hint: raw.hint, ...(mcq ? {distractors: (raw.distractor_explanations ?? []).map((d, i) => i === raw.correct_index ? null : d)} : {}),
    ...(spec.section === 'math' && raw.check_kind !== 'none' ? {check: raw.check_kind === 'value' ? {kind: 'value', expr: raw.check_expr} : {kind: 'equivalent', expr: raw.check_expr, vars: raw.check_vars}} : {}),
    source: 'generated'};
  return q;
}

export async function blindSolve(ai, q, solverModel) {
  const prompt = [q.passage ? `Passage:\n${q.passage}` : '', `Question: ${q.text}`, q.type === 'mcq' ? `Choices:\n${q.choices.map((c, i) => `${'ABCD'[i]}. ${c}`).join('\n')}` : 'Give the numeric answer.'].filter(Boolean).join('\n\n');
  const result = await ai.json({instructions: `Solve this SAT question carefully and independently. ${q.type === 'mcq' ? 'answer must be the single letter A, B, C, or D.' : 'answer must be the number only (integer, decimal, or a/b).'}`,
    input: [{role: 'user', content: prompt}], schema: solveSchema, effort: 'medium', maxTokens: 4000, modelOverride: solverModel});
  const answer = String(result.answer ?? '').trim();
  const agrees = q.type === 'mcq' ? answer.toUpperCase().replace(/[^A-D]/g, '').charAt(0) === 'ABCD'[q.correct] : gradeSpr(q, answer);
  return {answer, agrees};
}

export async function generateOne(ai, spec, {existingTexts = new Set(), solverModel = process.env.OPENAI_VERIFIER_MODEL} = {}) {
  const raw = await ai.json({instructions: brief(spec), input: [{role: 'user', content: `Create the question now. Skill: ${spec.skill}. Difficulty: ${spec.difficulty}.`}],
    schema: generationSchema, effort: 'medium', maxTokens: 6000, modelOverride: process.env.OPENAI_GENERATOR_MODEL});
  const q = toQuestion(raw, spec);
  const problems = validateQuestion(q);
  if (q.section === 'math' && !problems.length) problems.push(...verifyMathKey(q).map(p => `math check: ${p}`));
  if (existingTexts.has((q.text ?? '').trim().toLowerCase() + (q.passage ?? '').trim().toLowerCase())) problems.push('duplicate of an existing question');
  if (problems.length) return {question: q, status: 'rejected', verification: {problems}};
  const solve = await blindSolve(ai, q, solverModel);
  return {question: q, status: solve.agrees ? 'pending' : 'flagged',
    verification: {problems: [], mathCheck: q.section === 'math' ? 'passed' : 'not applicable', blindSolve: solve}};
}

export function validSpec(spec) {
  const section = spec?.section === 'rw' ? 'rw' : spec?.section === 'math' ? 'math' : null;
  if (!section || !DOMAINS[section].some(d => d.skills.includes(spec.skill))) return null;
  if (!['Easy', 'Medium', 'Hard'].includes(spec.difficulty)) return null;
  const type = section === 'math' && spec.type === 'spr' ? 'spr' : 'mcq';
  const count = Math.min(5, Math.max(1, Number.parseInt(spec.count, 10) || 1));
  return {section, skill: spec.skill, difficulty: spec.difficulty, type, count};
}
