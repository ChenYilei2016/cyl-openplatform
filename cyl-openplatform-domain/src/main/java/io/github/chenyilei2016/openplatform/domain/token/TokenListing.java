package io.github.chenyilei2016.openplatform.domain.token;

/** 分页时批量关联授权状态，只表示平台持久化事实，不逐条调用人员目录。 */
public record TokenListing(StoredToken token, boolean authorizationValid) {}
