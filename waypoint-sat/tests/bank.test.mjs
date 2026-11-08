import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateQuestion, gradeSpr, grade, DOMAINS, ALL_SKILLS} from '../src/data/question-schema.ts';
import {verifyMathKey, choiceValue, latexToMath} from '../server/question-check.mjs';

const bank = JSON.parse(await readFile(new URL('../src/data/sat-bank.json', import.meta.url), 'utf8'));

test('every bank question passes structural validation', () => {
  for (const q of bank) assert.deepEqual(validateQuestion(q), [], q.id);
  assert.equal(new Set(bank.map(q => q.id)).size, bank.length, 'ids are unique');
});
test('every math answer key is machine-verified and no distractor equals the answer', () => {
  for (const q of bank.filter(q => q.section === 'math')) assert.deepEqual(verifyMathKey(q), [], q.id);
});
test('the bank covers every Digital SAT skill at more than one difficulty overall', () => {
  for (const skill of ALL_SKILLS) assert.ok(bank.some(q => q.skill === skill), skill);
  for (const section of ['math', 'rw']) for (const level of ['Easy', 'Medium', 'Hard']) assert.ok(bank.filter(q => q.section === section && q.difficulty === level).length >= 5, `${section} ${level}`);
  assert.ok(bank.filter(q => q.type === 'spr').length >= 8, 'typed-answer math questions');
});
test('Explain My Work metadata solves the linear question it is attached to', () => {
  for (const q of bank.filter(q => q.work)) {
    const value = q.type === 'spr' ? Number(q.answers[0]) : choiceValue(q.choices[q.correct]);
    assert.equal(value, q.work.solution, q.id);
  }
});
test('typed answers follow SAT rules for equivalent fractions and decimals', () => {
  const q = {type: 'spr', answers: ['2/3']};
  for (const ok of ['2/3', '4/6', '.6666', '.6667', '0.667', '0.666']) assert.equal(gradeSpr(q, ok), true, ok);
  for (const bad of ['.66', '.67', '0.7', '3/2', 'two thirds', '']) assert.equal(gradeSpr(q, bad), false, bad);
  assert.equal(gradeSpr({answers: ['-6']}, '-6'), true);
  assert.equal(gradeSpr({answers: ['-6']}, '6'), false);
  assert.equal(gradeSpr({answers: ['36']}, '36.0'), true);
  assert.equal(grade({type: 'mcq', correct: 2}, 2), true);
  assert.equal(grade({type: 'mcq', correct: 2}, '2'), false);
  assert.equal(grade(undefined, 1), false);
});
test('the checker catches a wrong key and a duplicate distractor', () => {
  const q = bank.find(x => x.id === 'sat-m-001');
  assert.notDeepEqual(verifyMathKey({...q, correct: 1}), []);
  assert.notDeepEqual(verifyMathKey({...q, choices: ['7', '7.0', '11.5', '28']}), []);
  const eq = bank.find(x => x.id === 'sat-m-012');
  assert.notDeepEqual(verifyMathKey({...eq, correct: 1}), []);
  assert.equal(latexToMath(String.raw`\(\frac{3}{4}\)`), '((3)/(4))');
  assert.equal(choiceValue('$1,250'), 1250);
});
