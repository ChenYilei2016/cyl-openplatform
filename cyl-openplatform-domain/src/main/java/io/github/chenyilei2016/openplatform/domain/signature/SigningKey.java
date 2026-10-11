package io.github.chenyilei2016.openplatform.domain.signature;

import java.time.Instant;

/** 不含秘密的签名密钥元数据。 */
public record SigningKey(String keyId, String applicationId, long revision, SigningKeyStatus status,
                         Instant createdAt, Instant changedAt) {}
