package io.github.chenyilei2016.openplatform.web.admin.importing;

import io.github.chenyilei2016.openplatform.application.importing.ApiImportService;
import io.github.chenyilei2016.openplatform.application.importing.ImportModels.*;
import io.github.chenyilei2016.openplatform.application.importing.ImportRejected;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import io.github.chenyilei2016.openplatform.web.shared.common.JsonRequestReader;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** 管理员先预览完整契约差异，再明确确认选中集；写入仅变更草稿。 */
@RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
@RestController
@RequestMapping("/admin-api/api-imports")
@RequiredArgsConstructor
public class ApiImportController {
    private static final int MAX_REQUEST_BYTES = 262_144;
    private final JsonRequestReader requests;
    private final ImportDocumentReader documents;
    private final ApiImportService imports;
    private final io.github.chenyilei2016.openplatform.application.catalog.ApiCatalogService catalog;
    private final io.github.chenyilei2016.openplatform.application.importing.ApiSourceParser sources;

    @PostMapping(value = "/preview", consumes = "application/json")
    public ApiResponse<Preview> preview(HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(imports.preview(documents.parse(requests.readObject(request, MAX_REQUEST_BYTES))));
    }

    @PostMapping(value = "/confirm", consumes = "application/json")
    public ApiResponse<Confirmation> confirm(HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("Cache-Control", "no-store");
        AccessOperator operator = operator(request);
        Map<String, Object> body = requests.readObject(request, MAX_REQUEST_BYTES);
        boolean withReceipt = body.containsKey("submissionKey");
        if (!(body.keySet().equals(Set.of("document", "documentDigest", "selections"))
                || body.keySet().equals(Set.of("document", "documentDigest", "selections", "submissionKey", "sourceKind", "sourceDigest")))
                || !(body.get("document") instanceof Map<?, ?>)
                || !(body.get("documentDigest") instanceof String digest) || !digest.matches("[0-9a-f]{64}")
                || !(body.get("selections") instanceof List<?> selected) || selected.isEmpty() || selected.size() > 20) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "确认请求必须包含原始document、预览摘要及1至20项selections");
        }
        @SuppressWarnings("unchecked")
        ParsedDocument document = documents.parse((Map<String, Object>) body.get("document"));
        List<Selection> selections = new ArrayList<>();
        Set<Integer> indices = new HashSet<>();
        for (Object entry : selected) {
            if (!(entry instanceof Map<?, ?> fields) || !fields.keySet().equals(Set.of("index", "expectedRevision"))) {
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "每个选择必须只包含index与expectedRevision");
            }
            long index = integer(fields.get("index"));
            long revision = integer(fields.get("expectedRevision"));
            if (index >= document.items().size() || !indices.add((int) index)) {
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "选择索引超出范围或重复");
            }
            selections.add(new Selection((int) index, revision));
        }
        if (!document.digest().equals(digest)) {
            throw new ImportRejected(ErrorCode.CONFLICT, selections.stream().map(selection -> new ItemResult(
                    selection.index(), Change.ERROR, null, null, List.of("来源内容已变化，请重新预览后确认"))).toList());
        }
        if (withReceipt) {
            if (!(body.get("submissionKey") instanceof String key) || !(body.get("sourceKind") instanceof String kind)
                    || !(body.get("sourceDigest") instanceof String sourceDigest))
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "提交标识与来源信息必须为字符串");
            return ApiResponse.success(imports.submit(document, List.copyOf(selections), operator, key, kind, sourceDigest));
        }
        return ApiResponse.success(imports.confirm(document, List.copyOf(selections), operator));
    }

    @GetMapping("/exports/{apiId}")
    public ApiResponse<Map<String, Object>> export(@PathVariable String apiId, @RequestParam long revision,
                                                  HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition source = catalog.exportConfiguration(apiId, revision);
        Map<String, Object> config = new java.util.LinkedHashMap<>();
        config.put("service", source.service()); config.put("version", source.version()); config.put("method", source.method());
        config.put("name", source.name()); config.put("category", source.category()); config.put("owner", source.owner());
        config.put("employeeRequired", source.employeeRequired());
        config.put("responseAdapter", source.responseAdapter());
        config.put("operationKind", source.operationKind());
        config.put("idempotencyField", source.idempotencyField());
        config.put("mcpTool", source.mcpTool());
        config.put("description", source.description()); config.put("scopeCodes", source.scopeCodes());
        config.put("requestSchema", source.requestSchema()); config.put("responseSchema", source.responseSchema());
        config.put("errorDefinitions", source.errorDefinitions()); config.put("binding", source.binding());
        config.put("mappings", source.mappings()); config.put("lifecycle", source.lifecycle());
        return ApiResponse.success(Map.of("format", "cyl-openplatform.catalog/v1", "apis", List.of(config)));
    }

    @GetMapping("/requests/{key}")
    public ApiResponse<Confirmation> result(@PathVariable String key, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(imports.result(key, operator(request)));
    }

    /** 修订来源只返回类型与摘要，旧修订没有关联时明确未知，不扫描回执原文推断。 */
    @GetMapping("/provenance/{apiId}")
    public ApiResponse<io.github.chenyilei2016.openplatform.application.importing.ApiImportReceiptRepository.SourceInfo> provenance(
            @PathVariable String apiId, @RequestParam long revision, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(imports.provenance(apiId, revision));
    }

    @PostMapping(value = "/sources/openapi", consumes = "application/json")
    public ApiResponse<io.github.chenyilei2016.openplatform.application.importing.ApiSourceParser.Result> source(
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("Cache-Control", "no-store");
        // 从有界原始字节解析，保留来源摘要和精确数值；不打开任何来源URL。
        byte[] input = request.getInputStream().readNBytes(MAX_REQUEST_BYTES + 1);
        if (input.length > MAX_REQUEST_BYTES) throw new PlatformException(ErrorCode.INVALID_REQUEST, "来源超过256KiB");
        return ApiResponse.success(sources.parse(new String(input, java.nio.charset.StandardCharsets.UTF_8)));
    }

    @ExceptionHandler(ImportRejected.class)
    public ResponseEntity<ApiResponse<Confirmation>> rejected(ImportRejected exception) {
        return ResponseEntity.status(exception.getErrorCode() == ErrorCode.CONFLICT ? 409 : 400)
                .header("Cache-Control", "no-store")
                .body(new ApiResponse<>(exception.getErrorCode().getCode(), exception.getMessage(),
                        new Confirmation(false, exception.items()), MDC.get("requestId")));
    }

    private long integer(Object value) {
        if (!(value instanceof Integer || value instanceof Long || value instanceof BigInteger)) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "索引和预期修订必须为非负JSON整数");
        }
        BigInteger integer = new BigInteger(value.toString());
        if (integer.signum() < 0 || integer.compareTo(BigInteger.valueOf(Long.MAX_VALUE)) >= 0) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "索引和预期修订超出允许范围");
        }
        return integer.longValue();
    }

    private AccessOperator operator(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
