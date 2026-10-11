import type { ApiDefinition } from '../catalog/CatalogPanel';
import type { ReleaseStatus } from '../publication/types';

export interface ConnectionOption { id: string; name: string; description: string; revision: number }
export interface ConnectionDirectory { environmentId: string; nodeId: string; items: ConnectionOption[]; total: number; page: number; pageSize: number }
export interface Target { id: string; name: string; nodeIds: string[] }
export interface EnvironmentPreview { environmentId: string; nodeId: string; definition: ApiDefinition; before: ApiDefinition | null; change: string; expectedRevision: number; changedFields: string[]; previewDigest: string; auditRequired: boolean; pendingReleaseId: string | null }
export interface Receipt { environmentId: string; nodeId: string; sourceEnvironment: string; transferId: string; apiId: string; releaseId: string; draftRevision: number; status: ReleaseStatus; auditRequired: boolean; liveReleaseId: string | null; enabled: boolean; stateVersion: number; observedAt: string }
export interface NodeObservation { nodeId: string; receipt: Receipt | null; error: string | null; observedAt: string }
export interface OutgoingTransfer { id: string; request: { sourceEnvironment: string; targetEnvironment: string; sourceReleaseId: string; definition?: ApiDefinition }; deliveryState: 'READY' | 'ACCEPTED' | 'UNKNOWN' | 'REJECTED'; error: string | null; receipt: Receipt | null; observations: NodeObservation[]; createdAt: string; updatedAt: string; version: number }
export interface IncomingReview { sourceEnvironment: string; sourceReleaseId: string; operatorTenantId: string; operatorEmployeeNo: string; before: ApiDefinition | null; after: ApiDefinition; changedFields: string[] }

export interface TransferSummary { id: string; sourceEnvironment: string | null; observations: NodeObservation[]; sourceReleaseId: string; targetId: string; service: string; version: string; method: string; deliveryState: OutgoingTransfer['deliveryState']; error: string | null; receipt: Receipt | null; createdAt: string; updatedAt: string }
