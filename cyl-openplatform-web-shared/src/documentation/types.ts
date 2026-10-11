import type { ApiLifecycle } from '../lifecycle/LifecycleDetails';

export interface SchemaNode {
  type: string; description?: string | null; required?: boolean; nullable?: boolean; properties?: Record<string, SchemaNode>;
  items?: SchemaNode | null; enumValues?: unknown[]; defaultValue?: unknown; example?: unknown;
}
export interface ApiDocument {
  baseUrl?: string | null;
  mcp?: { name: string; description: string } | null;
  employeeRequired?: boolean | null;
  id: string; draftRevision: number; title: string; description?: string | null; path: string; httpMethod: string; scopeCodes: string[];
  requestSchema: SchemaNode; responseSchema: SchemaNode; errorDefinitions: { code: string; message: string; description?: string }[];
  requestExample: unknown; responseExample: unknown; lifecycle?: ApiLifecycle;
}
export interface DocumentSummary {
  apiId: string; releaseId: string; stateVersion: number; draftRevision: number; name: string; category: string;
  service: string; version: string; method: string; lifecycleStatus: ApiLifecycle['status']; mcpSupported?: boolean;
}
export interface DocumentView {
  releaseId: string; stateVersion: number; service: string; version: string; method: string; category: string; document: ApiDocument;
}
export interface DocumentCategory { category: string; apiCount: number }
export type DocumentFormat = 'JSON' | 'HTML';
