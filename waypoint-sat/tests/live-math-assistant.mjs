// Run in the Railway web container. Uses three real GPT requests and only its own
// disposable account. Never prints API keys, cookies, JWTs, or student records.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const {PostgresStore}=await import(process.cwd()+'/server/database.mjs');
const {createSession,resumeSession}=await import(process.cwd()+'/src/model.ts');

const origin=process.env.QA_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`;
const email=`qa-math-${randomUUID()}@example.com`,password=randomUUID()+randomUUID();
const db=new PostgresStore(process.env.DATABASE_URL);
let owner;
const headers={'Content-Type':'application/json','X-Waypoint-Client':'1'};
async function json(path,method='GET',body) {
  const response=await fetch(origin+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(75000)});
  return {response,body:await response.json()};
}
try {
  const signup=await json('/api/auth/signup','POST',{email,password});assert.equal(signup.response.status,200);
  headers.cookie=signup.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const user=await db.findUserByEmail(email);owner=`user:${user.id}`;
  const progress=(await json('/api/progress')).body;
  const snapshot=(await json('/api/assistant')).body;
  assert.equal(snapshot.configured,true);assert.equal(snapshot.mathConfigured,true);assert.equal(snapshot.context.weeklyQuestions,0);
  const cases=[
    {message:'Use the math calculator to verify (60 - 18) / 7. Explain the rental days.',tool:'calc_expression',check:result=>assert.equal(JSON.parse(result).result,6)},
    {message:'Use the statistics tool to calculate the mean of 4, 7, 7, 10, 12. Explain the result.',tool:'calc_statistics',check:result=>assert.equal(JSON.parse(result).result,8)},
    {message:'Use the graph tool to plot y = x**2 - 4 for x from -5 to 5, with 150 points. Explain its x-intercepts.',tool:'plot_function'},
  ];
  let first;
  for(const item of cases) {
    const request={requestId:randomUUID(),message:item.message,timezone:'UTC'};
    const started=Date.now(),reply=await json('/api/assistant','POST',request);
    assert.equal(reply.response.status,200,reply.body.message);
    const tool=reply.body.details.toolsUsed.find(t=>t.name===item.tool);
    assert.ok(tool,`Missing successful ${item.tool}`);assert.equal(reply.body.details.warnings.length,0);
    if(item.check)item.check(tool.result);
    if(item.tool==='plot_function') {
      assert.equal(reply.body.details.charts.length,1);
      const bytes=Buffer.from(reply.body.details.charts[0].src.split(',')[1],'base64');
      assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    }
    first ??= {request,reply:reply.body};
    console.log(`PASS: real GPT → private MCP → saved reply: ${item.tool} (${Math.round((Date.now()-started)/1000)}s)`);
  }
  const history=(await json('/api/assistant')).body.history;
  assert.equal(history.length,3);assert.equal(history[2].details.charts.length,1);
  assert.deepEqual((await json('/api/assistant','POST',first.request)).body.details,first.reply.details);
  console.log('PASS: PostgreSQL history restores charts and tool evidence; request replay reuses the saved reply.');
  const session=resumeSession(createSession(['wp-math-001','wp-rw-001','wp-math-002','wp-rw-002'],randomUUID()),Date.now());
  const save=await json('/api/progress','PUT',{revision:progress.revision,writeId:randomUUID(),state:{...progress.state,sessions:[session],activeSessionId:session.id}});
  assert.equal(save.response.status,200);
  const blocked=await json('/api/assistant','POST',{requestId:randomUUID(),message:'Use math tools to answer my test question'});
  assert.equal(blocked.response.status,409);assert.equal((await json('/api/assistant')).body.history.length,3);
  console.log('PASS: an active practice test blocks AI and tools.');
  assert.equal((await fetch(origin+'/api/assistant')).status,401);
  console.log('PASS: anonymous requests cannot access student chat or math results.');
} finally {
  const user=await db.findUserByEmail(email);
  if(user) {
    await db.pool.query('DELETE FROM waypoint_progress WHERE owner_hash=$1',[owner || `user:${user.id}`]);
    await db.pool.query('DELETE FROM waypoint_users WHERE id=$1',[user.id]);
  }
  await db.close();
  console.log('Disposable math QA account and its chat/progress removed.');
}
