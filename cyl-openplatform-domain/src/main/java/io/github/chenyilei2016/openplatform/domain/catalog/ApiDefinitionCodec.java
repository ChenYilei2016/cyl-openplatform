package io.github.chenyilei2016.openplatform.domain.catalog;

/** 目录契约的持久化编码及统一规模校验。 */
public interface ApiDefinitionCodec {
    String encode(ApiDefinition definition);
    ApiDefinition decode(String text);
}
