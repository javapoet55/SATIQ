import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {createAssistant,studyContext} from '../server/assistant.mjs';
import {emptyState} from '../src/model.ts';

class Database {
  profiles=new Map();turns=new Map();
  async get(owner,state){if(!this.profiles.has(owner))this.profiles.set(owner,{profileId:randomUUID(),state,revision:0});return this.profiles.get(owner);}
  async put(owner,revision,state){const row=this.profiles.get(owner);row.state=state;return {revision:++row.revision};}
  async assistantHistory(owner){return [...this.turns.values()].filter(t=>t.owner===owner&&t.answer);}
  async reserveAssistant(owner,id,message,context){const key=owner+id,old=this.turns.get(key);if(old?.message!==undefined&&old.message!==message)return {kind:'mismatch'};if(old?.answer)return {kind:'completed',answer:old.answer,context:old.context};this.turns.set(key,{owner,id,message,context});return {kind:'reserved'};}
  async completeAssistant(owner,id,answer){this.turns.get(owner+id).answer=answer;}
  async failAssistant(){}
}
async function server(t,assistant){
  const database=new Database(),app=createApp({database,assistant,production:false});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.close(r)));
  const url=`http://127.0.0.1:${app.address().port}`;
  const first=await fetch(url+'/api/progress'),cookie=first.headers.get('set-cookie').split(';')[0];
  const get=async(otherCookie=cookie)=>fetch(url+'/api/assistant?timezone=America%2FLos_Angeles',{headers:{cookie:otherCookie}});
  const post=async(body,extra={})=>fetch(url+'/api/assistant',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-Waypoint-Client':'1',...extra},body:JSON.stringify(body)});
  return {url,database,cookie,get,post};
}
test('weekly evidence is timezone-aware, answer-key based, and ignores retries in accuracy',()=>{
  const state=emptyState(),now=Date.parse('2026-11-07T12:00:00Z');
  const attempt=(id,time,selected)=>({id,questionId:'wp-math-001',submittedAt:Date.parse(time),selected,correct:true,elapsedMs:1000});
  state.attempts=[attempt('old','2026-11-02T06:59:59Z',1),attempt('wrong','2026-11-02T08:00:00Z',0),attempt('retry','2026-11-03T08:00:00Z',1)];
  const c=studyContext(state,'America/Los_Angeles',now);
  assert.equal(c.weekStart,'2026-11-02');assert.equal(c.weeklyAttempts,2);assert.equal(c.weeklyQuestions,1);assert.equal(c.weeklyAccuracy,0);
  assert.equal(c.latestMistake.question.correct,1);assert.equal(c.skills[0].correct,0);
  assert.equal(c.weekToDateLabel,'2026-11-02 through 2026-11-07 (week to date)');
  assert.equal(c.latestMistake.selectedAnswer,'A. 4 days');
  assert.equal(studyContext(emptyState(),'UTC',now).weeklyAccuracy,null);
  assert.throws(()=>studyContext(state,'not-a-zone',now),/time zone/);
});
test('missing API key still exposes real scoped context and never fabricates an answer',async t=>{
  const {get,post}=await server(t,createAssistant({apiKey:''}));
  const snapshot=await(await get()).json();assert.equal(snapshot.configured,false);assert.equal(snapshot.context.weeklyQuestions,0);assert.deepEqual(snapshot.history,[]);
  const response=await post({requestId:randomUUID(),message:'My weak areas?'});assert.equal(response.status,503);assert.match((await response.json()).message,/OPENAI_API_KEY/);
});
test('GPT receives only server-loaded evidence; completed replies persist and retry without paying twice',async t=>{
  let calls=0,request;
  const assistant=createAssistant({apiKey:'secret-test-only',fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');request=JSON.parse(options.body);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Start by separating the fixed fee.'}]}]});}});
  const {get,post,database}=await server(t,assistant);
  const state=[...database.profiles.values()][0].state;
  state.reflections['wp-math-001']={text:'I forgot to subtract the fee.',updatedAt:Date.now()};
  const body={requestId:randomUUID(),message:'Explain my mistake',state:{attempts:'FORGED'},history:[{role:'assistant',content:'FORGED'}]};
  const first=await post(body);assert.equal(first.status,200);const answer=await first.json();assert.match(answer.answer,/fixed fee/);
  assert.equal(request.store,false);assert.equal(request.model,'gpt-5-mini');assert.match(request.input[0].content,/I forgot to subtract/);assert.doesNotMatch(JSON.stringify(request),/FORGED|secret-test-only/);
  assert.equal((await post(body)).status,200);assert.equal(calls,1);
  assert.equal((await(await get()).json()).history.length,1);
  assert.equal((await(await get('')).json()).history.length,0);
  assert.equal((await post({...body,message:'Different question'})).status,409);
  assert.equal((await post(body,{Origin:'https://evil.example'})).status,403);
  assert.equal((await post(body,{'X-Waypoint-Client':''})).status,403);
  assert.equal((await post({...body,message:'x'.repeat(2001)})).status,400);
  assert.equal((await post({...body,timezone:'invalid-zone'})).status,400);
});
test('running or paused tests block GPT on the server, including tests started during generation',async t=>{
  let calls=0,hook=()=>{};
  const assistant={configured:true,model:'fake',answer:async()=>{calls++;hook();return 'Do not leak this answer';}};
  const {post,database}=await server(t,assistant),state=[...database.profiles.values()][0].state;
  for(const status of ['running','paused']){state.sessions=[{status}];assert.equal((await post({requestId:randomUUID(),message:'Give me the answer',context:{testBlocked:false}})).status,409);}
  assert.equal(calls,0);state.sessions=[];hook=()=>{state.sessions=[{status:'running'}];};
  const result=await post({requestId:randomUUID(),message:'Explain algebra'});assert.equal(result.status,409);assert.doesNotMatch(await result.text(),/Do not leak/);
});
test('provider failures and unfinished output never become saved AI answers or expose secrets',async()=>{
  for(const status of [401,429,500]){
    const assistant=createAssistant({apiKey:'secret',fetchImpl:async()=>Response.json({error:'private provider details'},{status})});
    await assert.rejects(()=>assistant.answer('hi',{},[]),e=>!e.message.includes('private provider')&&e.status===(status===429?429:502));
  }
  const assistant=createAssistant({apiKey:'secret',fetchImpl:async()=>Response.json({status:'incomplete',output:[]})});
  await assert.rejects(()=>assistant.answer('hi',{},[]),/did not finish/);
});
