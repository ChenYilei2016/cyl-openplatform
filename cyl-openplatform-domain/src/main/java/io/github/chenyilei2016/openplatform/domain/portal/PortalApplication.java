package io.github.chenyilei2016.openplatform.domain.portal;

import io.github.chenyilei2016.openplatform.domain.access.ApplicationStatus;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import java.util.List;

/** 当前租户的应用关联投影；不携带密钥、应用归属及其他租户信息；权限组只读展示代码、名称与启停。 */
public record PortalApplication(String id, String applicationId, String appKey, String name,
                                ApplicationStatus applicationStatus, GrantStatus status, long authorizationVersion,
                                String note, long noteRevision, String globalName, List<ScopeSummary> scopes) {
    /** 凭据已配置的权限组展示信息；是否能调用还取决于凭据、租户关系和接口授权。 */
    public record ScopeSummary(String code, String name, boolean enabled) {}

    public PortalApplication {
        scopes = List.copyOf(scopes);
        globalName = globalName != null && !globalName.isBlank() ? globalName : name;
        name = note != null && !note.isBlank() ? note : globalName != null && !globalName.isBlank() ? globalName
                : "AK · " + appKey.substring(0, Math.min(8, appKey.length()));
    }
}
