package io.github.chenyilei2016.openplatform.application.catalog;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiOperation;
import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolName;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 打开MCP的API，其完整工具名不得与其他操作规范化后的工具名相同（包括下划线拼接产生的歧义）。
 * 保存、导入、跨环境接收与发布共用；按一批查询已有版本，同批候选之间也互相比较。
 */
@Component
@RequiredArgsConstructor
public class McpToolNamePolicy {
    private final ApiCatalogRepository catalog;

    /** 返回打开MCP且工具名冲突的候选及说明；未打开或无法生成工具名的候选由领域校验报告。 */
    public Map<ApiOperation, String> conflicts(Collection<ApiDefinition> definitions) {
        Map<ApiOperation, McpToolName> tools = new HashMap<>();
        for (ApiDefinition definition : definitions) {
            if (!definition.mcpTool().enabled()) continue;
            try { tools.put(ApiOperation.of(definition), definition.toolName()); }
            catch (PlatformException invalid) { /* 工具名不可生成，已由ApiDefinition.validate定位。 */ }
        }
        if (tools.isEmpty()) return Map.of();
        Set<ApiOperation> known = new LinkedHashSet<>(catalog.findToolNameOperations(tools.values().stream().map(McpToolName::value).distinct().toList()));
        definitions.forEach(definition -> known.add(ApiOperation.of(definition)));
        Map<ApiOperation, String> result = new HashMap<>();
        tools.forEach((self, name) -> known.stream()
                .filter(other -> !other.equals(self))
                .filter(other -> sameToolName(other, name)).findFirst()
                .ifPresent(other -> result.put(self, "操作「" + other.service() + "/" + other.version() + "/" + other.method() + "」生成相同的MCP工具名"
                        + name.value() + "，不能开放为MCP工具")));
        return result;
    }

    public void require(ApiDefinition definition) {
        String conflict = conflicts(List.of(definition)).get(ApiOperation.of(definition));
        if (conflict != null) throw FieldValidation.invalid("/mcpTool/enabled", FieldValidation.Reason.INVALID_VALUE, conflict);
    }

    private static boolean sameToolName(ApiOperation other, McpToolName name) {
        try { return McpToolName.of(other.service(), other.method(), other.version()).equals(name); }
        catch (PlatformException invalid) { return false; } // 无法生成工具名的版本不会占用该名称。
    }
}
