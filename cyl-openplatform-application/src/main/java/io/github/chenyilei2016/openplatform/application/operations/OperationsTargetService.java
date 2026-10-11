package io.github.chenyilei2016.openplatform.application.operations;

import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationFilter;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationListing;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogFilter;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiSummary;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.List;
import java.util.Map;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfile;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileQuery;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.operations.OperationsMetricsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 审计人员选择统计维度所需的最小展示资料，不暴露接入配置、权限或秘密。 */
@Service
@RequiredArgsConstructor
public class OperationsTargetService {
    public enum Kind { API, APPLICATION, TENANT, EMPLOYEE }
    public record Target(String id, String name, String description) {}
    private final ApiCatalogRepository apis;
    private final ApplicationRepository applications;
    private final OperationsMetricsRepository metrics;
    private final EmployeeProfileRepository profiles;

    public PageResult<Target> targets(Kind kind, int page, int pageSize, String query, String id, String tenantId) {
        AccessPageQuery bounds = new AccessPageQuery(page, pageSize, query);
        if (kind == Kind.TENANT) {
            if (id != null && (id.isBlank() || id.length() > 64)) throw new PlatformException(ErrorCode.INVALID_REQUEST,"租户ID最多64字符");
            PageResult<String> rows = metrics.tenants(bounds, id);
            Map<String,String> names = profiles.tenantNames(rows.items());
            return new PageResult<>(rows.items().stream().map(key -> new Target(key,names.getOrDefault(key,key),"租户 "+key)).toList(),rows.total(),page,pageSize);
        }
        if (kind == Kind.EMPLOYEE) {
            if (tenantId == null || tenantId.isBlank()) throw new PlatformException(ErrorCode.INVALID_REQUEST,"请先选租户再选择调用人员");
            if (id != null) {
                List<Target> found = profiles.find(tenantId,id).map(profile -> new Target(profile.employeeId(), profile.displayName(),
                        "工号 "+profile.employeeNo()+" · "+(profile.tenantName()==null?tenantId:profile.tenantName()))).stream().toList();
                return new PageResult<>(found,found.size(),1,pageSize);
            }
            boolean number = query != null && query.matches("[0-9]{1,64}");
            PageResult<EmployeeProfile> rows = profiles.page(new EmployeeProfileQuery(tenantId, number?query:null, number?null:query,page,pageSize));
            return new PageResult<>(rows.items().stream().map(profile -> new Target(profile.employeeId(),profile.displayName(),"工号 "+profile.employeeNo()+" · "+(profile.tenantName()==null?tenantId:profile.tenantName()))).toList(),rows.total(),page,pageSize);
        }
        if (id != null) {
            if (!id.matches("[A-Za-z0-9_-]{1,36}"))
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "目标ID格式不合法");
            List<Target> found = switch (kind) {
                case API -> apis.find(id).map(api -> new Target(api.id(), api.name(), api.service() + "/" + api.version() + "/" + api.method())).stream().toList();
                case TENANT, EMPLOYEE -> throw new IllegalStateException("target routing");
                case APPLICATION -> applications.find(id).map(app -> new Target(app.id(), app.name(), "AK " + app.appKey())).stream().toList();
            };
            return new PageResult<>(found, found.size(), 1, pageSize);
        }
        return switch (kind) {
            case TENANT, EMPLOYEE -> throw new IllegalStateException("target routing");
            case API -> {
                PageResult<ApiSummary> result = apis.page(new CatalogPageQuery(page, pageSize, query), new ApiCatalogFilter(null, null, null, null, null));
                yield new PageResult<>(result.items().stream().map(api -> new Target(api.id(), api.name(), api.service() + "/" + api.version() + "/" + api.method())).toList(), result.total(), page, pageSize);
            }
            case APPLICATION -> {
                PageResult<ApplicationListing> result = applications.page(bounds, new ApplicationFilter(null, null, null, null, null));
                yield new PageResult<>(result.items().stream().map(row -> new Target(row.application().id(), row.application().name(), "AK " + row.application().appKey())).toList(), result.total(), page, pageSize);
            }
        };
    }
}
