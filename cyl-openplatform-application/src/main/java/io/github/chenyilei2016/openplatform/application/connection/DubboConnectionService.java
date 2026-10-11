package io.github.chenyilei2016.openplatform.application.connection;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.application.access.AccessAuditService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.connection.*;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository.RevisionKey;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository.RevisionSummary;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 连接写操作沿现有审计事务；激活仅更新可选指针，不宣称远程连接已成功。 */
@Service
@RequiredArgsConstructor
public class DubboConnectionService {
    private final DubboConnectionRepository repository;
    private final DubboConnectionConfigurationPolicy configuration;
    private final ReleaseEnvironment environment;
    private final AccessAuditService audit;
    private final DubboConnectionRuntime runtime;

    public record Detail(DubboConnection connection, DubboConnectionRevision draft, DubboConnectionRevision active) {}
    public record Configuration(String currentEnvironmentId, List<String> registryCredentialRefs,
                                List<String> metadataCredentialRefs) {}

    public Configuration configuration() {
        return new Configuration(environment.environmentId(), configuration.registryCredentialRefs(),
                configuration.metadataCredentialRefs());
    }

    public PageResult<DubboConnectionSummary> page(int page, int pageSize, String query, boolean selectableOnly) {
        validatePage(page, pageSize, query);
        PageResult<DubboConnectionSummary> result = repository.summaries(environment.environmentId(), page, pageSize, query == null ? "" : query, selectableOnly);
        Set<String> ids = result.items().stream().map(DubboConnectionSummary::id).collect(java.util.stream.Collectors.toSet());
        Map<String, DubboConnectionRuntime.DiagnosticResult> checks = runtime.recentChecks(ids);
        return new PageResult<>(result.items().stream().map(value -> value.withRegistryCheck(checks.get(value.id()))).toList(), result.total(), result.page(), result.pageSize());
    }

    /** API绑定只读摘要，不暴露地址/账号配置；最近检查只代表当前实例留存的事实。 */
    public DubboConnectionSummary summary(String id) {
        DubboConnection value = find(id);
        return new DubboConnectionSummary(value.id(), value.name(), value.environmentId(), value.description(),
                value.draftRevision(), value.activeRevision(), value.enabled(), value.stateVersion(), value.updatedAt(),
                null, null, null, runtime.recentChecks(Set.of(id)).get(id));
    }

    public DubboConnection find(String id) {
        return current(repository.find(id).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "服务连接不存在")));
    }

    public Detail detail(String id) {
        DubboConnection connection = find(id);
        Set<RevisionKey> keys = new HashSet<>();
        keys.add(new RevisionKey(id, connection.draftRevision()));
        if (connection.activeRevision() != null) keys.add(new RevisionKey(id, connection.activeRevision()));
        Map<RevisionKey, DubboConnectionRevision> revisions = repository.findRevisions(keys);
        DubboConnectionRevision draft = revisions.get(new RevisionKey(id, connection.draftRevision()));
        DubboConnectionRevision active = connection.activeRevision() == null ? null : revisions.get(new RevisionKey(id, connection.activeRevision()));
        if (draft == null || connection.activeRevision() != null && active == null)
            throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "连接修订缺失，请联系平台维护者");
        return new Detail(connection, draft, active);
    }

    public Detail create(String name, String description, DubboConnectionConfig config, AccessOperator operator) {
        String id = ObjectIdType.DUBBO_CONNECTION.nextId();
        audit.change("CREATE_DUBBO_CONNECTION", null, null, id, operator, () -> {
            validateInput(name, description, config);
            Instant now = Instant.now();
            repository.create(new DubboConnection(id, name.strip(), environment.environmentId(), description == null ? "" : description.strip(),
                    1, null, true, 1, now));
            repository.insertRevision(new DubboConnectionRevision(id, 1, config, now));
            return null;
        });
        return detail(id);
    }

    public Detail saveDraft(String id, long expectedStateVersion, String name, String description,
                            DubboConnectionConfig config, AccessOperator operator) {
        audit.change("SAVE_DUBBO_CONNECTION_DRAFT", null, null, id, operator, () -> {
            DubboConnection existing = lock(id, expectedStateVersion);
            validateInput(name, description, config);
            if (existing.draftRevision() == Long.MAX_VALUE) throw new PlatformException(ErrorCode.CONFLICT, "连接修订已达上限");
            Instant now = Instant.now();
            repository.insertRevision(new DubboConnectionRevision(id, existing.draftRevision() + 1, config, now));
            update(new DubboConnection(id, name.strip(), existing.environmentId(), description == null ? "" : description.strip(),
                    existing.draftRevision() + 1, existing.activeRevision(), existing.enabled(), existing.stateVersion() + 1, now), expectedStateVersion);
            return null;
        });
        return detail(id);
    }

    public Detail activate(String id, long expectedStateVersion, long revision, AccessOperator operator) {
        audit.change("ACTIVATE_DUBBO_CONNECTION", null, null, id, operator, () -> {
            DubboConnection existing = lock(id, expectedStateVersion);
            if (revision != existing.draftRevision()) throw new PlatformException(ErrorCode.CONFLICT, "只能激活当前草稿修订，请重新读取状态");
            DubboConnectionRevision candidate = repository.findRevision(id, revision)
                    .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "连接修订不存在"));
            configuration.validateConfiguration(candidate.config());
            update(new DubboConnection(id, existing.name(), existing.environmentId(), existing.description(), existing.draftRevision(),
                    revision, existing.enabled(), existing.stateVersion() + 1, Instant.now()), expectedStateVersion);
            return null;
        });
        return detail(id);
    }

    public Detail status(String id, long expectedStateVersion, boolean enabled, AccessOperator operator) {
        audit.change(enabled ? "ENABLE_DUBBO_CONNECTION" : "DISABLE_DUBBO_CONNECTION", null, null, id, operator, () -> {
            DubboConnection existing = lock(id, expectedStateVersion);
            update(new DubboConnection(id, existing.name(), existing.environmentId(), existing.description(), existing.draftRevision(),
                    existing.activeRevision(), enabled, existing.stateVersion() + 1, Instant.now()), expectedStateVersion);
            return null;
        });
        return detail(id);
    }

    public DubboConnectionRevision revision(String id, long revision) {
        find(id);
        if (revision < 1) throw new PlatformException(ErrorCode.INVALID_REQUEST, "连接修订必须为正整数");
        return repository.findRevision(id, revision).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "连接修订不存在"));
    }

    public PageResult<RevisionSummary> revisions(String id, int page, int pageSize) {
        find(id); validatePage(page, pageSize, null);
        return repository.revisions(id, page, pageSize);
    }

    public static void validatePage(int page, int pageSize, String query) {
        if (page < 1 || pageSize < 1 || pageSize > 100 || (long) (page - 1) * pageSize > 100_000
                || query != null && query.length() > 100)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "分页大小为1至100，偏移最多100000，查询最多100字符");
    }

    private DubboConnection current(DubboConnection connection) {
        if (!environment.environmentId().equals(connection.environmentId()))
            throw new PlatformException(ErrorCode.NOT_FOUND, "当前环境服务连接不存在");
        return connection;
    }

    private DubboConnection lock(String id, long expectedStateVersion) {
        DubboConnection connection = current(repository.lock(id).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "服务连接不存在")));
        if (expectedStateVersion < 1 || expectedStateVersion == Long.MAX_VALUE || connection.stateVersion() != expectedStateVersion)
            throw new PlatformException(ErrorCode.CONFLICT, "连接状态已变化，请重新读取后核对");
        return connection;
    }

    private void validateInput(String name, String description, DubboConnectionConfig config) {
        if (name == null || name.isBlank() || name.length() > 100 || description != null && description.length() > 2000 || config == null)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "连接名称必填且最多100字符，说明最多2000字符，配置必填");
        configuration.validateConfiguration(config);
    }

    private void update(DubboConnection connection, long expectedStateVersion) {
        if (!repository.update(connection, expectedStateVersion)) throw new PlatformException(ErrorCode.CONFLICT, "连接状态已变化，未覆盖原配置");
    }
}
