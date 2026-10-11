package io.github.chenyilei2016.openplatform.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.github.chenyilei2016.openplatform.application.administration.OperatorNames;
import io.github.chenyilei2016.openplatform.application.observability.ObservationService;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeNumberRef;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.administration.OperatorRef;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.observability.AuditSource;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository;
import io.github.chenyilei2016.openplatform.domain.observability.ManagementAudit;
import io.github.chenyilei2016.openplatform.domain.observability.ManagementAuditRepository;
import io.github.chenyilei2016.openplatform.domain.observability.ObservationQuery;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B3：日志与审计列表每页只做固定次数的批量补名，查询次数不随记录数增长。 */
class ObservationNamesTest {
    private final CallRecordRepository calls = mock(CallRecordRepository.class);
    private final ManagementAuditRepository audits = mock(ManagementAuditRepository.class);
    private final EmployeeProfileRepository profiles = mock(EmployeeProfileRepository.class);
    private final OperatorNames operatorNames = mock(OperatorNames.class);
    private final ObservationService service = new ObservationService(calls, audits, profiles, operatorNames);
    private final ObservationQuery query = ObservationQuery.builder().page(1).pageSize(100).build();

    @Test
    @SuppressWarnings("unchecked")
    void callPageResolvesTenantAndPersonNamesWithOneBatchEach() {
        List<CallRecord> rows = IntStream.range(0, 100).mapToObj(index -> CallRecord.builder()
                .id("c" + index).tenantId("t" + index % 3).employeeNo(index % 2 == 0 ? "E" + index % 5 : null).build()).toList();
        when(calls.page(query)).thenReturn(new PageResult<>(rows, 100, 1, 100));
        when(profiles.tenantNames(anyCollection())).thenReturn(Map.of("t0", "租户零"));
        when(profiles.displayNames(anyCollection())).thenReturn(Map.of(new EmployeeNumberRef("t0", "E0"), "张三"));

        PageResult<ObservationService.CallEntry> page = service.calls(query);

        ArgumentCaptor<Collection<String>> tenants = ArgumentCaptor.forClass(Collection.class);
        ArgumentCaptor<Collection<EmployeeNumberRef>> employees = ArgumentCaptor.forClass(Collection.class);
        verify(profiles, times(1)).tenantNames(tenants.capture());
        verify(profiles, times(1)).displayNames(employees.capture());
        assertThat(tenants.getValue()).containsExactlyInAnyOrder("t0", "t1", "t2");
        assertThat(employees.getValue()).doesNotHaveDuplicates().allMatch(ref -> ref.employeeNo() != null);
        assertThat(page.items().getFirst().tenantName()).isEqualTo("租户零");
        assertThat(page.items().getFirst().employeeName()).isEqualTo("张三");
        assertThat(page.items().get(1).employeeName()).isNull();
    }

    @Test
    @SuppressWarnings("unchecked")
    void auditPageFallsBackToPersonProfilesOnlyForUnregisteredOperators() {
        List<ManagementAudit> rows = IntStream.range(0, 60).mapToObj(index -> new ManagementAudit(
                "a" + index, AuditSource.CATALOG, "r", null, null, "biz", null, "UPDATE_DRAFT", "SUCCESS", "ADMIN",
                "ot", index % 2 == 0 ? "ADMIN_1" : "PORTAL_1", null, null, Instant.now())).toList();
        when(audits.page(query)).thenReturn(new PageResult<>(rows, 60, 1, 100));
        when(profiles.tenantNames(anyCollection())).thenReturn(Map.of());
        when(operatorNames.of(any())).thenReturn(Map.of(new OperatorRef("ot", "ADMIN_1"), "王管理"));
        when(profiles.displayNames(anyCollection())).thenReturn(Map.of(new EmployeeNumberRef("ot", "PORTAL_1"), "李四"));

        PageResult<ObservationService.AuditEntry> page = service.audits(query);

        ArgumentCaptor<Collection<EmployeeNumberRef>> fallback = ArgumentCaptor.forClass(Collection.class);
        verify(operatorNames, times(1)).of(any());
        verify(profiles, times(1)).tenantNames(anyCollection());
        verify(profiles, times(1)).displayNames(fallback.capture());
        assertThat(fallback.getValue()).containsExactly(new EmployeeNumberRef("ot", "PORTAL_1"));
        assertThat(page.items().get(0).operatorName()).isEqualTo("王管理");
        assertThat(page.items().get(1).operatorName()).isEqualTo("李四");
    }
}
