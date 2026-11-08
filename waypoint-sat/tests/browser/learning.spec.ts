import {test, expect} from '@playwright/test';
const KEY = 'waypoint-local-v1';
test('practice → review → reflection → dashboard persists actual activity and retries', async ({page}) => {
  await page.goto('/');
  await expect(page.getByText('Not available', {exact:true})).toBeVisible();
  await expect(page.getByText('0 of 3 complete')).toBeVisible();
  await page.getByRole('button', {name:'Answer Review', exact:true}).click();
  await expect(page.getByText('Your learning story starts here.')).toBeVisible();
  await page.getByRole('button', {name:'Start practicing'}).click();
  await expect(page.getByRole('button', {name:'Check answer'})).toBeDisabled();
  await page.getByRole('button', {name:'Give me a hint'}).click();
  await expect(page.getByText('Separate the fixed fee from the daily cost.')).toBeVisible();
  await page.getByRole('radio', {name:'A. 4 days', exact:true}).check();
  await page.reload();
  await expect(page.getByRole('radio', {name:'A. 4 days', exact:true})).toBeChecked();
  await page.getByRole('button', {name:'Check answer'}).click();
  await expect(page.getByText('Good opportunity to learn.', {exact:false})).toBeVisible();
  await page.getByRole('button', {name:'Worked solution'}).click();
  await expect(page.getByText('18 + 7d = 60', {exact:true})).toBeVisible();
  await expect(page.getByText('4 days · Your answer')).toBeVisible();
  await page.getByRole('textbox', {name:'What will you try next time?'}).fill('Subtract the fixed fee before dividing.');
  await page.reload();
  await expect(page.getByRole('textbox')).toHaveValue('Subtract the fixed fee before dividing.');
  await page.getByRole('button', {name:'Dashboard', exact:true}).click();
  await expect(page.getByText('2 of 3 complete')).toBeVisible();
  await expect(page.getByText('1 day in a row.', {exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Question Practice', exact:true}).click();
  await page.getByRole('button', {name:'Try again', exact:true}).click();
  await page.getByRole('radio', {name:'B. 6 days', exact:true}).check();
  await page.getByRole('button', {name:'Check answer'}).click();
  await expect(page.getByText('Retry saved. Your first attempt is preserved.')).toBeVisible();
  await page.getByRole('button', {name:'Reading & Writing', exact:true}).click();
  await page.getByRole('radio', {name:'C. as a result', exact:true}).check();
  await page.getByRole('button', {name:'Check answer'}).click();
  await page.getByRole('button', {name:'Dashboard', exact:true}).click();
  await expect(page.getByText('3 of 3 complete')).toBeVisible();
  const state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(state.attempts).toHaveLength(3);
  expect(state.attempts[0].correct).toBe(false);
  await expect(page.locator('.stats strong').first()).toHaveText('0%');
  await expect(page.locator('.stats strong').last()).toHaveText('100%');
});

test('demo navigation, flags, pause, reload, submission and locked actual-answer review', async ({page}) => {
  await page.goto('/#test'); await page.getByRole('button',{name:'Open 4-question quick demo',exact:false}).click();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  await page.getByRole('button', {name:'Begin demo'}).click();
  await page.getByRole('radio', {name:'B. 6 days', exact:true}).check();
  await page.getByRole('button', {name:'Mark for review', exact:false}).click();
  await page.getByRole('button', {name:'Next question'}).click();
  await page.getByRole('radio', {name:'A. nevertheless', exact:true}).check();
  await page.getByRole('button', {name:'Pause demo'}).click();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  const pausedTime = await page.locator('.timer').textContent();
  await page.waitForTimeout(1100);
  expect(await page.locator('.timer').textContent()).toBe(pausedTime);
  await page.reload();
  await expect(page.getByRole('radio', {name:'A. nevertheless', exact:true})).toBeChecked();
  await page.getByRole('button', {name:'Resume demo'}).click();
  await page.getByRole('button', {name:'Question 1, answered, marked', exact:true}).click();
  await expect(page.getByRole('radio', {name:'B. 6 days', exact:true})).toBeChecked();
  await page.getByRole('button', {name:'Dashboard', exact:true}).click();
  await expect(page.getByText(/Demo is running/)).toBeVisible();
  await page.getByRole('button', {name:'Return to demo'}).click();
  await page.getByRole('button', {name:'Finish module', exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('2 unanswered · 1 marked');
  await expect(page.getByRole('button', {name:'Keep working'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', {name:'Finish module', exact:true}).click();
  await page.getByRole('button', {name:'Submit & review'}).click();
  await expect(page).toHaveURL(/#review$/);
  await expect(page.getByText('6 days · ✓ Correct answer · Your answer')).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  const attemptSelect = page.getByRole('combobox', {name:'Attempt', exact:true});
  await attemptSelect.selectOption({label: await attemptSelect.locator('option').filter({hasText:'Percentages'}).textContent() as string});
  await expect(page.getByText('You left this question unanswered.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('You left this question unanswered.')).toBeVisible();
  await page.getByRole('button', {name:'Practice Test', exact:true}).click();
  await page.getByRole('button',{name:'Open 4-question quick demo',exact:false}).click();
  await expect(page.getByText('1 of 4 correct', {exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Start a new demo'}).click();
  await expect(page.getByRole('button', {name:'Begin demo'})).toBeVisible();
  const state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(state.sessions).toHaveLength(2); expect(state.attempts).toHaveLength(4);
});

test('running deadline expires across reload and submits exactly once', async ({page}) => {
  await page.goto('/#test'); await page.getByRole('button',{name:'Open 4-question quick demo',exact:false}).click(); await page.getByRole('button', {name:'Begin demo'}).click();
  await page.getByRole('radio', {name:'B. 6 days', exact:true}).check();
  await page.evaluate(key => {const s = JSON.parse(localStorage.getItem(key)!); s.sessions[0].deadlineAt = Date.now() - 1000; localStorage.setItem(key, JSON.stringify(s));}, KEY);
  await page.reload();
  await expect(page).toHaveURL(/#review$/);
  await expect(page.getByText('Time is up.', {exact:false})).toBeVisible();
  await page.reload();
  const state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(state.sessions[0].status).toBe('expired'); expect(state.attempts).toHaveLength(4);
});

test('storage failure is visible and reflection stays in memory', async ({page}) => {
  await page.goto('/#practice');
  await page.getByRole('radio', {name:'B. 6 days', exact:true}).check();
  await page.getByRole('button', {name:'Check answer'}).click();
  await page.getByRole('button', {name:'Worked solution'}).click();
  await page.evaluate(() => {Storage.prototype.setItem = () => {throw new DOMException('Quota exceeded', 'QuotaExceededError');};});
  await page.getByRole('textbox').fill('Keep this reflection in memory.');
  await expect(page.getByRole('alert')).toContainText('Progress is not saved.');
  await expect(page.getByRole('textbox')).toHaveValue('Keep this reflection in memory.');
});

test('all four original questions have correct solutions and per-question notes', async ({page}) => {
  await page.goto('/#practice');
  for (const [subject, choice, note] of [
    ['Math', 'B. 6 days', 'Separate the fixed fee.'],
    ['Math', 'C. $6', 'Subtract the discount.'],
    ['Reading & Writing', 'C. as a result', 'Look for cause and effect.'],
    ['Reading & Writing', 'A. able to recover', 'Read after the colon.'],
  ]) {
    await page.getByRole('button', {name:subject, exact:true}).click();
    if (choice.includes('$6') || choice.includes('recover')) await page.getByRole('button', {name:'Next practice question'}).click();
    await page.getByRole('radio', {name:choice, exact:true}).check();
    await page.getByRole('button', {name:'Check answer'}).click();
    await expect(page.getByText('✓ That’s right.', {exact:true})).toBeVisible();
    await page.getByRole('button', {name:'Worked solution'}).click();
    await expect(page.getByText('THE WORKED SOLUTION', {exact:true})).toBeVisible();
    await page.getByRole('textbox').fill(note);
    await page.getByRole('button', {name:'Return to practice'}).click();
  }
  await page.reload();
  const state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(state.attempts).toHaveLength(4);
  expect(state.attempts.every((a: {correct:boolean}) => a.correct)).toBe(true);
  expect(Object.keys(state.reflections)).toHaveLength(4);
});

test('live expiry while submission dialog is open locks and submits once', async ({page}) => {
  await page.clock.install({time: new Date('2026-11-07T20:00:00Z')});
  await page.goto('/#test'); await page.getByRole('button',{name:'Open 4-question quick demo',exact:false}).click();
  await page.getByRole('button', {name:'Begin demo'}).click();
  await page.getByRole('radio', {name:'B. 6 days', exact:true}).check();
  await page.getByRole('button', {name:'Finish module', exact:true}).click();
  await page.clock.fastForward(301000);
  await expect(page).toHaveURL(/#review$/);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(state.attempts).toHaveLength(4); expect(state.sessions[0].status).toBe('expired');
});

for (const width of [1440, 834, 390, 320]) test(`four responsive screens at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: width === 834 ? 1194 : width >= 1000 ? 1000 : 844});
  await page.goto('/#practice');
  await page.getByRole('radio', {name:'B. 6 days', exact:true}).check();
  await page.getByRole('button', {name:'Check answer'}).click();
  await page.getByRole('button', {name:'Worked solution'}).click();
  for (const route of ['dashboard', 'practice', 'test', 'review']) {
    await page.goto(`/#${route}`);
    const titles = {dashboard:'Small steps. Real progress.', practice:'One question at a time.', test:'Find your focus.', review:'Make the next one click.'};
    await expect(page.locator('h1')).toHaveText(titles[route as keyof typeof titles]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/screenshots/${route}-${width}.png`, fullPage:true});
  }
});

test('keyboard radio navigation and 200% equivalent viewport reflow', async ({page}) => {
  await page.setViewportSize({width:720, height:500});
  await page.goto('/#practice');
  const first = page.getByRole('radio', {name:'A. 4 days', exact:true});
  await first.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', {name:'B. 6 days', exact:true})).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
