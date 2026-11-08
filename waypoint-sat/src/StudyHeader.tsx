import './study-header.css';

export function StudyHeader({label,home,now,email,onSignOut,onOpenAssistant,assistantOpen}: {
  label:string;home:boolean;now:number;email?:string;onSignOut?:()=>void;onOpenAssistant:()=>void;assistantOpen:boolean;
}) {
  const date=new Date(now),hour=date.getHours();
  const salutation=hour>=5&&hour<12?'Good morning':hour>=12&&hour<17?'Good afternoon':'Good evening';
  // Accounts currently have no separate name field; use their email username.
  const username=email?.split('@')[0].split('+')[0].replace(/[._-]+/g,' ').trim();
  const name=username?username.split(' ').filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' '):'';
  return <header className="study-header">
    <div className="study-header-context">
      <div className="study-header-location"><span className="eyebrow">{label}</span><time className="muted header-date" dateTime={date.toISOString()}>{date.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</time></div>
      {home&&<p className="study-greeting">{salutation}{name&&<>, <strong>{name}</strong></>}.</p>}
    </div>
    <div className="header-actions">
      {!assistantOpen&&<a className="header-assistant" href="#assistant" onClick={onOpenAssistant}><span aria-hidden="true">✦</span> Ask AI</a>}
      {onSignOut&&<button className="signout" title={`Signed in as ${email}`} onClick={onSignOut}>Sign out</button>}
    </div>
  </header>;
}
