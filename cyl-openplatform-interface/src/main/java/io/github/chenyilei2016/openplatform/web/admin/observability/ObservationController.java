package io.github.chenyilei2016.openplatform.web.admin.observability;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import io.github.chenyilei2016.openplatform.application.observability.ObservationService;
import io.github.chenyilei2016.openplatform.application.observability.ObservationService.AuditEntry;
import io.github.chenyilei2016.openplatform.application.observability.ObservationService.CallEntry;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.observability.AuditSource;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.observability.ManagementAudit;
import io.github.chenyilei2016.openplatform.domain.observability.ObservationQuery;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 平台运维日志与管理审计检索，专属权限可跨业务租户查看元数据。 */
@RequireAdmin(permissions = AdminPermission.VIEW_AUDIT)
@RestController
@RequestMapping("/admin-api/observability")
@RequiredArgsConstructor
@Validated
public class ObservationController {
    private final ObservationService observations;

    /** 调用记录平铺输出，附业务租户名与调用人员姓名（仅展示，未登记为 null）。 */
    public record CallRow(@JsonUnwrapped CallRecord call, String tenantName, String employeeName) {
        static CallRow of(CallEntry entry) { return new CallRow(entry.call(), entry.tenantName(), entry.employeeName()); }
    }

    /** 管理审计平铺输出，附业务租户名与操作人姓名（仅展示，未登记为 null）。 */
    public record AuditRow(@JsonUnwrapped ManagementAudit audit, String tenantName, String operatorName) {
        static AuditRow of(AuditEntry entry) { return new AuditRow(entry.audit(), entry.tenantName(), entry.operatorName()); }
    }

    /** 生产调用和草稿调试共用过滤条件，最多查询31天；mode/outcome可重复传入，同字段OR、其他字段AND；耗时区间为闭区间毫秒。 */
    @GetMapping("/calls")
    public ApiResponse<PageResult<CallRow>> calls(
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) Instant from, @RequestParam(required = false) Instant to,
            @RequestParam(required = false) String requestId, @RequestParam(required = false) String apiId,
            @RequestParam(required = false) String applicationId, @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) Set<String> outcome, @RequestParam(required = false) Set<CallMode> mode,
            @RequestParam(required = false) String id, @RequestParam(required = false) String employeeNo,
            @RequestParam(required = false) String employeeId,
            @RequestParam(required = false) io.github.chenyilei2016.openplatform.domain.observability.CallIdentityKind identityKind,
            @RequestParam(required = false) String ruleId, @RequestParam(required = false) Long ruleVersion,
            @RequestParam(required = false) ObservationQuery.GovernanceOutcome governanceOutcome,
            @RequestParam(required = false) GovernanceDecision.Reason denialReason,
            @RequestParam(required = false) Long durationMin, @RequestParam(required = false) Long durationMax,
            @RequestParam(required = false) io.github.chenyilei2016.openplatform.domain.observability.CallChannel channel,
            @RequestParam(required = false) String toolName,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(observations.calls(ObservationQuery.builder()
                .page(page).pageSize(pageSize).from(from).to(to).id(id).requestId(requestId)
                .apiId(apiId).applicationId(applicationId).tenantId(tenantId).employeeNo(employeeNo)
                .employeeId(employeeId).identityKind(identityKind).ruleId(ruleId).ruleVersion(ruleVersion)
                .governanceOutcome(governanceOutcome).denialReason(denialReason).outcomes(outcome).modes(mode)
                .durationMin(durationMin).durationMax(durationMax).channel(channel).toolName(toolName).build()).map(CallRow::of));
    }

    /** 已有四类审计按发生时间分页投影，source/outcome可多选；操作工号仅匹配真实operatorEmployeeNo。 */
    @GetMapping("/audits")
    public ApiResponse<PageResult<AuditRow>> audits(
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) Instant from, @RequestParam(required = false) Instant to,
            @RequestParam(required = false) String requestId, @RequestParam(required = false) String apiId,
            @RequestParam(required = false) String applicationId, @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) Set<String> outcome, @RequestParam(required = false) Set<AuditSource> source,
            @RequestParam(required = false) String id, @RequestParam(required = false) String operatorEmployeeNo,
            @RequestParam(required = false) String targetId, @RequestParam(required = false) String operatorTenantId,
            HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(observations.audits(ObservationQuery.builder()
                .page(page).pageSize(pageSize).from(from).to(to).id(id).requestId(requestId)
                .apiId(apiId).applicationId(applicationId).tenantId(tenantId).targetId(targetId)
                .operatorTenantId(operatorTenantId).operatorEmployeeNo(operatorEmployeeNo)
                .outcomes(outcome).sources(source).build()).map(AuditRow::of));
    }
}
