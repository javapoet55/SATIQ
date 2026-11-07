// Opt-in live test: four paid GPT calls (two with --focused) using synthetic activity in a new QA profile.
// Never reads the user's browser cookies or API key. No existing study profile is changed.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyState,createSession,resumeSession,parseState} from '../src/model.ts';

const origin=process.argv[2];
if(!origin?.startsWith('https://') || !process.argv.includes('--allow-paid-requests'))throw new Error('Usage: node --experimental-strip-types tests/live-assistant.mjs HTTPS_ORIGIN --allow-paid-requests');
const first=await fetch(origin+'/api/progress');assert.equal(first.status,200);
const cookie=first.headers.get('set-cookie').split(';')[0];
const snapshot=await first.json();assert.deepEqual(snapshot.state,emptyState());
const headers={cookie,Origin:origin,'Content-Type':'application/json','X-Waypoint-Client':'1'};
const get=async()=>{
  const response=await fetch(origin+'/api/assistant?timezone=America%2FLos_Angeles',{headers:{cookie},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200);return response.json();
};
const initial=await get();assert.equal(initial.configured,true,'Railway has not loaded OPENAI_API_KEY.');
assert.equal(initial.context.weeklyQuestions,0);assert.equal(initial.history.length,0);
let revision=snapshot.revision;
const now=Date.now(),state=emptyState();
state.attempts=[
  {id:randomUUID(),questionId:'wp-rw-001',selected:2,correct:true,mode:'practice',sessionId:null,flagged:false,elapsedMs:45000,submittedAt:now-120000},
  {id:randomUUID(),questionId:'wp-math-001',selected:0,correct:false,mode:'practice',sessionId:null,flagged:false,elapsedMs:78000,submittedAt:now-60000},
];
state.reflections['wp-math-001']={text:'QA reflection: I forgot to subtract the fixed fee before dividing.',updatedAt:now};
async function save(next){
  parseState(JSON.stringify(next));
  const response=await fetch(origin+'/api/progress',{method:'PUT',headers,body:JSON.stringify({revision,writeId:randomUUID(),state:next})});
  assert.equal(response.status,200);revision=(await response.json()).revision;
}
await save(state);
const seeded=await get();assert.equal(seeded.context.weeklyQuestions,2);assert.equal(seeded.context.weeklyAccuracy,50);
assert.equal(seeded.context.skills.find(s=>s.skill==='Linear equations').accuracy,0);
assert.equal(seeded.context.skills.find(s=>s.skill==='Transitions').accuracy,100);
console.log('PASS: configured GPT and database context: 2 questions, 50% accuracy, isolated synthetic QA profile.');
const allPrompts=[
  ['weekly-weaknesses','What are my weak areas this week? Use my saved results, give the counts, and say whether the sample is enough to judge mastery.'],
  ['worked-mistake','Explain my latest mistake step by step. What is the correct number of rental days, and how can I check it?'],
  ['concept-help','Help me solve 3x + 5 = 20. Explain why I subtract before dividing.'],
  ['study-plan','Based on my saved activity and our discussion, suggest a 20-minute study session.'],
];
const prompts=process.argv.includes('--focused') ? allPrompts.slice(0,2) : allPrompts;
const results=[];
for(const [name,message] of prompts){
  const request={requestId:randomUUID(),message,timezone:'America/Los_Angeles'};
  const started=Date.now();
  const response=await fetch(origin+'/api/assistant',{method:'POST',headers,body:JSON.stringify(request),signal:AbortSignal.timeout(75000)});
  const body=await response.json();
  assert.equal(response.status,200,`${name}: ${body.message}`);
  assert.equal(body.id,request.requestId);assert.ok(body.answer.length>40);
  assert.equal(body.context.weeklyQuestions,2);
  if(name==='weekly-weaknesses'){
    assert.ok(body.answer.includes(body.context.weekStart),'Weekly answer must use the database week start.');
    assert.ok(body.answer.includes(body.context.today),'Weekly answer must stop at the database local date.');
  }
  if(name==='worked-mistake')assert.doesNotMatch(body.answer,/choice\s+0\b/i,'Student answer labels must not expose zero-based indexes.');
  const elapsedSeconds=Math.round((Date.now()-started)/100)/10;
  console.log(JSON.stringify({test:name,status:'PASS',elapsedSeconds,answer:body.answer}));
  results.push({request,body});
}
const replay=await fetch(origin+'/api/assistant',{method:'POST',headers,body:JSON.stringify(results[0].request)});
assert.equal(replay.status,200);assert.equal((await replay.json()).answer,results[0].body.answer);
const restored=await get();assert.equal(restored.history.length,prompts.length);
assert.deepEqual(restored.history.map(t=>t.answer),results.map(r=>r.body.answer));
const stranger=await fetch(origin+'/api/assistant');assert.equal(stranger.status,200);const other=await stranger.json();
assert.equal(other.context.weeklyQuestions,0);assert.equal(other.history.length,0);
console.log('PASS: PostgreSQL chat restoration, completed-request replay, and cross-profile isolation.');
const session=resumeSession(createSession(['wp-math-001','wp-rw-001','wp-math-002','wp-rw-002'],randomUUID()),Date.now());
await save({...state,sessions:[session],activeSessionId:session.id});
try{
  const blocked=await fetch(origin+'/api/assistant',{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),message:'Give me the test answer.',timezone:'America/Los_Angeles'})});
  assert.equal(blocked.status,409);assert.match((await blocked.json()).message,/submit your practice test/);
  assert.equal((await get()).history.length,prompts.length);
  console.log('PASS: active practice test blocks AI before any provider call.');
}finally{await save(state);}
console.log(`LIVE ASSISTANT TESTS PASSED. ${prompts.length} paid GPT calls; all other checks use saved replies or database-only endpoints.`);
