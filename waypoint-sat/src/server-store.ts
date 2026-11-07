import {useEffect, useRef, useState} from 'react';
import {emptyState, parseState, type State} from './model';

export interface ProgressStore {
  state: State; current: {current: State}; commit: (update: (s: State) => State) => void;
  error: string; retry: () => void; exportData: () => void; reset: () => void;
  hosted?: boolean; syncStatus?: string; conflict?: boolean; importData?: (raw: string) => void; loadServerCopy?: () => void;
  sessionEnded?: boolean; pending?: () => boolean;
  account?: {email: string; signOut: () => void};
}
export interface ServerSnapshot {profileId: string; revision: number; state: State}
const CACHE_KEY = 'waypoint-server-cache-v1';
export class SignInRequired extends Error {}
// Removes this browser's copy of hosted progress (used on sign-out so the next person can't read it).
export function clearServerCache() { try { localStorage.removeItem(CACHE_KEY); } catch { /* Storage denied. */ } }
interface Cache extends ServerSnapshot {pending: boolean}
export function exportProgress(value: string, name = 'waypoint-progress.json') {
  const url = URL.createObjectURL(new Blob([value], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function loadServerSnapshot(): Promise<ServerSnapshot> {
  const response = await fetch('/api/progress', {credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(15000)});
  if (response.status === 401) throw new SignInRequired('Sign in to open your study space.');
  if (!response.ok) throw new Error('The study database is temporarily unavailable. Retry to reconnect.');
  const data = await response.json();
  if (typeof data.profileId !== 'string' || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('The server returned unreadable progress.');
  return {...data, state: parseState(JSON.stringify(data.state))};
}
export function useServerStore(snapshot: ServerSnapshot): ProgressStore {
  const initial = useRef<{state: State; revision: number; pending: boolean; conflict: boolean} | null>(null);
  if (!initial.current) {
    let cached: Cache | null = null;
    try { const raw = localStorage.getItem(CACHE_KEY); if (raw) { const c = JSON.parse(raw); cached = {...c, state:parseState(JSON.stringify(c.state))}; } } catch { /* PostgreSQL remains the source of truth. */ }
    const pending = !!cached && cached.profileId === snapshot.profileId && cached.pending === true;
    initial.current = {state: pending ? cached!.state : snapshot.state, revision: pending ? cached!.revision : snapshot.revision, pending, conflict: pending && cached!.revision !== snapshot.revision};
  }
  const [state, setState] = useState(initial.current.state);
  const current = useRef(state); const revision = useRef(initial.current.revision);
  const [error, setError] = useState(initial.current.conflict ? 'Another tab saved newer progress. Export this pending work, then reload the server copy.' : '');
  const [syncStatus, setSyncStatus] = useState(initial.current.pending ? 'Pending database save' : 'Saved to Railway database');
  const dirty = useRef(initial.current.pending); const generation = useRef(0);
  const cacheAvailable = useRef(true);
  const conflict = useRef(initial.current.conflict); const busy = useRef(false);
  const ended = useRef(false); const [sessionEnded, setSessionEnded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef<{state: State; revision: number; writeId: string; generation: number} | null>(null);
  const flushRef = useRef<(keepalive?: boolean) => Promise<void>>(async () => {});
  const cache = () => {
    try {localStorage.setItem(CACHE_KEY, JSON.stringify({profileId:snapshot.profileId, revision:revision.current, state:current.current, pending:dirty.current})); cacheAvailable.current = true;}
    catch {cacheAvailable.current = false; /* A server acknowledgement still confirms durability if browser storage is full. */}
  };
  const flush = async (keepalive = false) => {
    if (!dirty.current || busy.current || conflict.current || ended.current) return;
    clearTimeout(timer.current); busy.current = true; setSyncStatus('Saving to Railway…');
    request.current ??= {state:current.current, revision:revision.current, writeId:crypto.randomUUID(), generation:generation.current};
    const sent = request.current;
    try {
      const response = await fetch('/api/progress', {method:'PUT', credentials:'same-origin', headers:{'Content-Type':'application/json','X-Waypoint-Client':'1'}, body:JSON.stringify({state:sent.state, revision:sent.revision, writeId:sent.writeId}), signal:AbortSignal.timeout(15000), keepalive});
      const result = await response.json();
      if (response.status === 409) conflict.current = true;
      // Pending work stays in the browser backup; signing back in to the same account restores and saves it.
      if (response.status === 401) {ended.current = true; setSessionEnded(true);}
      if (!response.ok) throw new Error(result.message || 'The database save failed.');
      if (!Number.isSafeInteger(result.revision) || result.revision <= sent.revision) throw new Error('Unexpected database save response.');
      revision.current = result.revision; request.current = null;
      dirty.current = generation.current !== sent.generation;
      cache(); setError(''); setSyncStatus(dirty.current ? 'Pending database save' : 'Saved to Railway database');
    } catch (e) {
      cache(); setError(`${e instanceof Error ? e.message : 'Connection lost.'} ${cacheAvailable.current ? 'Pending work is retained in this tab and its browser backup.' : 'Browser backup is unavailable. Pending work is in this tab only; export a backup now.'} Retry saving before closing.`); setSyncStatus('Database save pending');
    } finally {busy.current = false;}
    if (dirty.current && request.current === null && !conflict.current && !ended.current) timer.current = setTimeout(() => {void flushRef.current();}, 100);
  };
  flushRef.current = flush;
  const commit = (update: (s: State) => State) => {
    const next = update(current.current); if (next === current.current) return;
    current.current = next; setState(next); generation.current++; dirty.current = true;
    cache(); setSyncStatus('Pending database save');
    clearTimeout(timer.current); timer.current = setTimeout(() => {void flushRef.current();}, 250);
  };
  useEffect(() => {
    const online = () => {void flushRef.current();};
    const hidden = () => {if (document.visibilityState === 'hidden') void flushRef.current(true);};
    const leave = (e: BeforeUnloadEvent) => {if (dirty.current) {void flushRef.current(true); e.preventDefault();}};
    window.addEventListener('online', online); document.addEventListener('visibilitychange', hidden); window.addEventListener('beforeunload', leave);
    if (dirty.current) void flushRef.current();
    return () => {clearTimeout(timer.current); window.removeEventListener('online', online); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('beforeunload', leave);};
  }, []);
  return {state, current, commit, error, hosted:true, syncStatus, conflict:conflict.current, sessionEnded, pending: () => dirty.current,
    retry: () => {void flushRef.current();},
    loadServerCopy: () => {
      try {localStorage.removeItem(CACHE_KEY); dirty.current = false; location.reload();}
      catch {setError('Could not clear the pending browser backup. Export it first, then clear site storage and reconnect.');}
    },
    exportData: () => exportProgress(JSON.stringify(current.current, null, 2)),
    reset: () => {if (conflict.current) {setError('Reload the server copy before starting fresh. Export pending work first.'); return;} commit(() => emptyState());},
    importData: raw => {const imported = parseState(raw); if (conflict.current) throw new Error('Reload the server copy before importing a backup.'); exportProgress(JSON.stringify(current.current,null,2), 'waypoint-before-import.json'); commit(() => imported);},
  };
}
