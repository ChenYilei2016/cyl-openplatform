export interface EmployeeIdentity {
  tenantId: string;
  userId: string;
  employeeId: string;
  employeeNo: string;
  displayName: string;
  enabled: boolean;
  employeeStatus: string;
}
export interface Administrator extends Omit<EmployeeIdentity, 'employeeStatus'> {
  id: string;
  /** 名单与详情返回的租户展示名称；未登记时为空，名称不作为身份依据。 */
  tenantName?: string | null;
  superAdministrator: boolean;
  revision: number;
  permissions: string[];
}
export interface AdministratorAudit {
  id: string;
  administratorId: string;
  operatorTenantId: string;
  operatorEmployeeNo: string;
  action: string;
  reason: string;
  before: Administrator | null;
  after: Administrator | null;
  occurredAt: string;
}
export const permissionNames: Record<string, string> = {
  MANAGE_APPLICATIONS: '应用与授权管理',
  MANAGE_APIS: 'API 管理',
  PUBLISH_APIS: 'API 发布',
  REVIEW_APIS: '发布审核',
  VIEW_AUDIT: '审计查询',
  MANAGE_OPERATIONS: '运营管理',
  MANAGE_CONNECTIONS: 'Dubbo 服务连接管理',
};

export const employeeStatusNames: Record<string, string> = {
  PENDING_ENTRY: '待入职', PROBATION: '试用期', TEMPORARY: '临时员工',
  PERMANENT: '正式员工', NOTICE: '待离职', LEFT: '已离职', UNKNOWN: '状态未知',
};
export const administratorActionNames: Record<string, string> = {
  CREATE: '分配管理资格', UPDATE: '调整管理资格',
};
