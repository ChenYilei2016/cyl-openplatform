package io.github.chenyilei2016.openplatform.application.debug;

import io.github.chenyilei2016.openplatform.application.connection.DubboBindingPolicy;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiProtocol;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import static io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Stage.*;
import static io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics.Status.*;

/** 预检只核验本地结构与连接事实；业务地址/实例/方法由显式调用确认。 */
@Service
@RequiredArgsConstructor
public class DebugTargetInspector {
    private final DubboBindingPolicy bindings;
    public void inspect(ApiDefinition definition, InvocationDiagnostics trace) {
        try {
            definition.binding().validate();
            if (definition.protocol() == ApiProtocol.HTTP) {
                trace.passed(TARGET, "HTTP地址格式及平台出站组件已就绪；未探测业务URL，可达性须执行后确认");
            } else {
                bindings.validate(definition, definition);
                trace.passed(TARGET, "Dubbo结构、连接选择及固定修订已核验；未探测实例或方法，注册中心可单独检查，业务可达性须执行后确认");
            }
            trace.check(PROVIDER_AUTH, UNAVAILABLE, "CHECK_ON_CALL", "平台环境签名已配置；提供方认证结果须实际调用后确认", List.of());
        } catch (PlatformException failure) {
            trace.check(TARGET, FAILED, failure.getErrorCode().name(), failure.getMessage(), List.of());
        }
    }
}
