package io.github.chenyilei2016.openplatform.signature;

import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKey;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKeyStatus;
import io.github.chenyilei2016.openplatform.infrastructure.signature.AesGcmSigningSecretCipher;
import io.github.chenyilei2016.openplatform.infrastructure.properties.signature.SignatureKeyProperties;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class SigningSecretCipherTest {
    @Test void keyRingSupportsStagedRotationAndRejectsMissingOrInvalidConfiguration() {
        var properties = new SignatureKeyProperties();
        var disabled = new AesGcmSigningSecretCipher(properties);
        assertThat(disabled.configured()).isFalse();
        var key = new SigningKey("a".repeat(32), "app-1", 1, SigningKeyStatus.ACTIVE, Instant.now(), Instant.now());
        byte[] secret = new byte[32]; secret[0] = 17;
        assertThatThrownBy(() -> disabled.encrypt(key, secret)).isInstanceOf(PlatformException.class);
        String oldMaster = Base64.getEncoder().encodeToString(new byte[32]);
        String newMaster = Base64.getEncoder().encodeToString(secret);
        properties.setActiveWrappingKeyId("old"); properties.setWrappingKeys(Map.of("old", oldMaster));
        var first = new AesGcmSigningSecretCipher(properties).encrypt(key, secret);
        properties.setActiveWrappingKeyId("new"); properties.setWrappingKeys(Map.of("old", oldMaster, "new", newMaster));
        var migrating = new AesGcmSigningSecretCipher(properties);
        assertThat(migrating.decrypt(key, first)).isEqualTo(secret);
        var next = migrating.encrypt(key, secret);
        assertThat(next.wrappingKeyId()).isEqualTo("new");
        assertThat(migrating.encrypt(key, secret).encryptedSecret()).isNotEqualTo(next.encryptedSecret());
        properties.setWrappingKeys(Map.of("new", newMaster));
        var rotated = new AesGcmSigningSecretCipher(properties);
        assertThat(rotated.decrypt(key, next)).isEqualTo(secret);
        assertThatThrownBy(() -> rotated.decrypt(key, first)).isInstanceOf(PlatformException.class);
        properties.setWrappingKeys(Map.of("new", "invalid-sensitive-value"));
        assertThatThrownBy(() -> new AesGcmSigningSecretCipher(properties)).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("签名主密钥配置不合法");
        properties.setWrappingKeys(Map.of("1", oldMaster, "2", oldMaster, "3", oldMaster, "4", oldMaster, "5", oldMaster));
        assertThatThrownBy(() -> new AesGcmSigningSecretCipher(properties)).isInstanceOf(IllegalArgumentException.class);
    }
}
