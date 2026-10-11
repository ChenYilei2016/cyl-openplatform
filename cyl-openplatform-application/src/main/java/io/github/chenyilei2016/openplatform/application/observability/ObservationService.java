package io.github.chenyilei2016.openplatform.application.observability;

import io.github.chenyilei2016.openplatform.application.administration.OperatorNames;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeNumberRef;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.administration.OperatorRef;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository;
import io.github.chenyilei2016.openplatform.domain.observability.ManagementAudit;
import io.github.chenyilei2016.openplatform.domain.observability.ManagementAuditRepository;
import io.github.chenyilei2016.openplatform.domain.observability.ObservationQuery;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class ObservationService {
    private final CallRecordRepository calls;
    private final ManagementAuditRepository audits;
    private final EmployeeProfileRepository profiles;
    private final OperatorNames operatorNames;

    /** 调用记录及业务租户、调用人员的展示名称；名称只作展示，未登记时为 null。 */
    public record CallEntry(CallRecord call, String tenantName, String employeeName) {}

    /** 管理审计及业务租户、操作人的展示名称；名称只作展示，未登记时为 null。 */
    public record AuditEntry(ManagementAudit audit, String tenantName, String operatorName) {}

    /** 提供方已完成的结果不能被日志存储故障改写。 */
    public void record(CallRecord record) {
        try {
            calls.append(record);
        } catch (RuntimeException failure) {
            log.error("调用记录未落库 requestId={}", record.requestId(), failure);
        }
    }

    /** 每页一次租户名、一次人员名批量投影，不随记录数增加查询。 */
    public PageResult<CallEntry> calls(ObservationQuery query) {
        PageResult<CallRecord> page = calls.page(query);
        Map<String, String> tenants = tenantNames(page.items().stream().map(CallRecord::tenantId));
        Map<EmployeeNumberRef, String> employees = employeeNames(page.items().stream()
                .map(item -> new EmployeeNumberRef(item.tenantId(), item.employeeNo())));
        return page.map(item -> new CallEntry(item, tenants.get(item.tenantId()),
                employees.get(new EmployeeNumberRef(item.tenantId(), item.employeeNo()))));
    }

    /** 操作人姓名优先取管理员登记，门户人员等未登记管理员时回退到人员档案；每页最多三次批量查询。 */
    public PageResult<AuditEntry> audits(ObservationQuery query) {
        PageResult<ManagementAudit> page = audits.page(query);
        Map<String, String> tenants = tenantNames(page.items().stream().map(ManagementAudit::tenantId));
        Map<OperatorRef, String> operators = new HashMap<>(operatorNames.of(page.items().stream()
                .map(item -> new OperatorRef(item.operatorTenantId(), item.operatorEmployeeNo()))));
        employeeNames(page.items().stream()
                .map(item -> new OperatorRef(item.operatorTenantId(), item.operatorEmployeeNo()))
                .filter(operator -> !operators.containsKey(operator))
                .map(operator -> new EmployeeNumberRef(operator.tenantId(), operator.employeeNo())))
                .forEach((employee, name) -> operators.put(new OperatorRef(employee.tenantId(), employee.employeeNo()), name));
        return page.map(item -> new AuditEntry(item, tenants.get(item.tenantId()),
                operators.get(new OperatorRef(item.operatorTenantId(), item.operatorEmployeeNo()))));
    }

    /** 返回可按 null 租户查找的映射（早期拒绝的调用没有租户）。 */
    private Map<String, String> tenantNames(Stream<String> tenantIds) {
        return new HashMap<>(profiles.tenantNames(tenantIds.filter(Objects::nonNull).distinct().toList()));
    }

    private Map<EmployeeNumberRef, String> employeeNames(Stream<EmployeeNumberRef> employees) {
        return profiles.displayNames(employees
                .filter(employee -> employee.tenantId() != null && employee.employeeNo() != null)
                .distinct().toList());
    }
}
