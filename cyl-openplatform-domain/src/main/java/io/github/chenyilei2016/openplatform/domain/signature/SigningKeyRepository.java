package io.github.chenyilei2016.openplatform.domain.signature;

import java.util.Optional;

public interface SigningKeyRepository {
    Optional<SigningKey> findByApplication(String applicationId);
    Optional<SigningKey> findByKeyId(String keyId);
    Optional<SigningSecret> findSecret(SigningKey key);
    /** 调用方须持有应用行锁，保证初次创建及后续版本比较原子完成。 */
    void save(SigningKey key, SigningSecret secret);
}
