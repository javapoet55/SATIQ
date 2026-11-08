import {test,expect} from '@playwright/test';
import {topicQuestions} from '../../src/data/test-questions';
const KEY='waypoint-local-v1';
test('Math and Reading topics each build 25-question sets; answers, flags and timers survive reload',async({page})=>{
 await page.goto('/#test');await expect(page.getByRole('button',{name:'Math',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'Algebra',exact:true})).toBeVisible();await page.getByRole('button',{name:'Reading & Writing',exact:true}).click();await expect(page.getByRole('button',{name:'Information & Ideas',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Algebra',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Craft & Structure',exact:true}).click();await page.getByRole('button',{name:'Start 25-question test',exact:false}).click();
 await expect(page.getByText('Question 1 of 25',{exact:true})).toBeVisible();await expect(page.locator('.topic-number-grid button')).toHaveCount(25);await expect(page.getByLabel(/remaining/)).toContainText('30:');
 await page.getByRole('radio').first().check();await page.getByRole('button',{name:'Mark for review',exact:false}).click();await page.getByRole('button',{name:'Next question',exact:false}).click();
 await page.getByRole('button',{name:'Pause practice',exact:true}).click();const time=await page.locator('.topic-clock strong').textContent();await page.waitForTimeout(700);await expect(page.locator('.topic-clock strong')).toHaveText(time!);
 await page.reload();await expect(page.getByText('Question 2 of 25',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Question 1, answered, marked',exact:true})).toBeVisible();await expect(page.getByRole('radio').first()).toBeDisabled();
 await page.getByRole('button',{name:'Resume practice'}).click();await page.getByRole('button',{name:'Question 1, answered, marked',exact:true}).click();await expect(page.getByRole('radio').first()).toBeChecked();
 await page.getByRole('button',{name:'Review & submit test',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('24 unanswered · 1 marked');await page.getByRole('button',{name:'Keep working',exact:true}).click();
 await page.getByRole('button',{name:'Review & submit test',exact:true}).click();await page.getByRole('button',{name:'Submit practice test',exact:true}).click();await expect(page).toHaveURL(/#review$/);await expect(page.getByRole('combobox',{name:'Attempt',exact:true}).locator('option')).toHaveCount(25);
 await page.getByRole('textbox',{name:/What will you try/}).fill('Read the context before choosing a meaning.');await page.reload();await expect(page.getByRole('textbox')).toHaveValue('Read the context before choosing a meaning.');
 const state=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),KEY);expect(state.attempts).toHaveLength(25);expect(state.sessions[0].topicId).toBe('craft');expect(state.sessions[0].flags).toHaveLength(1);
});
test('a delayed deadline auto-submits exactly 25 attempts and locks solutions to the actual choices',async({page})=>{
 await page.goto('/#test');await page.getByRole('button',{name:'Algebra',exact:true}).click();await page.getByRole('button',{name:'Start 25-question test',exact:false}).click();await page.getByRole('radio').first().check();
 await page.evaluate(key=>{const state=JSON.parse(localStorage.getItem(key)!);const s=state.sessions[0];s.deadlineAt=Date.now()-100;s.segmentStartedAt=Date.now()-2000;localStorage.setItem(key,JSON.stringify(state));},KEY);
 await page.reload();await expect(page).toHaveURL(/#review$/);await expect(page.getByRole('combobox',{name:'Attempt',exact:true}).locator('option')).toHaveCount(25);await expect(page.getByRole('radio').first()).toBeDisabled();
 let state=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),KEY);expect(state.sessions[0].status).toBe('expired');expect(state.attempts).toHaveLength(25);await page.reload();state=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),KEY);expect(state.attempts).toHaveLength(25);
});
for(const width of [1440,834,390,320])test(`topic selector and test player fit at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.goto('/#test');await expect(page.getByRole('button',{name:'Algebra',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/topics/selector-${width}.png`,fullPage:true});await page.getByRole('button',{name:'Start 25-question test',exact:false}).click();await expect(page.getByText('Question 1 of 25',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/topics/player-${width}.png`,fullPage:true});
});
test('every topic starts with exactly 25 domain-matched questions and its correct time limit',async({page})=>{
 for(const topic of ['algebra','advanced','data','geometry','information','craft','expression','conventions']){
  await page.goto('/#test');await page.evaluate(()=>localStorage.clear());await page.reload();if(['information','craft','expression','conventions'].includes(topic))await page.getByRole('button',{name:'Reading & Writing',exact:true}).click();
  const names:Record<string,string>={algebra:'Algebra',advanced:'Advanced Math',data:'Problem-Solving & Data Analysis',geometry:'Geometry & Trigonometry',information:'Information & Ideas',craft:'Craft & Structure',expression:'Expression of Ideas',conventions:'Standard English Conventions'};
  await page.getByRole('button',{name:names[topic],exact:true}).click();await page.getByRole('button',{name:'Start 25-question test',exact:false}).click();
  const state=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),KEY),session=state.sessions[0];expect(session.questionIds).toHaveLength(25);expect(session.questionIds.every((id:string)=>topicQuestions.some(q=>q.id===id&&q.topicId===topic))).toBe(true);expect(session.durationMs).toBe((session.topicId==='algebra'||session.topicId==='advanced'||session.topicId==='data'||session.topicId==='geometry'?40:30)*60000);
 }
});
