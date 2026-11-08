import {createHmac, randomUUID} from 'node:crypto';

// This is a capability allowlist, not a filter over model-provided tool metadata.
// Workspace, resources, financial simulation and matrix tools are never exposed.
export const STUDENT_MATH_TOOLS = new Set([
  'calc_expression', 'calc_statistics', 'calc_units', 'calc_interest',
  'plot_function', 'plot_histogram', 'plot_scatter', 'plot_line_chart', 'plot_box_plot',
]);
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
export const MATH_UNAVAILABLE = 'Math tools are temporarily unavailable. This reply uses GPT reasoning; calculations and charts have not been checked by the math service.';
const unavailable = () => new Error('The math tool could not complete this request. Do not claim a verified result or generated chart. Explain the limitation and help with the reasoning.');

function bearer(secret) {
  const now = Math.floor(Date.now()/1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = `${encode({alg:'HS256',typ:'JWT'})}.${encode({iss:'preporbit-ai',aud:'preporbit-math-mcp',sub:'preporbit-assistant',client_id:'preporbit-assistant',scope:'math:tools',iat:now,exp:now+90})}`;
  return `${data}.${createHmac('sha256',secret).update(data).digest('base64url')}`;
}
async function boundedJson(response) {
  if (!response.ok || !response.body) throw unavailable();
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if(done) break;
      size += value.length;
      if(size > 2*1024*1024) throw unavailable();
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {await reader.cancel().catch(()=>{});}
}
export function createMathTools({url=process.env.MATH_MCP_URL,secret=process.env.MATH_MCP_JWT_SECRET,fetchImpl=fetch}={}) {
  const configured = !!url && typeof secret === 'string' && secret.length >= 64;
  let cached, expires = 0;
  async function rpc(method,params,signal) {
    if(!configured) throw unavailable();
    const id = randomUUID();
    try {
      const response = await fetchImpl(url,{method:'POST',redirect:'error',
        headers:{Authorization:`Bearer ${bearer(secret)}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},
        signal:AbortSignal.any([signal ?? new AbortController().signal,AbortSignal.timeout(10000)]),
        body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
      const body = await boundedJson(response);
      if(body.id !== id || body.error || !body.result) throw unavailable();
      return body.result;
    } catch {throw unavailable();}
  }
  return {
    configured,
    async definitions(signal) {
      if(!configured) return [];
      if(cached && Date.now()<expires) return cached;
      await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'preporbit-assistant',version:'1.0'}},signal);
      const result = await rpc('tools/list',{},signal);
      const definitions = (result.tools ?? []).filter(t=>STUDENT_MATH_TOOLS.has(t.name)).map(t=>({
        type:'function',name:t.name,description:t.description.slice(0,3000),parameters:t.inputSchema,strict:false,
      }));
      if(definitions.length !== STUDENT_MATH_TOOLS.size) throw unavailable();
      cached = definitions; expires = Date.now()+300000;
      return definitions;
    },
    async call(name,args,signal) {
      // Enforce again at execution, even if a model invents an unadvertised call.
      if(!STUDENT_MATH_TOOLS.has(name) || !args || Array.isArray(args) || typeof args!=='object' || JSON.stringify(args).length>12000) throw unavailable();
      const result = await rpc('tools/call',{name,arguments:args},signal);
      if(result.isError) throw unavailable();
      const text = (result.content ?? []).filter(c=>c.type==='text').map(c=>c.text).join('\n').slice(0,8000);
      const charts = (result.content ?? []).filter(c=>c.type==='image').map(c=>{
        if(c.mimeType!=='image/png' || typeof c.data!=='string' || c.data.length>350000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(c.data)) throw unavailable();
        const png = Buffer.from(c.data,'base64');
        if(!png.subarray(0,8).equals(PNG)) throw unavailable();
        const title = `Math tool chart: ${name.replace('plot_','').replaceAll('_',' ')}${typeof args.expression==='string'?` · ${args.expression}`:''}`;
        return {title,src:`data:image/png;base64,${c.data}`};
      });
      if(charts.length>1 || (!text && !charts.length)) throw unavailable();
      return {text,charts};
    },
  };
}
