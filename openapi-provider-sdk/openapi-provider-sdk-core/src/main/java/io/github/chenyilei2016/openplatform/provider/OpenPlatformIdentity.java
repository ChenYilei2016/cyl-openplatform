package io.github.chenyilei2016.openplatform.provider;

/** 认证后建立的不可变身份，禁止加入任何认证凭据。ID统一为String。 */
public final class OpenPlatformIdentity {
    public enum SubjectType {
        APP,
        USER
    }

    private final String applicationId;
    private final String appKey;
    private final String tenantId;
    private final String userId;
    private final String employeeId;
    private final String employeeNo;
    private final String requestId;
    private final String traceId;

    OpenPlatformIdentity(
            String applicationId,
            String appKey,
            String tenantId,
            String userId,
            String employeeId,
            String employeeNo,
            String requestId,
            String traceId) {
        this.applicationId = applicationId;
        this.appKey = appKey;
        this.tenantId = tenantId;
        this.userId = userId;
        this.employeeId = employeeId;
        this.employeeNo = employeeNo;
        this.requestId = requestId;
        this.traceId = traceId;
    }

    public String getApplicationId() {
        return applicationId;
    }

    public String getAppKey() {
        return appKey;
    }

    public String getTenantId() {
        return tenantId;
    }

    public SubjectType getSubjectType() {
        return userId == null ? SubjectType.APP : SubjectType.USER;
    }

    public String getUserId() {
        return userId;
    }

    public String getEmployeeId() {
        return employeeId;
    }

    public String getEmployeeNo() {
        return employeeNo;
    }

    public String getRequestId() {
        return requestId;
    }

    /** 上游W3C trace标识只用于关联排障；SDK不创建或替换宿主Span。 */
    public String getTraceId() {
        return traceId;
    }

    public OpenPlatformIdentity requireEmployee() {
        if (getSubjectType() != SubjectType.USER)
            throw new OpenPlatformException(OpenPlatformException.Reason.EMPLOYEE_REQUIRED);
        return this;
    }
}
