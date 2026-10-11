package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

/** 本租户备注版本与授权版本独立，展示修改不撤销调用资格。 */
public record TenantGrant(String id, String applicationId, String tenantId, GrantStatus status,
                          long authorizationVersion, String note, long noteRevision) {
    public TenantGrant withNote(String value, long expectedRevision) {
        status.requireActive();
        if (value == null) throw new PlatformException(ErrorCode.INVALID_REQUEST, "必须提供备注，空串表示清除");
        String normalized = value.strip();
        if (normalized.codePointCount(0, normalized.length()) > 100) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "本租户备注最多100个字符");
        }
        if (expectedRevision != noteRevision || noteRevision == Long.MAX_VALUE) {
            throw new PlatformException(ErrorCode.CONFLICT, "备注已被修改，请核对最新备注后重新保存");
        }
        return new TenantGrant(id, applicationId, tenantId, status, authorizationVersion, normalized, noteRevision + 1);
    }
}
