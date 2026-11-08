import {createContext, useContext} from 'react';
import type {Question} from './data/question-schema';

export interface AppConfig {hosted: boolean; ai: boolean; admin: boolean; desmosKey: string | null}
export const ConfigContext = createContext<AppConfig>({hosted: false, ai: false, admin: false, desmosKey: null});
export const useConfig = () => useContext(ConfigContext);

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function request<T>(path: string, body?: unknown, timeoutMs = 90000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, body === undefined ? {credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs)}
      : {method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: {'Content-Type': 'application/json', 'X-Waypoint-Client': '1'}, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)});
  } catch { throw new ApiError('Could not reach the server. Check your connection and try again.', 0); }
  let data: {message?: string} = {};
  try { data = await response.json(); } catch { /* Non-JSON error page. */ }
  if (!response.ok) throw new ApiError(data.message || 'Something went wrong. Try again.', response.status);
  return data as T;
}
// Both responses are validated: an unexpected body (an HTML error page, a proxy) must never break sign-in.
export const loadConfig = () => request<Partial<{ai: boolean; admin: boolean; desmosKey: string | null}>>('/api/config', undefined, 15000)
  .then(r => ({ai: r?.ai === true, admin: r?.admin === true, desmosKey: typeof r?.desmosKey === 'string' && r.desmosKey ? r.desmosKey : null}));
export const loadGeneratedQuestions = () => request<{questions?: unknown}>('/api/questions', undefined, 15000).then(r => Array.isArray(r?.questions) ? r.questions as Question[] : []);
export const askTutor = (body: {questionId: string; selected: unknown; hintLevel: number; history: {role: string; text: string}[]; message: string}) => request<{reply: string}>('/api/ai/tutor', body);
export const explainMyWork = (body: {questionId: string; lines: string[]}) => request<{explanation: string}>('/api/ai/explain-work', body);
export const transcribePhoto = (body: {image: string; variable: string}) => request<{lines: string[]}>('/api/ai/handwriting', body, 120000);
export const coachNote = (body: {kind: 'daily' | 'weekly'; timezone: string; refresh?: boolean}) => request<{text: string | null; day: string; cached: boolean}>('/api/ai/insight', body);
export interface GeneratedRow {id: string; status: 'pending' | 'flagged' | 'approved' | 'rejected'; payload: Question; verification: {problems?: string[]; mathCheck?: string; blindSolve?: {answer: string; agrees: boolean}}; createdBy: string; createdAt: string; decidedBy: string | null}
export interface Job {id: string; spec: {section: string; skill: string; difficulty: string; type: string; count: number}; status: string; startedAt: number; finishedAt?: number; results: {id: string | null; status: string; problems?: string[]}[]}
export const adminList = (status: string) => request<{questions: GeneratedRow[]}>(`/api/admin/questions${status === 'all' ? '' : `?status=${status}`}`).then(r => r.questions);
export const adminJobs = () => request<{jobs: Job[]}>('/api/admin/jobs').then(r => r.jobs);
export const adminGenerate = (spec: {section: string; skill: string; difficulty: string; type: string; count: number}) => request<{job: Job}>('/api/admin/generate', spec);
export const adminDecide = (id: string, decision: 'approve' | 'reject') => request<{ok: boolean}>('/api/admin/decide', {id, decision});
export const timezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

// Shrinks a photo in the browser so uploads stay small and fast (long side at most 1600px, JPEG).
export async function photoToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
