package io.github.chenyilei2016.openplatform.connection;

import java.net.InetAddress;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.apache.dubbo.config.ApplicationConfig;
import org.apache.dubbo.config.MetadataReportConfig;
import org.apache.dubbo.config.ProtocolConfig;
import org.apache.dubbo.config.RegistryConfig;
import org.apache.dubbo.config.ServiceConfig;
import org.apache.dubbo.config.bootstrap.DubboBootstrap;
import org.apache.dubbo.rpc.model.ApplicationModel;
import org.apache.dubbo.rpc.model.FrameworkModel;

/** 独立测试提供方进程：原生Nacos元数据发布，不给消费端预置定义或替换调用。 */
public final class DubboConnectionTestProvider {
    private DubboConnectionTestProvider() {}

    public static void main(String[] args) throws Exception {
        FrameworkModel framework = new FrameworkModel();
        ApplicationModel model = framework.newApplication();
        DubboBootstrap bootstrap = DubboBootstrap.getInstance(model);
        try {
            ApplicationConfig application = new ApplicationConfig(model, args[4]);
            application.setQosEnable(false);
            application.setMetadataType(args[5].toLowerCase(java.util.Locale.ROOT));
            RegistryConfig registry = new RegistryConfig(model, args[0]);
            registry.setId("application-registry");
            registry.setGroup(args[2]);
            registry.setRegisterMode("instance");
            registry.setUseAsConfigCenter(false);
            registry.setUseAsMetadataCenter(false);
            registry.setParameters(Map.of("namespace", args[1]));
            MetadataReportConfig metadata = new MetadataReportConfig(model, args[0]);
            metadata.setId("application-metadata");
            metadata.setGroup(args[3]);
            metadata.setParameters(Map.of("namespace", args[1]));
            metadata.setReportDefinition(true);
            metadata.setReportMetadata(true);
            int port;
            try (ServerSocket socket = new ServerSocket(0, 1, InetAddress.ofLiteral("::1"))) { port = socket.getLocalPort(); }
            ProtocolConfig protocol = new ProtocolConfig(model, "dubbo", port);
            protocol.setHost("::1"); protocol.setSerialization("hessian2"); protocol.setThreads(2);
            ServiceConfig<DubboConnectionRuntimeNacosIT.ProbeService> service = new ServiceConfig<>(model.getDefaultModule());
            service.setInterface(DubboConnectionRuntimeNacosIT.ProbeService.class);
            service.setRef(() -> args[4]);
            if (args.length > 7 && !args[7].isEmpty()) service.setVersion(args[7]);
            bootstrap.application(application).registry(registry).metadataReport(metadata).protocol(protocol).service(service).start();
            if (!InetAddress.ofLiteral(service.getExportedUrls().getFirst().getParameter("bind.ip")).isLoopbackAddress()) {
                throw new IllegalStateException("测试提供方必须绑定回环地址");
            }
            Files.writeString(Path.of(args[6]), "ready");
            System.in.read();
        } finally {
            try { bootstrap.destroy(); } finally { framework.destroy(); }
        }
        // 上游原生MetadataReport的SDK线程没有完整destroy；仅测试提供方进程以JVM退出收束资源。
        System.exit(0);
    }
}
