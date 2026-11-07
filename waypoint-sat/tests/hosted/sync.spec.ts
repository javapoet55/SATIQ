import {test, expect, type Page} from '@playwright/test';
import {emptyState, type State} from '../../src/model';
async function mockDatabase(page: Page) {
  const db = {state:emptyState(), revision:0, failAfterWrite:false};
  const writes = new Map<string,number>();
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
  await page.getByRole('button',{name:'Worked solution'}).click();
  await expect(page.locator('footer')).toContainText('Saved to Railway database');
}
test('hosted progress restores from database without relying on localStorage', async ({page}) => {
  const db = await mockDatabase(page); await review(page);
  await page.getByRole('textbox').fill('Subtract the fixed fee before dividing.');
  await expect(page.locator('footer')).toContainText('Saved to Railway database');
  expect(db.state.attempts).toHaveLength(1);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('textbox')).toHaveValue('Subtract the fixed fee before dividing.');
  await expect(page.getByText('6 days · ✓ Correct answer · Your answer')).toBeVisible();
});
test('a lost save acknowledgement retries idempotently and preserves newer edits', async ({page}) => {
  const db = await mockDatabase(page); await review(page);
  db.failAfterWrite = true;
  await page.getByRole('textbox').fill('First saved reflection.');
  await expect(page.getByRole('alert')).toContainText('Progress is not saved.');
  await page.getByRole('textbox').fill('A newer reflection after losing the response.');
  await page.getByRole('button',{name:'Retry saving'}).click();
  await expect(page.locator('footer')).toContainText('Saved to Railway database');
  expect(db.state.reflections['wp-math-001'].text).toBe('A newer reflection after losing the response.');
  expect(db.state.attempts).toHaveLength(1);
});
test('conflicting tab never overwrites server and explicitly reloads the server copy', async ({page}) => {
  const db = await mockDatabase(page); await review(page);
  db.state = {...db.state, reflections:{'wp-math-001':{text:'Saved by the other tab.',updatedAt:Date.now()}}}; db.revision++;
  await page.getByRole('textbox').fill('Pending work in this tab.');
  await expect(page.getByRole('alert')).toContainText('Newer progress was saved in another tab.');
  await expect(page.getByRole('textbox')).toHaveValue('Pending work in this tab.');
  expect(db.state.reflections['wp-math-001'].text).toBe('Saved by the other tab.');
  page.on('dialog', async dialog => {await dialog.accept();});
  await page.getByRole('button',{name:'Reload server copy'}).click();
  await expect(page.getByRole('textbox')).toHaveValue('Saved by the other tab.');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('save failure with full browser storage clearly reports memory-only recovery', async ({page}) => {
  const db = await mockDatabase(page); await review(page);
  await page.evaluate(() => {Storage.prototype.setItem = () => {throw new DOMException('Full storage','QuotaExceededError');};});
  db.failAfterWrite = true;
  await page.getByRole('textbox').fill('Keep this note in memory.');
  await expect(page.getByRole('alert')).toContainText('Browser backup is unavailable.');
  await expect(page.getByRole('textbox')).toHaveValue('Keep this note in memory.');
  await page.getByRole('button',{name:'Retry saving'}).click();
  await expect(page.locator('footer')).toContainText('Saved to Railway database');
});
test('local progress backup imports to the database and preserves all questions', async ({page}) => {
  const db = await mockDatabase(page);
  await page.goto('/');
  const backup: State = emptyState();
  backup.reflections['wp-math-002'] = {text:'A saved local reflection.',updatedAt:Date.now()};
  backup.attempts = [{id:'from-local',questionId:'wp-math-002',selected:2,correct:true,mode:'practice',sessionId:null,flagged:false,elapsedMs:1200,submittedAt:Date.now()}];
  backup.reviewAttemptId = 'from-local';
  page.on('dialog', async dialog => {await dialog.accept();});
  await page.getByLabel('Progress backup file').setInputFiles({name:'progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await expect(page.locator('footer')).toContainText('Saved to Railway database');
  await expect.poll(() => db.state.attempts.length).toBe(1);
  await page.getByRole('button',{name:'Answer Review',exact:true}).click();
  await expect(page.getByRole('textbox')).toHaveValue('A saved local reflection.');
});

test('companion conversations, plan completion and confirmed causes restore from database', async ({page}) => {
  const db = await mockDatabase(page);
  await page.goto('/#plan');
  await page.getByRole('button',{name:'30 min',exact:true}).click();
  await page.getByRole('button',{name:'Start: Find your algebra rhythm',exact:true}).click();
  await page.getByRole('button',{name:'Give me a small hint'}).click();
  await page.getByRole('textbox',{name:'Your question to the tutor'}).fill('A question I want to return to.');
  await page.getByRole('radio',{name:'A. 4 days',exact:true}).check();
  await page.getByRole('button',{name:'Check answer'}).click();
  await page.getByRole('button',{name:'Complete demo activity & return to plan'}).click();
  await expect(page.locator('footer')).toContainText('Saved to Railway database');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.plan-progress')).toContainText('1 of 4 activities');
  await expect(page.getByRole('button',{name:'30 min',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Guided Tutor',exact:true}).click();
  await expect(page.getByText('1 of 3 hints opened')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Your question to the tutor'})).toHaveValue('A question I want to return to.');
  await page.getByRole('button',{name:'Reflect on this attempt'}).click();
  await page.getByRole('textbox',{name:'Describe how you solved the question'}).fill('I need to review how to write the equation.');
  await page.getByRole('button',{name:'Explore my mistake'}).click();
  await page.getByRole('radio',{name:/Concept gap/}).check();
  await page.getByRole('button',{name:'Confirm my reflection'}).click();
  await expect(page.locator('footer')).toContainText('Saved to Railway database');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading',{name:'Separate the parts.'})).toBeVisible();
  expect(db.state.companion?.tutor['wp-math-001'].hintLevel).toBe(1);
  expect(db.state.attempts).toHaveLength(1);
});
