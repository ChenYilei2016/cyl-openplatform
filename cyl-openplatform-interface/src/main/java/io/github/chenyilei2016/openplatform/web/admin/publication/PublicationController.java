package io.github.chenyilei2016.openplatform.web.admin.publication;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import io.github.chenyilei2016.openplatform.application.publication.PublicationService;
import io.github.chenyilei2016.openplatform.application.publication.PublicationService.ReleaseEntry;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.Scope;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.publication.*;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.identity.AdminSession;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

import lombok.RequiredArgsConstructor;

import org.slf4j.MDC;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** 发布固定快照、审核结果和独立紧急开关；所有操作以当前可信后台身份授权。 */
@RequireAdmin(permissions = {AdminPermission.MANAGE_APIS, AdminPermission.PUBLISH_APIS, AdminPermission.REVIEW_APIS}, match = RequireAdmin.Match.ANY)
@RestController
@RequestMapping("/admin-api/publications")
@RequiredArgsConstructor
public class PublicationController {
    private final PublicationService publications;

    public record Submission(
            @NotNull @Min(1) Long expectedDraftRevision,
            @NotNull @Min(0) @Max(Long.MAX_VALUE - 1) Long expectedStateVersion,
            @NotNull
                    @Pattern(
                            regexp =
                                    "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
                    String submissionKey,
            @NotNull @Size(max = 500) String comment) {}

    public record Rollback(
            @NotBlank @Size(max = 36) String sourceReleaseId,
            @NotBlank @Size(max = 36) String expectedLiveReleaseId,
            @NotNull @Min(0) @Max(Long.MAX_VALUE - 2) Long expectedStateVersion,
            @NotNull @Pattern(regexp = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
                    String submissionKey,
            @NotBlank @Size(max = 500) String comment) {}

    public record Approval(@NotNull @Size(max = 500) String comment) {}

    public record Rejection(@NotBlank @Size(max = 500) String comment) {}

    public record StatusChange(
            @NotNull Boolean enabled,
            @NotNull @Min(0) @Max(Long.MAX_VALUE - 1) Long expectedStateVersion,
            @NotBlank @Size(max = 500) String reason) {}

    public record Config(boolean auditEnabled) {}

    /** 发布记录摘要平铺输出，附提交人、审核人展示姓名。 */
    /** 发布详情：固定快照与审核信息，附提交人、审核人展示姓名。 */
    public record ReleaseView(@JsonUnwrapped Release release, String submittedByName, String reviewedByName) {}

    public record ReleaseRow(@JsonUnwrapped ReleaseSummary release, String submittedByName, String reviewedByName) {
        static PageResult<ReleaseRow> of(PageResult<ReleaseEntry> page) {
            return page.map(item -> new ReleaseRow(item.release(), item.submittedByName(), item.reviewedByName()));
        }
    }

    public record AuditRow(@JsonUnwrapped PublicationAudit audit, String operatorName) {}

    public record ScopeLabelRequest(
            @NotNull @Size(max = 200)
                    List<@NotNull @Pattern(regexp = "[a-z0-9][a-z0-9_.:-]{0,63}") String> codes) {}

    public record ScopeLabel(String name, boolean enabled) {}

    /** 批量解析当前权限组名称；历史未知代码不返回，调用方仍须保留原代码。 */
    @PostMapping("/scope-labels")
    public ApiResponse<Map<String, ScopeLabel>> scopeLabels(
            @Valid @RequestBody ScopeLabelRequest body, HttpServletRequest request) {
        return ApiResponse.success(publications.currentScopes(body.codes()).stream().collect(
                Collectors.toMap(Scope::code,
                        scope -> new ScopeLabel(scope.name(), scope.enabled()))));
    }

    @GetMapping("/config")
    public ApiResponse<Config> config(HttpServletRequest request) {
        return ApiResponse.success(new Config(publications.auditEnabled()));
    }

    @GetMapping
    public ApiResponse<PageResult<ReleaseRow>> page(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) ReleaseStatus status,
            @RequestParam(required = false) Boolean auditRequired,
            HttpServletRequest request) {
        return ApiResponse.success(ReleaseRow.of(
                publications.page(new CatalogPageQuery(page, pageSize, query), status, auditRequired)));
    }

    @GetMapping("/apis")
    public ApiResponse<PageResult<ApiSummary>> apis(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query,
            HttpServletRequest request) {
        return ApiResponse.success(publications.apis(new CatalogPageQuery(page, pageSize, query)));
    }

    /** 发布候选只读入口；不授予草稿编辑权限、不创建提交或推进状态。 */
    @GetMapping("/apis/{apiId}/candidate")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<ApiDefinition> candidate(@PathVariable @Size(max = 36) String apiId) {
        return ApiResponse.success(publications.candidate(apiId));
    }

    @GetMapping("/apis/{apiId}/state")
    public ApiResponse<PublicationState> state(
            @PathVariable @Size(max = 36) String apiId, HttpServletRequest request) {
        return ApiResponse.success(publications.state(apiId));
    }

    /** API 的发布历史摘要；精确过滤后分页，不包含契约正文。 */
    @GetMapping("/apis/{apiId}/releases")
    public ApiResponse<PageResult<ReleaseRow>> apiReleases(
            @PathVariable @Size(max = 36) String apiId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(ReleaseRow.of(publications.apiReleases(apiId, new CatalogPageQuery(page, pageSize, null))));
    }

    /** 历史已生效快照生成新发布，保留工作草稿及独立访问开关。 */
    @PostMapping("/apis/{apiId}/rollbacks")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<Release> rollback(
            @PathVariable @Size(max = 36) String apiId,
            @Valid @RequestBody Rollback body,
            HttpServletRequest request) {
        return ApiResponse.success(publications.rollback(apiId, body.sourceReleaseId(),
                body.expectedLiveReleaseId(), body.expectedStateVersion(),
                body.submissionKey().toLowerCase(java.util.Locale.ROOT), body.comment(), operator(request)));
    }

    @PostMapping("/apis/{apiId}/submissions")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<Release> submit(
            @PathVariable @Size(max = 36) String apiId,
            @Valid @RequestBody Submission body,
            HttpServletRequest request) {
        return ApiResponse.success(
                publications.submit(
                        apiId,
                        body.expectedDraftRevision(),
                        body.expectedStateVersion(),
                        body.submissionKey().toLowerCase(java.util.Locale.ROOT),
                        body.comment(),
                        operator(request)));
    }

    /** 查询原提交结果；审核拒绝、失败等历史结果同样可以定位。 */
    @GetMapping("/apis/{apiId}/submissions/{key}")
    public ApiResponse<Release> submission(@PathVariable @Size(max = 36) String apiId,
            @PathVariable @Pattern(regexp = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}") String key,
            HttpServletRequest request) {
        return ApiResponse.success(publications.submission(apiId, key.toLowerCase(java.util.Locale.ROOT)));
    }

    @GetMapping("/{id}")
    public ApiResponse<ReleaseView> find(
            @PathVariable @Size(max = 36) String id, HttpServletRequest request) {
        var named = publications.findNamed(id);
        return ApiResponse.success(new ReleaseView(named.release(), named.submittedByName(), named.reviewedByName()));
    }

    @PostMapping("/{id}/approve")
    @RequireAdmin(permissions = AdminPermission.REVIEW_APIS)
    public ApiResponse<Release> approve(
            @PathVariable @Size(max = 36) String id,
            @Valid @RequestBody Approval body,
            HttpServletRequest request) {
        return ApiResponse.success(
                publications.approve(
                        id, body.comment(), operator(request)));
    }

    @PostMapping("/{id}/reject")
    @RequireAdmin(permissions = AdminPermission.REVIEW_APIS)
    public ApiResponse<Release> reject(
            @PathVariable @Size(max = 36) String id,
            @Valid @RequestBody Rejection body,
            HttpServletRequest request) {
        return ApiResponse.success(
                publications.reject(
                        id, body.comment(), operator(request)));
    }

    @PutMapping("/apis/{apiId}/status")
    @RequireAdmin(permissions = AdminPermission.PUBLISH_APIS)
    public ApiResponse<PublicationState> status(
            @PathVariable @Size(max = 36) String apiId,
            @Valid @RequestBody StatusChange body,
            HttpServletRequest request) {
        return ApiResponse.success(
                publications.status(
                        apiId,
                        body.enabled(),
                        body.expectedStateVersion(),
                        body.reason(),
                        operator(request)));
    }

    @GetMapping("/apis/{apiId}/effective")
    public ApiResponse<EffectiveRelease> effective(
            @PathVariable @Size(max = 36) String apiId, HttpServletRequest request) {
        return ApiResponse.success(publications.effective(apiId));
    }

    @GetMapping("/apis/{apiId}/audit")
    public ApiResponse<PageResult<AuditRow>> audit(
            @PathVariable @Size(max = 36) String apiId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            HttpServletRequest request) {
        return ApiResponse.success(publications.audit(apiId, new CatalogPageQuery(page, pageSize, null))
                .map(item -> new AuditRow(item.audit(), item.operatorName())));
    }

    private AccessOperator operator(HttpServletRequest request) {
        AdminSession session = AdminSession.current(request);
        return new AccessOperator(session.tenantId(), session.employeeNo(), MDC.get("requestId"), session.userId(), session.employeeId());
    }
}
