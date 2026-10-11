package io.github.chenyilei2016.openplatform.sdk;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/** SDK公开接入验收共用的真实Java8编译/运行入口，不进入生产和客户源码包。 */
public final class SdkClientRuntime {
    private SdkClientRuntime() { }

    public static Path javaHome() throws IOException {
        String configured = System.getProperty("sdk.java8.home", System.getenv("JAVA8_HOME"));
        if (configured == null || configured.isBlank()) {
            throw new IllegalStateException("SDK验收必须配置JAVA8_HOME或-Dsdk.java8.home，指向真实JDK8");
        }
        Path home = Path.of(configured);
        Properties release = new Properties();
        try (var input = Files.newInputStream(home.resolve("release"))) { release.load(input); }
        assertThat(release.getProperty("JAVA_VERSION")).as("SDK必须在真实JDK8运行").startsWith("\"1.8.");
        return home;
    }

    public static void compile(Path sdkRoot, Path classes, List<Path> sources, Path log) throws Exception {
        Files.createDirectories(classes);
        List<String> command = new ArrayList<>(List.of(javaHome().resolve("bin/javac").toString(),
                "-encoding", "UTF-8", "-cp", classpath(sdkRoot, classes), "-d", classes.toAbsolutePath().toString()));
        sources.forEach(source -> command.add(source.toAbsolutePath().toString()));
        var compiler = new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(log.toFile()).start();
        try {
            assertThat(compiler.waitFor(30, TimeUnit.SECONDS)).as("SDK Java8编译期限").isTrue();
            assertThat(compiler.exitValue()).as(Files.readString(log)).isZero();
        } finally { compiler.destroyForcibly(); }
    }

    public static ProcessBuilder command(Path sdkRoot, Path classes, String mainClass) throws IOException {
        return new ProcessBuilder(javaHome().resolve("bin/java").toString(), "-DsocksProxyHost=", "-Xmx64m",
                "-cp", classpath(sdkRoot, classes), mainClass);
    }

    private static String classpath(Path sdkRoot, Path classes) throws IOException {
        Path dependencies = sdkRoot.resolve("target/dependency");
        if (!Files.isDirectory(dependencies)) {
            throw new IllegalStateException("请先执行examples/java-client/build.sh，按客户独立pom准备公共依赖");
        }
        try (var files = Files.list(dependencies)) {
            String jars = files.filter(file -> file.toString().endsWith(".jar")).sorted()
                    .map(file -> file.toAbsolutePath().toString()).collect(Collectors.joining(File.pathSeparator));
            if (jars.isEmpty()) throw new IllegalStateException("SDK公共依赖目录为空");
            return classes.toAbsolutePath() + File.pathSeparator + jars;
        }
    }
}
