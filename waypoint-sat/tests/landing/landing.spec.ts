import {test,expect} from '@playwright/test';
test('public homepage leads into SAT sign-in and returns home from the app logo',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toContainText('Your daily');
 await page.getByRole('link',{name:'Start free SAT practice',exact:true}).first().click();
 await expect(page).toHaveURL(/\/app\/#practice$/);await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
 await page.getByRole('link',{name:'PrepOrbit AI home',exact:true}).click();
 await expect(page).toHaveURL('http://127.0.0.1:5192/');await expect(page.getByRole('heading',{level:1})).toContainText('Your community');
});
test('old study bookmarks and password-reset URLs still open the app',async({page})=>{
 for(const route of ['dashboard','assistant','practice']){await page.goto('/#'+route);await expect(page).toHaveURL(new RegExp('/app/#'+route+'$'));await expect(page.locator('.auth')).toBeVisible();}
 await page.goto('/#reset='+'a'.repeat(64));await expect(page).toHaveURL(/\/app\/#reset=/);await expect(page.getByRole('heading',{name:'Choose a new password.'})).toBeVisible();
});
for(const width of [1440,834,390,320])test(`integrated landing and tutor preview fit at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('.hero-visual img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await page.getByRole('button',{name:'Find a tutor',exact:true}).first().click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('combobox',{name:'Subject',exact:true}).selectOption('Reading & Writing');
 await expect(page.getByText('1 illustrative profile',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close preview',exact:true}).press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.screenshot({path:`test-results/landing/railway-landing-${width}.png`});
});

test('SAT sample explains answers and suggests the next skill without leaving the homepage',async({page})=>{
 await page.goto('/'); await page.getByRole('button',{name:'Try a free question',exact:true}).click();
 await expect(page).toHaveURL('http://127.0.0.1:5192/');
 await expect(page.getByRole('heading',{name:'If 3x + 7 = 22, what is the value of x?',exact:true})).toBeInViewport();
 await expect(page.getByRole('button',{name:'Check my answer',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'A 3',exact:true}).click();await page.getByRole('button',{name:'Check my answer',exact:true}).click();
 await expect(page.getByText('Good effort. Let’s work it through.',{exact:true})).toBeVisible();
 await expect(page.getByText('Equations with variables on both sides',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Try this question again ↗',exact:true}).click();
 await page.getByRole('button',{name:'B 5',exact:true}).click();await page.getByRole('button',{name:'Check my answer',exact:true}).click();
 await expect(page.getByText('Exactly right. Nice work!',{exact:true})).toBeVisible();
});
test('tutor workspace and proposed pricing stay clearly separated from live features',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'T 11',exact:true}).click();
 await expect(page.getByText('Algebra confidence session',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open lesson notes',exact:true}).click();
 await expect(page.getByText(/Next session: use an area model/)).toBeVisible();
 await page.getByRole('button',{name:'See what a certificate includes',exact:true}).click();
 await expect(page.getByText(/Tutor name · Verified teaching hours/)).toBeVisible();
 await page.getByRole('button',{name:'Preview Orbit Plus',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('Subscriptions are not available yet.');
 await page.getByRole('button',{name:'Close preview',exact:true}).press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
