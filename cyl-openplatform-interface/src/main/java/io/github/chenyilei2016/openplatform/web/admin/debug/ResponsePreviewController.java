package io.github.chenyilei2016.openplatform.web.admin.debug;

import io.github.chenyilei2016.openplatform.web.shared.observability.DiagnosticContent;

import io.github.chenyilei2016.openplatform.application.catalog.ApiCatalogService;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.github.chenyilei2016.openplatform.application.runtime.ProviderResponseService;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.catalog.ResponseAdapter;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.runtime.ResponseAdaptation;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import io.github.chenyilei2016.openplatform.web.admin.catalog.ApiDraftRequestReader;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
public class ResponsePreviewController {
    private final ApiCatalogService catalog;
    private final ApiDraftRequestReader bodies;
    private final ProviderResponseService responses;
    private final DiagnosticContent content;
    private final PreparationLimiter preparations;
    public record Request(ResponseAdapter responseAdapter, @NotNull SchemaNode responseSchema, @JsonProperty(required = true) Object sample) {}
    public record Preview(boolean succeeded, DiagnosticContent.Content providerResponse,
                          DiagnosticContent.Content adaptedData, DiagnosticContent.Content publicResponse,
                          ResponseAdaptation.Issue issue, List<ResponseAdaptation.Issue> warnings,
                          DiagnosticContent.Message providerMessage) {}

    /** 离线预览返回规则：仅需管理会话，不调用提供方、不使用业务Token、不修改草稿；sample支持任意JSON值。 */
    @PostMapping(value = {"/admin-api/apis/{id}/response-preview", "/admin-api/apis/response-preview"}, consumes = "application/json")
    public ApiResponse<Preview> preview(@PathVariable(required = false) @Size(max = 36) String id,
                                        HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("Cache-Control", "no-store");
        try (PreparationLimiter.Permit ignored = preparations.acquire()) {
            if (id != null) catalog.find(id);
            Request body = bodies.read(request, Request.class);
            body.responseSchema().validate(false);
            ResponseAdaptation.Result result = responses.adapt(body.responseAdapter(), body.responseSchema(), body.sample());
            Map<String, Object> publicResponse = new LinkedHashMap<>();
            int code = result.succeeded() ? 200 : result.issue().reason().errorCode().getCode();
            publicResponse.put("code", code);
            publicResponse.put("resultMsg", result.succeeded() ? "成功" : result.issue().reason().publicMessage());
            publicResponse.put("data", result.publicData());
            publicResponse.put("requestId", MDC.get("requestId"));
            return ApiResponse.success(new Preview(result.succeeded(), content.view(body.sample()), result.succeeded() || result.issue().stage() == ResponseAdaptation.Stage.SCHEMA
                            ? content.view(result.adaptedData()) : DiagnosticContent.Content.unavailable("未提取业务数据"),
                    content.view(publicResponse), result.issue(), result.warnings().stream().limit(100).toList(), content.message(result.providerMessage())));
        }
    }
}
