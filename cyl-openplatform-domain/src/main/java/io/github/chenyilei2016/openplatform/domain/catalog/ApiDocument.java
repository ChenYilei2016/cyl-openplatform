package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiLifecycle;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import java.util.List;

/** 受控文档视图，不携带内部地址或发布状态。 */
public record ApiDocument(String id, long draftRevision, String title, String path, String httpMethod,
                           List<String> scopeCodes, SchemaNode requestSchema, SchemaNode responseSchema,
                           List<ApiDefinition.ErrorDefinition> errorDefinitions, Object requestExample, Object responseExample, ApiLifecycle lifecycle, String description, Boolean employeeRequired, @lombok.With String baseUrl, McpTool mcp) {
    public record McpTool(String name, String description) {}

    public static ApiDocument from(ApiDefinition api, String title) {
        return new ApiDocument(api.id(), api.draftRevision(), title,
                "/api/oauth/" + api.service() + "/" + api.version() + "/" + api.method(), "POST", api.scopeCodes(),
                api.requestSchema(), api.responseSchema(), publicErrors(api),
                api.requestSchema().generatedExample(), api.responseSchema().generatedExample(), api.lifecycle(), api.description(), api.employeeRequired(), null,
                api.mcpTool().enabled() && api.lifecycle().status() != ApiLifecycle.Status.RETIRED
                        ? new McpTool(api.toolName().value(), api.mcpTool().aiDescription() == null || api.mcpTool().aiDescription().isBlank() ? api.description() : api.mcpTool().aiDescription()) : null);
    }
    private static List<ApiDefinition.ErrorDefinition> publicErrors(ApiDefinition api) {
        if (api.responseAdapter().mode() == ResponseAdapter.Mode.DIRECT) return api.errorDefinitions();
        java.util.ArrayList<ApiDefinition.ErrorDefinition> errors = new java.util.ArrayList<>(api.errorDefinitions().stream()
                .filter(error -> !error.code().equals("50200002")).toList());
        errors.add(new ApiDefinition.ErrorDefinition("50200002", "提供方业务拒绝；HTTP 502，data为null"));
        return List.copyOf(errors);
    }

}
