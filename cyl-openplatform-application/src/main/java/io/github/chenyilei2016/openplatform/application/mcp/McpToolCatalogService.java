package io.github.chenyilei2016.openplatform.application.mcp;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiOperationKind;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.mcp.McpJsonSchema;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolRepository;
import io.github.chenyilei2016.openplatform.domain.publication.EffectiveRelease;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class McpToolCatalogService {
    private final McpToolRepository tools;
    public record Tool(String name, String title, String description, Map<String, Object> inputSchema,
                       Map<String, Object> outputSchema, Map<String, Boolean> annotations) {}
    public record ToolRow(String apiId, String name, String title, String description, String operationKind,
                          List<String> scopeCodes, List<McpToolRepository.ToolSetRef> toolSets) {}
    public record CatalogPage(List<Tool> tools, String nextCursor) {}
    public record ManagementPage(List<ToolRow> rows, String nextCursor) {}
    private record SnapshotPage(List<ApiDefinition> apis, String nextCursor) {}

    public CatalogPage list(String toolSetId, String cursor) {
        SnapshotPage page = snapshots(toolSetId, cursor);
        return new CatalogPage(page.apis().stream().map(McpToolCatalogService::tool).toList(), page.nextCursor());
    }
    public ManagementPage managementList(String toolSetId, String cursor) {
        SnapshotPage page = snapshots(toolSetId, cursor);
        Map<String, List<McpToolRepository.ToolSetRef>> memberships = tools.toolSets(page.apis().stream().map(ApiDefinition::id).toList()).stream()
                .collect(java.util.stream.Collectors.groupingBy(McpToolRepository.ToolSetRef::apiId));
        return new ManagementPage(page.apis().stream().map(api -> new ToolRow(api.id(), api.toolName().value(), api.name(), description(api),
                api.operationKind().name(), api.scopeCodes(), memberships.getOrDefault(api.id(), List.of()))).toList(), page.nextCursor());
    }
    private SnapshotPage snapshots(String toolSetId, String cursor) {
        String after = decodeCursor(toolSetId, cursor);
        List<EffectiveRelease> found = tools.listAfter(toolSetId, after, 101);
        List<ApiDefinition> page = found.stream().limit(100).map(EffectiveRelease::snapshot).toList();
        String next = found.size() > 100 ? encodeCursor(toolSetId, page.getLast().id()) : null;
        return new SnapshotPage(page, next);
    }

    private static Tool tool(ApiDefinition api) {
        boolean query = api.operationKind() == ApiOperationKind.QUERY;
        return new Tool(api.toolName().value(), api.name(), description(api), McpJsonSchema.input(api.requestSchema()),
                McpJsonSchema.output(api.responseSchema()), Map.of("readOnlyHint", query, "destructiveHint", !query,
                        "idempotentHint", query || api.idempotencyField() != null));
    }
    private static String description(ApiDefinition api) {
        return api.mcpTool().aiDescription() == null ? api.description() : api.mcpTool().aiDescription();
    }
    private static String encodeCursor(String setId, String apiId) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(((setId == null ? "" : setId) + "\n" + apiId).getBytes(StandardCharsets.UTF_8));
    }
    private static String decodeCursor(String setId, String cursor) {
        if (cursor == null) return null;
        try {
            if (cursor.length() > 256) throw new IllegalArgumentException();
            String value = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
            String[] parts = value.split("\n", -1);
            if (parts.length != 2 || !parts[0].equals(setId == null ? "" : setId) || !ObjectIdType.API.accepts(parts[1]))
                throw new IllegalArgumentException();
            return parts[1];
        } catch (IllegalArgumentException invalid) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "工具目录游标无效，请从第一页重新读取");
        }
    }
}
