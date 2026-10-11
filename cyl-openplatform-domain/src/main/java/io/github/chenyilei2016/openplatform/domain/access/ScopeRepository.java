package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.List;
import java.util.Map;

public interface ScopeRepository {
    PageResult<Scope> page(AccessPageQuery query, ScopeFilter filter);
    /** 当前页权限组的 API 数与凭据数，固定两次聚合查询；未被引用的代码不出现在结果中。 */
    Map<String, ScopeUsage> usage(List<String> codes);
    /** 草稿或已发布生效版本携带该组的 API，按服务标识排序分页；query 匹配名称、服务或方法。 */
    PageResult<ScopeApi> apis(String code, AccessPageQuery query);
    Scope find(String id);
    Scope lock(String id);
    List<String> defaultCodes();
    List<String> enabledCodes(List<String> codes);
    List<Scope> findByCodes(List<String> codes);
    void create(Scope scope);
    void update(Scope scope);
    boolean allEnabled(List<String> codes);
}
