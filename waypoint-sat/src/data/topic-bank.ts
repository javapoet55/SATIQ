// Adapts the 200 topic-practice items (pt-*) to the shared bank format so they also appear in practice,
// adaptive tests, the tutor, and skill statistics. Their ids, choices, and answer keys are unchanged.
import {topicQuestions, type TopicQuestion} from './test-questions.ts';
import {testTopics} from './test-topics.ts';
import type {Question} from './question-schema.ts';

const SKILL: Record<string, string> = {
  'Linear equations': 'Linear equations in one variable', 'Linear models': 'Linear equations in one variable', 'Linear functions': 'Linear functions',
  'Systems of equations': 'Systems of two linear equations', 'Linear inequalities': 'Linear inequalities',
  'Quadratic equations': 'Nonlinear equations and systems', 'Radical equations': 'Nonlinear equations and systems', 'Nonlinear functions': 'Nonlinear functions',
  'Exponents': 'Equivalent expressions', 'Equivalent expressions': 'Equivalent expressions',
  'Rates': 'Ratios, rates, proportions, and units', 'Ratios': 'Ratios, rates, proportions, and units', 'Percentages': 'Percentages', 'Statistics': 'One-variable data', 'Probability': 'Probability',
  'Area': 'Area and volume', 'Volume': 'Area and volume', 'Lines and angles': 'Lines, angles, and triangles', 'Right triangles': 'Right triangles and trigonometry', 'Trigonometry': 'Right triangles and trigonometry', 'Circles': 'Circles',
  'Central ideas': 'Central Ideas and Details', 'Inferences': 'Inferences', 'Textual evidence': 'Command of Evidence (Textual)', 'Quantitative evidence': 'Command of Evidence (Quantitative)', 'Data interpretation': 'Command of Evidence (Quantitative)',
  'Words in context': 'Words in Context', 'Text structure and purpose': 'Text Structure and Purpose', 'Text function': 'Text Structure and Purpose', 'Cross-text connections': 'Cross-Text Connections',
  'Transitions': 'Transitions', 'Rhetorical synthesis': 'Rhetorical Synthesis',
};
const DOMAIN: Record<string, string> = {algebra: 'Algebra', advanced: 'Advanced Math', data: 'Problem-Solving and Data Analysis', geometry: 'Geometry and Trigonometry',
  information: 'Information and Ideas', craft: 'Craft and Structure', expression: 'Expression of Ideas', conventions: 'Standard English Conventions'};
// Conventions items: if the choices differ only in punctuation, the skill is Boundaries.
const conventionsSkill = (q: TopicQuestion) => new Set(q.choices.map(c => c.replace(/[^a-z0-9]/gi, '').toLowerCase())).size === 1 ? 'Boundaries' : 'Form, Structure, and Sense';
function adapt(q: TopicQuestion): Question & {topicId: string} {
  const split = q.text.lastIndexOf('\n\n');
  const skill = q.topicId === 'conventions' ? conventionsSkill(q) : SKILL[q.skill] ?? q.skill;
  return {id: q.id, topicId: q.topicId, section: q.section, domain: DOMAIN[q.topicId], skill, difficulty: 'Medium', type: 'mcq',
    ...(q.section === 'rw' && split > 0 ? {passage: q.text.slice(0, split).trim(), text: q.text.slice(split + 2).trim()} : {text: q.text}),
    choices: q.choices, correct: q.correct, steps: q.steps, why: q.why, hint: q.hint, source: 'original'};
}
export const topicBank = topicQuestions.map(adapt);
export {testTopics};
