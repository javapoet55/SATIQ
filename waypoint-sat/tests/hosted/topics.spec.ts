import {test, expect} from '@playwright/test';
import {emptyState} from '../../src/model';
test('a 25-question topic set restores from the database with local backup removed, and its results persist', async ({page}) => {
  let state = emptyState(), revision = 0;
  await page.route('**/api/config', route => route.fulfill({json: {ai: false, admin: false, desmosKey: null}}));
  await page.route('**/api/questions', route => route.fulfill({json: {questions: []}}));
  await page.route('**/api/auth/me', route => route.fulfill({json: {user: {email: 'topic-qa@example.com'}}}));
  await page.route('**/api/progress', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({json: {profileId: 'topic-qa', state, revision}}); return; }
    const body = route.request().postDataJSON();
    if (body.revision !== revision) { await route.fulfill({status: 409, json: {message: 'stale'}}); return; }
    state = body.state; revision++; await route.fulfill({json: {revision}});
  });
  await page.goto('/#test');
  await page.getByRole('button', {name: 'Start Geometry & Trigonometry topic practice'}).click();
  const begin = page.getByRole('button', {name: /^Begin test/});
  if (await begin.isVisible().catch(() => false)) await begin.click();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', {name: /Mark for review/}).click();
  await page.getByRole('button', {name: 'Next →'}).click();
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  await expect.poll(() => state.sessions[0]?.status).toBe('paused');
  expect(state.sessions[0].questionIds).toHaveLength(25);
  expect(state.sessions[0].topicId).toBe('geometry');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await expect(page.getByText('Question 2 of 25', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Question 1, answered, marked', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Resume', exact: true}).click();
  await page.getByRole('button', {name: 'Finish test', exact: true}).click();
  await page.getByRole('button', {name: 'Submit', exact: true}).click();
  await expect(page).toHaveURL(/#review/);
  await expect.poll(() => state.attempts.length).toBe(25);
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await expect.poll(() => state.attempts.length).toBe(25);
  expect(state.sessions[0].status).toBe('submitted');
});
