import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createMathTools, STUDENT_MATH_TOOLS} from '../server/math-tools.mjs';
import {createAssistant} from '../server/assistant.mjs';

const secret = 'test-only-secret-'.repeat(5);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function service({content=[{type:'text',text:'{"result":14}'}],isError=false}={}) {
  const calls=[];
  const tools=createMathTools({url:'http://math.example/mcp',secret,fetchImpl:async(url,options)=>{
    const call=JSON.parse(options.body);calls.push(call);
    const token=options.headers.Authorization.slice(7).split('.');
    assert.equal(token[2],createHmac('sha256',secret).update(token.slice(0,2).join('.')).digest('base64url'));
    const claims=JSON.parse(Buffer.from(token[1],'base64url'));
    assert.equal(claims.aud,'preporbit-math-mcp');assert.equal(claims.scope,'math:tools');assert.ok(claims.exp-claims.iat<=90);
    assert.equal(options.redirect,'error');
    const result=call.method==='initialize'?{protocolVersion:'2025-06-18'}:call.method==='tools/list'?{tools:[...STUDENT_MATH_TOOLS,'workspace_load','workspace_save'].map(name=>({name,description:name,inputSchema:{type:'object',properties:{}}}))}:{content,isError};
    return Response.json({jsonrpc:'2.0',id:call.id,result});
  }});
  return {tools,calls};
}
test('private MCP client signs short-lived JWTs, discovers and caches only nine student tools',async()=>{
  const {tools,calls}=service();const definitions=await tools.definitions();
  assert.equal(definitions.length,9);assert.ok(definitions.every(t=>!t.name.includes('workspace')));
  await tools.definitions();assert.equal(calls.length,2);
  assert.equal((await tools.call('calc_expression',{expression:'2+3*4'})).text,'{"result":14}');
  for(const name of ['workspace_load','workspace_save','resources/read','plot_financial_line','matrix_inverse'])await assert.rejects(()=>tools.call(name,{}));
  assert.equal(calls.length,3);
});
test('MCP output accepts bounded PNGs and rejects malformed, oversized and failed results',async()=>{
  const {tools}=service({content:[{type:'image',mimeType:'image/png',data:png}]});
  const {charts}=await tools.call('plot_function',{expression:'x**2'});
  assert.equal(charts.length,1);assert.equal(charts[0].src,`data:image/png;base64,${png}`);
  for(const content of [[{type:'image',mimeType:'image/svg+xml',data:png}],[{type:'image',mimeType:'image/png',data:Buffer.from('not a PNG').toString('base64')}],[{type:'image',mimeType:'image/png',data:'a'.repeat(350001)}],[]]) {
    await assert.rejects(()=>service({content}).tools.call('plot_function',{}));
  }
  await assert.rejects(()=>service({isError:true}).tools.call('calc_expression',{expression:'1/0'}));
});
const textResponse=text=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
const functionResponse=(name,args)=>({status:'completed',output:[{type:'reasoning',id:'reason-1',encrypted_content:'opaque-reasoning'},
  {type:'function_call',call_id:'call-1',name,arguments:JSON.stringify(args)}]});
test('Responses tool loop preserves reasoning, returns charts separately, and does not send image bytes or secrets to GPT',async()=>{
  const requests=[];const {tools}=service({content:[{type:'image',mimeType:'image/png',data:png}]});
  const assistant=createAssistant({apiKey:'fake-key',mathTools:tools,fetchImpl:async(_url,options)=>{
    const request=JSON.parse(options.body);requests.push(structuredClone(request));
    return Response.json(requests.length===1?functionResponse('plot_function',{expression:'x**2-4',x_range:[-5,5]}):textResponse('The graph crosses the x-axis at −2 and 2.'));
  }});
  const reply=await assistant.answer('Plot this quadratic',{},[]);
  assert.equal(reply.charts.length,1);assert.equal(reply.toolsUsed[0].name,'plot_function');
  assert.ok(requests[1].input.some(i=>i.type==='reasoning'&&i.encrypted_content==='opaque-reasoning'));
  assert.ok(requests[1].input.some(i=>i.type==='function_call_output'&&i.output.includes('displayedInApp')));
  assert.doesNotMatch(JSON.stringify(requests),new RegExp(`${png}|${secret}|Bearer|fake-key`));
  assert.equal(requests[0].store,false);assert.deepEqual(requests[0].include,['reasoning.encrypted_content']);
});
test('tool failures and unadvertised workspace calls produce transparent warnings without invoking workspace',async()=>{
  const {tools,calls}=service();let turn=0;
  const assistant=createAssistant({apiKey:'fake',mathTools:tools,fetchImpl:async()=>Response.json(++turn===1?functionResponse('workspace_load',{name:'other-student'}):textResponse('I cannot access a shared workspace.'))});
  const reply=await assistant.answer('Load another student',{},[]);
  assert.equal(reply.toolsUsed.length,0);assert.equal(reply.warnings.length,1);assert.equal(calls.length,2);
});
test('math outage falls back honestly; unconfigured math does not block ordinary tutoring',async()=>{
  for(const configured of [true,false]) {
    let request;
    const assistant=createAssistant({apiKey:'fake',mathTools:{configured,definitions:async()=>{throw new Error('private-secret');}},fetchImpl:async(_u,o)=>{request=JSON.parse(o.body);return Response.json(textResponse('Subtract 5, then divide by 3.'));}});
    const reply=await assistant.answer('Explain an equation',{},[]);
    assert.equal(reply.warnings.length,configured?1:0);assert.equal(request.tools,undefined);assert.doesNotMatch(JSON.stringify(reply),/private-secret/);
  }
});
test('a test beginning between GPT and tool execution prevents the tool call',async()=>{
  const {tools,calls}=service();let checks=0;
  const assistant=createAssistant({apiKey:'fake',mathTools:tools,fetchImpl:async()=>Response.json(functionResponse('calc_expression',{expression:'2+2'}))});
  await assert.rejects(()=>assistant.answer('Calculate',{},[],{assertAllowed:async()=>{if(++checks===2)throw new Error('Practice test started');}}),/Practice test started/);
  assert.equal(calls.length,2);
});
test('repeated tool requests stop after two rounds and force a text-only final response',async()=>{
  const {tools,calls}=service();let turn=0;
  const assistant=createAssistant({apiKey:'fake',mathTools:tools,fetchImpl:async(_u,o)=>{
    const request=JSON.parse(o.body);turn++;
    if(turn===3){assert.equal(request.tool_choice,'none');return Response.json(textResponse('14'));}
    return Response.json(functionResponse('calc_expression',{expression:'2+3*4'}));
  }});
  const reply=await assistant.answer('Calculate',{},[]);assert.equal(reply.toolsUsed.length,2);assert.equal(calls.length,4);
});
