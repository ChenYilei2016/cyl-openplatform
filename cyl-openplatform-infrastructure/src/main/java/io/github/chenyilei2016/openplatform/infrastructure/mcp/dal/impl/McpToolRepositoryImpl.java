package io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolRepository;
import io.github.chenyilei2016.openplatform.domain.publication.EffectiveRelease;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.ApiDefinitionJson;
import io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.mapper.McpToolMapper;
import io.github.chenyilei2016.openplatform.infrastructure.publication.dal.dataobject.PublicationReleaseDO;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class McpToolRepositoryImpl implements McpToolRepository {
    private final ReleaseEnvironment environment;
    private final McpToolMapper mapper;
    private final ApiDefinitionJson json;

    @Override public List<EffectiveRelease> listAfter(String toolSetId, String afterApiId, int limit) {
        if (limit < 1 || limit > 101) throw new IllegalArgumentException("工具目录单次最多读取101项");
        return mapper.listAfter(environment.environmentId(), toolSetId, afterApiId, limit).stream().map(this::effective).toList();
    }

    @Override public Optional<EffectiveRelease> find(String toolName, String toolSetId) {
        List<PublicationReleaseDO> found = mapper.find(environment.environmentId(), toolName, toolSetId);
        if (found.size() > 1) throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "工具名称冲突，请联系平台管理员");
        return found.stream().findFirst().map(this::effective);
    }

    @Override public List<String> availableApiIds(List<String> apiIds) {
        if (apiIds.isEmpty()) return List.of();
        if (apiIds.size() > 200) throw new IllegalArgumentException("单次最多核对200个工具");
        return mapper.availableApiIds(environment.environmentId(), apiIds);
    }

    private EffectiveRelease effective(PublicationReleaseDO row) {
        return new EffectiveRelease(row.getApiId(), row.getId(), row.getEffectiveStateVersion(), row.getEffectiveEnabled(),
                row.getReviewedAt() == null ? row.getSubmittedAt() : row.getReviewedAt(), json.decode(row.getSnapshotJson()));
    }
    @Override public java.util.Map<String, String> apiNames(List<String> apiIds) {
        if (apiIds.isEmpty()) return java.util.Map.of();
        if (apiIds.size() > 200) throw new IllegalArgumentException("单次最多读取200个工具名称");
        return mapper.apiNames(environment.environmentId(), apiIds).stream().collect(java.util.stream.Collectors.toMap(
                io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiDraftDO::getId,
                io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiDraftDO::getName));
    }
    @Override public List<ToolSetRef> toolSets(List<String> apiIds) {
        if (apiIds.isEmpty()) return List.of();
        if (apiIds.size() > 100) throw new IllegalArgumentException("工具集预览每次最多100个API");
        return mapper.toolSets(environment.environmentId(), apiIds);
    }
}
