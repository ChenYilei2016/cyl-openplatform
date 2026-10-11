export interface ConnectionHeader {
  id: string; name: string; environmentId: string; description: string;
  draftRevision: number; activeRevision: number | null; enabled: boolean; stateVersion: number; updatedAt: string;
  registryCheck?: Diagnostics | null;
}
export interface ConnectionSummary extends ConnectionHeader {
  metadataType: 'NONE' | 'NACOS' | 'REDIS' | null; discoveryMode: 'INTERFACE' | 'APPLICATION' | null; providerMetadataMode: 'LOCAL' | 'REMOTE' | null;
}
export interface ConnectionConfig {
  registry: { address: string; namespace: string; group: string; credentialRef: string | null };
  metadata: { type: 'NONE' | 'NACOS' | 'REDIS'; address: string | null; namespace: string | null; group: string | null; database: number | null; credentialRef: string | null };
  discoveryMode: 'INTERFACE' | 'APPLICATION'; providerMetadataMode: 'LOCAL' | 'REMOTE';
}
export interface ConnectionRevision { connectionId: string; revision: number; config: ConnectionConfig; createdAt: string }
export interface ConnectionDetail { connection: ConnectionHeader; draft: ConnectionRevision; active: ConnectionRevision | null }
export interface Configuration { currentEnvironmentId: string; registryCredentialRefs: string[]; metadataCredentialRefs: string[] }
export interface ReferenceUsage { apiId: string; name: string; revision: number; kind: string }
export type CheckStatus = 'PASSED' | 'FAILED' | 'UNAVAILABLE' | 'NOT_APPLICABLE' | 'NOT_CHECKED';
export interface Diagnostics { connectionId: string; revision: number; checkedAt: string; checks: { stage: 'CONFIG' | 'REGISTRY' | 'INSTANCES' | 'MAPPING' | 'RUNTIME_METADATA' | 'DEFINITION'; status: CheckStatus; summary: string }[] }
