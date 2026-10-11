package io.github.chenyilei2016.openplatform.runtime;

import io.github.chenyilei2016.openplatform.application.runtime.ApiInvocationExecutor;
import io.github.chenyilei2016.openplatform.domain.access.ScopeRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiLifecycle;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.catalog.ParameterMapping;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaType;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceGuard;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRequest;
import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.runtime.DubboApiInvoker;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpApiInvoker;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InOrder;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 两种真实执行分支共用治理顺序；端口替身只记录准入与提供方调用，不模拟Redis算法。 */
class ApiInvocationGovernanceTest {
    private final ScopeRepository scopes = mock(ScopeRepository.class);
    private final GovernanceGuard governance = mock(GovernanceGuard.class);
    private final HttpApiInvoker http = mock(HttpApiInvoker.class);
    private final DubboApiInvoker dubbo = mock(DubboApiInvoker.class);
    private final ApiInvocationExecutor executor = new ApiInvocationExecutor(scopes, governance, http, dubbo,
            new io.github.chenyilei2016.openplatform.application.runtime.ProviderResponseService(20000, 32),
            new io.github.chenyilei2016.openplatform.application.runtime.InvocationIdempotency(mock(io.github.chenyilei2016.openplatform.domain.runtime.IdempotencyGuard.class)));
    private final GovernanceDecision admitted = new GovernanceDecision(true, GovernanceDecision.Reason.NONE, 0, List.of());
    private final InvocationContext employee = new InvocationContext("application-1", "a".repeat(32), "tenant-1",
            "user-1", "employee-1", "E001", List.of("orders"));

    @BeforeEach void authorize() {
        when(scopes.enabledCodes(List.of("orders"))).thenReturn(List.of("orders"));
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void admissionDependencyFailureIsUnavailableBeforeProvider(boolean scopeFailure) {
        RuntimeException unavailable = new IllegalStateException("测试依赖故障");
        if (scopeFailure) when(scopes.enabledCodes(any())).thenThrow(unavailable);
        else when(governance.evaluate(any())).thenThrow(unavailable);
        CallRecord.CallRecordBuilder observation = CallRecord.builder();
        assertThatThrownBy(() -> executor.execute(definition(ApiProtocol.HTTP, "employeeNo"), employee,
                Map.of("orderId", "1"), "request-1", "127.0.0.1", CallMode.PRODUCTION, observation))
                .isInstanceOfSatisfying(PlatformException.class, failure -> {
                    assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE);
                    assertThat(failure.getCause()).isSameAs(unavailable);
                });
        assertThat(observation.build().errorCode()).isEqualTo(ErrorCode.DEPENDENCY_UNAVAILABLE.getCode());
        verifyNoInteractions(http, dubbo);
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void missingTrustedPersonnelIdentityRejectsBeforeGovernanceEvenWhenBodySuppliesIt(ApiProtocol protocol) {
        for (String field : List.of("userId", "employeeId", "employeeNo")) {
            for (String absent : new String[]{null, " "}) {
                InvocationContext application = new InvocationContext("application-1", "a".repeat(32), "tenant-1",
                        absent, absent, absent, List.of("orders"));
                ApiDefinition definition = definition(protocol, field);
                CallRecord.CallRecordBuilder observation = CallRecord.builder();
                Map<String, Object> input = Map.of("orderId", "order-1", "userId", "forged-user",
                        "employeeId", "forged-employee", "employeeNo", "forged-number");
                assertThatThrownBy(() -> executor.execute(definition, application, input, "request-1", "127.0.0.1", CallMode.PRODUCTION, observation))
                        .isInstanceOfSatisfying(PlatformException.class, failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
                assertThat(observation.build().errorCode()).isEqualTo(ErrorCode.FORBIDDEN.getCode());
                assertThat(observation.build().governance()).isNull();
            }
        }
        verifyNoInteractions(governance, http, dubbo);
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void invalidBusinessParametersAreCheckedAfterAdmissionWithoutCallingProvider(ApiProtocol protocol) {
        GovernanceRequest request = new GovernanceRequest(employee.applicationId(), employee.tenantId(), "api-1", "127.0.0.1", CallMode.PRODUCTION);
        when(governance.evaluate(request)).thenReturn(admitted);
        CallRecord.CallRecordBuilder observation = CallRecord.builder();
        assertThatThrownBy(() -> executor.execute(definition(protocol, "employeeNo"), employee, Map.of("orderId", 42),
                "request-1", "127.0.0.1", CallMode.PRODUCTION, observation))
                .isInstanceOfSatisfying(PlatformException.class, failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.INVALID_REQUEST));
        InOrder order = inOrder(scopes, governance);
        order.verify(scopes).enabledCodes(List.of("orders"));
        order.verify(governance).evaluate(request);
        order.verifyNoMoreInteractions();
        verifyNoInteractions(http, dubbo);
        assertThat(observation.build().governance()).isSameAs(admitted);
        assertThat(observation.build().errorCode()).isEqualTo(ErrorCode.INVALID_REQUEST.getCode());
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void providerFailureKeepsThePriorAdmissionAndDoesNotInvokeTheOtherProtocol(ApiProtocol protocol) {
        ApiDefinition definition = definition(protocol, "employeeNo");
        GovernanceRequest request = new GovernanceRequest(employee.applicationId(), employee.tenantId(), "api-1", "127.0.0.1", CallMode.PRODUCTION);
        when(governance.evaluate(request)).thenReturn(admitted);
        PlatformException failure = new PlatformException(ErrorCode.DOWNSTREAM_FAILED, "受控提供方失败");
        if (protocol == ApiProtocol.HTTP) when(http.invoke(any(), any(), any(), anyString())).thenThrow(failure);
        else when(dubbo.invoke(any(), any(), any(), anyString())).thenThrow(failure);
        CallRecord.CallRecordBuilder observation = CallRecord.builder();
        assertThatThrownBy(() -> executor.execute(definition, employee, Map.of("orderId", "order-1"), "request-1", "127.0.0.1", CallMode.PRODUCTION, observation))
                .isInstanceOfSatisfying(PlatformException.class, actual -> assertThat(actual.getErrorCode()).isEqualTo(failure.getErrorCode()));
        Map<String, Object> parameters = Map.of("orderId", "order-1", "identity", "E001");
        if (protocol == ApiProtocol.HTTP) {
            InOrder order = inOrder(governance, http);
            order.verify(governance).evaluate(request);
            order.verify(http).invoke(definition.binding(), new io.github.chenyilei2016.openplatform.domain.runtime.HttpParameters(Map.of(), Map.of(), parameters), employee, "request-1");
            verifyNoInteractions(dubbo);
        } else {
            InOrder order = inOrder(governance, dubbo);
            order.verify(governance).evaluate(request);
            order.verify(dubbo).invoke(definition.binding(), Map.of("arg0", parameters), employee, "request-1");
            verifyNoInteractions(http);
        }
        verify(governance).evaluate(request);
        assertThat(observation.build().governance()).isSameAs(admitted);
        assertThat(observation.build().errorCode()).isEqualTo(ErrorCode.DOWNSTREAM_FAILED.getCode());
    }

    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void explicitEmployeeRequirementChecksEveryIdentityFieldBeforeQuotaInBothModes(ApiProtocol protocol) {
        ApiDefinition source = definition(protocol, "tenantId");
        ApiDefinition required = new ApiDefinition(source.id(), source.service(), source.version(), source.method(), source.name(),
                source.category(), source.owner(), source.protocol(), source.draftRevision(), source.scopeCodes(), source.requestSchema(),
                source.responseSchema(), source.errorDefinitions(), source.binding(), source.mappings(), source.lifecycle(), source.description(), true, null, null, null, null);
        for (CallMode mode : CallMode.values()) {
            for (InvocationContext incomplete : List.of(
                    new InvocationContext("application-1", "a".repeat(32), "tenant-1", null, null, null, List.of("orders")),
                    new InvocationContext("application-1", "a".repeat(32), "tenant-1", "user", null, "E1", List.of("orders")),
                    new InvocationContext("application-1", "a".repeat(32), "tenant-1", null, "employee", "E1", List.of("orders")),
                    new InvocationContext("application-1", "a".repeat(32), "tenant-1", "user", "employee", " ", List.of("orders")))) {
                assertThatThrownBy(() -> executor.execute(required, incomplete, Map.of("orderId", "order-1"),
                        "request-1", "127.0.0.1", mode, CallRecord.builder())).isInstanceOfSatisfying(PlatformException.class,
                                failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
            }
        }
        verifyNoInteractions(governance, http, dubbo);
    }


    @ParameterizedTest
    @EnumSource(ApiProtocol.class)
    void bothProtocolsAdaptBeforePublicReturnAndKeepBusinessFailureDistinct(ApiProtocol protocol) {
        when(governance.evaluate(any())).thenReturn(admitted);
        ApiDefinition source = definition(protocol, "employeeNo");
        io.github.chenyilei2016.openplatform.domain.catalog.ResponseAdapter adapter = new io.github.chenyilei2016.openplatform.domain.catalog.ResponseAdapter(
                io.github.chenyilei2016.openplatform.domain.catalog.ResponseAdapter.Mode.ENVELOPE, "code", List.of(0), "data", "message");
        ApiDefinition definition = new ApiDefinition(source.id(), source.service(), source.version(), source.method(), source.name(), source.category(),
                source.owner(), source.protocol(), source.draftRevision(), source.scopeCodes(), source.requestSchema(), source.responseSchema(),
                source.errorDefinitions(), source.binding(), source.mappings(), source.lifecycle(), source.description(), source.employeeRequired(), adapter, null, null, null);
        Object good = Map.of("code", 0, "data", "业务数据", "internal", "不公开");
        Object bad = Map.of("code", 1, "message", "提供方内部消息");
        if (protocol == ApiProtocol.HTTP) when(http.invoke(any(), any(), any(), anyString())).thenReturn(good, bad);
        else when(dubbo.invoke(any(), any(), any(), anyString())).thenReturn(good, bad);
        assertThat(executor.execute(definition, employee, Map.of("orderId", "1"), "request", "127.0.0.1", CallMode.PRODUCTION, CallRecord.builder()).data()).isEqualTo("业务数据");
        assertThatThrownBy(() -> executor.execute(definition, employee, Map.of("orderId", "1"), "request", "127.0.0.1", CallMode.PRODUCTION, CallRecord.builder()))
                .isInstanceOfSatisfying(PlatformException.class, failure -> {
                    assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.PROVIDER_BUSINESS_REJECTED);
                    assertThat(failure.getMessage()).isEqualTo("提供方业务拒绝");
                });
    }

    private ApiDefinition definition(ApiProtocol protocol, String identityField) {
        SchemaNode order = new SchemaNode(SchemaType.STRING, "订单编号", true, Map.of(), null, List.of(), null, null, false);
        SchemaNode request = new SchemaNode(SchemaType.OBJECT, null, false, Map.of("orderId", order), null, List.of(), null, null, false);
        SchemaNode response = new SchemaNode(SchemaType.STRING, null, false, Map.of(), null, List.of(), null, null, false);
        ApiBinding binding = protocol == ApiProtocol.HTTP
                ? new ApiBinding(protocol, 3000, new ApiBinding.Http("https://provider.example/orders", "POST"), null)
                : new ApiBinding(protocol, 3000, null, new ApiBinding.Dubbo("com.example.OrderService", "query", "1.0", "", List.of("java.util.Map"), null, null, null));
        String prefix = protocol == ApiProtocol.DUBBO ? "arg0." : "";
        List<ParameterMapping> mappings = List.of(
                new ParameterMapping(prefix + "orderId", ParameterMapping.Source.REQUEST, "orderId", null),
                new ParameterMapping(prefix + "identity", ParameterMapping.Source.CONTEXT, identityField, null));
        ApiDefinition definition = new ApiDefinition("api-1", "orders", "v1", "query", "订单查询", "订单", "维护者", protocol,
                1, List.of("orders"), request, response, List.of(), binding, mappings, ApiLifecycle.DEFAULT, null, false, null, null, null, null);
        definition.validate();
        return definition;
    }
}
