import {useEffect, useRef, useState} from 'react';
import type {ProgressStore} from './server-store';
import {Intro, AnswerInput, QuestionBody, WrongChoiceNote, MathTools, hasAnswer} from './StudyComponents';
import {MathText, plain} from './MathText';
import {questions, questionById} from './data/bank';
import {DOMAINS, answerLabel, correctLabel, type Question, type Subject} from './data/question-schema';
import {tutorContent, causeOptions, strategy} from './data/companion-content';
import {activityStats, localDay, dayOffset, type Route} from './model';
import {companionOf, freshTutor, openTutor, checkTutor, analysisFor, editReflection, confirmAnalysis, taskSet, startPlanTask, planCompletionAttempt, completePlanTask, testInProgress, SAMPLE_ATTEMPT, type PlanTask} from './companion-model';
import type {CompanionState, TutorContext, Cause} from './companion-types';
import {prioritySkill, nextQuestion, firstAttempts} from './practice-engine';
import {PlanBanner, CoachNote} from './StudioScreens';
import {useConfig, askTutor} from './api';

type Props = {store: ProgressStore; route: 'plan' | 'tutor' | 'analysis'; now: number; navigate: (r: Route) => void; notify: (text: string) => void};
const skillOf = (id: string) => questionById(id).skill;
// Hints for any question: authored ladders for the original four, otherwise the hint then each worked step.
const hintLadder = (q: Question) => tutorContent[q.id]?.hints ?? [q.hint, ...q.steps.map(s => `${s[0]}: ${s[1]}`)].filter(Boolean).slice(0, 3);

export function CompanionScreens({store, route, now, navigate, notify}: Props) {
  const {state, commit} = store; const c = companionOf(state); const today = localDay(now);
  const config = useConfig();
  const [selectedDay, setSelectedDay] = useState(today);
  useEffect(() => setSelectedDay(today), [today]);
  const update = (fn: (c: CompanionState) => CompanionState) => commit(s => ({...s, companion: fn(companionOf(s))}));
  const updateTutor = (fn: (t: TutorContext) => TutorContext) => commit(s => {
    if (testInProgress(s)) return s;
    const cc = companionOf(s); const id = cc.tutorQuestionId;
    return {...s, companion: {...cc, tutor: {...cc.tutor, [id]: fn(cc.tutor[id] ?? freshTutor())}}};
  });
  const blocked = testInProgress(state);
  const saveStatus = store.error ? 'Not saved · use the retry or export controls above' : store.syncStatus ?? 'Saved on this device';
  const helpBlocked = <div className="card"><span className="pill">Help is paused during tests</span><h2 className="spaced">Give the test your full focus.</h2><p className="muted spaced">Finish or stop your practice test to reopen the tutor and mistake reflection. Your conversations are saved.</p><button className="primary spaced" onClick={() => navigate('test')}>Return to test →</button></div>;

  // ---------------- Tutor ----------------
  const q = questionById(c.tutorQuestionId); const t = c.tutor[q.id] ?? freshTutor();
  const chatRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false); const [aiError, setAiError] = useState('');
  useEffect(() => { if (route === 'tutor' && chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [route, q.id, t.messages, pending]);
  useEffect(() => setAiError(''), [q.id]);
  if (route === 'tutor') {
    const checked = state.attempts.find(a => a.id === t.checkedAttemptId);
    const ladder = hintLadder(q);
    const push = (user: string, reply: string, nextLevel?: number) => updateTutor(cur => ({...cur, composer: '', hintLevel: nextLevel ?? cur.hintLevel, messages: [...cur.messages, {role: 'user' as const, text: user}, {role: 'tutor' as const, text: reply}].slice(-60)}));
    const ask = async (message: string, fallback: string, nextLevel?: number) => {
      if (!config.ai || pending) { push(message, fallback, nextLevel); return; }
      setPending(true); setAiError('');
      updateTutor(cur => ({...cur, composer: '', messages: [...cur.messages, {role: 'user' as const, text: message}].slice(-60)}));
      try {
        const {reply} = await askTutor({questionId: q.id, selected: t.selected, hintLevel: nextLevel ?? t.hintLevel, history: t.messages.slice(-8), message});
        updateTutor(cur => ({...cur, hintLevel: nextLevel ?? cur.hintLevel, messages: [...cur.messages, {role: 'tutor' as const, text: reply}].slice(-60)}));
      } catch (e) { setAiError(e instanceof Error ? e.message : 'The tutor could not answer.'); updateTutor(cur => ({...cur, hintLevel: nextLevel ?? cur.hintLevel, messages: [...cur.messages, {role: 'tutor' as const, text: fallback}].slice(-60)})); }
      finally { setPending(false); }
    };
    const changeQuestion = (id: string) => { if (id !== q.id) commit(s => openTutor(s, id)); };
    const sectionQs = questions().filter(x => x.section === q.section);
    const choiceText = t.selected === null ? '' : answerLabel(q, t.selected);
    return <>
      <Intro tag="PRACTICE / GUIDED TUTOR" title="A nudge in the right direction.">{config.ai ? 'Ask anything about the question. The tutor guides you step by step and won’t give the answer away before you check.' : 'Work through hints one step at a time.'}</Intro>
      {blocked ? helpBlocked : <>
      <div className="practice-controls"><div className="tabs" aria-label="Tutor section">{(['rw', 'math'] as Subject[]).map(subject => <button key={subject} aria-pressed={q.section === subject} className={q.section === subject ? 'active' : ''} onClick={() => { const nq = nextQuestion(state, {section: subject, skill: 'All skills', difficulty: 'Any', adaptive: false}); if (nq) changeQuestion(nq.id); }}>{subject === 'math' ? 'Math' : 'Reading & Writing'}</button>)}</div>
        <label>Question<select aria-label="Tutor question" value={q.id} onChange={e => changeQuestion(e.target.value)}>{DOMAINS[q.section].map(d => <optgroup key={d.domain} label={d.domain}>{sectionQs.filter(x => x.domain === d.domain).map((x, i) => <option key={x.id} value={x.id}>{x.skill} · {x.difficulty} · #{i + 1}</option>)}</optgroup>)}</select></label></div>
      <div className="workspace"><section><div className="card question"><div className="row"><span className="pill">{q.skill} · {q.difficulty}</span>{q.section === 'math' && <MathTools/>}</div>
        <QuestionBody question={q}/>
        <AnswerInput question={q} selected={t.selected} reveal={!!checked} locked={!!checked} onSelect={selected => updateTutor(cur => ({...cur, selected, checkedAttemptId: null}))}/>
        {checked && <div className={`feedback ${checked.correct ? 'right' : 'miss'}`} role="status"><strong>{checked.correct ? '✓ That’s right.' : `↻ The answer is ${plain(correctLabel(q))}.`}</strong><WrongChoiceNote question={q} selected={checked.selected}/><p><MathText text={q.steps.map(x => x[1]).join(' ')}/></p></div>}
        <div className="row questionfooter"><span className="caption">Your first answer is saved separately from retries.</span><button className="primary" disabled={!hasAnswer(t.selected) || !!checked} onClick={() => commit(s => checkTutor(s, q, Date.now()))}>{checked ? 'Answer checked' : 'Check answer →'}</button></div>
        {checked && <div className="row spaced"><button onClick={() => {update(cc => ({...cc, analysisAttemptId: checked.id})); navigate('analysis');}}>Reflect on this attempt →</button><button onClick={() => commit(s => openTutor(s, q.id, true))}>Try again</button></div>}
      </div></section>
      <section className="card tutor-panel" aria-label="Guided tutor"><div className="tutor-head"><div className="row"><div className="tutor-title"><span className="tutor-mark" aria-hidden="true">✧</span><div><h3>PrepOrbit AI Tutor</h3><p className="caption no-margin">{config.ai ? 'Live AI · grounded in this question’s worked solution' : 'Step-by-step hints'}</p></div></div><span className="pill">{t.hintLevel} of 3 hints</span></div></div>
        <div ref={chatRef} className="chat" role="log" aria-label="Tutor conversation" aria-relevant="additions"><div className="bubble"><small>PREPORBIT AI TUTOR</small><p>Let’s work on this together. Ask for a hint, or tell me which step feels unclear.</p></div>{t.messages.map((m, i) => <div key={i} className={`bubble ${m.role === 'user' ? 'user' : ''}`}><small>{m.role === 'user' ? 'YOU' : 'PREPORBIT AI TUTOR'}</small><p><MathText text={m.text}/></p></div>)}{pending && <div className="bubble"><small>PREPORBIT AI TUTOR</small><p className="muted">Thinking…</p></div>}</div>
        <div className="tutor-bottom">{aiError && <p className="caption error-text" role="alert">{aiError} A step-by-step hint was shown instead.</p>}<span className="sectionlabel">TRY A STARTING POINT</span><div className="chips">
          <button disabled={t.hintLevel >= 3 || pending} onClick={() => ask(t.hintLevel ? 'Give me another hint.' : 'Give me a small hint.', ladder[t.hintLevel] ?? q.hint, t.hintLevel + 1)}>{t.hintLevel >= 3 ? 'All 3 hints used' : t.hintLevel ? '✧ Next hint' : '✧ Small hint'}</button>
          <button disabled={pending} onClick={() => ask('Explain the next step.', tutorContent[q.id]?.explain ?? `${q.steps[0][0]}: ${q.steps[0][1]}`)}>Explain the next step</button>
          <button disabled={!hasAnswer(t.selected) || pending} onClick={() => ask(`Can we discuss my answer, ${plain(choiceText)}?`, checked ? `${q.steps.map(x => x[1]).join(' ')} ${q.why}` : 'Check your choice against the question: does it answer exactly what is asked, using every piece of information given?')}>Discuss my answer</button></div>
          {config.ai ? <form className="spaced" onSubmit={e => {e.preventDefault(); const m = t.composer.trim(); if (m) void ask(m, 'The tutor could not answer right now. Try a hint instead.');}}><label className="sr-only" htmlFor="tutor-composer">Your question to the tutor</label><input id="tutor-composer" value={t.composer} maxLength={500} placeholder="Tell me where you’re stuck…" onChange={e => updateTutor(cur => ({...cur, composer: e.target.value}))}/><button className="primary" aria-label="Send question" disabled={!t.composer.trim() || pending}>↑</button></form> : <p className="caption">Typing your own questions needs the AI connection. The hint buttons work without it.</p>}
          <p className="caption">{config.ai ? `${t.composer.length}/500 · AI answers can contain mistakes; the worked solution is the final word. ` : ''}The latest 30 exchanges are saved.</p></div>
      </section></div></>}
    </>;
  }

  // ---------------- Mistake reflection ----------------
  if (route === 'analysis') {
    const latest = [...state.attempts].reverse();
    const id = c.analysisAttemptId ?? state.reviewAttemptId ?? latest.find(a => !a.correct)?.id ?? latest[0]?.id;
    const sample = id === SAMPLE_ATTEMPT;
    const attempt = state.attempts.find(a => a.id === id);
    const question = sample ? questionById('wp-math-001') : attempt ? questionById(attempt.questionId) : null;
    const record = id ? analysisFor(state, id) : null;
    const authored = question ? tutorContent[question.id] : undefined;
    const content = question ? {insight: authored?.insight ?? (attempt && typeof attempt.selected === 'number' ? question.distractors?.[attempt.selected] ?? undefined : undefined) ?? `Compare your work with step 1 of the solution: ${question.steps[0][1]}`,
      equation: authored?.equation ?? question.steps[0][2] ?? question.steps[0][0], suggested: authored?.suggested ?? (question.section === 'math' ? 'calculation' : 'reading') as Cause,
      example: authored?.example ?? 'I picked the answer that looked familiar without checking it against the question.'} : null;
    const next = record && question ? strategy(record.cause, question.section) : null;
    const setAnalysis = (patch: Partial<NonNullable<typeof record>>) => { if (id) update(cc => ({...cc, analysisAttemptId: id, analyses: {...cc.analyses, [id]: {...analysisFor(state, id), ...patch}}})); };
    const yourAnswer = sample ? 'A · 4 days' : attempt ? plain(answerLabel(question!, attempt.selected)) : '';
    return <>
      <Intro tag="REVIEW / MISTAKE REFLECTION" title="Find the lesson in the miss.">Your reasoning matters more than a single answer.</Intro>
      <PlanBanner store={store} now={now} navigate={navigate} notify={notify}/>
      {blocked ? helpBlocked : !question || !record || !id || !content ? <div className="card"><h2>Start with an actual attempt.</h2><p className="muted spaced">Check an answer in practice or finish a test. Then reflect on your own reasoning here.</p><div className="row spaced"><button className="primary" onClick={() => navigate('practice')}>Start practicing →</button><button onClick={() => update(cc => ({...cc, analysisAttemptId: SAMPLE_ATTEMPT}))}>See a sample</button></div><p className="caption">The sample never counts toward your progress or plan.</p></div> : <>
        <div className="stepper" aria-label="Reflection stages"><span className="on"><b>1</b> Reflect</span><span aria-hidden="true">→</span><span className={record.opened ? 'on' : ''}><b>2</b> Understand</span><span aria-hidden="true">→</span><span className={record.confirmedAt !== null ? 'on' : ''}><b>3</b> Try again</span></div>
        <label className="analysis-selector">Attempt to reflect on<select value={id} onChange={e => update(cc => ({...cc, analysisAttemptId: e.target.value}))}><option value={SAMPLE_ATTEMPT}>Sample algebra mistake · not recorded</option>{latest.map(a => <option key={a.id} value={a.id}>{questionById(a.questionId).skill} · {a.selected === null || a.selected === '' ? 'Unanswered' : a.correct ? 'Correct' : 'Incorrect'} · {new Date(a.submittedAt).toLocaleString()}</option>)}</select></label>
        <div className="workspace"><section><div className="card question"><div className="row"><span className="pill">{question.skill} · {sample ? 'Sample' : 'Your attempt'}</span><span className="priority">{sample ? 'Not part of your progress' : attempt?.correct ? '✓ Correct · reflect on your method' : attempt?.selected === null ? 'Unanswered' : '↻ Review'}</span></div>
          <QuestionBody question={question}/>
          <div className="result-strip"><div><strong>Your answer: {yourAnswer}</strong><br/><span>Correct answer: {plain(correctLabel(question))}</span></div></div>
          <div className="spaced"><label htmlFor="analysis-reflection"><h3>Walk me through your thinking.</h3></label><p className="caption">What steps did you take? What felt uncertain?</p><textarea id="analysis-reflection" maxLength={5000} value={record.reflection} placeholder="For example: I subtracted the fee, then divided…" onChange={e => commit(s => editReflection(s, id, e.target.value))}/>
            <div className="row"><button onClick={() => commit(s => editReflection(s, id, content.example))}>Use an example</button><button className="primary" disabled={!record.reflection.trim()} onClick={() => setAnalysis({opened: true, confirmedAt: null, cause: c.analyses[id]?.cause ?? content.suggested})}>Explore my mistake →</button></div></div>
        </div></section><section>
          {!record.opened ? <div className="card analysis-empty"><span className="tutor-mark" aria-hidden="true">↗</span><h2 className="spaced">Let’s look at your approach.</h2><p className="muted spaced">Describe what you did, then compare it with the most common mistake on this question.</p></div> : <>
          <div className="card"><span className="eyebrow">WHAT USUALLY GOES WRONG HERE</span><h2 className="solution-title">{question.section === 'math' ? 'Check the first step that changed.' : 'Connect your choice to the evidence.'}</h2><div className="insight"><p><MathText text={content.insight}/></p><div className="equation"><MathText text={content.equation.includes('\\(') || !/[=^\\]/.test(content.equation) ? content.equation : `\\(${content.equation}\\)`}/></div></div>
            <h3 className="spaced">Which cause fits best?</h3><fieldset className="cause-fieldset"><legend className="caption">Choose the one that describes your own work</legend><div className="cause-list">{causeOptions.map(option => <label className="cause" key={option.id}><input type="radio" name="mistake-cause" value={option.id} checked={record.cause === option.id} onChange={() => setAnalysis({cause: option.id as Cause, confirmedAt: null})}/><span><strong>{option.title}</strong><small>{option.description}</small></span></label>)}</div></fieldset>
            <button className="primary wide" disabled={record.confirmedAt !== null} onClick={() => commit(s => confirmAnalysis(s, id, Date.now()))}>{record.confirmedAt !== null ? 'Reflection saved' : 'Save my reflection'}</button><p className="caption">{saveStatus}</p></div>
          {record.confirmedAt !== null && next && <div className="card spaced strategy" role="status"><span className="eyebrow">YOUR NEXT STEP</span><h2 className="solution-title">{next.title}</h2><p>{next.text}</p><button className="primary spaced" onClick={() => {commit(s => openTutor(s, question.id, true)); navigate('tutor');}}>Try it again with the tutor →</button>{c.activeTask?.taskId === 'review' && <button className="wide spaced" disabled={!planCompletionAttempt(state, skillOf, now) || sample} onClick={() => {commit(s => completePlanTask(s, skillOf, Date.now())); navigate('plan'); notify('Plan activity complete.');}}>Complete review & return to plan</button>}</div>}
          </>}
        </section></div></>}
    </>;
  }

  // ---------------- Daily plan ----------------
  const readOnly = selectedDay !== today;
  const plan = c.plans[selectedDay] ?? {minutes: 20 as const, completed: {}};
  const focus = {math: prioritySkill(state, 'math').skill, rw: prioritySkill(state, 'rw').skill};
  const activeFocus = c.activeTask && c.activeTask.date === today && c.activeTask.skill ? c.activeTask : null;
  const tasks = taskSet(plan.minutes, {math: activeFocus?.taskId === 'algebra' || activeFocus?.taskId === 'stretch' ? activeFocus.skill! : focus.math, rw: activeFocus?.taskId === 'transitions' ? activeFocus.skill! : focus.rw});
  const completed = tasks.filter(task => plan.completed[task.id]).length;
  const date = new Date(`${selectedDay}T12:00:00`);
  const monday = dayOffset(now, -((new Date(now).getDay() + 6) % 7));
  const stats = activityStats(state, now);
  const first = firstAttempts(state);
  const start = (task: PlanTask) => {
    const firstQ = task.section ? nextQuestion(state, {section: task.section, skill: task.skill, difficulty: task.id === 'stretch' ? 'Hard' : 'Any', adaptive: task.id !== 'stretch'}) : undefined;
    commit(s => startPlanTask(s, task, firstQ?.id, Date.now()));
    navigate(task.id === 'review' ? 'analysis' : 'practice');
  };
  return <>
    <Intro tag="PLAN / DAILY PLAN" title="A plan that meets you here.">Built from your own results: your weakest skills get the first slots.</Intro>
    <div className="card hero planhero"><div><span className="eyebrow">{date.toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})} · {readOnly ? 'PLAN PREVIEW' : 'YOUR DAILY PLAN'}</span><h2 className="hero-title">{completed === tasks.length ? 'You made time for progress.' : `Let’s make ${plan.minutes} minutes count.`}</h2><p className="muted">One Math skill, one Reading and Writing skill, and a second look at a mistake.</p></div><div className="softcard"><span className="sectionlabel">{readOnly ? 'SELECTED DAY' : 'TODAY’S PROGRESS'}</span><div className="plan-progress">{completed} <span>of {tasks.length} activities</span></div><div className="bar"><i style={{width: `${completed / tasks.length * 100}%`}}/></div><small>One focused step at a time.</small></div></div>
    <div className="schedule" aria-label="Week overview">{Array.from({length: 7}, (_, i) => { const time = dayOffset(monday, i); const key = localDay(time); const count = Object.keys(c.plans[key]?.completed ?? {}).length; return <button key={key} className={selectedDay === key ? 'active' : ''} aria-pressed={selectedDay === key} aria-label={`${new Date(time).toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})}${key === today ? ', today' : ''}`} onClick={() => setSelectedDay(key)}><small>{new Date(time).toLocaleDateString(undefined, {weekday: 'short'})}</small><b>{new Date(time).getDate()}</b><small>{key === today ? 'Today' : key > today ? 'Upcoming' : count ? `${count} done` : stats.days.has(key) ? 'Studied' : 'No activity'}</small></button>; })}</div>
    {readOnly && <div className="feedback" role="status">{selectedDay > today ? 'Upcoming preview. Start activities from today’s plan.' : 'Past plan view.'} <button className="text-button" onClick={() => setSelectedDay(today)}>Return to today</button></div>}
    {blocked && <div className="feedback" role="status">You have a practice test in progress. Finish it before starting a plan activity. <button className="text-button" onClick={() => navigate('test')}>Return to test</button></div>}
    {!readOnly && c.activeTask && c.activeTask.date === today && <div className="notice row spaced"><span>An activity is in progress.</span><button onClick={() => navigate(c.activeTask!.taskId === 'review' ? 'analysis' : 'practice')}>Continue activity →</button></div>}
    <div className="plan-grid spaced"><section><div className="row"><h2>{readOnly ? 'Your selected day' : 'Your next small steps'}</h2><span className="muted small">{plan.minutes} min planned</span></div><div className="plan-list">{tasks.map(task => {
      const done = plan.completed[task.id]; const reviewEmpty = task.id === 'review' && !state.attempts.length;
      const skillFirst = [...first.values()].filter(a => skillOf(a.questionId) === task.skill);
      return <article className={`plan-task ${done ? 'done' : ''}`} key={task.id}><span className="task-icon" aria-hidden="true">{done ? '✓' : task.icon}</span><div><div className="row"><h3>{task.title}</h3><span className="priority">{task.label}</span></div><div className="task-detail"><span>{task.count} {task.count === 1 ? 'question' : 'questions'}</span><span>◷ {task.time} min</span>{task.section && <span>{skillFirst.length ? `${skillFirst.filter(a => a.correct).length}/${skillFirst.length} right so far` : 'new skill'}</span>}</div><p className="reason">{task.reason}</p><p className="caption">{done ? 'Completed' : reviewEmpty ? 'Answer a question first to unlock review.' : ''}</p></div><button aria-label={`${done ? 'Completed' : 'Start'}: ${task.title}`} disabled={readOnly || !!done || blocked || reviewEmpty} className={task.id === 'algebra' ? 'primary' : ''} onClick={() => start(task)}>{done ? '✓ Done' : selectedDay > today ? 'Upcoming' : 'Start →'}</button></article>;
    })}</div></section>
    <section><div className="card"><span className="eyebrow">MAKE ROOM FOR STUDY</span><h2 className="solution-title">How much time today?</h2><div className="time-options">{([10, 20, 30] as const).map(minutes => <button key={minutes} disabled={readOnly} aria-pressed={plan.minutes === minutes} className={plan.minutes === minutes ? 'active' : ''} onClick={() => update(cc => ({...cc, plans: {...cc.plans, [today]: {...cc.plans[today], minutes, completed: cc.plans[today]?.completed ?? {}}}}))}>{minutes} min</button>)}</div><p className="caption">Changing time keeps your completed activities.</p></div>
      {config.ai && <CoachNote kind="daily" hasData={state.attempts.length > 0}/>}
      <div className="softcard spaced"><h3>Consistency over intensity.</h3><p className="caption">A shorter session still moves you forward. Choose a plan you can finish.</p></div></section></div>
  </>;
}
