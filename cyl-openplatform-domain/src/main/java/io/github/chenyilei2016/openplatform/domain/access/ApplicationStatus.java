package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

public enum ApplicationStatus {
    ENABLED, DISABLED;

    public void requireEnabled() {
        if (this != ENABLED) throw new PlatformException(ErrorCode.CONFLICT, "应用已停用");
    }
}
