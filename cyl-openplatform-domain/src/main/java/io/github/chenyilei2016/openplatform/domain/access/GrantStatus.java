package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

public enum GrantStatus {
    ACTIVE, REVOKED;

    public void requireActive() {
        if (this != ACTIVE) throw new PlatformException(ErrorCode.CONFLICT, "租户关联已撤销");
    }
}
