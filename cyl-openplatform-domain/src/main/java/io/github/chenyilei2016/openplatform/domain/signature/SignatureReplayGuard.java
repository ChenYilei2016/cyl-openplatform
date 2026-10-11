package io.github.chenyilei2016.openplatform.domain.signature;

/** 使用共享时钟检查时间窗并一次性消费nonce，失败关闭准入。 */
public interface SignatureReplayGuard {
    void consume(String keyId, String nonce, long timestamp);
}
