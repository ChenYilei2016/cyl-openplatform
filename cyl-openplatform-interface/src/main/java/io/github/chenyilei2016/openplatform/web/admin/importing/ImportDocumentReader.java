package io.github.chenyilei2016.openplatform.web.admin.importing;

import io.github.chenyilei2016.openplatform.application.importing.ImportModels.ParsedDocument;
import io.github.chenyilei2016.openplatform.application.importing.ImportModels.SourceItem;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiOperation;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.web.admin.catalog.ApiCatalogController.SaveApiRequest;
import jakarta.validation.Validator;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** 将提供方原生契约转换为逐项结果；不访问来源URL，也不信任数据库元数据。 */
@Component
@RequiredArgsConstructor
public class ImportDocumentReader {
    private static final Set<String> SOURCE_FIELDS = Set.of("service", "version", "method", "name", "category", "owner",
            "scopeCodes", "requestSchema", "responseSchema", "errorDefinitions", "binding", "mappings", "lifecycle", "description", "employeeRequired", "responseAdapter",
            "operationKind", "idempotencyField", "mcpTool");
    private final JsonMapper json;
    private final io.github.chenyilei2016.openplatform.web.admin.catalog.ApiDraftRequestReader drafts;
    private final Validator validator;

    public ParsedDocument parse(Map<String, Object> document) {
        List<?> sources;
        if (document.containsKey("format") || document.containsKey("apis")) {
            if (!document.keySet().equals(Set.of("format", "apis"))
                    || !"cyl-openplatform.catalog/v1".equals(document.get("format"))
                    || !(document.get("apis") instanceof List<?> entries) || entries.isEmpty() || entries.size() > 20) {
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "导入包必须使用cyl-openplatform.catalog/v1且包含1至20项apis");
            }
            sources = (List<?>) document.get("apis");
        } else sources = List.of(document);

        List<SourceItem> items = new ArrayList<>();
        Map<ApiOperation, List<Integer>> operations = new HashMap<>();
        for (int index = 0; index < sources.size(); index++) {
            Object source = sources.get(index);
            ApiOperation operation = null;
            if (source instanceof Map<?, ?> fields
                    && fields.get("service") instanceof String service && service.matches("[a-z][a-z0-9_]{0,63}")
                    && fields.get("version") instanceof String version && version.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}")
                    && fields.get("method") instanceof String method && method.matches("[a-z][a-z0-9_]{0,63}")) {
                operation = new ApiOperation(service, version, method);
                operations.computeIfAbsent(operation, ignored -> new ArrayList<>()).add(index);
            }
            if (!(source instanceof Map<?, ?> fields)) {
                items.add(new SourceItem(index, operation, null, List.of("本项必须是 JSON 对象（{...}），不能是文本、数组或空值。请通过「修正此项」填写完整契约。")));
                continue;
            }
            List<String> unsupported = unsupportedFields(fields);
            if (!unsupported.isEmpty()) {
                items.add(new SourceItem(index, operation, null, unsupported));
                continue;
            }
            try {
                SaveApiRequest request = drafts.readerFor(SaveApiRequest.class).readValue(json.writeValueAsBytes(source));
                if (!validator.validate(request).isEmpty()) {
                    items.add(new SourceItem(index, operation, null, List.of("契约必填字段缺失、列表包含空值或超出条数限制")));
                    continue;
                }
                var definition = request.definition(null, 0);
                definition.validate();
                items.add(new SourceItem(index, operation, definition, List.of()));
            } catch (PlatformException exception) {
                items.add(new SourceItem(index, operation, null, List.of(exception.getMessage())));
            } catch (tools.jackson.core.JacksonException invalid) {
                String field = invalid.getPath().stream().map(tools.jackson.core.JacksonException.Reference::getPropertyName)
                        .filter(java.util.Objects::nonNull).filter(SOURCE_FIELDS::contains).findFirst().orElse(null);
                items.add(new SourceItem(index, operation, null, List.of(field == null
                        ? "契约字段类型或结构不合法，请通过「修正此项」检查平台契约 JSON。"
                        : "字段 " + field + " 的类型或结构不合法，请通过「修正此项」按平台契约模板修改。")));
            } catch (IllegalArgumentException | NullPointerException exception) {
                // Jackson错误可包含原始值及字段路径；只向调用方返回不含源数据的说明。
                items.add(new SourceItem(index, operation, null, List.of("契约字段类型或结构不合法，请使用平台契约JSON模板")));
            }
        }
        operations.values().stream().filter(indices -> indices.size() > 1).forEach(indices -> indices.forEach(index -> {
            SourceItem item = items.get(index);
            List<String> errors = new ArrayList<>(item.errors());
            errors.add("同批次操作标识重复，请保留唯一契约");
            items.set(index, new SourceItem(index, item.operation(), item.definition(), List.copyOf(errors)));
        }));
        try {
            String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(document)));
            return new ParsedDocument(digest, List.copyOf(items));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("JDK不支持SHA-256", exception);
        }
    }

    private static List<String> unsupportedFields(Map<?, ?> fields) {
        List<?> unsupported = fields.keySet().stream().filter(key -> !SOURCE_FIELDS.contains(key)).toList();
        List<String> errors = new ArrayList<>();
        for (Object key : unsupported.stream().limit(20).toList()) {
            // 仅显示正常字段名，永不回显字段值或异常键中的任意源文本。
            String name = key instanceof String text && text.matches("[A-Za-z_][A-Za-z0-9_.-]{0,63}") ? text : null;
            if (name == null) {
                errors.add("本项包含名称过长或含特殊字符的不支持字段，请对照平台契约模板移除该字段。");
                continue;
            }
            errors.add(switch (name) {
                case "expectedRevision" -> "不支持导入字段 expectedRevision：它是来源编辑时的修订校验值，请删除后重新预览；覆盖导入的修订由目标环境确定。";
                case "protocol" -> "不支持导入顶层字段 protocol：请删除顶层 protocol，协议应放在 binding.protocol 中。";
                case "id", "apiId", "draftRevision", "status", "enabled", "liveDraftRevision", "liveReleaseId", "pendingReleaseId", "stateVersion" ->
                        "不支持导入服务端字段 " + name + "，请删除后重新预览；目标环境会维护自己的记录和状态。";
                default -> "不支持导入字段 " + name + "，请检查拼写或删除该字段后重新预览；导入只接受平台契约字段。";
            });
        }
        if (unsupported.size() > 20) errors.add("另有 " + (unsupported.size() - 20) + " 个不支持字段，请先修正已列字段后重新预览。");
        return List.copyOf(errors);
    }
}
