package io.github.chenyilei2016.openplatform.domain.signature;

/** 加密存储材料，只在应用与存储适配器之间流转。 */
public record SigningSecret(String wrappingKeyId, String encryptedSecret) {
    @Override public String toString() { return "SigningSecret[REDACTED]"; }
}
