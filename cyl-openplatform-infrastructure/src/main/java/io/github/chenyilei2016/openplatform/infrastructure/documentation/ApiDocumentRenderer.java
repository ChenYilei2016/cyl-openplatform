package io.github.chenyilei2016.openplatform.infrastructure.documentation;

import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.documentation.DocumentFormat;
import io.github.chenyilei2016.openplatform.domain.documentation.DocumentRenderer;
import io.github.chenyilei2016.openplatform.domain.documentation.DocumentView;
import io.github.chenyilei2016.openplatform.infrastructure.common.BoundedOutputStream;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.web.util.HtmlUtils;
import tools.jackson.databind.json.JsonMapper;

import java.io.FilterWriter;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Semaphore;

/** 从同一公开快照生成离线文档；不读取模板、外链或调用外部渲染进程。 */
@Component
@RequiredArgsConstructor
public class ApiDocumentRenderer implements DocumentRenderer {
    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private final JsonMapper json;
    private final Semaphore permits = new Semaphore(4);

    @Override
    public ExportedDocument render(DocumentView view, DocumentFormat format) {
        if (!permits.tryAcquire()) throw new PlatformException(ErrorCode.RATE_LIMITED, "文档生成并发已达上限，请稍后重试");
        try {
            var output = new BoundedOutputStream(MAX_BYTES);
            if (format == DocumentFormat.JSON) {
                json.writeValue(output, view);
            } else {
                try (var writer = new OutputStreamWriter(output, StandardCharsets.UTF_8)) {
                    html(writer, view);
                }
            }
            String filename = String.join("-", view.service(), view.version(), view.method(), view.releaseId())
                    .replaceAll("[^A-Za-z0-9._-]", "_") + "." + format.extension();
            return new ExportedDocument(filename, format.mediaType(), output.toByteArray());
        } catch (RuntimeException failure) {
            if (NestedExceptionUtils.getMostSpecificCause(failure) instanceof PlatformException platform) throw platform;
            throw failure;
        } catch (IOException failure) {
            throw new IllegalStateException("内存文档生成失败", failure);
        } finally {
            permits.release();
        }
    }

    private void html(Writer writer, DocumentView view) throws IOException {
        var document = view.document();
        String callUrl = (document.baseUrl() == null ? "" : document.baseUrl()) + document.path();
        writer.write("""
                <!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
                <meta name="viewport" content="width=device-width, initial-scale=1"><title>开放平台 API 文档</title>
                <style>
                body{font:14px/1.6 system-ui,sans-serif;margin:32px auto;padding:0 20px;max-width:1100px;color:#172334}
                h1,h2,h3{line-height:1.3}table{border-collapse:collapse;width:100%;table-layout:fixed}
                th,td{border:1px solid #c5ccd4;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
                th{background:#eef2f6}pre,code{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
                pre{background:#f4f6f8;padding:12px}dl{display:grid;grid-template-columns:10em 1fr;gap:4px 12px}
                dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}dt{font-weight:600}.note{color:#526171}
                @media print{body{margin:0;max-width:none;font-size:10pt;padding:0}thead{display:table-header-group}
                h2,h3{break-after:avoid}pre{border:1px solid #ddd}tr{break-inside:avoid}}
                </style></head><body><h1>
                """);
        writer.write(HtmlUtils.htmlEscape(document.title()));
        writer.write("</h1><p class=\"note\">当前生效契约的离线副本。可使用浏览器打印，选择另存为 PDF；下载后的文件不会随平台变更自动更新。</p><dl>");
        field(writer, "服务", view.service());
        field(writer, "外部版本", view.version());
        field(writer, "操作", view.method());
        field(writer, "分类", view.category());
        field(writer, "发布标识 releaseId", view.releaseId());
        field(writer, "状态修订 stateVersion", Long.toString(view.stateVersion()));
        field(writer, "契约修订", Long.toString(document.draftRevision()));
        field(writer, "请求", document.httpMethod() + " " + callUrl);
        field(writer, "请求格式", "Content-Type: application/json");
        field(writer, "鉴权选择", "以下两种方案任选其一，每次请求只使用一种；均需匹配启用的权限组和有效授权");
        field(writer, "Bearer 调用", "POST " + callUrl + "\nAuthorization: Bearer <业务Token>");
        field(writer, "HMAC 签名调用", "POST " + callUrl.replace("/api/oauth/", "/api/sign/")
                + "\nAuthorization: SZ-HMAC-SHA256 <keyId>:<signature>"
                + "\nX-SZ-Tenant: <租户ID>\nX-SZ-Timestamp: <当前UTC秒>\nX-SZ-Nonce: <随机32位小写hex>"
                + "\n人员委托时另加 X-SZ-Employee；SigningSecret与AppSecret独立，可使用平台Java SDK生成签名。");
        field(writer, "权限组", String.join(", ", document.scopeCodes()));
        field(writer, "调用身份要求", Boolean.TRUE.equals(document.employeeRequired()) ? "必须指定调用员工：先建立有效人员委托，再申请人员Token或使用人员签名" : "允许租户级或人员级调用");
        field(writer, "接口说明", document.description());
        writer.write("</dl><h2>版本维护说明</h2><dl>");
        var lifecycle = document.lifecycle();
        field(writer, "生命周期", lifecycle.status().name());
        field(writer, "兼容性", lifecycle.compatibility().name());
        field(writer, "兼容性说明", lifecycle.compatibilityNotes());
        field(writer, "废弃说明", lifecycle.deprecationNotice());
        field(writer, "替代外部版本", lifecycle.replacementVersion());
        field(writer, "计划退出日期", lifecycle.sunsetDate());
        writer.write("</dl><p class=\"note\">兼容性为维护者声明，未经自动证明。计划退出日期不自动停用，替代版本不自动跳转或授权。已废弃版本仍可调用，已退出版本调用返回410，独立紧急停用仍返回404。</p>");
        schema(writer, "请求结构", document.requestSchema());
        example(writer, "请求示例", document.requestExample());
        schema(writer, "返回结构", document.responseSchema());
        example(writer, "返回示例", document.responseExample());
        writer.write("<h2>业务错误说明</h2><table><thead><tr><th>错误码</th><th>说明</th></tr></thead><tbody>");
        for (var error : document.errorDefinitions()) {
            writer.write("<tr><td>" + HtmlUtils.htmlEscape(error.code()) + "</td><td>" + HtmlUtils.htmlEscape(error.message()) + "</td></tr>");
        }
        writer.write("</tbody></table></body></html>");
    }

    private void schema(Writer writer, String heading, SchemaNode schema) throws IOException {
        writer.write("<h2>" + heading + "</h2><table><thead><tr><th>字段路径</th><th>类型 / 必填</th><th>说明</th><th>枚举 / 默认 / 显式示例</th></tr></thead><tbody>");
        schemaRow(writer, "$", schema);
        writer.write("</tbody></table>");
    }

    private void schemaRow(Writer writer, String path, SchemaNode schema) throws IOException {
        writer.write("<tr><td><code>" + HtmlUtils.htmlEscape(path) + "</code></td><td>" + schema.type().name()
                + (schema.nullable() ? "（可为null）" : "") + " / " + (schema.required() ? "是" : "否") + "</td><td>"
                + HtmlUtils.htmlEscape(schema.description() == null ? "" : schema.description()) + "</td><td>");
        if (!schema.enumValues().isEmpty()) example(writer, "枚举", schema.enumValues());
        if (schema.defaultValue() != null) example(writer, "默认值", schema.defaultValue());
        if (schema.example() != null) example(writer, "显式示例", schema.example());
        writer.write("</td></tr>");
        for (var property : schema.properties().entrySet()) schemaRow(writer, path + "." + property.getKey(), property.getValue());
        if (schema.items() != null) schemaRow(writer, path + "[]", schema.items());
    }

    private void example(Writer writer, String heading, Object value) throws IOException {
        writer.write("<h3>" + heading + "</h3><pre>");
        json.writerWithDefaultPrettyPrinter().writeValue(new HtmlTextWriter(writer), value);
        writer.write("</pre>");
    }

    private void field(Writer writer, String label, String value) throws IOException {
        writer.write("<dt>" + label + "</dt><dd>" + HtmlUtils.htmlEscape(value == null || value.isEmpty() ? "未声明" : value) + "</dd>");
    }

    /** Jackson 分块输出 JSON 时同步转义，避免先构造整份无界中间字符串。 */
    private static final class HtmlTextWriter extends FilterWriter {
        private HtmlTextWriter(Writer writer) { super(writer); }
        @Override public void write(char[] value, int offset, int length) throws IOException {
            out.write(HtmlUtils.htmlEscape(new String(value, offset, length)));
        }
        @Override public void write(String value, int offset, int length) throws IOException {
            out.write(HtmlUtils.htmlEscape(value.substring(offset, offset + length)));
        }
        @Override public void write(int value) throws IOException { out.write(HtmlUtils.htmlEscape(String.valueOf((char) value))); }
        @Override public void close() throws IOException { flush(); }
    }
}
