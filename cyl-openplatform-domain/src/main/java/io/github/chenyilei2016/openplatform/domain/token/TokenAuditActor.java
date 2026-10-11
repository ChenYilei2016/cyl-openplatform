package io.github.chenyilei2016.openplatform.domain.token;

/** 外部调用与后台操作明确区分，不能伪造平台后台操作者。 */
public record TokenAuditActor(Kind kind, String operatorTenantId, String operatorEmployeeNo) {
    public enum Kind { APPLICATION_CREDENTIALS, BEARER, ADMIN }
}
