import {test, expect, type Page} from '@playwright/test';
import {topicQuestions} from '../../src/data/test-questions';
import {testTopics} from '../../src/data/test-topics';
const KEY = 'waypoint-local-v1';
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), KEY);
const startTopic = async (page: Page, name: string, section: 'math' | 'rw') => {
  await page.goto('/#test');
  if (section === 'rw') await page.getByRole('group', {name: 'Topic section'}).or(page.getByLabel('Topic section')).getByRole('button', {name: 'Reading & Writing'}).click();
  await page.getByRole('button', {name: `Start ${name} topic practice`}).click();
  const begin = page.getByRole('button', {name: /^Begin test/});
  if (await begin.isVisible().catch(() => false)) await begin.click();
  await expect(page.getByText('Question 1 of 25', {exact: true})).toBeVisible();
};

test('a topic set has 25 questions; answers, flags and the paused timer survive reload', async ({page}) => {
  await startTopic(page, 'Craft & Structure', 'rw');
  await expect(page.locator('.navgrid button')).toHaveCount(25);
  await page.getByRole('radio').first().check();
  await page.getByRole('button', {name: /Mark for review/}).click();
  await page.getByRole('button', {name: 'Next →'}).click();
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  const time = await page.locator('.timer').textContent();
  await page.waitForTimeout(1200);
  await expect(page.locator('.timer')).toHaveText(time!);
  await page.reload();
  await expect(page.getByText('Question 2 of 25', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Question 1, answered, marked', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Resume', exact: true}).click();
  await page.getByRole('button', {name: 'Question 1, answered, marked', exact: true}).click();
  await expect(page.getByRole('radio').first()).toBeChecked();
  await page.getByRole('button', {name: 'Finish test', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('24 unanswered · 1 marked');
  await page.getByRole('button', {name: 'Keep working'}).click();
  await page.getByRole('button', {name: 'Finish test', exact: true}).click();
  await page.getByRole('button', {name: 'Submit', exact: true}).click();
  await expect(page).toHaveURL(/#review/);
  const state = await saved(page);
  expect(state.attempts).toHaveLength(25);
  expect(state.sessions[0].topicId).toBe('craft');
  expect(state.sessions[0].flags).toHaveLength(1);
});

test('a missed deadline auto-submits exactly 25 attempts', async ({page}) => {
  await startTopic(page, 'Algebra', 'math');
  await page.getByRole('radio').first().check();
  await page.evaluate(key => { const state = JSON.parse(localStorage.getItem(key)!); const s = state.sessions[0]; s.deadlineAt = Date.now() - 100; s.segmentStartedAt = Date.now() - 2000; localStorage.setItem(key, JSON.stringify(state)); }, KEY);
  await page.reload();
  await expect.poll(async () => (await saved(page)).sessions[0].status).toBe('expired');
  expect((await saved(page)).attempts).toHaveLength(25);
  await page.reload();
  expect((await saved(page)).attempts).toHaveLength(25);
});

test('every topic starts 25 matching questions with its time limit', async ({page}) => {
  for (const topic of testTopics) {
    await page.goto('/#test'); await page.evaluate(() => localStorage.clear()); await page.reload();
    await startTopic(page, topic.name, topic.section as 'math' | 'rw');
    const session = (await saved(page)).sessions[0];
    expect(session.topicId).toBe(topic.id);
    expect(session.questionIds).toHaveLength(25);
    expect(session.questionIds.every((id: string) => topicQuestions.some(q => q.id === id && q.topicId === topic.id))).toBe(true);
    expect(session.durationMs).toBe(topic.minutes * 60000);
  }
});

for (const width of [1440, 834, 390, 320]) test(`topic picker and player fit at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 1000});
  await page.goto('/#test');
  await expect(page.getByRole('button', {name: 'Start Algebra topic practice'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await startTopic(page, 'Algebra', 'math');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
