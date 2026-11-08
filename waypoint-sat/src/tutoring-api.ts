import {request} from './api';
import type {Role, ProfileInput} from './data/tutoring-schema';

export interface OwnProfile {
  fullName: string; roles: Role[]; zip: string | null; city: string | null; state: string | null; grade: string | null; subjectsWanted: string[];
  linkedin: string | null; school: string | null; subjects: string[]; bio: string | null; availability: string | null; radiusMiles: number; accepting: boolean;
  guidelinesAccepted: boolean; reviewed: boolean; complete: boolean;
}
export interface Totals {confirmed: number; pending: number; students: number; firstDate: string | null; lastDate: string | null}
export interface Me {profile: OwnProfile | null; counts: {incomingRequests: number; hoursToConfirm: number}; totals: Totals | null; certificate: {code: string; issuedAt: string} | null}
export interface TutorCard {
  id: string; name: string; school: string; subjects: string[]; bio: string; availability: string | null; linkedin: string; reviewed: boolean;
  distance: string; hours: number; certified: boolean; relation: {id: string; status: 'pending' | 'accepted' | 'unavailable'} | null;
}
export interface Connection {
  id: string; role: 'student' | 'tutor'; status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'ended'; subject: string; message: string;
  createdAt: string; respondedAt: string | null; endedAt: string | null; confirmedHours: number; distance: string | null;
  other: {name: string; grade?: string; school?: string; linkedin?: string; subjects?: string[]; email?: string};
}
export interface HourEntry {id: string; date: string; minutes: number; note: string; status: 'pending' | 'confirmed' | 'disputed'; name: string; connectionId?: string}
export interface HoursData {asTutor: {entries: HourEntry[]; totals: Totals; certificate: {code: string; issuedAt: string} | null} | null; asStudent: HourEntry[]}
export interface VerifiedCertificate {code: string; name: string; hours: string; students: number; firstDate: string; lastDate: string; issuedAt: string; revoked: boolean}
export interface AdminTutor {
  id: string; name: string; email: string; school: string | null; linkedin: string | null; subjects: string[]; place: string | null; accepting: boolean; reviewed: boolean;
  confirmedMinutes: number; pendingMinutes: number; students: number; eligible: boolean; certificate: {id: string; code: string; issuedAt: string; hours: string} | null;
}
export interface AdminReport {id: string; reason: string; createdAt: string; reporter: string; target: string}

export const loadMe = () => request<Me>('/api/tutoring/me', undefined, 15000);
export const saveProfile = (body: ProfileInput) => request<{profile: OwnProfile}>('/api/tutoring/profile', body, 20000);
export const findTutors = (radius: number, subject: string) => request<{tutors: TutorCard[]}>(`/api/tutoring/tutors?radius=${radius}${subject ? `&subject=${encodeURIComponent(subject)}` : ''}`, undefined, 20000).then(r => r.tutors);
export const requestTutor = (body: {tutorId: string; subject: string; message: string}) => request<{id: string}>('/api/tutoring/connect', body, 20000);
export const loadConnections = () => request<{connections: Connection[]}>('/api/tutoring/connections', undefined, 20000).then(r => r.connections);
export const respondToRequest = (id: string, decision: 'accept' | 'decline') => request<{ok: boolean}>('/api/tutoring/respond', {id, decision});
export const withdrawRequest = (id: string) => request<{ok: boolean}>('/api/tutoring/withdraw', {id});
export const endConnection = (id: string) => request<{ok: boolean}>('/api/tutoring/end', {id});
export const reportConnection = (connectionId: string, reason: string, block: boolean) => request<{ok: boolean}>('/api/tutoring/report', {connectionId, reason, block});
export const loadHours = () => request<HoursData>('/api/tutoring/hours', undefined, 20000);
export const logHours = (body: {connectionId: string; date: string; minutes: number; note: string}) => request<{id: string}>('/api/tutoring/hours', body);
export const deleteHours = (id: string) => request<{ok: boolean}>('/api/tutoring/hours/delete', {id});
export const decideHours = (id: string, decision: 'confirm' | 'dispute') => request<{ok: boolean}>('/api/tutoring/hours/decide', {id, decision});
export const verifyCertificate = (code: string) => request<VerifiedCertificate>(`/api/verify/${encodeURIComponent(code)}`, undefined, 15000);
export const adminTutoring = () => request<{tutors: AdminTutor[]; reports: AdminReport[]}>('/api/admin/tutoring', undefined, 20000);
export const adminIssueCertificate = (userId: string) => request<{code: string}>('/api/admin/tutoring/certificate', {userId});
export const adminRevokeCertificate = (id: string, reason: string) => request<{ok: boolean}>('/api/admin/tutoring/revoke', {id, reason});
export const adminReviewTutor = (userId: string, reviewed: boolean) => request<{ok: boolean}>('/api/admin/tutoring/review', {userId, reviewed});
export const adminCloseReport = (id: string) => request<{ok: boolean}>('/api/admin/tutoring/close-report', {id});
