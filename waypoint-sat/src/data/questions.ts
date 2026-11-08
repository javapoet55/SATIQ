import originals from './original-questions.json';
import {topicQuestions} from './test-questions.ts';

export type Subject = 'math' | 'rw';
export interface Question {
  id: string; section: Subject; skill: string; difficulty: string;
  text: string; choices: string[]; correct: number; steps: string[][]; why: string; hint: string;
}
const ids = ['wp-math-001', 'wp-rw-001', 'wp-math-002', 'wp-rw-002'];
const hints = ['Separate the fixed fee from the daily cost.', 'Look for a cause-and-effect relationship.', 'Find the discount first, then subtract it from the price.', 'Look at the explanation after the colon.'];
export const questions: Question[] = originals.map((q, i) => ({...q, id: ids[i], section: i % 2 === 0 ? 'math' : 'rw', difficulty: 'Medium', hint: hints[i]}));
export const allQuestions:Question[]=[...questions,...topicQuestions];
export const questionById = (id: string) => allQuestions.find(q => q.id === id)!;
