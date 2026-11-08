import React, {useState} from 'react';
import type {Question} from './data/question-schema';
import type {Choice} from './model';
import {MathText, Passage} from './MathText';

export function Intro({tag, title, children}: {tag: string; title: string; children: React.ReactNode}) {
  return <div className="intro"><div className="eyebrow">{tag}</div><h1 tabIndex={-1} id="page-title">{title}</h1><p className="muted">{children}</p></div>;
}
export function Choices({question: q, selected, onSelect, locked = false, reveal = false}: {question: Question; selected: Choice; onSelect?: (choice: number) => void; locked?: boolean; reveal?: boolean}) {
  return <fieldset className="answers"><legend className="sr-only">Answer choices</legend>{q.choices.map((text, i) => <label key={i} className={`answer ${selected === i ? 'selected' : ''} ${reveal && q.correct === i ? 'correct' : ''} ${reveal && selected === i && i !== q.correct ? 'wrong' : ''} ${locked ? 'locked' : ''}`}>
    <input type="radio" name={`answer-${q.id}`} value={i} checked={selected === i} disabled={locked} onChange={() => onSelect?.(i)} />
    <b aria-hidden="true">{'ABCD'[i]}</b><span><span className="sr-only">{'ABCD'[i]}. </span><MathText text={text}/>{reveal && q.correct === i && <strong> · ✓ Correct answer</strong>}{reveal && selected === i && <strong> · Your answer</strong>}</span>
  </label>)}</fieldset>;
}
// SAT student-produced response: up to 5 characters (6 with a minus sign), fractions or decimals.
export function SprInput({question: q, value, onChange, locked = false, reveal = false}: {question: Question; value: Choice; onChange?: (v: string) => void; locked?: boolean; reveal?: boolean}) {
  const text = typeof value === 'string' ? value : '';
  return <div className="spr"><label htmlFor={`spr-${q.id}`}><strong>Your answer</strong></label>
    <input id={`spr-${q.id}`} className="spr-input" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={6} value={text} disabled={locked}
      aria-describedby={`spr-help-${q.id}`} onChange={e => { const v = e.target.value.replace(/[^\d./-]/g, ''); if (/^-?[\d./]*$/.test(v) && v.length <= (v.startsWith('-') ? 6 : 5)) onChange?.(v); }}/>
    <small id={`spr-help-${q.id}`} className="caption">Type a number, decimal, or fraction such as 3/4. Up to 5 characters (6 with a minus sign).</small>
    {reveal && <p className="spr-key"><strong>Accepted answer{(q.answers ?? []).length > 1 ? 's' : ''}:</strong> {(q.answers ?? []).join(', ')}</p>}
  </div>;
}
export function AnswerInput(props: {question: Question; selected: Choice; onSelect?: (choice: number | string) => void; locked?: boolean; reveal?: boolean}) {
  return props.question.type === 'spr'
    ? <SprInput question={props.question} value={props.selected} onChange={props.onSelect} locked={props.locked} reveal={props.reveal}/>
    : <Choices question={props.question} selected={props.selected} onSelect={props.onSelect} locked={props.locked} reveal={props.reveal}/>;
}
export function QuestionBody({question: q}: {question: Question}) {
  return <>{q.passage && <Passage text={q.passage}/>}<p className="questiontext"><MathText text={q.text}/></p></>;
}
export const hasAnswer = (choice: Choice) => choice !== null && choice !== '';
export function WrongChoiceNote({question: q, selected}: {question: Question; selected: Choice}) {
  if (q.type !== 'mcq' || typeof selected !== 'number' || selected === q.correct) return null;
  const note = q.distractors?.[selected];
  return note ? <div className="distractor-note"><strong>Why {'ABCD'[selected]} is tempting:</strong> <MathText text={note}/></div> : null;
}
export function Solution({question: q, selected}: {question: Question; selected?: Choice}) {
  return <><div className="card"><span className="eyebrow">THE WORKED SOLUTION</span><h2 className="solution-title">{q.skill}</h2>{q.steps.map((step, i) => <div className="step" key={i}><b>{i + 1}</b><div><h3><MathText text={step[0]}/></h3><p className="muted"><MathText text={step[1]}/></p>{step[2] && <div className="equation"><MathText text={`\\(${step[2]}\\)`}/></div>}</div></div>)}</div>
    {q.type === 'mcq' && q.distractors && <div className="card spaced"><h3>Why the other choices are wrong</h3><ul className="distractor-list">{q.distractors.map((d, i) => d && <li key={i} className={selected === i ? 'picked' : ''}><b>{'ABCD'[i]}.</b> <MathText text={d}/>{selected === i && <em> · your answer</em>}</li>)}</ul></div>}
    <div className="card spaced strategy"><h3>Strategy for next time</h3><p className="spaced"><MathText text={q.why}/></p></div></>;
}

// Test-day tools for math: Desmos graphing calculator and the SAT reference sheet.
export function MathTools() {
  const [open, setOpen] = useState<'calc' | 'ref' | null>(null);
  return <div className="math-tools"><button aria-pressed={open === 'calc'} onClick={() => setOpen(open === 'calc' ? null : 'calc')}>🖩 Calculator</button><button aria-pressed={open === 'ref'} onClick={() => setOpen(open === 'ref' ? null : 'ref')}>📐 Reference</button>
    {open === 'calc' && <Calculator onClose={() => setOpen(null)}/>}{open === 'ref' && <ReferenceSheet onClose={() => setOpen(null)}/>}</div>;
}
// The calculator runs in a frame served by desmos.com, so its code never runs on this site and the site's
// script policy stays strict. No API key is needed for this. The pop-up link stays as a backup.
function Calculator({onClose}: {onClose: () => void}) {
  const popup = () => window.open('https://www.desmos.com/calculator', 'desmos', 'width=520,height=640');
  return <section className="tool-panel" aria-label="Graphing calculator"><div className="row"><h3>Graphing calculator</h3><button onClick={onClose} aria-label="Close calculator">×</button></div>
    <iframe className="desmos-host" title="Desmos graphing calculator" src="https://www.desmos.com/calculator" referrerPolicy="no-referrer" allow="clipboard-write"/>
    <button className="linkbutton" onClick={popup}>Open in a larger window ↗</button></section>;
}
const REFERENCE: [string, string][] = [
  ['Circle', String.raw`A = \pi r^2,\quad C = 2\pi r`], ['Rectangle', String.raw`A = \ell w`], ['Triangle', String.raw`A = \tfrac{1}{2}bh`],
  ['Pythagorean theorem', String.raw`c^2 = a^2 + b^2`], ['Special right triangles', String.raw`x,\ x\sqrt{3},\ 2x \ (30^\circ\text{-}60^\circ\text{-}90^\circ);\quad s,\ s,\ s\sqrt{2}\ (45^\circ\text{-}45^\circ\text{-}90^\circ)`],
  ['Rectangular prism', String.raw`V = \ell w h`], ['Cylinder', String.raw`V = \pi r^2 h`], ['Sphere', String.raw`V = \tfrac{4}{3}\pi r^3`], ['Cone', String.raw`V = \tfrac{1}{3}\pi r^2 h`], ['Pyramid', String.raw`V = \tfrac{1}{3}\ell w h`],
];
function ReferenceSheet({onClose}: {onClose: () => void}) {
  return <section className="tool-panel" aria-label="Reference sheet"><div className="row"><h3>Reference sheet</h3><button onClick={onClose} aria-label="Close reference sheet">×</button></div>
    <dl className="reference">{REFERENCE.map(([name, tex]) => <div key={name}><dt>{name}</dt><dd><MathText text={`\\(${tex}\\)`}/></dd></div>)}</dl>
    <p className="caption">A circle has 360 degrees of arc (2π radians). The angles of a triangle add up to 180°.</p></section>;
}
