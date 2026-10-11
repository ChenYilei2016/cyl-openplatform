package io.github.chenyilei2016.openplatform.domain.connection;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 业务运行时预热与独立只读注册中心检查。 */
public interface DubboConnectionRuntime {
    void warmup(String connectionId, long revision);

    DiagnosticResult diagnose(String connectionId, long revision);

    /** 本实例有界最近检查；缺少记录不表示全局从未检查。 */
    Map<String, DiagnosticResult> recentChecks(Set<String> connectionIds);

    enum Stage { CONFIG, REGISTRY, INSTANCES, MAPPING, RUNTIME_METADATA, DEFINITION }
    enum CheckStatus { PASSED, FAILED, UNAVAILABLE, NOT_APPLICABLE, NOT_CHECKED }

    record Check(Stage stage, CheckStatus status, String summary) {}

    record DiagnosticResult(String connectionId, long revision, Instant checkedAt, List<Check> checks) {
        public DiagnosticResult { checks = List.copyOf(checks); }
    }

}
