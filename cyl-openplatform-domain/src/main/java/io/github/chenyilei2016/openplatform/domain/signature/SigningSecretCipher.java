package io.github.chenyilei2016.openplatform.domain.signature;

public interface SigningSecretCipher {
    boolean configured();
    SigningSecret encrypt(SigningKey key, byte[] secret);
    byte[] decrypt(SigningKey key, SigningSecret secret);
}
