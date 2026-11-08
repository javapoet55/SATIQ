// Server view of the question bank: the reviewed static file plus admin-approved generated questions.
import {readFile} from 'node:fs/promises';
import {topicBank} from '../src/data/topic-bank.ts';
const reviewedBank = JSON.parse(await readFile(new URL('../src/data/sat-bank.json', import.meta.url), 'utf8'));
const staticBank = [...reviewedBank, ...topicBank];
const staticIds = new Set(staticBank.map(q => q.id));

export function createBank(database) {
  let generated = [], loadedAt = 0;
  const map = () => new Map([...staticBank, ...generated].map(q => [q.id, q]));
  let byId = map();
  return {
    async refresh() {
      generated = (await database.approvedQuestions?.() ?? []).filter(q => !staticIds.has(q.id));
      byId = map(); loadedAt = Date.now();
    },
    async ensure() { if (Date.now() - loadedAt > 60000) await this.refresh().catch(() => {}); },
    get: id => byId.get(id),
    lookup: () => byId,
    generated: () => generated,
    staticTexts: () => new Set([...staticBank, ...generated].map(q => (q.text ?? '').trim().toLowerCase() + (q.passage ?? '').trim().toLowerCase())),
  };
}
export {staticBank, topicBank};
