package io.github.chenyilei2016.openplatform.application.catalog;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinitionContent;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

/** 已完成结构及引用校验后的保存决策；所有写入口必须先检查预期修订，再比较内容。 */
public record ApiDraftSaveResult(ApiDefinition definition, boolean changed) {
    public static ApiDraftSaveResult prepare(ApiDefinition existing, ApiDefinition candidate, long expectedRevision) {
        if ((existing == null ? 0 : existing.draftRevision()) != expectedRevision) {
            throw new PlatformException(ErrorCode.CONFLICT, "草稿已被修改，请重新加载后保存");
        }
        if (existing != null && ApiDefinitionContent.changedFields(existing, candidate).isEmpty()) {
            return new ApiDraftSaveResult(existing, false);
        }
        return new ApiDraftSaveResult(candidate, true);
    }
}
