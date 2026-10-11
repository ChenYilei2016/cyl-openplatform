package io.github.chenyilei2016.openplatform.domain.access;

import java.time.Instant;

/**
 * 租户权限：平台管理员把权限组开通给指定租户，(tenantId, scopeCode) 唯一；撤销保留记录，再次开通复用同一记录。
 * 只用于 MCP 工具可用性与门户展示，普通凭据调用仍按凭据自己的权限组判断。
 * grantedBy* 为最近一次开通的操作人；updatedAt 为最近一次开通或撤销的时间；revision 用于状态变更的乐观并发控制。
 */
public record TenantScopeGrant(String id, String tenantId, String scopeCode, GrantStatus status,
                               String grantedByTenantId, String grantedByEmployeeNo,
                               Instant createdAt, Instant updatedAt, long revision) {
    public static TenantScopeGrant open(String id, String tenantId, String scopeCode, AccessOperator operator, Instant now) {
        return new TenantScopeGrant(id, tenantId, scopeCode, GrantStatus.ACTIVE, operator.tenantId(), operator.employeeNo(), now, now, 0);
    }

    /** 已撤销的记录重新开通：更新开通人与时间，版本加一。 */
    public TenantScopeGrant reopen(AccessOperator operator, Instant now) {
        return new TenantScopeGrant(id, tenantId, scopeCode, GrantStatus.ACTIVE, operator.tenantId(), operator.employeeNo(),
                createdAt, now, revision + 1);
    }

    /** 开通人引用，仅用于查找展示姓名。 */
    public EmployeeNumberRef grantedBy() {
        return new EmployeeNumberRef(grantedByTenantId, grantedByEmployeeNo);
    }

    /** 撤销保留开通人，只更新状态与时间；撤销人见访问审计。 */
    public TenantScopeGrant revoke(Instant now) {
        return new TenantScopeGrant(id, tenantId, scopeCode, GrantStatus.REVOKED, grantedByTenantId, grantedByEmployeeNo,
                createdAt, now, revision + 1);
    }
}
