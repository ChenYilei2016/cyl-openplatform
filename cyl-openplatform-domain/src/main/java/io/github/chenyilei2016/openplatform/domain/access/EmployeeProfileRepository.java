package io.github.chenyilei2016.openplatform.domain.access;

import java.util.Map;
import java.util.Collection;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;

import java.time.Instant;

public interface EmployeeProfileRepository {
    /** 同一人员原子登记；重复初始化只在字段变化或超过刷新间隔时更新。 */
    void remember(EmployeeProfile profile, Instant refreshBefore);

    PageResult<EmployeeProfile> page(EmployeeProfileQuery query);

    java.util.Optional<EmployeeProfile> find(String tenantId, String employeeId);

    /** 跨租户按工号精确或姓名包含查找已登记档案，最多返回 limit 条；只作展示与跳转，不作授权依据。 */
    java.util.List<EmployeeProfile> search(String keyword, int limit);

    Map<String, EmployeeProfile> findByIds(Collection<String> ids);

    String tenantName(String tenantId);

    /** 仅投影当前有界列表涉及的租户；展示名称不作为身份或授权依据。 */
    Map<String, String> tenantNames(Collection<String> tenantIds);

    /** 按当前有界列表涉及的（租户, 工号）批量投影最近核验的展示姓名；同工号多条档案取最近一次。 */
    Map<EmployeeNumberRef, String> displayNames(Collection<EmployeeNumberRef> employees);
}
