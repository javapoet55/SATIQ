import {test,expect} from '@playwright/test';
const pages = [
 ['Dashboard','Small steps. Real progress.'],['Question Practice','One question at a time.'],['Practice Test','Find your focus.'],['Answer Review','Make the next one click.'],
 ['Daily Plan','A plan that meets you here.'],['Guided Tutor','A nudge in the right direction.'],['Mistake Analysis','Find the lesson in the miss.'],
 ['Adaptive Practice','The right next challenge.'],['Explain My Work','Let’s find the turning point.'],['Pacing Coach','Make time work for you.'],['Similar Questions','Same skill. A fresh start.'],['Weekly Summary','Look how far you’ve come.'],['Handwritten Work','Your scratch work has a story.'],
 ['AI Assistant','Ask. Understand. Move forward.']
];
test('all fourteen destinations are available from the same desktop left menu',async ({page})=>{
 await page.goto('/');const nav=page.getByRole('navigation',{name:'Main navigation'});
 await expect(nav.getByRole('button')).toHaveCount(14);
 for(const [name,title] of pages){await nav.getByRole('button',{name,exact:true}).click();await expect(page.locator('h1')).toHaveText(title);await expect(nav.getByRole('button',{name,exact:true})).toHaveAttribute('aria-current','page');await expect(nav.getByRole('button')).toHaveCount(14)}
 await nav.getByRole('button',{name:'Similar Questions',exact:true}).click();
 await expect(page.locator('header').getByRole('button')).toHaveCount(0);
 await page.locator('header').getByRole('link',{name:'AI Assistant',exact:true}).click();
 await expect(page.locator('h1')).toHaveText('Ask. Understand. Move forward.');
 await nav.getByRole('button',{name:'Dashboard',exact:true}).click();
 await page.locator('.sidebar-bottom').getByRole('link',{name:/AI Assistant/}).click();
 await expect(page.locator('h1')).toHaveText('Ask. Understand. Move forward.');
});
test('mobile Menu exposes every destination, closes on selection and preserves current route',async ({page})=>{
 await page.setViewportSize({width:320,height:844});await page.goto('/');
 const nav=page.getByRole('navigation',{name:'Main navigation'});await expect(nav).toBeHidden();
 for(const [name,title] of pages){await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(nav).toBeVisible();await nav.getByRole('button',{name,exact:true}).click();await expect(page.locator('h1')).toHaveText(title);await expect(nav).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
 await page.reload();await expect(page.locator('h1')).toHaveText('Ask. Understand. Move forward.');
 await expect(page.locator('header').getByRole('link',{name:'AI Assistant',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(nav.getByRole('button',{name:'AI Assistant',exact:true})).toHaveAttribute('aria-current','page');
 await page.screenshot({path:'test-results/navigation/mobile-menu-320.png',fullPage:false});
});
test('intelligence screens support checked adaptive routing, work review, similar practice and handwriting confirmation',async ({page})=>{
 await page.goto('/#adaptive');
 await page.getByRole('radio',{name:'B. 5 hours',exact:true}).check();await page.getByRole('button',{name:'Check answer',exact:false}).click();
 await page.getByRole('button',{name:'Choose my next question',exact:false}).click();await expect(page.getByText('Linear equations · Stretch',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Small hint',exact:false}).click();await page.getByRole('radio',{name:'B. 3 packages',exact:true}).check();await page.getByRole('button',{name:'Check answer',exact:false}).click();await page.getByRole('button',{name:'Choose my next question',exact:false}).click();await expect(page.getByText('Linear equations · Foundation',{exact:true})).toBeVisible();
 const nav=page.getByRole('navigation',{name:'Main navigation'});
 await nav.getByRole('button',{name:'Explain My Work',exact:true}).click();await page.getByRole('button',{name:'Review my steps',exact:false}).click();await expect(page.getByText(/First incorrect step ·/)).toBeVisible();
 await page.getByRole('textbox',{name:'Your solution, one equation per line'}).fill('60 = 18 + 7d\nd = (60 - 18)/7\nd = 6');await page.getByRole('button',{name:'Review my steps',exact:false}).click();await expect(page.getByText(/First incorrect step ·/)).toHaveCount(0);
 await nav.getByRole('button',{name:'Similar Questions',exact:true}).click();await page.getByRole('radio',{name:'B. 6',exact:true}).check();await page.getByRole('button',{name:'Check answer',exact:false}).click();await expect(page.getByRole('button',{name:'Answer saved',exact:true})).toBeDisabled();
 await nav.getByRole('button',{name:'Weekly Summary',exact:true}).click();await expect(page.getByText('You completed 3 distinct questions this week.',{exact:true})).toBeVisible();
 await nav.getByRole('button',{name:'Handwritten Work',exact:true}).click();await page.getByRole('button',{name:'Use sample handwriting',exact:true}).click();await page.getByRole('button',{name:'This matches the writing',exact:false}).click();await page.getByRole('button',{name:'Review confirmed steps',exact:false}).click();await expect(page.locator('.walkstep.error')).toHaveCount(1);
 await page.getByRole('textbox',{name:'Transcription line 3',exact:true}).fill('7d = 42');await expect(page.getByRole('button',{name:'Review confirmed steps',exact:false})).toHaveCount(0);
});
for(const width of [1440,834,390,320])test(`six intelligence screen layouts at ${width}px`,async ({page})=>{
 await page.setViewportSize({width,height:width===834?1194:1000});
 const routes=['adaptive','work','pacing','similar','weekly','handwriting'];
 for(let i=0;i<routes.length;i++){
  await page.goto('/#'+routes[i]);await expect(page.locator('h1')).toHaveText(pages[i+7][1]);
  if(routes[i]==='pacing')await page.getByRole('button',{name:'Explore sample report',exact:true}).click();
  if(routes[i]==='handwriting')await page.getByRole('button',{name:'Use sample handwriting',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/navigation/${routes[i]}-${width}.png`,fullPage:true});
 }
});
