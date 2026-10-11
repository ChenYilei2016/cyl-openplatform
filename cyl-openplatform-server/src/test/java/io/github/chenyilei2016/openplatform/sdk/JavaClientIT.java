package io.github.chenyilei2016.openplatform.sdk;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;

/** 编译独立SDK源码，另起JVM验证连接复用、原生正文限制与完整调用期限。 */
class JavaClientIT {
    @TempDir Path directory;

    @Test
    void standaloneJavaClientEnforcesItsPublicTransportContract() throws Exception {
        Path root = Path.of(System.getProperty("user.dir")).getParent();
        Path source = root.resolve("examples/java-client");
        Path log = directory.resolve("sdk-check.log");
        SdkClientRuntime.compile(source, directory, List.of(
                source.resolve("src/io/github/chenyilei2016/openplatform/client/OpenPlatformClient.java"),
                source.resolve("src/io/github/chenyilei2016/openplatform/client/OrderExample.java"),
                source.resolve("test/OpenPlatformClientCheck.java")), log);
        var process = SdkClientRuntime.command(source, directory, "OpenPlatformClientCheck")
                .redirectErrorStream(true).redirectOutput(log.toFile()).start();
        try {
            assertThat(process.waitFor(30, TimeUnit.SECONDS)).isTrue();
            assertThat(process.exitValue()).as(Files.readString(log)).isZero();
            assertThat(Files.readString(log)).contains("SDK_CLIENT_CHECK_PASSED");
        } finally { process.destroyForcibly(); }
    }
}
