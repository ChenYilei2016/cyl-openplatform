import { permissionNames } from "./types";

export interface AdministratorStatus {
  enabledSuperAdministratorCount: number;
}

/** 最后一名启用的总管理员不可停用或降级；列表、抽屉与提交校验共用同一说明。 */
export const lastSuperReason = "这是最后一名启用的总管理员，请先为其他有效员工分配总管理员，再停用或降级此账号。";

export const isLastSuper = (administrator: { enabled: boolean; superAdministrator: boolean } | null | undefined, status: AdministratorStatus | null) =>
  Boolean(administrator?.enabled && administrator.superAdministrator && status?.enabledSuperAdministratorCount === 1);

export const permissionText = (permissions: string[]) =>
  permissions.map((code) => permissionNames[code] ?? code).join("、") || "无业务权限";

export const roleText = (superAdministrator: boolean) => (superAdministrator ? "总管理员" : "普通管理员");
