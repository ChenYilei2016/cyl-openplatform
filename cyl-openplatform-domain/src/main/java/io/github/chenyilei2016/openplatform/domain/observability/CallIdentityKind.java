package io.github.chenyilei2016.openplatform.domain.observability;

/** 仅根据采集链已验证的字段区分人员、应用自主调用与未知身份。 */
public enum CallIdentityKind {
    EMPLOYEE, APPLICATION, UNKNOWN;

    public static CallIdentityKind of(CallRecord record) {
        if (record.tenantId() != null && record.employeeId() != null) return EMPLOYEE;
        if (record.tenantId() != null && record.applicationId() != null && record.userId() == null) return APPLICATION;
        return UNKNOWN;
    }
}
