import {test} from 'node:test';
import assert from 'node:assert/strict';
import {topicQuestions} from '../src/data/test-questions.ts';
import {testTopics} from '../src/data/test-topics.ts';
import {emptyState,createTopicSession,resumeSession,pauseSession,navigateSession,finishSession,remaining,parseState,activityStats} from '../src/model.ts';
import {studyContext} from '../server/assistant.mjs';
const keys=Object.fromEntries(topicQuestions.map(q=>[q.id,q.correct]));
test('eight topic banks contain 200 original items with 25 distinct, answerable questions each',()=>{
 assert.equal(topicQuestions.length,200);assert.equal(new Set(topicQuestions.map(q=>q.id)).size,200);
 assert.equal(new Set(topicQuestions.map(q=>q.text)).size,200);
 for(const topic of testTopics){const rows=topicQuestions.filter(q=>q.topicId===topic.id);assert.equal(rows.length,25,topic.id);for(const q of rows){assert.equal(q.section,topic.section);assert.equal(q.choices.length,4);assert.equal(new Set(q.choices).size,4,q.id);assert.ok(q.choices.every(c=>c.trim()));assert.ok(q.correct>=0&&q.correct<4);assert.ok(q.steps.every(s=>s.length>=2&&s[1].length>10));assert.ok(q.why.length>20);}}
});
test('numeric question answer keys satisfy the equations and geometry facts in their prompts',()=>{
 for(const q of topicQuestions.filter(q=>q.section==='math')){
  const answer=Number(q.choices[q.correct]);assert.ok(Number.isFinite(answer));
  if(q.skill==='Linear equations'){const [,a,b,total]=q.text.match(/If (\d+)x \+ (\d+) = (\d+)/)!;assert.equal(Number(a)*answer+Number(b),Number(total));}
  if(q.skill==='Linear models'){const nums=q.text.match(/\d+/g)!.map(Number);assert.equal(nums[0]+nums[1]*answer,nums[2]);}
  if(q.skill==='Quadratic equations'){const nums=q.text.match(/\d+/g)!.map(Number);assert.equal((answer-nums[0])*(answer-nums[1]),0);assert.equal(answer,Math.max(...nums));}
  if(q.skill==='Right triangles'){const nums=q.text.match(/\d+/g)!.map(Number);assert.equal(answer,Math.hypot(nums[0],nums[1]));}
  if(q.skill==='Volume'){const nums=q.text.match(/\d+/g)!.map(Number);assert.equal(answer,nums.reduce((a,b)=>a*b,1));}
  if(q.skill==='Statistics'){const nums=q.text.match(/\d+/g)!.map(Number);assert.equal(answer,nums.reduce((a,b)=>a+b,0)/nums.length);}
  if(q.skill==='Circles'){const radius=Number(q.text.match(/radius (\d+)/)![1]);assert.equal(answer,Math.pow(radius,2));}
 }
});
test('25-question sessions preserve deadlines, answers, flags and per-question timing through reload and pause',()=>{
 const start=1000000;let session=resumeSession(createTopicSession('algebra','fixed-order'),start);
 assert.equal(session.questionIds.length,25);assert.equal(remaining(session,start),40*60000);
 assert.equal(remaining(session,start-500),40*60000,'A stale render timestamp must never display 40:01.');
 const first=session.questionIds[0];session={...session,answers:{[first]:keys[first]},flags:[first]};
 session=navigateSession(session,24,start+10000);assert.equal(session.questionElapsedMs[first],10000);
 session=pauseSession(session,start+20000);assert.equal(session.remainingMs,40*60000-20000);
 let state={...emptyState(),sessions:[session],activeSessionId:session.id};state=parseState(JSON.stringify(state));
 assert.equal(state.sessions[0].currentIndex,24);assert.equal(state.sessions[0].answers[first],keys[first]);assert.deepEqual(state.sessions[0].flags,[first]);
 session=resumeSession(state.sessions[0],start+50000);assert.equal(session.deadlineAt,start+50000+40*60000-20000);
 state={...state,sessions:[session]};const ended=finishSession(state,session.id,session.deadlineAt!+5000,keys);
 assert.equal(ended.attempts.length,25);assert.equal(ended.attempts.filter(a=>a.correct).length,1);assert.equal(ended.attempts.filter(a=>a.selected===null).length,24);assert.equal(ended.sessions[0].status,'expired');assert.equal(ended.attempts[0].submittedAt,session.deadlineAt);
 assert.deepEqual(finishSession(ended,session.id,session.deadlineAt!+7000,keys),ended);assert.deepEqual(parseState(JSON.stringify(ended)),ended);
});
test('all topic states validate, order shuffles without content drift, invalid imported test metadata is rejected',()=>{
 for(const topic of testTopics){const first=createTopicSession(topic.id,'seed-a'),second=createTopicSession(topic.id,'seed-b');assert.deepEqual([...first.questionIds].sort(),[...second.questionIds].sort());assert.notDeepEqual(first.questionIds,second.questionIds);const state={...emptyState(),sessions:[first],activeSessionId:first.id};assert.doesNotThrow(()=>parseState(JSON.stringify(state)));for(const change of [{durationMs:1},{questionIds:first.questionIds.slice(1)},{currentIndex:25},{remainingMs:99999999},{topicId:'unknown'}])assert.throws(()=>parseState(JSON.stringify({...state,sessions:[{...first,...change}]})));}
});
test('topic results appear in real progress and the AI database context',()=>{
 const now=Date.now();let session=resumeSession(createTopicSession('information','test-evidence'),now-10000);session={...session,answers:Object.fromEntries(session.questionIds.map(id=>[id,keys[id]]))};
 const state=finishSession({...emptyState(),sessions:[session],activeSessionId:session.id},session.id,now,keys);
 assert.equal(activityStats(state,now).first.length,25);const context=studyContext(state,'America/Los_Angeles',now+1000);assert.equal(context.weeklyQuestions,25);assert.equal(context.weeklyAccuracy,100);assert.equal(context.testBlocked,false);
});
