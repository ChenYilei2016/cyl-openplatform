package io.github.chenyilei2016.openplatform.application.workbench;

import io.github.chenyilei2016.openplatform.application.operations.AlertService;
import io.github.chenyilei2016.openplatform.application.publication.PublicationService;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogFilter;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiSummary;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.operations.AlertStatus;
import io.github.chenyilei2016.openplatform.domain.operations.OperationsMetricsRepository;
import io.github.chenyilei2016.openplatform.domain.operations.OperationsTotals;
import io.github.chenyilei2016.openplatform.domain.publication.ReleaseStatus;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 工作台聚合：一次请求按当前管理员权限组装各区块，无权限的区块为 null。
 * 每个区块的查询次数与条数固定且有上限，不随数据量增长。
 */
@Service
@RequiredArgsConstructor
public class WorkbenchService {
    /** 待审核列表展示条数。 */
    public static final int PENDING_LIMIT = 5;
    /** “我的草稿”展示条数。 */
    public static final int DRAFT_LIMIT = 10;
    /** “我的草稿”按更新时间倒序最多扫描的负责 API 数；是否有未发布修改由快照差异判断，无法下推到 SQL。 */
    public static final int DRAFT_SCAN_LIMIT = 50;
    private static final Duration TRAFFIC_WINDOW = Duration.ofHours(1);

    private final PublicationService publications;
    private final ApiCatalogRepository catalog;
    private final EmployeeProfileRepository profiles;
    private final OperationsMetricsRepository metrics;
    private final AlertService alerts;

    /** 当前管理员身份（来自可信会话），权限决定返回哪些区块。 */
    public record Viewer(String tenantId, String employeeId, Set<AdminPermission> permissions) {
        public Viewer {
            permissions = Set.copyOf(permissions);
        }

        boolean hasAny(AdminPermission... candidates) {
            for (AdminPermission permission : candidates) if (permissions.contains(permission)) return true;
            return false;
        }
    }

    public record Workbench(PendingReviews pendingReviews, MyDrafts myDrafts, Traffic traffic, Alerts alerts) {}

    public record PendingReviews(long total, List<PendingItem> items) {}

    public record PendingItem(String id, String apiId, String name, String service, String version, String method,
                              long draftRevision, Instant submittedAt, String submittedByEmployeeNo, String submittedByName) {}

    /** ownerId 为当前管理员的人员档案 ID；未登记档案时为 null 且列表为空。truncated 表示还有更多未展示。 */
    public record MyDrafts(String ownerId, List<DraftItem> items, boolean truncated) {}

    public record DraftItem(String id, String name, String service, String version, String method,
                            long draftRevision, Long liveDraftRevision, String pendingReleaseId, Instant updatedAt) {}

    /** 正式调用近 1 小时（含当前分钟）的请求数与失败率（百分数，两位小数）；无请求时 failureRate 为 null。 */
    public record Traffic(Instant from, Instant to, long requests, long failures, String failureRate) {}

    /** 未恢复（FIRING）的告警指标数；stale 表示评估结果已过期。 */
    public record Alerts(long firing, boolean stale) {}

    public Workbench overview(Viewer viewer) {
        return new Workbench(
                viewer.hasAny(AdminPermission.MANAGE_APIS, AdminPermission.PUBLISH_APIS, AdminPermission.REVIEW_APIS) ? pendingReviews() : null,
                viewer.hasAny(AdminPermission.MANAGE_APIS) ? myDrafts(viewer) : null,
                viewer.hasAny(AdminPermission.VIEW_AUDIT) ? traffic() : null,
                viewer.hasAny(AdminPermission.VIEW_AUDIT) ? alerts() : null);
    }

    private PendingReviews pendingReviews() {
        var page = publications.page(new CatalogPageQuery(1, PENDING_LIMIT, null), ReleaseStatus.PENDING, null);
        return new PendingReviews(page.total(), page.items().stream().map(entry -> {
            var release = entry.release();
            return new PendingItem(release.id(), release.apiId(), release.name(), release.service(), release.version(),
                    release.method(), release.draftRevision(), release.submittedAt(), release.submittedByEmployeeNo(), entry.submittedByName());
        }).toList());
    }

    private MyDrafts myDrafts(Viewer viewer) {
        var profile = profiles.find(viewer.tenantId(), viewer.employeeId()).orElse(null);
        if (profile == null) return new MyDrafts(null, List.of(), false);
        var filter = new ApiCatalogFilter(null, null, null, null, null, null, null, null, profile.id(), ApiCatalogFilter.Sort.UPDATED_DESC, null);
        var page = catalog.page(new CatalogPageQuery(1, DRAFT_SCAN_LIMIT, null), filter);
        List<ApiSummary> changed = page.items().stream().filter(ApiSummary::hasUnpublishedChanges).toList();
        return new MyDrafts(profile.id(), changed.stream().limit(DRAFT_LIMIT).map(api -> new DraftItem(api.id(), api.name(),
                        api.service(), api.version(), api.method(), api.draftRevision(), api.liveDraftRevision(),
                        api.pendingReleaseId(), api.updatedAt())).toList(),
                changed.size() > DRAFT_LIMIT || page.total() > DRAFT_SCAN_LIMIT);
    }

    private Traffic traffic() {
        Instant to = Instant.now().truncatedTo(ChronoUnit.MINUTES).plus(1, ChronoUnit.MINUTES);
        Instant from = to.minus(TRAFFIC_WINDOW);
        OperationsTotals totals = metrics.summary(from, to, CallMode.PRODUCTION, null, null);
        long failures = totals.requests() - totals.successes();
        return new Traffic(from, to, totals.requests(), failures, totals.requests() == 0 ? null
                : BigDecimal.valueOf(failures).multiply(BigDecimal.valueOf(100))
                        .divide(BigDecimal.valueOf(totals.requests()), 2, RoundingMode.HALF_UP).toPlainString());
    }

    private Alerts alerts() {
        var overview = alerts.overview();
        return new Alerts(overview.states().stream().filter(state -> state.status() == AlertStatus.FIRING).count(), overview.stale());
    }
}
