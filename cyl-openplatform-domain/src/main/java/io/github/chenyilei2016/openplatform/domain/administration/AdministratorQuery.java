package io.github.chenyilei2016.openplatform.domain.administration;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

/** search 为列表单一搜索框：姓名包含或工号精确；name/tenantId/employeeNo 为分项条件，供身份核对沿用。 */
public record AdministratorQuery(
        int page, int pageSize, String search, String name, String tenantId, String employeeNo, Boolean enabled,
        Boolean superAdministrator) {
    public AdministratorQuery {
        if (page < 1
                || pageSize < 1
                || pageSize > 100
                || search != null && search.length() > 100
                || name != null && name.length() > 100
                || tenantId != null && tenantId.length() > 64
                || employeeNo != null && employeeNo.length() > 64) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "管理员查询参数不合法，单页最多100条");
        }
    }
}
