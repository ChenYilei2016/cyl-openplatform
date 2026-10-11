package io.github.chenyilei2016.openplatform.web.admin.operations;

import io.github.chenyilei2016.openplatform.application.operations.OperationsStatisticsService;
import io.github.chenyilei2016.openplatform.application.operations.OperationsTargetService;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.operations.OperationsQuery;
import io.github.chenyilei2016.openplatform.domain.operations.OperationsStatistics;
import io.github.chenyilei2016.openplatform.domain.operations.StatisticsBucket;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 跨租户平台运营统计，只聚合已持久化调用，不作为计费账单。 */
@RequireAdmin(permissions = AdminPermission.VIEW_AUDIT)
@RestController
@RequestMapping("/admin-api/operations")
@RequiredArgsConstructor
public class OperationsStatisticsController {
    private final OperationsStatisticsService statistics;
    private final OperationsTargetService targets;

    /** VIEW_AUDIT分页选择统计对象，只返回名称/公开标识；最多100项、偏移100000，id精确恢复选择。 */
    @GetMapping("/targets")
    public ApiResponse<PageResult<OperationsTargetService.Target>> targets(
            @RequestParam OperationsTargetService.Kind kind,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query, @RequestParam(required = false) String id,
            @RequestParam(required = false) String tenantId,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(targets.targets(kind, page, pageSize, query, id, tenantId));
    }


    /** 当前列表涉及规则的批量分钟概况，固定版本分列；不扩展治理写权限。 */
    @GetMapping("/rule-overview")
    public ApiResponse<java.util.List<io.github.chenyilei2016.openplatform.domain.operations.RuleOverview>> ruleOverview(
            @RequestParam Instant from, @RequestParam Instant to,
            @RequestParam(defaultValue = "PRODUCTION") CallMode mode,
            @RequestParam java.util.List<String> ruleId, HttpServletResponse response) {
        response.setHeader("Cache-Control","no-store");
        return ApiResponse.success(statistics.ruleOverview(new OperationsQuery(from,to,mode,StatisticsBucket.FIVE_MINUTES,null,null),ruleId));
    }

    /** 带时区时间按UTC半开区间查询，分钟对齐且最多31天/1440桶。 */
    @GetMapping("/statistics")
    public ApiResponse<OperationsStatistics> statistics(@RequestParam Instant from, @RequestParam Instant to,
            @RequestParam(defaultValue = "PRODUCTION") CallMode mode,
            @RequestParam(defaultValue = "FIVE_MINUTES") StatisticsBucket bucket,
            @RequestParam(required = false) String apiId, @RequestParam(required = false) String applicationId,
            @RequestParam(required = false) String tenantId, @RequestParam(required = false) String employeeId,
            @RequestParam(required = false) io.github.chenyilei2016.openplatform.domain.observability.CallIdentityKind identityKind,
            @RequestParam(required = false) String ruleId, @RequestParam(required = false) Long ruleVersion,
            @RequestParam(defaultValue = "TENANT") io.github.chenyilei2016.openplatform.domain.operations.StatisticsDimension dimension,
            @RequestParam(defaultValue = "REQUESTS") io.github.chenyilei2016.openplatform.domain.operations.StatisticsSort sort,
            @RequestParam(defaultValue = "10") int top,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(statistics.statistics(new OperationsQuery(from, to, mode, bucket, apiId, applicationId,
                tenantId, employeeId, identityKind, ruleId, ruleVersion, dimension, sort, top)));
    }
}
