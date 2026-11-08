// Question registry: the reviewed static bank plus admin-approved AI-generated questions loaded at sign-in.
import reviewedBank from './sat-bank.json';
import {topicBank} from './topic-bank.ts';
import type {Question, Subject} from './question-schema';
// The reviewed bank plus the 200 topic-practice items: about 280 questions in all.
const staticBank: Question[] = [...(reviewedBank as Question[]), ...topicBank];
export type {Question, Subject} from './question-schema';

const RETIRED: Question = {id: 'retired', section: 'math', domain: 'Algebra', skill: 'Retired question', difficulty: 'Medium', type: 'mcq',
  text: 'This question is no longer in the question bank. Your saved answer still counts in your history.', choices: ['—', '—', '—', '—'], correct: 0,
  steps: [['Retired', 'This question was removed after review.']], why: 'Retired questions stay in your history but are not shown in practice.', hint: '', distractors: [null, '', '', '']};
let all: Question[] = staticBank;
let byId = new Map(all.map(q => [q.id, q]));
export function setGeneratedQuestions(list: Question[]) {
  const staticIds = new Set(staticBank.map(q => q.id));
  const fresh = (Array.isArray(list) ? list : []).filter(q => q && typeof q.id === 'string' && !staticIds.has(q.id) && q.source === 'generated' && Array.isArray(q.steps) && Array.isArray(q.choices));
  all = [...staticBank, ...fresh];
  byId = new Map(all.map(q => [q.id, q]));
}
export const questions = () => all;
export const hasQuestion = (id: string) => byId.has(id);
export const questionById = (id: string): Question => byId.get(id) ?? {...RETIRED, id};
export const bySection = (section: Subject) => all.filter(q => q.section === section);
