package io.github.chenyilei2016.openplatform.infrastructure.connection.dal.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.connection.*;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import io.github.chenyilei2016.openplatform.infrastructure.connection.dal.dataobject.*;
import io.github.chenyilei2016.openplatform.infrastructure.connection.dal.mapper.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

@Repository
@RequiredArgsConstructor
public class DubboConnectionRepositoryImpl implements DubboConnectionRepository {
    private final DubboConnectionMapper connections;
    private final DubboConnectionRevisionMapper revisions;
    private final JsonMapper json;

    @Override public Optional<DubboConnection> find(String id) {
        return Optional.ofNullable(connections.selectById(id)).map(DubboConnectionRepositoryImpl::connection);
    }

    @Override public Optional<DubboConnection> lock(String id) {
        return Optional.ofNullable(connections.selectForUpdate(id)).map(DubboConnectionRepositoryImpl::connection);
    }

    @Override public Map<String, DubboConnection> findAll(Set<String> ids) {
        if (ids.isEmpty()) return Map.of();
        if (ids.size() > 100) throw new PlatformException(ErrorCode.INVALID_REQUEST, "单批连接查询最多100项");
        return connections.selectByIds(ids).stream().map(DubboConnectionRepositoryImpl::connection)
                .collect(Collectors.toMap(DubboConnection::id, value -> value));
    }

    @Override public Optional<DubboConnectionRevision> findRevision(String id, long revision) {
        return Optional.ofNullable(revisions.selectById(id + ":" + revision)).map(this::revision);
    }

    @Override public Map<RevisionKey, DubboConnectionRevision> findRevisions(Set<RevisionKey> keys) {
        if (keys.isEmpty()) return Map.of();
        if (keys.size() > 100) throw new PlatformException(ErrorCode.INVALID_REQUEST, "单批连接修订查询最多100项");
        List<String> ids = keys.stream().map(key -> key.connectionId() + ":" + key.revision()).toList();
        return revisions.selectByIds(ids).stream().map(this::revision)
                .collect(Collectors.toMap(value -> new RevisionKey(value.connectionId(), value.revision()), value -> value));
    }

    @Override public PageResult<DubboConnectionSummary> summaries(String environmentId, int page, int pageSize, String query, boolean selectableOnly) {
        com.baomidou.mybatisplus.core.metadata.IPage<DubboConnectionSummaryDO> result = connections.selectSummaries(
                new Page<>(page, pageSize), environmentId, SqlPatterns.contains(query), selectableOnly);
        return new PageResult<>(result.getRecords().stream().map(row -> new DubboConnectionSummary(row.getId(), row.getName(),
                row.getEnvironmentId(), row.getDescription(), row.getDraftRevision(), row.getActiveRevision(), row.getEnabled(),
                row.getStateVersion(), row.getUpdatedAt(), row.getMetadataType() == null ? null : DubboConnectionConfig.MetadataType.valueOf(row.getMetadataType()),
                row.getDiscoveryMode() == null ? null : DubboConnectionConfig.DiscoveryMode.valueOf(row.getDiscoveryMode()),
                row.getProviderMetadataMode() == null ? null : DubboConnectionConfig.ProviderMetadataMode.valueOf(row.getProviderMetadataMode()), null)).toList(),
                result.getTotal(), page, pageSize);
    }

    @Override public PageResult<DubboConnection> page(String environmentId, int page, int pageSize, String query, boolean selectableOnly) {
        LambdaQueryWrapper<DubboConnectionDO> filter = Wrappers.<DubboConnectionDO>lambdaQuery()
                .eq(DubboConnectionDO::getEnvironmentId, environmentId)
                .apply("name LIKE {0} ESCAPE '!'", SqlPatterns.contains(query))
                .orderByDesc(DubboConnectionDO::getUpdatedAt, DubboConnectionDO::getId);
        if (selectableOnly) filter.eq(DubboConnectionDO::getEnabled, true).isNotNull(DubboConnectionDO::getActiveRevision);
        Page<DubboConnectionDO> result = connections.selectPage(new Page<>(page, pageSize), filter);
        return new PageResult<>(result.getRecords().stream().map(DubboConnectionRepositoryImpl::connection).toList(),
                result.getTotal(), page, pageSize);
    }

    @Override public PageResult<RevisionSummary> revisions(String id, int page, int pageSize) {
        Page<DubboConnectionRevisionDO> result = revisions.selectPage(new Page<>(page, pageSize),
                Wrappers.<DubboConnectionRevisionDO>lambdaQuery()
                        .select(DubboConnectionRevisionDO::getConnectionId, DubboConnectionRevisionDO::getRevision, DubboConnectionRevisionDO::getCreatedAt)
                        .eq(DubboConnectionRevisionDO::getConnectionId, id).orderByDesc(DubboConnectionRevisionDO::getRevision));
        return new PageResult<>(result.getRecords().stream().map(value -> new RevisionSummary(value.getConnectionId(),
                value.getRevision(), value.getCreatedAt())).toList(), result.getTotal(), page, pageSize);
    }

    @Override public List<DubboConnection> enabledConnections(String environmentId, int limit) {
        if (limit < 1 || limit > 101) throw new PlatformException(ErrorCode.INVALID_REQUEST, "连接装载查询上限必须为1至101");
        return connections.selectList(Wrappers.<DubboConnectionDO>lambdaQuery()
                        .eq(DubboConnectionDO::getEnvironmentId, environmentId).eq(DubboConnectionDO::getEnabled, true)
                        .isNotNull(DubboConnectionDO::getActiveRevision).orderByAsc(DubboConnectionDO::getId).last("LIMIT " + limit))
                .stream().map(DubboConnectionRepositoryImpl::connection).toList();
    }

    @Override public void create(DubboConnection connection) {
        DubboConnectionDO row = new DubboConnectionDO();
        row.setId(connection.id()); row.setName(connection.name()); row.setEnvironmentId(connection.environmentId());
        row.setDescription(connection.description()); row.setDraftRevision(connection.draftRevision());
        row.setActiveRevision(connection.activeRevision()); row.setEnabled(connection.enabled());
        row.setStateVersion(connection.stateVersion()); row.setUpdatedAt(connection.updatedAt());
        connections.insert(row);
    }

    @Override public void insertRevision(DubboConnectionRevision revision) {
        String configJson = json.writeValueAsString(revision.config());
        if (configJson.getBytes(StandardCharsets.UTF_8).length > 262_144)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "连接配置超过256KiB");
        DubboConnectionRevisionDO row = new DubboConnectionRevisionDO();
        row.setId(revision.connectionId() + ":" + revision.revision());
        row.setConnectionId(revision.connectionId()); row.setRevision(revision.revision());
        row.setConfigJson(configJson); row.setCreatedAt(revision.createdAt());
        row.setMetadataType(revision.config().metadata().type().name());
        row.setDiscoveryMode(revision.config().discoveryMode().name());
        row.setProviderMetadataMode(revision.config().providerMetadataMode().name());
        revisions.insert(row);
    }

    @Override public boolean update(DubboConnection connection, long expectedStateVersion) {
        return connections.update(null, Wrappers.<DubboConnectionDO>lambdaUpdate()
                .eq(DubboConnectionDO::getId, connection.id()).eq(DubboConnectionDO::getStateVersion, expectedStateVersion)
                .set(DubboConnectionDO::getName, connection.name()).set(DubboConnectionDO::getDescription, connection.description())
                .set(DubboConnectionDO::getDraftRevision, connection.draftRevision()).set(DubboConnectionDO::getActiveRevision, connection.activeRevision())
                .set(DubboConnectionDO::getEnabled, connection.enabled()).set(DubboConnectionDO::getStateVersion, connection.stateVersion())
                .set(DubboConnectionDO::getUpdatedAt, connection.updatedAt())) == 1;
    }

    private static DubboConnection connection(DubboConnectionDO row) {
        return new DubboConnection(row.getId(), row.getName(), row.getEnvironmentId(), row.getDescription(),
                row.getDraftRevision(), row.getActiveRevision(), row.getEnabled(), row.getStateVersion(), row.getUpdatedAt());
    }

    private DubboConnectionConfig readConfig(String value) {
        // 已保存修订不回填；仅丢弃撤销的许可清单，注册中心及固定修订身份保持原样。
        tools.jackson.databind.node.ObjectNode config = (tools.jackson.databind.node.ObjectNode) json.readTree(value);
        config.remove("allowedServices");
        return json.treeToValue(config, DubboConnectionConfig.class);
    }

    private DubboConnectionRevision revision(DubboConnectionRevisionDO row) {
        return new DubboConnectionRevision(row.getConnectionId(), row.getRevision(),
                readConfig(row.getConfigJson()), row.getCreatedAt());
    }
}
