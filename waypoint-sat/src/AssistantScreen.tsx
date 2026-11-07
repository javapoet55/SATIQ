import {useEffect, useRef, useState} from 'react';
import {Intro} from './StudyComponents';
import {testInProgress} from './companion-model';
import type {ProgressStore} from './server-store';
import './assistant.css';

import {examplePrompts} from './data/assistant-prompts';
interface Context {asOf:string;timezone:string;weekStart:string;today:string;weeklyAttempts:number;weeklyQuestions:number;weeklyAccuracy:number|null;testBlocked:boolean;skills:{skill:string;questions:number;correct:number;accuracy:number}[]}
interface Turn {id:string;message:string;answer:string;context:Context}
interface Snapshot {configured:boolean;model:string;profileId:string;context:Context;history:Turn[]}
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
async function request<T>(method:'GET'|'POST',body?:unknown):Promise<T> {
  const response = await fetch(`/api/assistant?timezone=${encodeURIComponent(timezone)}`,{method,credentials:'same-origin',cache:'no-store',
    headers:method==='POST'?{'Content-Type':'application/json','X-Waypoint-Client':'1'}:undefined,
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(75000)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'The assistant could not connect. Try again.');
  return data;
}
export function AssistantScreen({store}:{store:ProgressStore}) {
  const [snapshot,setSnapshot] = useState<Snapshot|null>(null);
  const [draft,setDraft] = useState('');
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const [sending,setSending] = useState(false);
  const [pending,setPending] = useState<{requestId:string;message:string}|null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const list=transcript.current;
    if(list)list.scrollTop=sending?list.scrollHeight:(list.lastElementChild as HTMLElement|null)?.offsetTop ?? 0;
  },[snapshot?.history,sending]);
  const blocked = testInProgress(store.state) || !!snapshot?.context.testBlocked;
  const saving = !!store.error || (!!store.hosted && store.syncStatus !== 'Saved to Railway database');
  const load = async () => {
    setLoading(true);setError('');
    try {
      const data = await request<Snapshot>('GET');
      if (!mounted.current) return;
      setSnapshot(data);
      try {
        const saved = JSON.parse(localStorage.getItem(`waypoint-ai-pending-${data.profileId}`) || 'null');
        if (saved && data.history.some(t=>t.id===saved.requestId)) {
          setDraft('');setPending(null);
          localStorage.removeItem(`waypoint-ai-draft-${data.profileId}`);
          localStorage.removeItem(`waypoint-ai-pending-${data.profileId}`);
        } else {
          setDraft(localStorage.getItem(`waypoint-ai-draft-${data.profileId}`) || '');
          setPending(saved && typeof saved.requestId==='string' && typeof saved.message==='string' ? saved : null);
        }
      } catch {/* Chat still works without browser storage. */}
    } catch (e) {if(mounted.current)setError(e instanceof Error?e.message:'Unable to connect to the assistant.');}
    finally {if(mounted.current)setLoading(false);}
  };
  useEffect(()=>{mounted.current=true;if(store.hosted)void load();return()=>{mounted.current=false;};},[store.hosted]);
  const change = (text:string) => {
    setDraft(text);setPending(null);
    if(snapshot)try{localStorage.setItem(`waypoint-ai-draft-${snapshot.profileId}`,text);localStorage.removeItem(`waypoint-ai-pending-${snapshot.profileId}`);}catch{/* Keep the in-memory draft. */}
  };
  const send = async () => {
    if(busy.current || !snapshot?.configured || blocked || saving || !draft.trim())return;
    const next = pending?.message === draft.trim() ? pending : {requestId:crypto.randomUUID(),message:draft.trim()};
    busy.current=true;setSending(true);setPending(next);setError('');
    try{localStorage.setItem(`waypoint-ai-pending-${snapshot.profileId}`,JSON.stringify(next));}catch{/* Same-page retries still reuse the request ID. */}
    try {
      const turn = await request<Turn>('POST',{...next,timezone});
      if(!mounted.current)return;
      setSnapshot(s=>s?{...s,context:turn.context,history:[...s.history.filter(t=>t.id!==turn.id),turn].slice(-20)}:s);
      setDraft('');setPending(null);
      try{localStorage.removeItem(`waypoint-ai-draft-${snapshot.profileId}`);localStorage.removeItem(`waypoint-ai-pending-${snapshot.profileId}`);}catch{/* Already saved on server. */}
    } catch(e) {if(mounted.current)setError(e instanceof Error?e.message:'The request timed out. Your question is kept; try again.');}
    finally {busy.current=false;if(mounted.current)setSending(false);}
  };
  const context = snapshot?.context;
  return <>
    <Intro tag="A LITTLE CLARITY, WHEN YOU NEED IT" title="Ask. Understand. Move forward.">Your SAT questions, connected to your own learning journey.</Intro>
    {!store.hosted && <div className="card spaced" role="status">AI Assistant uses the hosted study database. Open the Railway app to connect your saved activity and GPT.</div>}
    {store.hosted && !snapshot && <div className="card spaced"><p role="status">{loading?'Reading your saved activity…':'The assistant could not connect.'}</p>{!loading&&<button className="btn" onClick={()=>void load()}>Reconnect assistant</button>}</div>}
    {snapshot && !snapshot.configured && <div className="assistant-banner" role="status"><strong>Your study context is ready. GPT is not connected yet.</strong><p>Add OPENAI_API_KEY to the Railway web service and deploy the variable change, then choose Refresh context. You can explore the prompts and draft a question now.</p></div>}
    {blocked && <div className="assistant-banner" role="status">Finish and submit your practice test to unlock AI help.</div>}
    <div className="assistant-layout">
      <section className="card assistant-chat" aria-label="AI conversation">
        <div className="assistant-card-heading"><div><span className="eyebrow">YOUR LEARNING COMPANION</span><h2>AI Assistant <span aria-hidden="true">✧</span></h2></div><span className="assistant-pill">{snapshot?.configured?'GPT connected':'Awaiting connection'}</span></div>
        <p className="muted">Ask about a concept, unpack a mistake, or find your next focus.</p>
        <div className="assistant-prompts" aria-label="Example prompts">{examplePrompts.map((prompt,i)=><button disabled={sending || blocked || loading} key={prompt} onClick={()=>{change(prompt);composer.current?.focus();}}><span aria-hidden="true">0{i+1}</span>{prompt}<span aria-hidden="true">↗</span></button>)}</div>
        <div ref={transcript} className="assistant-transcript" aria-label="Saved conversation" aria-busy={sending} tabIndex={0}>
          {!snapshot?.history.length && <p className="muted assistant-empty">Start with a question above, or put your doubt into your own words.</p>}
          {snapshot?.history.map(turn=><article className="assistant-turn" key={turn.id}><div className="assistant-user"><span className="eyebrow">YOU</span><p>{turn.message}</p></div><div className="assistant-answer"><span className="eyebrow">PREPORBIT AI</span><p>{turn.answer}</p><small className="muted">Sources: your saved activity as of {new Date(turn.context.asOf).toLocaleString()} + GPT subject knowledge.</small></div></article>)}
          {sending&&<p role="status" className="assistant-thinking">✧ Reading your activity and preparing an answer…</p>}
        </div>
        <form onSubmit={e=>{e.preventDefault();void send();}} className="assistant-compose">
          <label htmlFor="ai-question"><strong>What would you like to understand?</strong></label>
          <textarea ref={composer} id="ai-question" value={draft} maxLength={2000} rows={4} disabled={sending || blocked || loading} onChange={e=>change(e.target.value)} placeholder="For example: Why do I keep missing percentage questions?" aria-describedby="ai-privacy"/>
          <div className="assistant-send"><small className="muted">{draft.length}/2,000</small><button className="btn primary" disabled={!snapshot?.configured || !draft.trim() || sending || blocked || saving || loading} type="submit">{sending?'Preparing answer…':pending?'Retry question ↗':'Ask PrepOrbit AI ↗'}</button></div>
          {saving&&<p role="status" className="muted">Save your latest activity before asking. {store.error || 'Waiting for the database save…'}</p>}
          <p id="ai-privacy" className="muted assistant-note">Sending a question shares it, recent chat, and a summary of your saved learning activity and reflections with OpenAI. Answers can contain mistakes; check the reasoning. AI cannot change your progress.</p>
        </form>
        {error&&<p className="assistant-error" role="alert">{error}</p>}
      </section>
      <aside className="card assistant-context" aria-label="Saved study context"><span className="eyebrow">GROUNDED IN YOUR PROGRESS</span><h2>This week, so far.</h2>
        <p className="muted">{context?`${context.weekStart} → ${context.today} · ${context.timezone}`:'Your saved activity will appear here.'}</p>
        <div className="assistant-metrics"><div><strong>{context?.weeklyQuestions ?? '—'}</strong><span>distinct questions</span></div><div><strong>{context?.weeklyAccuracy==null?'—':`${context.weeklyAccuracy}%`}</strong><span>first-attempt accuracy</span></div></div>
        {context?.skills.map(skill=><div className="assistant-skill" key={skill.skill}><strong>{skill.skill}</strong><span>{skill.correct}/{skill.questions} correct · {skill.accuracy}%</span></div>)}
        {context?.weeklyQuestions===0&&<p className="muted">No answers saved this week yet. A few practice questions will give us a starting point.</p>}
        <p className="muted assistant-note">First attempt per distinct question this week. Small samples suggest what to practice; they do not establish mastery. Estimated SAT score is unavailable.</p>
        {store.hosted&&<button className="btn" disabled={loading || sending || saving} onClick={()=>void load()}>{loading?'Refreshing…':'Refresh context'}</button>}
        <p className="muted assistant-note">Chat is saved in your private browser study profile on Railway. The most recent 20 exchanges are shown. Refresh context after studying in another tab.</p>
      </aside>
    </div>
  </>;
}
