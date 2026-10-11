package io.github.chenyilei2016.openplatform.domain.connection;

import java.time.Instant;

/** 不可变技术配置；仅保存凭据引用，不保存凭据值。 */
public record DubboConnectionRevision(String connectionId, long revision,
                                     DubboConnectionConfig config, Instant createdAt) {}
