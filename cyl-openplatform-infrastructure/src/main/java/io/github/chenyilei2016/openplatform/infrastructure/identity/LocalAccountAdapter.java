package io.github.chenyilei2016.openplatform.infrastructure.identity;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeIdentity;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeStatus;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.infrastructure.properties.identity.LocalAccountProperties;
import java.util.HashMap;
import java.util.Map;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;

/** 开源版认证与人员目录适配器；核心业务只依赖两个 SPI。 */
public final class LocalAccountAdapter implements AccountAuthentication {
    private final Pbkdf2PasswordEncoder passwords = Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    private final Map<String, LocalAccountProperties.User> accounts;
    private final Map<IdentityKey, LocalAccountProperties.User> employees;
    private final String dummyHash = passwords.encode("invalid-account");

    public LocalAccountAdapter(LocalAccountProperties settings) {
        Map<String, LocalAccountProperties.User> byName = new HashMap<>();
        Map<IdentityKey, LocalAccountProperties.User> byEmployee = new HashMap<>();
        java.util.Set<IdentityKey> userIds = new java.util.HashSet<>();
        java.util.Set<IdentityKey> employeeIds = new java.util.HashSet<>();
        for (LocalAccountProperties.User user : settings.getUsers()) {
            if (byName.putIfAbsent(user.username(), user) != null
                    || byEmployee.putIfAbsent(new IdentityKey(user.tenantId(), user.employeeNo()), user) != null
                    || !userIds.add(new IdentityKey(user.tenantId(), user.userId()))
                    || !employeeIds.add(new IdentityKey(user.tenantId(), user.employeeId())))
                throw new IllegalArgumentException("本地账号用户名、租户内用户ID、员工ID及工号必须唯一");
        }
        accounts = Map.copyOf(byName);
        employees = Map.copyOf(byEmployee);
    }

    @Override public Account authenticate(String username, String password) {
        LocalAccountProperties.User user = accounts.get(username);
        boolean matched = passwords.matches(password, user == null ? dummyHash : user.passwordHash());
        if (!matched || user == null || !user.enabled())
            throw new PlatformException(ErrorCode.UNAUTHENTICATED, "账号或密码不正确");
        return account(user);
    }

    @Override public Account current(String username) {
        LocalAccountProperties.User user = accounts.get(username);
        if (user == null || !user.enabled())
            throw new PlatformException(ErrorCode.UNAUTHENTICATED, "账号已失效，请重新登录");
        return account(user);
    }

    public EmployeeIdentity find(String tenantId, String employeeNo) {
        LocalAccountProperties.User user = employees.get(new IdentityKey(tenantId, employeeNo));
        if (user == null) throw new PlatformException(ErrorCode.FORBIDDEN, "人员不存在或不可授权");
        return identity(user);
    }

    private static Account account(LocalAccountProperties.User user) {
        return new Account(user.username(), identity(user), user.tenantName());
    }

    private static EmployeeIdentity identity(LocalAccountProperties.User user) {
        return new EmployeeIdentity(user.tenantId(), user.userId(), user.employeeId(), user.employeeNo(),
                user.displayName(), user.enabled(), EmployeeStatus.PERMANENT);
    }
    private record IdentityKey(String tenantId, String employeeNo) {}
}
