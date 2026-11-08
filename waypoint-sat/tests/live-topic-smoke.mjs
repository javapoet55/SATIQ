// Live verification uses a new QA account, synthetic answers and no LLM/email calls.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTopicSession,resumeSession,pauseSession,finishSession,parseState} from '../src/model.ts';
import {topicQuestions} from '../src/data/test-questions.ts';
const origin=process.argv[2];if(!origin?.startsWith('https://'))throw Error('Provide the deployed HTTPS origin.');
const signup=await fetch(origin+'/api/auth/signup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Waypoint-Client':'1'},body:JSON.stringify({email:`topic-qa-${randomUUID()}@example.com`,password:randomUUID()+randomUUID()})});
assert.equal(signup.status,200);const cookie=signup.headers.getSetCookie().map(c=>c.split(';')[0]).find(c=>c.startsWith('waypoint_session='));assert.ok(cookie);
const headers={cookie,Origin:origin,'Content-Type':'application/json','X-Waypoint-Client':'1'};
const read=async()=>{const r=await fetch(origin+'/api/progress',{headers:{cookie}});assert.equal(r.status,200);return r.json();};
const snapshot=await read();let revision=snapshot.revision;
const put=async state=>{parseState(JSON.stringify(state));const r=await fetch(origin+'/api/progress',{method:'PUT',headers,body:JSON.stringify({state,revision,writeId:randomUUID()})});const body=await r.json();assert.equal(r.status,200,body.message);revision=body.revision;};
let state=snapshot.state;
const keys=Object.fromEntries(topicQuestions.map(q=>[q.id,q.correct]));
for(const topicId of ['algebra','information']){
 let session=resumeSession(createTopicSession(topicId),Date.now()-1000);
 session={...session,answers:Object.fromEntries(session.questionIds.map(id=>[id,keys[id]])),flags:[session.questionIds[0]],currentIndex:24};
 session=pauseSession(session,Date.now());state={...state,sessions:[...state.sessions,session],activeSessionId:session.id};await put(state);
 const restored=await read();assert.deepEqual(restored.state,state);assert.equal(restored.state.sessions.at(-1).questionIds.length,25);assert.equal(restored.state.sessions.at(-1).currentIndex,24);
 const blocked=await fetch(origin+'/api/assistant',{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),message:'Give me a test answer.',timezone:'America/Los_Angeles'})});assert.equal(blocked.status,409);
 state=finishSession(state,session.id,Date.now(),keys);await put(state);assert.equal(state.attempts.filter(a=>a.sessionId===session.id&&a.correct).length,25);
 console.log(`PASS: ${topicId}: 25-question PostgreSQL restore, navigation/flags/timing, AI help blocked while paused, and 25/25 grading.`);
}
assert.deepEqual((await read()).state,state);
const contextResponse=await fetch(origin+'/api/assistant?timezone=America%2FLos_Angeles',{headers:{cookie}});assert.equal(contextResponse.status,200);const assistant=await contextResponse.json();assert.equal(assistant.context.weeklyQuestions,50);assert.equal(assistant.context.weeklyAccuracy,100);assert.equal(assistant.context.testBlocked,false);
console.log('PASS: 50 topic answers appear in the saved AI study context. Existing students were not touched. No LLM or email requests.');
