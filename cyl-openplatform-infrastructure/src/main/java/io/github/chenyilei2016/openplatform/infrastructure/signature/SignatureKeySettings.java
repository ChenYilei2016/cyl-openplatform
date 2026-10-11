package io.github.chenyilei2016.openplatform.infrastructure.signature;

import java.util.Map;

/** 签名密钥加密适配器使用的只读主密钥配置。 */
public interface SignatureKeySettings {
    String getActiveWrappingKeyId();
    Map<String, String> getWrappingKeys();
}
