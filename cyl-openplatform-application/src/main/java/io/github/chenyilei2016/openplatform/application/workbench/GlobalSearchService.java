package io.github.chenyilei2016.openplatform.application.workbench;

import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationKind;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationFilter;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationListing;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationStatus;
import io.github.chenyilei2016.openplatform.domain.access.ClientApplication;
import io.github.chenyilei2016.openplatform.domain.access.CredentialSearch;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository;
import io.github.chenyilei2016.openplatform.domain.observability.ObservationQuery;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 管理端全局搜索：一次请求检索 API、凭据、调用、人员，各类最多 {@link #LIMIT} 条。
 * 按当前管理员权限裁剪分组（无权限的分组为 null），只返回标识与展示字段，不含秘密。
 */
@Service
@RequiredArgsConstructor
public class GlobalSearchService {
    public static final int LIMIT = 5;
    public static final int MAX_KEYWORD_LENGTH = 100;
    /** requestId 精确匹配只查保留期上限内的调用（与日志检索一致，最多 31 天）。 */
    private static final Duration CALL_WINDOW = Duration.ofDays(31);
    private static final Pattern REQUEST_ID = Pattern.compile("[A-Za-z0-9._:-]{1,64}");

    private final ApiCatalogRepository catalog;
    private final ApplicationRepository applications;
    private final CallRecordRepository calls;
    private final EmployeeProfileRepository profiles;

    public record SearchResult(List<ApiHit> apis, List<CredentialHit> credentials, List<CallHit> calls, List<PersonHit> people) {}

    public record ApiHit(String id, String name, String service, String version, String method, String internalClass, String internalMethod) {}

    /** appKey 是公开标识（AK），不返回密钥或摘要。 */
    public record CredentialHit(String id, String name, String appKey, ApplicationStatus status) {}

    public record CallHit(String id, String requestId, CallMode mode, String service, String version, String method, String outcome,
                          int httpStatus, Instant occurredAt) {}

    public record PersonHit(String id, String tenantId, String tenantName, String employeeId, String employeeNo, String displayName) {}

    public SearchResult search(String keyword, Set<AdminPermission> permissions) {
        String text = keyword == null ? "" : keyword.strip();
        if (text.isEmpty() || text.length() > MAX_KEYWORD_LENGTH || text.chars().anyMatch(Character::isISOControl))
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "搜索内容需为1至100个字符");
        // 与凭据列表同一判定：完整 Token 明文直接拒绝，不进入任何分组的查询条件。
        CredentialSearch credential = CredentialSearch.parse(text);
        return new SearchResult(
                permissions.contains(AdminPermission.MANAGE_APIS) ? apis(text) : null,
                permissions.contains(AdminPermission.MANAGE_APPLICATIONS) ? credentials(credential) : null,
                permissions.contains(AdminPermission.VIEW_AUDIT) ? calls(text) : null,
                permissions.contains(AdminPermission.MANAGE_APPLICATIONS) || permissions.contains(AdminPermission.VIEW_AUDIT) ? people(text) : null);
    }

    private List<ApiHit> apis(String text) {
        return catalog.search(text, LIMIT).stream().map(hit -> new ApiHit(hit.id(), hit.name(), hit.service(), hit.version(),
                hit.method(), hit.internalClass(), hit.internalMethod())).toList();
    }

    private List<CredentialHit> credentials(CredentialSearch search) {
        // AK 精确，其余按名称包含（Token 记录 ID 在凭据页单独定位，全局搜索不做）；只含普通凭据，MCP 网关凭据在“MCP 接入”页。
        if (search.appKey() != null)
            return applications.findByKey(search.appKey()).filter(app -> app.kind() == ApplicationKind.STANDARD)
                    .map(GlobalSearchService::credential).stream().toList();
        return applications.page(new AccessPageQuery(1, LIMIT, search.nameContains()), new ApplicationFilter(null, null, null, null, null))
                .items().stream().map(ApplicationListing::application).map(GlobalSearchService::credential).toList();
    }

    private static CredentialHit credential(ClientApplication application) {
        return new CredentialHit(application.id(), application.name(), application.appKey(), application.status());
    }

    private List<CallHit> calls(String text) {
        if (!REQUEST_ID.matcher(text).matches()) return List.of();
        Instant to = Instant.now();
        return calls.page(ObservationQuery.builder().page(1).pageSize(LIMIT).from(to.minus(CALL_WINDOW)).to(to).requestId(text).build())
                .items().stream().map(call -> new CallHit(call.id(), call.requestId(), call.mode(), call.service(), call.version(), call.method(),
                        call.outcome(), call.httpStatus(), call.occurredAt())).toList();
    }

    private List<PersonHit> people(String text) {
        if (text.length() > 64) return List.of();
        return profiles.search(text, LIMIT).stream().map(profile -> new PersonHit(profile.id(), profile.tenantId(),
                profile.tenantName(), profile.employeeId(), profile.employeeNo(), profile.displayName())).toList();
    }
}
