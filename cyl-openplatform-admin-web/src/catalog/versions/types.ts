import type { ApiDefinition } from "../CatalogPanel";

/** 草稿修订摘要（列表不含正文）；operatorName 为管理员展示姓名，未登记时为空。 */
export interface RevisionSummary {
  apiId: string;
  revision: number;
  source: string;
  summary: string;
  operatorTenantId: string | null;
  operatorEmployeeNo: string | null;
  operatorName?: string | null;
  recordedAt: string;
  historyStart: boolean;
  contentDigest: string;
  digestVersion: string;
  restoredFromRevision?: number | null;
}

export interface RevisionDetail extends RevisionSummary {
  snapshot: ApiDefinition;
}
