package io.github.chenyilei2016.openplatform.testing;

import io.github.chenyilei2016.openplatform.domain.connection.DubboServiceIdentity;
import io.github.chenyilei2016.openplatform.infrastructure.connection.runtime.ManagedDubboConnectionRuntime;
import java.util.Map;
import org.apache.dubbo.config.ApplicationConfig;
import org.apache.dubbo.config.ReferenceConfig;
import org.apache.dubbo.config.RegistryConfig;
import org.apache.dubbo.config.bootstrap.DubboBootstrap;
import org.apache.dubbo.rpc.model.FrameworkModel;
import org.apache.dubbo.rpc.model.ApplicationModel;
import org.apache.dubbo.rpc.service.GenericService;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 传输测试替换注册发现边界，仍使用真实TCP Provider；注册发现由Nacos IT独立覆盖。 */
public final class DirectDubboTestConnection implements AutoCloseable {
    private final FrameworkModel framework = new FrameworkModel();
    private final DubboBootstrap bootstrap;
    private final ReferenceConfig<GenericService> reference;

    public DirectDubboTestConnection(String interfaceName, String version, String group, String url, int timeout) {
        ApplicationModel model = framework.newApplication();
        bootstrap = DubboBootstrap.getInstance(model);
        ApplicationConfig application = new ApplicationConfig(model, "test-direct-consumer");
        application.setQosEnable(false);
        reference = new ReferenceConfig<>(model.getDefaultModule());
        reference.setInterface(interfaceName); reference.setVersion(version); reference.setGroup(group);
        reference.setGeneric("true"); reference.setUrl(url); reference.setInjvm(false);
        reference.setCheck(false); reference.setRetries(0); reference.setTimeout(timeout);
        reference.setParameters(Map.of("serialization", "hessian2", "send.reconnect", "false"));
        bootstrap.application(application).registry(new RegistryConfig(model, "N/A")).reference(reference).start();
    }

    public void install(ManagedDubboConnectionRuntime runtime) {
        when(runtime.acquire(anyString(), anyLong(), any(DubboServiceIdentity.class))).thenAnswer(call -> {
            DubboServiceIdentity identity = call.getArgument(2);
            if (!reference.getInterface().equals(identity.interfaceName()) || !reference.getVersion().equals(identity.version()) || !reference.getGroup().equals(identity.group()))
                throw new IllegalArgumentException("测试绑定目标不匹配");
            ManagedDubboConnectionRuntime.ReferenceLease lease = mock(ManagedDubboConnectionRuntime.ReferenceLease.class);
            when(lease.service()).thenReturn(reference.get());
            return lease;
        });
    }

    @Override public void close() {
        try { reference.destroy(); bootstrap.destroy(); }
        finally { framework.destroy(); }
    }
}
