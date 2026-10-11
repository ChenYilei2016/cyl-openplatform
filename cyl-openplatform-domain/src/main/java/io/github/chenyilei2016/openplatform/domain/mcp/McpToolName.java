package io.github.chenyilei2016.openplatform.domain.mcp;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.regex.Pattern;

/** MCP工具名：{service}_{method}_{version}，版本中的点和短横线转为下划线；由API身份决定，创建后不变。 */
public record McpToolName(String value) {
    public static final int MAX_LENGTH = 64;
    private static final Pattern VALID = Pattern.compile("[a-zA-Z0-9_]{1," + MAX_LENGTH + "}");

    public McpToolName {
        if (value == null || !VALID.matcher(value).matches())
            throw new PlatformException(ErrorCode.INVALID_REQUEST,
                    "按 service_method_版本 生成的MCP工具名只能包含字母、数字和下划线，且不超过" + MAX_LENGTH + "字符");
    }

    public static McpToolName of(String service, String method, String version) {
        if (service == null || method == null || version == null)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "服务标识、操作标识和外部版本齐全后才能生成MCP工具名");
        return new McpToolName(service + "_" + method + "_" + version.replace('.', '_').replace('-', '_'));
    }
}
