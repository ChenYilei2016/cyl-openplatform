package io.github.chenyilei2016.openplatform.infrastructure.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import java.util.List;

/** 跨环境客户端的可信传输目标；领域环境视图不暴露凭据。 */
public interface EnvironmentReleaseSettings extends ReleaseEnvironment {
    RemoteTarget requireTarget(String id);

    record RemoteTarget(String id, String name, String credential, List<Node> nodes) {
        @Override public String toString() { return "RemoteTarget[id=" + id + "]"; }
    }
    record Node(String id, String origin) {}
    record TrustedSource(String id, String credential) {
        @Override public String toString() { return "TrustedSource[id=" + id + "]"; }
    }
}
