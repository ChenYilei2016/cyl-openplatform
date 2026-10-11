package io.github.chenyilei2016.openplatform.domain.connection;

import java.time.Instant;

/** 连接的草稿、可选修订及整体启停各自独立；激活不会重绑既有API。 */
public record DubboConnection(String id, String name, String environmentId, String description,
                              long draftRevision, Long activeRevision, boolean enabled,
                              long stateVersion, Instant updatedAt) {}
