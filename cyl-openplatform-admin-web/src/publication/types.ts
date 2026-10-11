import type { ApiDefinition } from '../catalog/CatalogPanel';

export const releaseStatusNames = { PENDING: '待审核', APPLIED: '已生效', REJECTED: '已拒绝', FAILED: '发布失败' };
export type ReleaseStatus = keyof typeof releaseStatusNames;
export interface StandardSubmission { submissionKey: string; expectedDraftRevision: number; expectedStateVersion: number; comment: string }
export interface RollbackSubmission { submissionKey: string; sourceReleaseId: string; expectedLiveReleaseId: string; expectedStateVersion: number; comment: string }
export type PublicationSubmission = StandardSubmission | RollbackSubmission;
export interface ReleaseSummary { kind?: 'STANDARD' | 'ROLLBACK'; sourceReleaseId?: string | null; comment?: string; id: string; apiId: string; name: string; service: string; version: string; method: string; draftRevision: number; status: ReleaseStatus; auditRequired: boolean; submittedAt: string; submittedByTenantId: string; submittedByEmployeeNo: string; submittedByName?: string | null; reviewedAt: string | null; reviewedByTenantId: string | null; reviewedByEmployeeNo: string | null; reviewedByName?: string | null; failureReason: string | null }
export interface ReleaseDetail extends ReleaseSummary { baselineStateVersion?: number | null; submissionKey: string; comment: string; reviewComment: string | null; snapshot: ApiDefinition; baseline: ApiDefinition | null; baselineKnown: boolean }
export interface PublicationState { apiId: string; stateVersion: number; enabled: boolean; liveReleaseId: string | null; pendingReleaseId: string | null }
export interface EffectiveRelease { apiId: string; releaseId: string; stateVersion: number; enabled: boolean; appliedAt: string; snapshot: ApiDefinition }
export interface PublicationAudit { id: string; apiId: string; releaseId: string | null; action: string; operatorTenantId: string; operatorEmployeeNo: string; operatorName?: string | null; outcome: string; summary: string; requestId: string; occurredAt: string }

export function releaseOutcome(release: Pick<ReleaseSummary, 'status' | 'auditRequired'>): string {
  return release.status === 'APPLIED' ? release.auditRequired ? '审核通过' : '免审生效' : release.status === 'REJECTED' ? '已驳回' : release.status === 'FAILED' ? '发布失败' : '待审核';
}
