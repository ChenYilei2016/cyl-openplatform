package io.github.chenyilei2016.openplatform.domain.runtime;

import java.util.List;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

/** 经认证和当前授权核验后的可信调用身份；不携带特定认证方式的凭据。 */
public record InvocationContext(String applicationId, String appKey, String tenantId,
                                String userId, String employeeId, String employeeNo, List<String> scopeCodes) {
    public InvocationContext { scopeCodes = List.copyOf(scopeCodes); }

    /** API要求人员时，三个标识必须均来自已核验委托。 */
    public void requireEmployee() {
        requireValue("userId");
        requireValue("employeeId");
        requireValue("employeeNo");
    }

    /** 内部映射所需的可信身份；在治理扣额前检查，客户端不能补填缺失身份。 */
    public String requireValue(String field) {
        String value = switch (field) {
            case "applicationId" -> applicationId;
            case "appKey" -> appKey;
            case "tenantId" -> tenantId;
            case "userId" -> userId;
            case "employeeId" -> employeeId;
            case "employeeNo" -> employeeNo;
            default -> throw new PlatformException(ErrorCode.DOWNSTREAM_FAILED, "内部身份映射不合法");
        };
        if (value == null || value.isBlank()) throw new PlatformException(ErrorCode.FORBIDDEN, "当前调用缺少所需人员身份");
        return value;
    }
}
