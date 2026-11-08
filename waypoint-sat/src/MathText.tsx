import katex from 'katex';
import 'katex/dist/katex.min.css';

// Renders text with inline LaTeX between \( and \). Dollar signs stay plain text (they mean money on the SAT).
const cache = new Map<string, string>();
function render(tex: string) {
  let html = cache.get(tex);
  if (html === undefined) {
    try { html = katex.renderToString(tex, {throwOnError: false, output: 'htmlAndMathml', strict: 'ignore'}); }
    catch { html = ''; }
    if (cache.size > 2000) cache.clear();
    cache.set(tex, html);
  }
  return html;
}
export function MathText({text, className}: {text: string; className?: string}) {
  const parts = text.split(/(\\\(.*?\\\))/s);
  return <span className={className}>{parts.map((part, i) => part.startsWith('\\(') && part.endsWith('\\)')
    ? <span key={i} className="math" dangerouslySetInnerHTML={{__html: render(part.slice(2, -2))}}/>
    : <span key={i}>{part}</span>)}</span>;
}
// Multi-line passages: blank lines start a new paragraph, lines starting with • become list items.
export function Passage({text}: {text: string}) {
  const blocks = text.split(/\n\s*\n/);
  return <div className="passage">{blocks.map((block, i) => {
    const lines = block.split('\n');
    const bullets = lines.filter(l => l.trim().startsWith('•'));
    if (bullets.length) return <div key={i}>{lines.filter(l => !l.trim().startsWith('•')).map((l, j) => <p key={j}><MathText text={l}/></p>)}<ul>{bullets.map((b, j) => <li key={j}><MathText text={b.replace(/^\s*•\s*/, '')}/></li>)}</ul></div>;
    return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br/>}<MathText text={l}/></span>)}</p>;
  })}</div>;
}
// Plain-text version for labels, selects, and screen-reader names.
export const plain = (text: string) => text.replace(/\\\((.*?)\\\)/gs, (_, tex: string) => tex.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2').replace(/\\(cdot|times)/g, '×').replace(/\\sqrt\{([^{}]*)\}/g, '√$1').replace(/\^\\circ/g, '°').replace(/\\[a-z]+/gi, '').replace(/[{}]/g, ''));
