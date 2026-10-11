package io.github.chenyilei2016.openplatform.domain.catalog;

/** API调用性质；未标注的老API按会修改数据处理，不被当作可安全重试的查询。 */
public enum ApiOperationKind {
    QUERY, MUTATION
}
