package io.github.chenyilei2016.openplatform.domain.catalog;

/** 外部操作的稳定标识，与内部调用协议及数据库ID无关。 */
public record ApiOperation(String service, String version, String method) {
    public static ApiOperation of(ApiDefinition definition) {
        return new ApiOperation(definition.service(), definition.version(), definition.method());
    }
}
