import type { SchemaNode } from '@cyl/open-platform-web-shared/documentation/types';
import type { ApiDefinition } from '../catalog/CatalogPanel';
import type { AdapterForm, ResponseIssue } from '../catalog/ResponseAdapterEditor';
export interface DebugContent { available: boolean; truncated: boolean; redacted: boolean; value: unknown; unavailableReason?: string }
export interface DebugCheck { stage: string; status: 'PASSED' | 'FAILED' | 'NOT_CHECKED' | 'UNAVAILABLE'; reason?: string; summary: string; issues: ResponseIssue[] }
export interface DebugResult {
  requestId: string; draftRevision: number; durationMillis: number;
  outcome: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'; providerDispatch: 'NOT_SENT' | 'SENT' | 'UNKNOWN';
  checks: DebugCheck[]; mappedInput: DebugContent; providerResponse: DebugContent; adaptedData: DebugContent; publicResponse: DebugContent;
  providerMessage?: { value: string; truncated: boolean };
  /** 凭据代换身份时没有 Token：tokenId 与 expiresAt 为空。 */
  identity: { applicationId: string; appKey: string; tenantId: string; employeeNo?: string | null; expiresAt: string | null; tokenId?: string | null };
}
export interface DebugEditorActions {
  setGeneratorState?: (state:{pending:boolean;busy:boolean})=>void;
  configureTarget: () => void;
  reload: () => void;
  dirty: () => boolean;
  save: () => Promise<ApiDefinition | null>;
  saveError?: () => Error | null;
  setBusy: (busy: boolean) => void;
  requestSchema?: SchemaNode;
  adapter: AdapterForm;
  responseSchemaText: string;
  changeAdapter: (value: AdapterForm) => void;
  changeResponseSchema: (text: string) => void;
  /** 112：带着本次提供方返回（可选）到配置页修复返回规则或公开结构。 */
  repairResponse?: (sample: string | undefined, structure: boolean) => void;
  /** 清除调试身份时销毁交给配置页的临时返回样例。 */
  setResponseSample?: (sample: string | undefined) => void;
}
export interface DebugDefinition {
  id: string; draftRevision: number; name: string; service?: string; version?: string; method?: string; scopeCodes?: string[];
  requestSchema?: SchemaNode; responseSchema?: SchemaNode; binding?: unknown; mappings?: unknown[]; employeeRequired?: boolean | null;
}
