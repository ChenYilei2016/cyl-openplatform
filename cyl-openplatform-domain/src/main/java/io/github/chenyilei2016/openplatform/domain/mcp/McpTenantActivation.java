package io.github.chenyilei2016.openplatform.domain.mcp;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

/**
 * 租户 MCP 开通（MCP_KEY）：每租户一条，表示“该租户已开通 MCP”，不含签名密钥。
 * keyCode 只是展示编号；平台管理员停用后租户不能自行重新启用，需由平台管理员启用。
 */
public record McpTenantActivation(String id, String tenantId, String keyCode, McpActivationStatus status,
                                  boolean disabledByPlatform, String activatedByEmployeeNo,
                                  Instant createdAt, Instant updatedAt, long revision) {

    public static McpTenantActivation open(String tenantId, String employeeNo, Instant now) {
        String code = "MCP_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16).toUpperCase(Locale.ROOT);
        return new McpTenantActivation(ObjectIdType.MCP_TENANT_ACTIVATION.nextId(), tenantId, code,
                McpActivationStatus.ENABLED, false, employeeNo, now, now, 0);
    }

    public boolean active() {
        return status == McpActivationStatus.ENABLED;
    }

    /** 租户自助停用/启用；状态未变化时返回自身。 */
    public McpTenantActivation changedByTenant(boolean enabled, Instant now) {
        McpActivationStatus target = enabled ? McpActivationStatus.ENABLED : McpActivationStatus.DISABLED;
        if (target == status) return this;
        if (enabled && disabledByPlatform)
            throw new PlatformException(ErrorCode.CONFLICT, "MCP 已被平台管理员停用，请联系平台管理员启用");
        return withStatus(target, false, now);
    }

    /** 平台管理员停用锁定为“平台停用”，租户不能自行恢复；平台启用同时解除锁定。状态未变化时返回自身。 */
    public McpTenantActivation changedByPlatform(boolean enabled, Instant now) {
        McpActivationStatus target = enabled ? McpActivationStatus.ENABLED : McpActivationStatus.DISABLED;
        if (target == status && (enabled || disabledByPlatform)) return this;
        return withStatus(target, !enabled, now);
    }

    private McpTenantActivation withStatus(McpActivationStatus target, boolean byPlatform, Instant now) {
        return new McpTenantActivation(id, tenantId, keyCode, target, byPlatform, activatedByEmployeeNo,
                createdAt, now, revision + 1);
    }
}
