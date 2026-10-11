package io.github.chenyilei2016.openplatform.application.access;

/** 原始凭据只用于本次响应，禁止自动生成包含密钥的 toString。 */
public record ApplicationCredentials(ApplicationView application, String appSecret) {
    @Override public String toString() { return "ApplicationCredentials[applicationId=" + application.id() + "]"; }
}
