// Production UI smoke: one real GPT/chart request in an isolated QA account.
// Requires the Railway CLI/project link to remove its own disposable account.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const origin='https://waypoint-web-production-50a5.up.railway.app';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
const email=`qa-math-ui-${randomUUID()}@example.com`;
console.log('Disposable UI QA account:',email);
try {
  const response=await context.request.post(origin+'/api/auth/signup',{headers:{'X-Waypoint-Client':'1'},data:{email,password:randomUUID()+randomUUID()}});
  assert.equal(response.status(),200);
  const page=await context.newPage();
  await page.goto(origin+'/#assistant');
  await page.getByText('Math tools enabled',{exact:false}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'Graph y = x²',exact:false}).click();
  await page.getByRole('button',{name:'Ask PrepOrbit AI',exact:false}).click();
  const image=page.locator('.assistant-chart img');
  await image.waitFor({timeout:75000});
  await page.waitForFunction(()=>{const img=document.querySelector('.assistant-chart img');return img?.complete&&img.naturalWidth>100;});
  assert.equal(await page.locator('.assistant-tool-warning').count(),0);
  await page.getByText(/Math tools used/).click();
  assert.match(await page.locator('.assistant-tool-evidence').textContent(),/plot function/);
  await page.reload();await image.waitFor({timeout:30000});
  for(const width of [1440,834,390,320]) {
    await page.setViewportSize({width,height:1100});await image.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`test-results-hosted/live-math-${width}.png`,fullPage:true});
    console.log(`PASS: live saved graph renders without overflow at ${width}px`);
  }
  console.log('PASS: live student composer → GPT → private MCP → inline chart; reload restores chart and tool evidence.');
} finally {
  await context.request.post(origin+'/api/auth/signout',{headers:{'X-Waypoint-Client':'1'},data:{}}).catch(()=>{});
  await browser.close();
  const cleanup=`import {PostgresStore} from './server/database.mjs';
    const db=new PostgresStore(process.env.DATABASE_URL);
    try {const u=await db.findUserByEmail(${JSON.stringify(email)});
      if(u){await db.pool.query('DELETE FROM waypoint_progress WHERE owner_hash=$1',['user:'+u.id]);await db.pool.query('DELETE FROM waypoint_users WHERE id=$1',[u.id]);}
    } finally {await db.close();}`;
  const quote=s=>`'${s.replaceAll("'","'\\''")}'`;
  execFileSync('railway',['ssh','--service','waypoint-web',`node --experimental-strip-types --input-type=module -e ${quote(cleanup)}`],{stdio:'pipe',timeout:45000});
  console.log('Disposable browser QA account and its graph/chat removed.');
}
