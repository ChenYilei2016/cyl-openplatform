package io.github.chenyilei2016.openplatform.application.mcp;

import io.github.chenyilei2016.openplatform.application.access.AccessAuditService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeNumberRef;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.mcp.McpActivationStatus;
import io.github.chenyilei2016.openplatform.domain.mcp.McpTenantActivation;
import io.github.chenyilei2016.openplatform.domain.mcp.McpTenantActivationRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.UnaryOperator;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 租户 MCP 开通：门户由本租户任意有效员工自助开通、停用、启用（租户只取自服务端会话）；
 * 平台管理员可查看全部并停用/启用。每次变更与审计同一事务。
 */
@Service
@RequiredArgsConstructor
public class McpTenantActivationService {
    private final McpTenantActivationRepository activations;
    private final AccessAuditService audit;
    private final EmployeeProfileRepository profiles;

    /** 开通展示视图；activatedByName 为最近登记的展示姓名，仅供展示。 */
    public record ActivationView(String id, String tenantId, String tenantName, String keyCode, String status,
                                 boolean disabledByPlatform, String activatedByEmployeeNo, String activatedByName,
                                 Instant createdAt, Instant updatedAt, long revision) {}

    /** MCP 入口判断租户是否已开通：存在且启用才返回。 */
    public Optional<McpTenantActivation> activeTenantActivation(String tenantId) {
        return activations.findByTenant(tenantId).filter(McpTenantActivation::active);
    }

    /** 门户：本租户开通情况，未开通为空。 */
    public Optional<ActivationView> current(AccessOperator operator) {
        return activations.findByTenant(operator.tenantId()).map(activation -> views(List.of(activation)).getFirst());
    }

    /** 门户开通：每租户只能一次，并发重复开通只有一个成功。 */
    public ActivationView open(AccessOperator operator) {
        McpTenantActivation activation = McpTenantActivation.open(operator.tenantId(), operator.employeeNo(), Instant.now());
        McpTenantActivation created = audit.change("OPEN_MCP_ACTIVATION", null, operator.tenantId(), activation.id(), operator, () -> {
            if (activations.findByTenant(operator.tenantId()).isPresent())
                throw new PlatformException(ErrorCode.CONFLICT, "本租户已开通 MCP，不能重复开通");
            activations.create(activation);
            return activation;
        });
        return views(List.of(created)).getFirst();
    }

    /** 门户停用/启用本租户开通；平台停用后租户不能自行启用。 */
    public ActivationView changeOwnStatus(boolean enabled, AccessOperator operator) {
        McpTenantActivation current = activations.findByTenant(operator.tenantId())
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "本租户尚未开通 MCP"));
        return change(current, operator, latest -> latest.changedByTenant(enabled, Instant.now()));
    }

    /** 管理端：按租户 ID 精确筛选与状态筛选；租户名称与开通人姓名按页批量补充。 */
    public PageResult<ActivationView> page(AccessPageQuery query, McpActivationStatus status) {
        PageResult<McpTenantActivation> page = activations.page(query, status);
        return new PageResult<>(views(page.items()), page.total(), page.page(), page.pageSize());
    }

    /** 管理端停用/启用任一租户的开通。 */
    public ActivationView changeStatus(String id, boolean enabled, AccessOperator operator) {
        McpTenantActivation current = activations.find(id)
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "MCP 开通记录不存在"));
        return change(current, operator, latest -> latest.changedByPlatform(enabled, Instant.now()));
    }

    private ActivationView change(McpTenantActivation current, AccessOperator operator, UnaryOperator<McpTenantActivation> transition) {
        McpTenantActivation result = audit.change("SET_MCP_ACTIVATION_STATUS", null, current.tenantId(), current.id(), operator, () -> {
            McpTenantActivation latest = activations.find(current.id())
                    .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "MCP 开通记录不存在"));
            McpTenantActivation next = transition.apply(latest);
            if (next != latest && !activations.updateStatus(next, latest.revision()))
                throw new PlatformException(ErrorCode.CONFLICT, "开通状态已变化，请刷新后重试");
            return next;
        });
        return views(List.of(result)).getFirst();
    }

    private List<ActivationView> views(List<McpTenantActivation> items) {
        if (items.isEmpty()) return List.of();
        Map<String, String> tenantNames = profiles.tenantNames(items.stream().map(McpTenantActivation::tenantId).distinct().toList());
        Map<EmployeeNumberRef, String> names = profiles.displayNames(items.stream()
                .map(item -> new EmployeeNumberRef(item.tenantId(), item.activatedByEmployeeNo())).distinct().toList());
        return items.stream().map(item -> new ActivationView(item.id(), item.tenantId(), tenantNames.get(item.tenantId()),
                item.keyCode(), item.status().name(), item.disabledByPlatform(), item.activatedByEmployeeNo(),
                names.get(new EmployeeNumberRef(item.tenantId(), item.activatedByEmployeeNo())),
                item.createdAt(), item.updatedAt(), item.revision())).toList();
    }
}
