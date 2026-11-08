import {test, expect, type Page} from '@playwright/test';
const KEY = 'waypoint-local-v1';
const nav = (page: Page) => page.getByRole('navigation', {name: 'Main navigation'});
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), KEY);

test('practice: hint, persistence across reload, wrong-choice explanation, solution, retry keeps the first attempt', async ({page}) => {
  await page.goto('/#practice');
  await expect(page.getByRole('button', {name: 'Check answer'})).toBeDisabled();
  await page.getByRole('button', {name: '✧ Hint'}).click();
  await expect(page.getByText('Separate the fixed fee from the daily cost.')).toBeVisible();
  await page.getByRole('radio', {name: 'A. 4 days', exact: true}).check();
  await page.reload();
  await expect(page.getByRole('radio', {name: 'A. 4 days', exact: true})).toBeChecked();
  await page.getByRole('button', {name: 'Check answer'}).click();
  await expect(page.getByText('Why A is tempting:')).toBeVisible();
  await expect(page.getByText('4 days · Your answer')).toBeVisible();
  await page.getByRole('button', {name: 'Full solution'}).click();
  await expect(page.getByRole('heading', {name: 'Why the other choices are wrong'})).toBeVisible();
  await expect(page.locator('.equation .katex').first()).toBeVisible();
  await page.getByRole('button', {name: 'Try again'}).click();
  await page.getByRole('radio', {name: 'B. 6 days', exact: true}).check();
  await page.getByRole('button', {name: 'Check answer'}).click();
  await expect(page.getByText('Retry saved. Your first attempt is kept for your stats.')).toBeVisible();
  const state = await saved(page);
  expect(state.attempts.map((a: {correct: boolean}) => a.correct)).toEqual([false, true]);
  await nav(page).getByRole('button', {name: 'Home', exact: true}).click();
  await expect(page.locator('.section-scores strong').last()).toHaveText('0%');
});
test('typed-answer questions accept SAT-style equivalents and filter invalid characters', async ({page}) => {
  await page.goto('/#practice');
  await page.getByRole('button', {name: 'Math', exact: true}).click();
  await page.getByLabel('Skill').selectOption('Equivalent expressions');
  await page.getByLabel('Level').selectOption('Medium');
  // Medium equivalent-expressions items include the typed (x + y)^2 question; step until it appears.
  for (let i = 0; i < 6 && !(await page.getByLabel('Your answer').count()); i++) await page.getByRole('button', {name: 'Skip →'}).click();
  const input = page.getByLabel('Your answer');
  await input.fill('6a4!');
  await expect(input).toHaveValue('64');
  await page.getByRole('button', {name: 'Check answer'}).click();
  await expect(page.getByText('That’s right.')).toBeVisible();
  await expect(page.getByText('Accepted answer: 64')).toBeVisible();
});
test('every skill is reachable and math renders with KaTeX; calculator and reference sheet open', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.skill-chip')).toHaveCount(29);
  await page.getByRole('button', {name: /^Circles:/}).click();
  await expect(page).toHaveURL(/#practice$/);
  await expect(page.locator('.pill').first()).toContainText('Circles ·');
  await page.getByLabel('Level').selectOption('Hard');
  await expect(page.getByText('Circles · Hard · Typed answer')).toBeVisible();
  await expect(page.locator('.questiontext .katex').first()).toBeVisible();
  await page.getByRole('button', {name: '🖩 Calculator'}).click();
  await expect(page.locator('iframe[title="Desmos graphing calculator"]')).toHaveAttribute('src', 'https://www.desmos.com/calculator');
  await expect(page.getByRole('button', {name: 'Open in a larger window ↗'})).toBeVisible();
  await page.getByRole('button', {name: '📐 Reference'}).click();
  await expect(page.getByText('Pythagorean theorem')).toBeVisible();
  await expect(page.locator('iframe[title="Desmos graphing calculator"]')).toHaveCount(0);
});
test('quick check: answers, flags, pause, reload, submit, then review that test only', async ({page}) => {
  await page.goto('/#test');
  await page.getByRole('button', {name: 'Start →'}).last().click();
  await expect(page.getByRole('heading', {name: 'Quick check · 10 mixed questions'})).toBeVisible();
  await page.getByRole('button', {name: 'Begin test →'}).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', {name: '⚐ Mark for review'}).click();
  await page.getByRole('button', {name: 'Next →'}).click();
  await page.getByRole('button', {name: 'Pause'}).click();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  const paused = await page.locator('.timer').textContent();
  await page.waitForTimeout(1100);
  expect(await page.locator('.timer').textContent()).toBe(paused);
  await page.reload();
  await page.getByRole('button', {name: 'Resume'}).click();
  await page.getByRole('button', {name: 'Question 1, answered, marked', exact: true}).click();
  await page.getByRole('button', {name: 'Finish test', exact: true}).click();
  await expect(page.getByText('9 unanswered · 1 marked.')).toBeVisible();
  await page.getByRole('button', {name: 'Submit'}).click();
  await expect(page).toHaveURL(/#review$/);
  const state = await saved(page);
  expect(state.attempts).toHaveLength(10);
  expect(state.attempts.filter((a: {flagged: boolean}) => a.flagged)).toHaveLength(1);
  await page.goto('/#test');
  await expect(page.getByText('LATEST RESULTS')).toBeVisible();
});
test('section test: module 2 is routed by module 1 results, help is paused, and the test can be stopped', async ({page}) => {
  await page.goto('/#test');
  await page.getByRole('button', {name: 'Start →'}).nth(1).click();
  await expect(page.getByRole('heading', {name: 'Reading and Writing · Module 1'})).toBeVisible();
  await page.getByRole('button', {name: 'Begin module →'}).click();
  await page.goto('/#tutor');
  await expect(page.getByText('Help is paused during tests')).toBeVisible();
  await page.goto('/#test');
  await page.getByRole('button', {name: 'Finish module', exact: true}).click();
  await page.getByRole('button', {name: 'Submit'}).click();
  await expect(page.getByRole('heading', {name: 'Reading and Writing · Module 2 (easier)'})).toBeVisible();
  await expect(page.getByText('the easier version')).toBeVisible();
  page.on('dialog', d => d.accept());
  await page.getByRole('button', {name: 'Stop test'}).click();
  await expect(page).toHaveURL(/#review$/);
  const state = await saved(page);
  expect(state.runs[0].status).toBe('complete');
  expect(state.runs[0].moduleSessionIds).toHaveLength(1);
  await page.goto('/#tutor');
  await expect(page.getByText('Help is paused during tests')).toHaveCount(0);
});
test('a module whose time runs out is submitted automatically and the next module is offered', async ({page}) => {
  await page.clock.install();
  await page.goto('/#test');
  await page.getByRole('button', {name: 'Start →'}).nth(2).click();
  await page.getByRole('button', {name: 'Begin module →'}).click();
  await page.getByRole('radio').first().check();
  await page.clock.fastForward('40:00');
  await expect(page.getByText('Time is up for this module.')).toBeVisible();
  await expect(page.getByRole('heading', {name: /Math · Module 2/})).toBeVisible();
  const state = await saved(page);
  expect(state.sessions[0].status).toBe('expired');
});
test('daily plan targets the weakest skill and completes after the planned number of answers', async ({page}) => {
  await page.goto('/#plan');
  await page.getByRole('button', {name: '10 min', exact: true}).click();
  await page.getByRole('button', {name: /^Start: Reading & Writing focus/}).click();
  await expect(page).toHaveURL(/#practice$/);
  await expect(page.getByText(/Daily plan: 0 of 2 questions in Words in Context/)).toBeVisible();
  for (let i = 0; i < 2; i++) { await page.getByRole('radio').first().check(); await page.getByRole('button', {name: 'Check answer'}).click(); if (i === 0) await page.getByRole('button', {name: 'Next question'}).click(); }
  await page.getByRole('button', {name: 'Complete activity →'}).click();
  await expect(page.locator('.plan-progress')).toContainText('1 of 3 activities');
});
test('tutor works without AI using step-by-step hints for any bank question', async ({page}) => {
  await page.goto('/#tutor');
  await page.getByRole('button', {name: 'Reading & Writing', exact: true}).click();
  await page.getByRole('button', {name: '✧ Small hint'}).click();
  await expect(page.getByText('1 of 3 hints')).toBeVisible();
  await expect(page.getByText('Typing your own questions needs the AI connection.')).toBeVisible();
  await expect(page.locator('.chat .bubble')).toHaveCount(3);
});
test('explain-my-work and handwriting checks find the first wrong step', async ({page}) => {
  await page.goto('/#work');
  await page.getByRole('button', {name: 'Check my steps →'}).click();
  await expect(page.locator('.walkstep.error code')).toHaveText('7d = 28');
  await page.getByLabel('Question').selectOption('sat-m-002');
  await page.getByRole('textbox', {name: /Your solution/}).fill('6x - 15 = 2x + 9\n4x = 24\nx = 6');
  await page.getByRole('button', {name: 'Check my steps →'}).click();
  await expect(page.getByText('Every line checks out.')).toBeVisible();
  await page.goto('/#handwriting');
  await page.getByLabel('Question').selectOption('wp-math-001');
  await page.getByRole('button', {name: 'Use sample work'}).click();
  await page.getByRole('button', {name: 'This matches my work · check it →'}).click();
  await expect(page.locator('.walkstep.error code')).toHaveText('7d = 28');
});
test('progress saved by the earlier 4-question demo still loads and appears in review', async ({page}) => {
  await page.goto('/');
  await page.evaluate(key => {
    const t = 1_700_000_000_000;
    localStorage.setItem(key, JSON.stringify({version: 1, activeSessionId: 'old', drafts: {}, reflections: {'wp-rw-001': {text: 'Old note', updatedAt: t}}, practiceQuestionId: 'wp-rw-001', reviewAttemptId: null,
      attempts: [{id: 'old:wp-math-001', questionId: 'wp-math-001', selected: 1, correct: true, mode: 'test', sessionId: 'old', flagged: false, elapsedMs: 30000, submittedAt: t}],
      sessions: [{id: 'old', questionIds: ['wp-math-001', 'wp-rw-001', 'wp-math-002', 'wp-rw-002'], status: 'submitted', answers: {'wp-math-001': 1}, flags: [], currentIndex: 3, startedAt: t - 60000, deadlineAt: null, remainingMs: 240000, submittedAt: t, questionElapsedMs: {'wp-math-001': 30000}, segmentStartedAt: null}],
      intelligence: {attempts: [{id: 's1', questionId: 'smart-a1', correct: true, selected: 1, hinted: false, elapsedMs: 1000, submittedAt: t, level: 'Medium'}], workDraft: '18 + 7d = 60', pacingGoal: true, handwrittenLines: ['', '', '', '']}}));
  }, KEY);
  await page.reload();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.goto('/#review');
  await expect(page.getByText('6 days · ✓ Correct answer · Your answer')).toBeVisible();
  await page.goto('/#pacing');
  await expect(page.getByRole('heading', {name: 'Where your time went'})).toBeVisible();
  await page.goto('/#adaptive');
  await expect(page).toHaveURL(/#practice$/);
});
for (const width of [1440, 834, 390, 320]) test(`no horizontal scrolling on any page at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  for (const route of ['dashboard', 'practice', 'tutor', 'test', 'pacing', 'review', 'analysis', 'work', 'handwriting', 'plan', 'weekly', 'assistant']) {
    await page.goto(`/#${route}`); await page.locator('#page-title').waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${route} at ${width}px`).toBe(true);
  }
  if (width <= 700) {
    await page.getByRole('button', {name: 'Open navigation'}).click();
    await expect(nav(page).getByRole('button', {name: 'Plan', exact: true})).toBeVisible();
  } else await expect(nav(page).getByRole('button')).toHaveCount(6);
});
