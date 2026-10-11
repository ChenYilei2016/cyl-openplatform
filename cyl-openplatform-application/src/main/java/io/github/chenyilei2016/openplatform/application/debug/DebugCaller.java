package io.github.chenyilei2016.openplatform.application.debug;

/** 草稿调试的调用身份来源：业务 Token，或后台选择的凭据授权（服务端代换，不签发 Token）。 */
public sealed interface DebugCaller {
    record Bearer(String token) implements DebugCaller {}
    record Credential(String tenantGrantId, String userGrantId, String operatorTenantId, String operatorEmployeeNo) implements DebugCaller {}
}
