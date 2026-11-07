import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewSteps,nextChallenge,weeklyStats} from '../src/intelligence-model.ts';
import {emptyIntelligence} from '../src/intelligence-types.ts';
import {emptyState,parseState} from '../src/model.ts';
import {variantQuestion} from '../src/data/intelligence-content.ts';
test('step verification accepts equivalent methods and stops at the first error',()=>{
 assert.deepEqual(reviewSteps('18 + 7d = 60\n7d = 60 − 18\n7d = 28\nd = 4').map(s=>s.status),['correct','correct','incorrect','pending']);
 assert.ok(reviewSteps('60 = 18 + 7*d\nd = (60 - 18)/7\nd = 6').every(s=>s.status==='correct'));
 assert.equal(reviewSteps('explain this').at(0)?.status,'uncertain');
 assert.equal(reviewSteps('d = 1/0').at(0)?.status,'uncertain');
 assert.equal(reviewSteps('d*d = 36').at(0)?.status,'uncertain');
});
test('adaptive routing accounts for help as well as correctness',()=>{assert.equal(nextChallenge(true,false),2);assert.equal(nextChallenge(true,true),1);assert.equal(nextChallenge(false,false),1)});
test('new progress validates while old backups remain readable',()=>{
 const state=emptyState();assert.deepEqual(parseState(JSON.stringify(state)),state);
 state.intelligence=emptyIntelligence();state.intelligence.attempts.push({id:'x',questionId:'smart-a1',selected:1,correct:true,hinted:false,elapsedMs:1000,submittedAt:1,level:'Medium'});
 assert.deepEqual(parseState(JSON.stringify(state)),state);
 state.intelligence.attempts[0].selected=8;assert.throws(()=>parseState(JSON.stringify(state)));
});
test('weekly data uses real dates and deduplicates repeat questions within each week',()=>{
 const state=emptyState(),now=new Date(2026,10,7,12).getTime();state.intelligence=emptyIntelligence();
 const base={id:'x',questionId:'smart-a1',selected:1,correct:false,hinted:false,elapsedMs:1000,submittedAt:now,level:'Medium'};
 state.intelligence.attempts=[base,{...base,id:'retry',correct:true},{...base,id:'old',questionId:'smart-a2',submittedAt:new Date(2026,9,30,12).getTime()}];
 const current=weeklyStats(state,now);assert.equal(current.total,1);assert.equal(current.correct,0);assert.equal(weeklyStats(state,now,true).total,1);
});
test('all nine template variants have distinct valid answers at their requested level',()=>{const ids=new Set();for(const level of ['Foundation','Medium','Stretch'])for(let i=0;i<3;i++){const q=variantQuestion(level,i);assert.equal(q.difficulty,level);assert.equal(q.choices.length,4);assert.equal(new Set(q.choices).size,4);assert.ok(q.choices[q.correct]);ids.add(q.id)}assert.equal(ids.size,9)});

