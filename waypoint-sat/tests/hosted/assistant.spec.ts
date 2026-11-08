import {test,expect,type Page} from '@playwright/test';
import {emptyState} from '../../src/model';
import {examplePrompts} from '../../src/data/assistant-prompts';
async function mockAssistant(page:Page,{configured=true,blocked=false}={}) {
  const context={asOf:new Date().toISOString(),timezone:'America/Los_Angeles',weekStart:'2026-11-02',today:'2026-11-07',weeklyAttempts:3,weeklyQuestions:2,weeklyAccuracy:50,testBlocked:blocked,skills:[{skill:'Linear equations',correct:0,questions:1,accuracy:0},{skill:'Transitions',correct:1,questions:1,accuracy:100}]};
  const db={configured,mathConfigured:true,history:[] as {id:string;message:string;answer:string;context:typeof context;details?:unknown}[],fail:false,posts:[] as {requestId:string;message:string;timezone:string}[]};
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{email:'student@example.com'},emailDelivery:true}}));
  await page.route('**/api/progress',route=>route.fulfill({json:{profileId:'qa-profile',state:emptyState(),revision:0}}));
  await page.route('**/api/assistant?*',async route=>{
    if(route.request().method()==='GET'){await route.fulfill({json:{configured:db.configured,mathConfigured:db.mathConfigured,model:'gpt-5-mini',profileId:'qa-profile',context,history:db.history}});return;}
    const body=route.request().postDataJSON();db.posts.push(body);
    if(db.fail){db.fail=false;await route.fulfill({status:502,json:{message:'GPT could not answer. Try again.'}});return;}
    const turn={id:body.requestId,message:body.message,answer:'From your saved activity: 0 of 1 linear-equation questions was correct this week. Separate the fixed fee before dividing. Try one more question.',context};
    db.history.push(turn);await route.fulfill({json:turn});
  });
  return db;
}
test('five editable examples, real context, saved reply and draft survive reloads',async({page})=>{
  const db=await mockAssistant(page);await page.goto('/#assistant');
  await expect(page.getByText('GPT connected',{exact:true})).toBeVisible();
  for(const prompt of examplePrompts){await page.getByRole('button',{name:prompt,exact:false}).click();await expect(page.getByRole('textbox',{name:'What would you like to understand?'})).toHaveValue(prompt);}
  expect(db.posts).toHaveLength(0);
  await page.reload();await expect(page.getByRole('textbox')).toHaveValue(examplePrompts[4]);
  await page.getByRole('button',{name:'Ask PrepOrbit AI',exact:false}).click();await expect(page.getByText(/0 of 1 linear-equation/)).toBeVisible();
  expect(Object.keys(db.posts[0]).sort()).toEqual(['message','requestId','timezone']);
  await page.evaluate(()=>localStorage.clear());await page.reload();await expect(page.getByText(/0 of 1 linear-equation/)).toBeVisible();await expect(page.getByRole('textbox')).toHaveValue('');
});
test('math examples stay editable and saved charts, evidence and warnings survive reload',async({page})=>{
  const db=await mockAssistant(page);
  db.history.push({id:'math-turn',message:'Graph a quadratic',answer:'The intercepts are −2 and 2.',context:{asOf:new Date().toISOString(),timezone:'UTC',weekStart:'2026-11-02',today:'2026-11-07',weeklyAttempts:0,weeklyQuestions:0,weeklyAccuracy:0,testBlocked:false,skills:[]},details:{toolsUsed:[{name:'plot_function',label:'plot function',result:''}],charts:[{title:'Quadratic graph',src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}],warnings:['A different calculation could not be verified.']}});
  await page.goto('/#assistant');
  await expect(page.getByText('Math tools enabled',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Graph y = x²',exact:false}).click();
  await expect(page.getByRole('textbox')).toHaveValue(/Graph y = x²/);expect(db.posts).toHaveLength(0);
  await expect(page.getByRole('img',{name:'Quadratic graph'})).toBeVisible();
  await page.getByText('Math tools used · 1 successful call').click();await expect(page.getByText('plot function',{exact:true})).toBeVisible();
  await expect(page.getByText('A different calculation could not be verified.')).toBeVisible();
  await page.reload();await expect(page.getByRole('img',{name:'Quadratic graph'})).toBeVisible();
});
test('retry preserves the question and request ID, including across a reload',async({page})=>{
  const db=await mockAssistant(page);db.fail=true;await page.goto('/#assistant');
  await page.getByRole('textbox').fill('Help with my latest mistake');await page.getByRole('button',{name:'Ask PrepOrbit AI',exact:false}).click();await expect(page.getByRole('alert')).toContainText('GPT could not answer');
  await page.reload();await expect(page.getByRole('textbox')).toHaveValue('Help with my latest mistake');await page.getByRole('button',{name:'Retry question',exact:false}).click();
  await expect(page.getByText(/0 of 1 linear-equation/)).toBeVisible();expect(db.posts[0].requestId).toBe(db.posts[1].requestId);
});
test('missing-key mode gives useful database context, keeps drafts and refreshes after configuration',async({page})=>{
  const db=await mockAssistant(page,{configured:false});await page.goto('/#assistant');
  await expect(page.getByText('Your study context is ready. GPT is not connected yet.')).toBeVisible();
  await page.getByRole('button',{name:examplePrompts[0],exact:false}).click();await expect(page.getByRole('button',{name:'Ask PrepOrbit AI',exact:false})).toBeDisabled();
  await expect(page.getByText('0/1 correct · 0%')).toBeVisible();expect(db.posts).toHaveLength(0);
  db.configured=true;await page.getByRole('button',{name:'Refresh context'}).click();await expect(page.getByRole('button',{name:'Ask PrepOrbit AI',exact:false})).toBeEnabled();
});
test('active test blocks the composer and all example prompts',async({page})=>{
  const db=await mockAssistant(page,{blocked:true});await page.goto('/#assistant');await expect(page.getByRole('textbox')).toBeDisabled();await expect(page.getByRole('button',{name:examplePrompts[0],exact:false})).toBeDisabled();expect(db.posts).toHaveLength(0);
});
for(const width of [1440,834,390,320])test(`assistant context and conversation reflow at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await mockAssistant(page);await page.goto('/#assistant');
  await expect(page.getByText('GPT connected',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:examplePrompts[0],exact:false}).click();await page.getByRole('button',{name:'Ask PrepOrbit AI',exact:false}).click();await expect(page.getByText(/0 of 1 linear-equation/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results-hosted/assistant-${width}.png`,fullPage:true});
});
