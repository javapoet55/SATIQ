import type {State} from './model.ts';
import {emptyIntelligence,type IntelligenceState} from './intelligence-types.ts';
import {checkWork} from './work-check.ts';
export const intelligenceOf=(s:State):IntelligenceState=>s.intelligence??emptyIntelligence();
export function nextChallenge(correct:boolean,hinted:boolean){return correct&&!hinted?2:1}
export function weekBounds(now:number,previous=false){const d=new Date(now);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7)-(previous?7:0));const end=new Date(d);end.setDate(end.getDate()+7);return [d.getTime(),end.getTime()] as const}
export function weeklyStats(state:State,now:number,previous=false){const [start,end]=weekBounds(now,previous);const unique=new Map<string,{correct:boolean;submittedAt:number;elapsedMs:number;skill:string}>();for(const a of state.attempts){if(a.submittedAt>=start&&a.submittedAt<end&&!unique.has(a.questionId))unique.set(a.questionId,{...a,skill:a.questionId.startsWith('wp-math')?'Math':'Reading & Writing'})}for(const a of intelligenceOf(state).attempts){if(a.submittedAt>=start&&a.submittedAt<end&&!unique.has(a.questionId))unique.set(a.questionId,{...a,skill:'Linear equations'})}const rows=[...unique.values()];const days=new Set(rows.map(a=>new Date(a.submittedAt).toDateString()));return{start,end,rows,total:rows.length,correct:rows.filter(a=>a.correct).length,minutes:Math.round(rows.reduce((s,a)=>s+a.elapsedMs,0)/60000),days:days.size}}
// The step checker now lives in work-check.ts and works for any linear question; this keeps the original d = 6 default.
export const reviewSteps=(draft:string)=>checkWork(draft,'d',6);
