package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.List;
import java.util.Optional;

public interface ApplicationRepository {
    PageResult<ApplicationListing> page(AccessPageQuery query, ApplicationFilter filter);
    Optional<ClientApplication> find(String id);
    Optional<ClientApplication> findByKey(String appKey);
    /** 每环境唯一的 MCP 网关凭据（由数据库唯一约束保证）。 */
    Optional<ClientApplication> findMcpGateway();
    ClientApplication lock(String id);
    String secretDigest(String id);
    void create(ClientApplication application, String secretDigest);
    void rename(String id, String name);
    void replaceScopes(String id, List<String> codes);
    void changeStatus(String id, ApplicationStatus status);
    void incrementScopeVersion(String code);
    void rotateSecret(String id, String secretDigest);
}
