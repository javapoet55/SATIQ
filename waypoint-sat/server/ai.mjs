// One place that talks to the OpenAI Responses API. Every feature reuses its error handling and limits.
export const aiError = (status, message) => Object.assign(new Error(message), {status});

export function createAI({apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-5-mini', fetchImpl = fetch} = {}) {
  async function call({instructions, input, maxTokens = 2048, effort = 'low', schema, timeoutMs = 90000, modelOverride}) {
    if (!apiKey) throw aiError(503, 'AI help is not connected yet. Add OPENAI_API_KEY to the Railway web service.');
    const useModel = modelOverride || model;
    const body = {model: useModel, store: false, max_output_tokens: maxTokens, instructions, input,
      ...(useModel.startsWith('gpt-5') || /^o\d/.test(useModel) ? {reasoning: {effort}} : {}),
      ...(schema ? {text: {format: {type: 'json_schema', name: schema.name, strict: true, schema: schema.schema}}} : {})};
    let response;
    try {
      response = await fetchImpl('https://api.openai.com/v1/responses', {method: 'POST', headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)});
    } catch { throw aiError(504, 'The AI took too long or could not be reached. Try again.'); }
    if (!response.ok) throw aiError(response.status === 429 ? 429 : 502, response.status === 401 ? 'The server AI key was rejected. Check OPENAI_API_KEY in Railway.' : response.status === 429 ? 'The AI is busy or its allowance is used up. Try again later.' : 'The AI could not answer right now. Try again.');
    let json;
    try { json = await response.json(); } catch { throw aiError(502, 'The AI returned an unreadable answer. Try again.'); }
    const text = (json.output ?? []).filter(o => o.type === 'message').flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('\n').trim();
    if (!text || json.status !== 'completed') throw aiError(502, 'The AI did not finish its answer. Try again.');
    return text;
  }
  return {
    configured: !!apiKey, model,
    text: options => call(options).then(t => t.slice(0, 12000)),
    async json(options) {
      const text = await call(options);
      try { return JSON.parse(text); } catch { throw aiError(502, 'The AI returned data in the wrong format. Try again.'); }
    },
  };
}
