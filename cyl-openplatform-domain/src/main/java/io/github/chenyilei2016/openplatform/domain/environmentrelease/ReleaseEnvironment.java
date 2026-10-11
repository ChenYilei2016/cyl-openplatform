package io.github.chenyilei2016.openplatform.domain.environmentrelease;

import java.util.List;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.Target;

/** 运维指定的环境身份与信任关系；认证失败必须拒绝，不创建管理会话。 */
public interface ReleaseEnvironment {
    String environmentId();
    String nodeId();
    List<Target> targets();
    void authenticate(String sourceEnvironment, String credential);
}
