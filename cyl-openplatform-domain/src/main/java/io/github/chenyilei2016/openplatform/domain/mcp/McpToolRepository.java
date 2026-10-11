package io.github.chenyilei2016.openplatform.domain.mcp;

import io.github.chenyilei2016.openplatform.domain.publication.EffectiveRelease;
import java.util.List;
import java.util.Optional;

/** 从生效发布投影读取工具；过滤在数据库完成，返回同一次读取的固定快照。 */
public interface McpToolRepository {
    record ToolSetRef(String apiId, String code, String name, boolean enabled, long total) {}
    List<EffectiveRelease> listAfter(String toolSetId, String afterApiId, int limit);
    Optional<EffectiveRelease> find(String toolName, String toolSetId);
    List<String> availableApiIds(List<String> apiIds);
    java.util.Map<String, String> apiNames(List<String> apiIds);
    /** 每个API最多三个所属工具集预览及总数。 */
    List<ToolSetRef> toolSets(List<String> apiIds);
}
