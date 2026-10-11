import type { AdminApi } from "../access/api";

/** 112：草稿调试“选凭据由服务端代换身份”。可选项由服务端按启用、有效授权、权限组过滤。 */
export interface IdentityCandidate {
  tenantGrantId: string;
  applicationId: string;
  applicationName: string;
  appKeyTail: string | null;
  tenantId: string;
  tenantName?: string | null;
  note?: string | null;
}
export interface IdentityEmployee {
  userGrantId: string;
  employeeNo: string;
  displayName?: string | null;
}
export interface IdentityChoice {
  candidate: IdentityCandidate;
  employee: IdentityEmployee | null;
}
export type IdentityMode = "credential" | "token";
interface Page<T> {
  items: T[];
  total: number;
}

const query = (text: string) => `?page=1&pageSize=20${text.trim() ? `&query=${encodeURIComponent(text.trim())}` : ""}`;
export const searchCandidates = (api: AdminApi, apiId: string, text: string, signal?: AbortSignal) =>
  api<Page<IdentityCandidate>>(`/apis/${encodeURIComponent(apiId)}/debug/identities${query(text)}`, { signal });
export const searchEmployees = (api: AdminApi, apiId: string, tenantGrantId: string, text: string, signal?: AbortSignal) =>
  api<Page<IdentityEmployee>>(`/apis/${encodeURIComponent(apiId)}/debug/identities/${encodeURIComponent(tenantGrantId)}/employees${query(text)}`, {
    signal,
  });

export const candidateLabel = (candidate: IdentityCandidate) =>
  `${candidate.applicationName} · ${candidate.tenantName || candidate.tenantId}${candidate.appKeyTail ? ` · AK …${candidate.appKeyTail}` : ""}`;
export const employeeLabel = (employee: IdentityEmployee) =>
  employee.displayName ? `${employee.displayName}（${employee.employeeNo}）` : employee.employeeNo;

/**
 * 本次登录内记住选择（页面内存，不写浏览器存储）：切换 API 后无需重选。
 * 只保存凭据与人员授权的标识和显示名，不含任何 Token 或 Secret。
 */
let remembered: { mode: IdentityMode; choice: IdentityChoice | null } = { mode: "credential", choice: null };
export const rememberedIdentity = () => remembered;
export function rememberIdentity(mode: IdentityMode, choice: IdentityChoice | null) {
  remembered = { mode, choice };
}
/** 仅测试使用。 */
export function forgetIdentity() {
  remembered = { mode: "credential", choice: null };
}

/** 请求体中的调用身份；与 Authorization 头二选一。 */
export const identityBody = (choice: IdentityChoice) =>
  `{"tenantGrantId":${JSON.stringify(choice.candidate.tenantGrantId)}${choice.employee ? `,"userGrantId":${JSON.stringify(choice.employee.userGrantId)}` : ""}}`;
