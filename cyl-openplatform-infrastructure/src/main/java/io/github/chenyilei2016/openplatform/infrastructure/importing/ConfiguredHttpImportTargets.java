package io.github.chenyilei2016.openplatform.infrastructure.importing;

import io.github.chenyilei2016.openplatform.application.importing.HttpImportTargetPolicy;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformTarget;
import org.springframework.stereotype.Component;

/** 导入与手动保存使用相同地址格式规则；不再要求部署登记目标。 */
@Component
public final class ConfiguredHttpImportTargets implements HttpImportTargetPolicy {
    @Override public Decision check(ApiDefinition before, ApiDefinition candidate) {
        if (candidate.binding().http() == null) return Decision.PERMITTED;
        try {
            candidate.binding().validate();
            OpenPlatformTarget.origin(candidate.binding().http().template().origin());
            return Decision.PERMITTED;
        } catch (IllegalArgumentException | PlatformException invalid) {
            return Decision.REJECTED;
        }
    }
}
