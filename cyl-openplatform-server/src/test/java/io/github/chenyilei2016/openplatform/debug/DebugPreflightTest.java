package io.github.chenyilei2016.openplatform.debug;

import io.github.chenyilei2016.openplatform.application.connection.DubboBindingPolicy;
import io.github.chenyilei2016.openplatform.application.debug.DebugTargetInspector;
import io.github.chenyilei2016.openplatform.application.runtime.RequestPreparation;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class DebugPreflightTest {
    private final DebugTargetInspector targets = new DebugTargetInspector(mock(DubboBindingPolicy.class));
    private final InvocationContext identity = new InvocationContext("app", "ak", "tenant", null, null, null, List.of("orders"));

    @Test void mappedPrimitiveMismatchIsCaughtDuringPreparationBeforeRpc() {
        ApiDefinition api = definition();
        assertThatThrownBy(() -> RequestPreparation.prepare(api, identity, Map.of("count", 2147483648L)))
                .isInstanceOf(PlatformException.class).hasMessageContaining("arg0").hasMessageContaining("int");
        assertThat(RequestPreparation.prepare(api, identity, Map.of("count", 7)).dubboArguments()).containsEntry("arg0", 7);
    }

    @Test void handWrittenSignaturePreflightDoesNotClaimNetworkOrMethodVerification() {
        InvocationDiagnostics trace = new InvocationDiagnostics();
        targets.inspect(definition(), trace);
        assertThat(target(trace).status()).isEqualTo(InvocationDiagnostics.Status.PASSED);
        assertThat(target(trace).summary()).contains("未探测实例或方法", "执行后确认");
    }

    private InvocationDiagnostics.Check target(InvocationDiagnostics trace) {
        return trace.checks().stream().filter(check -> check.stage() == InvocationDiagnostics.Stage.TARGET).findFirst().orElseThrow();
    }
    private ApiDefinition definition() {
        SchemaNode count = new SchemaNode(SchemaType.INTEGER, null, true, Map.of(), null, List.of(), null, null, false);
        SchemaNode request = new SchemaNode(SchemaType.OBJECT, null, false, Map.of("count", count), null, List.of(), null, null, false);
        ApiBinding binding = new ApiBinding(ApiProtocol.DUBBO, 2000, null, new ApiBinding.Dubbo("com.example.Counter", "query", "1.0", "", List.of("int"), "connection", 1L, null));
        return new ApiDefinition("api", "counter", "v1", "query", "计数", "测试", "测试", ApiProtocol.DUBBO, 1, List.of("orders"), request, count, List.of(), binding,
                List.of(new ParameterMapping("arg0", ParameterMapping.Source.REQUEST, "count", null)), null, null, false, null, null, null, null);
    }
}
