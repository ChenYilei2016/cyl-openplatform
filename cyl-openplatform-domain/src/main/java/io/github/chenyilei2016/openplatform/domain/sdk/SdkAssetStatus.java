package io.github.chenyilei2016.openplatform.domain.sdk;

import io.github.chenyilei2016.openplatform.domain.common.*;

public enum SdkAssetStatus {
    DRAFT, PUBLISHED, WITHDRAWN;

    public void requireDraft() {
        if (this != DRAFT) throw new PlatformException(ErrorCode.CONFLICT, "只有草稿SDK资产可以修改或发布");
    }

    public void requireWithdrawable() {
        if (this == WITHDRAWN) throw new PlatformException(ErrorCode.CONFLICT, "SDK资产已撤下");
    }
}
