import {test,expect,type Page} from '@playwright/test';
import {emptyState} from '../../src/model';

test.use({timezoneId:'America/Los_Angeles'});
async function study(page:Page) {
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{email:'jamie.lee@example.com'},emailDelivery:true}}));
  await page.route('**/api/config',route=>route.fulfill({json:{ai:false,admin:false,desmosKey:null}}));
  await page.route('**/api/questions',route=>route.fulfill({json:{questions:[]}}));
  await page.route('**/api/progress',route=>route.fulfill({json:{state:emptyState(),revision:0,profileId:'header-qa'}}));
  await page.goto('/#dashboard');
}
for(const [hour,greeting] of [['08','Good morning'],['14','Good afternoon'],['19','Good evening']]) {
  test(`home greeting uses the student's local time at ${hour}:00`,async({page})=>{
    await page.clock.setFixedTime(new Date(`2026-11-08T${hour}:00:00-08:00`));
    await study(page);
    await expect(page.locator('.study-greeting')).toHaveText(`${greeting}, Jamie Lee.`);
    const location=page.locator('.study-header-location');
    await expect(location.locator('.eyebrow')).toHaveText('HOME');
    await expect(location.locator('time')).toHaveText('Sunday, November 8');
    await expect(page.locator('header .avatar')).toHaveCount(0);
    await expect(page.locator('header').getByRole('button',{name:'Sign out'})).toBeVisible();
  });
}
for(const width of [1440,834,390,320]) {
  test(`header greeting, date and actions reflow at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:1000});
    await page.clock.setFixedTime(new Date('2026-11-08T08:00:00-08:00'));
    await study(page);
    await expect(page.locator('.study-greeting')).toBeVisible();
    await expect(page.locator('.study-header-location time')).toBeVisible();
    await expect(page.locator('header').getByRole('link',{name:'Ask AI'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results-hosted/header-${width}.png`});
  });
}
