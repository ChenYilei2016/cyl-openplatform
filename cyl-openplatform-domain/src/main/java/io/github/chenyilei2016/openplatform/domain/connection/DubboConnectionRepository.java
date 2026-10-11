package io.github.chenyilei2016.openplatform.domain.connection;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

public interface DubboConnectionRepository {
    record RevisionKey(String connectionId, long revision) {}
    record RevisionSummary(String connectionId, long revision, Instant createdAt) {}
    Optional<DubboConnection> find(String id);
    Optional<DubboConnection> lock(String id);
    Map<String, DubboConnection> findAll(Set<String> ids);
    Optional<DubboConnectionRevision> findRevision(String id, long revision);
    Map<RevisionKey, DubboConnectionRevision> findRevisions(Set<RevisionKey> keys);
    PageResult<DubboConnectionSummary> summaries(String environmentId, int page, int pageSize, String query, boolean selectableOnly);
    PageResult<DubboConnection> page(String environmentId, int page, int pageSize, String query, boolean selectableOnly);
    PageResult<RevisionSummary> revisions(String id, int page, int pageSize);
    List<DubboConnection> enabledConnections(String environmentId, int limit);
    void create(DubboConnection connection);
    void insertRevision(DubboConnectionRevision revision);
    boolean update(DubboConnection connection, long expectedStateVersion);
}
