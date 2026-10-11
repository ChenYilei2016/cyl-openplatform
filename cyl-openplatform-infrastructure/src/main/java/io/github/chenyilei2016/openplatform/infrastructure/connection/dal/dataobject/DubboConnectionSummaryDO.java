package io.github.chenyilei2016.openplatform.infrastructure.connection.dal.dataobject;

import lombok.Getter;
import lombok.Setter;

/** JOIN查询投影，复用头字段；不会读取修订配置JSON。 */
@Getter
@Setter
public class DubboConnectionSummaryDO extends DubboConnectionDO {
    private String metadataType;
    private String discoveryMode;
    private String providerMetadataMode;
}
