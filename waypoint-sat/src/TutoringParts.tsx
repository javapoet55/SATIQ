import React from 'react';
import type {Role} from './data/tutoring-schema';

export const GUIDELINES: {title: string; body: string}[] = [
  {title: 'Free and friendly', body: 'Prep Orbit tutoring is volunteer and free. Never ask for or accept payment.'},
  {title: 'Meet in public', body: 'Meet in a public place such as a library, a school or a café. Tell a parent, guardian or trusted adult where you are going and when.'},
  {title: 'Keep details private', body: 'Only your first name and last initial are shown until you accept a connection. Don’t share your home address, passwords or anything you wouldn’t tell a stranger.'},
  {title: 'Tutors are not background-checked', body: 'LinkedIn and school details are entered by tutors and are not verified. A “Reviewed” badge means an administrator looked at the profile, nothing more. Students under 18 should involve a parent or guardian.'},
  {title: 'Speak up', body: 'If anything feels wrong, end the connection, report it and block the person. You can do this at any time.'},
  {title: 'Certificates are public by link', body: 'If you earn a certificate, your full name appears on it, and anyone with its verification link can see it.'},
  {title: 'You must be 13 or older', body: 'You must be at least 13 to use Prep Orbit.'},
];

export function GuidelinesList() {
  return <ul className="guidelines">{GUIDELINES.map(g => <li key={g.title}><strong>{g.title}.</strong> {g.body}</li>)}</ul>;
}
export function GuidelinesAgreement({checked, onChange, locked, id = 'guidelines'}: {checked: boolean; onChange: (v: boolean) => void; locked?: boolean; id?: string}) {
  return <div className="guidelines-box">
    <details><summary>Read the community guidelines</summary><GuidelinesList/></details>
    <label className="check-line" htmlFor={id}><input id={id} type="checkbox" checked={checked} disabled={locked} onChange={e => onChange(e.target.checked)}/><span>I’m 13 or older and I agree to the community guidelines.</span></label>
  </div>;
}

export type RoleChoice = 'student' | 'tutor' | 'both';
export const rolesOf = (choice: RoleChoice): Role[] => choice === 'both' ? ['student', 'tutor'] : [choice];
export const choiceOf = (roles: Role[]): RoleChoice => roles.includes('student') && roles.includes('tutor') ? 'both' : roles.includes('tutor') ? 'tutor' : 'student';
const ROLE_TEXT: Record<RoleChoice, [string, string]> = {
  student: ['I’m a student', 'Practice for the SAT and ask nearby tutors for help.'],
  tutor: ['I’m a tutor', 'Teach students near you and earn a certificate after 100 hours.'],
  both: ['Both', 'Learn from tutors and teach others.'],
};
export function RolePicker({value, onChange, name = 'role'}: {value: RoleChoice; onChange: (v: RoleChoice) => void; name?: string}) {
  return <fieldset className="role-picker"><legend>How will you use Prep Orbit?</legend>
    {(['student', 'tutor', 'both'] as RoleChoice[]).map(choice => <label key={choice} className={value === choice ? 'selected' : ''}>
      <input type="radio" name={name} value={choice} checked={value === choice} onChange={() => onChange(choice)}/>
      <span><strong>{ROLE_TEXT[choice][0]}</strong><small>{ROLE_TEXT[choice][1]}</small></span></label>)}
  </fieldset>;
}

export function Chips({options, value, onChange, max, label}: {options: readonly string[]; value: string[]; onChange: (v: string[]) => void; max: number; label: string}) {
  return <fieldset className="chip-picker"><legend>{label}</legend>
    <div className="chips">{options.map(option => {
      const on = value.includes(option);
      return <label key={option} className={`chip ${on ? 'on' : ''}`}><input type="checkbox" checked={on} disabled={!on && value.length >= max} onChange={() => onChange(on ? value.filter(v => v !== option) : [...value, option])}/><span>{option}</span></label>;
    })}</div>
    <small className="muted">Choose up to {max}.</small></fieldset>;
}

export const hoursText = (minutes: number) => { const h = Math.floor(minutes / 60), m = minutes % 60; return h && m ? `${h} hr ${m} min` : h ? `${h} hr` : `${m} min`; };
export const dateText = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
