package io.github.chenyilei2016.openplatform.domain.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfile;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileQuery;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.*;
import java.util.List;

/** 一次有界传输或节点观测；发送结果未知必须与明确拒绝区分。 */
public interface EnvironmentReleaseClient {
    ConnectionDirectory connections(String targetId, int page, int pageSize, String query);
    PageResult<EmployeeProfile> owners(
            String targetId, EmployeeProfileQuery query);
    Preview preview(String targetId, ApiDefinition definition);
    DeliveryResult receive(String targetId, SendRequest request);
    List<NodeObservation> observe(String targetId, String transferId);
}
