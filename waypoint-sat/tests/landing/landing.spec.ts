import {test,expect} from '@playwright/test';
test('public homepage leads into SAT sign-in and returns home from the app logo',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toContainText('SAT practice.');
 await page.getByRole('link',{name:'Explore SAT Practice',exact:true}).first().click();
 await expect(page).toHaveURL(/\/app\/#practice$/);await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
 await page.getByRole('link',{name:'PrepOrbit AI home',exact:true}).click();
 await expect(page).toHaveURL('http://127.0.0.1:5192/');await expect(page.getByRole('heading',{level:1})).toContainText('Human connection.');
});
test('old study bookmarks and password-reset URLs still open the app',async({page})=>{
 for(const route of ['dashboard','assistant','practice']){await page.goto('/#'+route);await expect(page).toHaveURL(new RegExp('/app/#'+route+'$'));await expect(page.locator('.auth')).toBeVisible();}
 await page.goto('/#reset='+'a'.repeat(64));await expect(page).toHaveURL(/\/app\/#reset=/);await expect(page.getByRole('heading',{name:'Choose a new password.'})).toBeVisible();
});
for(const width of [1440,834,390,320])test(`integrated landing and tutor preview fit at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('.hero-visual img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await page.getByRole('button',{name:'Find a Nearby Tutor',exact:true}).first().click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('combobox',{name:'Subject',exact:true}).selectOption('Reading & Writing');
 await expect(page.getByText('1 illustrative profile',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close preview',exact:true}).press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.screenshot({path:`test-results/landing/railway-landing-${width}.png`});
});
