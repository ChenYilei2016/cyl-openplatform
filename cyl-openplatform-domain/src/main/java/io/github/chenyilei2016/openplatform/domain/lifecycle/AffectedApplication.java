package io.github.chenyilei2016.openplatform.domain.lifecycle;

import io.github.chenyilei2016.openplatform.domain.access.ApplicationStatus;
import java.util.List;

/** 具有API权限组交集的应用，不代表已持有有效Token或曾经调用。 */
public record AffectedApplication(String applicationId, String name, String ownerTenantId,
                                  ApplicationStatus status, List<String> matchedScopeCodes,
                                  long activeTenantGrantCount) {
    public AffectedApplication { matchedScopeCodes = List.copyOf(matchedScopeCodes); }
}
