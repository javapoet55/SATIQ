import React from 'react';
import type {Question} from './data/questions';
import type {Choice} from './model';

export function Intro({tag, title, children}: {tag: string; title: string; children: React.ReactNode}) {
  return <div className="intro"><div className="eyebrow">{tag}</div><h1 tabIndex={-1} id="page-title">{title}</h1><p className="muted">{children}</p></div>;
}
export function Choices({question: q, selected, onSelect, locked = false, reveal = false}: {question: Question; selected: Choice; onSelect?: (choice: number) => void; locked?: boolean; reveal?: boolean}) {
  return <fieldset className="answers"><legend className="sr-only">Answer choices</legend>{q.choices.map((text, i) => <label key={i} className={`answer ${selected === i ? 'selected' : ''} ${reveal && q.correct === i ? 'correct' : ''} ${reveal && selected === i && i !== q.correct ? 'wrong' : ''} ${locked ? 'locked' : ''}`}>
    <input type="radio" name={`answer-${q.id}`} value={i} checked={selected === i} disabled={locked} onChange={() => onSelect?.(i)} />
    <b aria-hidden="true">{'ABCD'[i]}</b><span><span className="sr-only">{'ABCD'[i]}. </span>{text}{reveal && q.correct === i && <strong> · ✓ Correct answer</strong>}{reveal && selected === i && <strong> · Your answer</strong>}</span>
  </label>)}</fieldset>;
}
export function Solution({question: q}: {question: Question}) {
  return <><div className="card"><span className="eyebrow">THE WORKED SOLUTION</span><h2 className="solution-title">{q.id.startsWith('pt-') ? 'Work through the reasoning.' : q.section === 'math' ? 'Separate, then solve.' : 'Connect the ideas.'}</h2>{q.steps.map((step, i) => <div className="step" key={i}><b>{i + 1}</b><div><h3>{step[0]}</h3><p className="muted">{step[1]}</p>{step[2] && <div className="equation">{step[2]}</div>}</div></div>)}</div><div className="card spaced strategy"><h3>Strategy for next time</h3><p className="spaced">{q.why}</p></div></>;
}

