package io.github.chenyilei2016.openplatform.application.identity;

import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;

/** 账号认证 SPI。实现由部署方提供；不得从客户端接受租户或管理权限。 */
public interface AccountAuthentication {
    Account authenticate(String username, String password);
    /** 重新核验当前账号；已禁用或不存在时拒绝，不能信任旧会话快照。 */
    Account current(String username);

    record Account(String username, EmployeeIdentity employee, String tenantName) {}
}
