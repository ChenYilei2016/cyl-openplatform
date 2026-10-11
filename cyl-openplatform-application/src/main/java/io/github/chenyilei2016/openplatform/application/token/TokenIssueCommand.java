package io.github.chenyilei2016.openplatform.application.token;

public record TokenIssueCommand(String appKey, String appSecret, String tenantId, String employeeNo, String existingToken) {
    @Override public String toString() { return "TokenIssueCommand[appKey=" + appKey + ",tenantId=" + tenantId + "]"; }
}
