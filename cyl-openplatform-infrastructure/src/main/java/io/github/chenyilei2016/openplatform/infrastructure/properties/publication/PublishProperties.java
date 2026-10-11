package io.github.chenyilei2016.openplatform.infrastructure.properties.publication;

import io.github.chenyilei2016.openplatform.application.publication.PublishSettings;
import lombok.RequiredArgsConstructor;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** 审核开关保留原有按次读取行为，不在启动时固定为快照。 */
@Component
@RequiredArgsConstructor
public class PublishProperties implements PublishSettings {
    private final Environment environment;

    @Override
    public boolean auditEnabled() {
        return environment.getProperty("open-platform.publish.audit.enabled", Boolean.class, true);
    }
}
