import {test, expect, type Page} from '@playwright/test';
import {emptyState, type State} from '../../src/model';
async function mockDatabase(page: Page) {
  const db = {state:emptyState(), revision:0, failAfterWrite:false};
  const writes = new Map<string,number>();
  await page.route('**/api/config', route => route.fulfill({json:{ai:false, admin:false, desmosKey:null}}));
  await page.route('**/api/questions', route => route.fulfill({json:{questions:[]}}));
  await page.route('**/api/auth/me', route => route.fulfill({json:{user:{email:'student@example.com'}, emailDelivery:true}}));
  await page.route('**/api/progress', async route => {
    if (route.request().method() === 'GET') {await route.fulfill({json:{state:db.state,revision:db.revision,profileId:'test-profile'}}); return;}
    const body = route.request().postDataJSON();
    if (writes.has(body.writeId)) {await route.fulfill({json:{revision:writes.get(body.writeId)}}); return;}
    if (body.revision !== db.revision) {await route.fulfill({status:409,json:{message:'Newer progress was saved in another tab.'}}); return;}
    db.state = body.state; db.revision++; writes.set(body.writeId,db.revision);
    if (db.failAfterWrite) {db.failAfterWrite=false; await route.abort(); return;}
    await route.fulfill({json:{revision:db.revision}});
  });
  return db;
}
async function review(page: Page) {
  await page.goto('/#practice');
  await page.getByRole('radio',{name:'B. 6 days',exact:true}).check();
  await page.getByRole('button',{name:'Check answer'}).click();
  await expect(page.getByText('That’s right.')).toBeVisible();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Review',exact:true}).click();
  await expect(page.locator('footer')).toContainText('Progress saved');
}
const reflection = (page: Page) => page.getByRole('textbox',{name:'What will you try next time?'});
test('hosted progress restores from database without relying on localStorage', async ({page}) => {
  const db = await mockDatabase(page); await review(page);
  await reflection(page).fill('Subtract the fixed fee before dividing.');
  await expect(page.locator('footer')).toContainText('Progress saved');
  expect(db.state.attempts).toHaveLength(1);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(reflection(page)).toHaveValue('Subtract the fixed fee before dividing.');
  await expect(page.getByText('6 days · ✓ Correct answer · Your answer')).toBeVisible();
});
test('a lost save acknowledgement retries idempotently and preserves newer edits', async ({page}) => {
  const db = await mockDatabase(page); await review(page);
  db.failAfterWrite = true;
  await reflection(page).fill('First saved reflection.');
  await expect(page.getByRole('alert')).toContainText('Progress is not saved.');
  await reflection(page).fill('A newer reflection after losing the response.');
  await page.getByRole('button',{name:'Retry saving'}).click();
  await expect(page.locator('footer')).toContainText('Progress saved');
  expect(db.state.reflections['wp-math-001'].text).toBe('A newer reflection after losing the response.');
  expect(db.state.attempts).toHaveLength(1);
});
test('conflicting tab never overwrites server and explicitly reloads the server copy', async ({page}) => {
  const db = await mockDatabase(page); await review(page);
  db.state = {...db.state, reflections:{'wp-math-001':{text:'Saved by the other tab.',updatedAt:Date.now()}}}; db.revision++;
  await reflection(page).fill('Pending work in this tab.');
  await expect(page.getByRole('alert')).toContainText('Newer progress was saved in another tab.');
  await expect(reflection(page)).toHaveValue('Pending work in this tab.');
  expect(db.state.reflections['wp-math-001'].text).toBe('Saved by the other tab.');
  page.on('dialog', async dialog => {await dialog.accept();});
  await page.getByRole('button',{name:'Reload server copy'}).click();
  await expect(reflection(page)).toHaveValue('Saved by the other tab.');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('save failure with full browser storage clearly reports memory-only recovery', async ({page}) => {
  const db = await mockDatabase(page); await review(page);
  await page.evaluate(() => {Storage.prototype.setItem = () => {throw new DOMException('Full storage','QuotaExceededError');};});
  db.failAfterWrite = true;
  await reflection(page).fill('Keep this note in memory.');
  await expect(page.getByRole('alert')).toContainText('Browser backup is unavailable.');
  await expect(reflection(page)).toHaveValue('Keep this note in memory.');
  await page.getByRole('button',{name:'Retry saving'}).click();
  await expect(page.locator('footer')).toContainText('Progress saved');
});
test('local progress backup imports to the database, including typed answers and new question ids', async ({page}) => {
  const db = await mockDatabase(page);
  await page.goto('/');
  const backup: State = emptyState();
  backup.reflections['wp-math-002'] = {text:'A saved local reflection.',updatedAt:Date.now()};
  backup.attempts = [{id:'from-local',questionId:'wp-math-002',selected:2,correct:true,mode:'practice',sessionId:null,flagged:false,elapsedMs:1200,submittedAt:Date.now()},
    {id:'typed',questionId:'sat-m-002',selected:'6',correct:true,mode:'practice',sessionId:null,flagged:false,elapsedMs:900,submittedAt:Date.now()-1000}];
  backup.reviewAttemptId = 'from-local';
  page.on('dialog', async dialog => {await dialog.accept();});
  await page.getByLabel('Progress backup file').setInputFiles({name:'progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await expect(page.locator('footer')).toContainText('Progress saved');
  await expect.poll(() => db.state.attempts.length).toBe(2);
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Review',exact:true}).click();
  await expect(reflection(page)).toHaveValue('A saved local reflection.');
});
test('daily plan progress, tutor hints, and confirmed reflections restore from database', async ({page}) => {
  const db = await mockDatabase(page);
  await page.goto('/#plan');
  await page.getByRole('button',{name:'10 min',exact:true}).click();
  await page.getByRole('button',{name:/^Start: Math focus/}).click();
  await expect(page.getByText(/Daily plan: 0 of 3 questions in/)).toBeVisible();
  for (let i = 0; i < 3; i++) {
    const radios = page.getByRole('radio');
    if (await radios.count()) await radios.first().check(); else await page.getByLabel('Your answer').fill('6');
    await page.getByRole('button',{name:'Check answer'}).click();
    if (i < 2) await page.getByRole('button',{name:'Next question'}).click();
  }
  await page.getByRole('button',{name:'Complete activity →'}).click();
  await expect(page.locator('.plan-progress')).toContainText('1 of 3 activities');
  await page.goto('/#tutor');
  await page.getByRole('button',{name:'✧ Small hint'}).click();
  await expect(page.getByText('1 of 3 hints')).toBeVisible();
  await expect(page.locator('footer')).toContainText('Progress saved');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText('1 of 3 hints')).toBeVisible();
  await page.goto('/#plan');
  await expect(page.locator('.plan-progress')).toContainText('1 of 3 activities');
  await page.goto('/#analysis');
  await page.getByLabel('Attempt to reflect on').selectOption({index: 1});
  await page.getByRole('textbox',{name:'Walk me through your thinking.'}).fill('I need to review how to write the equation.');
  await page.getByRole('button',{name:'Explore my mistake'}).click();
  await page.getByRole('radio',{name:/Concept gap/}).check();
  await page.getByRole('button',{name:'Save my reflection'}).click();
  await expect(page.locator('footer')).toContainText('Progress saved');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading',{name:'Separate the parts.'})).toBeVisible();
  expect(db.state.companion?.plans[Object.keys(db.state.companion!.plans)[0]].completed.algebra).toBeTruthy();
  expect(db.state.attempts).toHaveLength(3);
});
test('practice filters, typed work and handwriting transcriptions restore from database', async ({page}) => {
  const db = await mockDatabase(page);
  await page.goto('/#practice');
  await page.getByRole('button',{name:'Math',exact:true}).click();
  await page.getByLabel('Skill').selectOption('Circles');
  await page.goto('/#work');
  await page.getByRole('textbox',{name:/Your solution, one equation per line/}).fill('18 + 7d = 60\n7d = 42\nd = 6');
  await page.getByRole('button',{name:'Check my steps →'}).click();
  await expect(page.locator('.walkstep.error')).toHaveCount(0);
  await expect(page.locator('footer')).toContainText('Progress saved');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await expect(page.getByRole('textbox',{name:/Your solution, one equation per line/})).toHaveValue('18 + 7d = 60\n7d = 42\nd = 6');
  await page.goto('/#practice');
  await expect(page.getByLabel('Skill')).toHaveValue('Circles');
  expect(db.state.practice?.skill).toBe('Circles');
  expect(db.state.intelligence?.workDraft).toContain('7d = 42');
});
