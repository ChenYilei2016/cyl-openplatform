package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** 权限组相关 API 的分页投影；包含标记来自 JSON 判断，可能为 NULL。 */
@Getter
@Setter
@NoArgsConstructor
public class ScopeApiDO {
    private String id;
    private String name;
    private String service;
    private String version;
    private String method;
    private String protocol;
    private Long draftRevision;
    private Long liveDraftRevision;
    private Boolean draftIncluded;
    private Boolean liveIncluded;
}
