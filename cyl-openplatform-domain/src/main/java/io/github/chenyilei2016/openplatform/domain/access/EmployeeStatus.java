package io.github.chenyilei2016.openplatform.domain.access;

/** 平台人员状态与平台授权资格的对应关系。 */
public enum EmployeeStatus {
    PENDING_ENTRY(false), PROBATION(true), TEMPORARY(true), PERMANENT(true), NOTICE(true), LEFT(false), UNKNOWN(false);

    private final boolean grantable;
    EmployeeStatus(boolean grantable) { this.grantable = grantable; }
    public boolean isGrantable() { return grantable; }

    public static EmployeeStatus fromCode(Integer code) {
        if (code == null) return UNKNOWN;
        return switch (code) {
            case 1 -> PENDING_ENTRY;
            case 2 -> PROBATION;
            case 3 -> TEMPORARY;
            case 4 -> PERMANENT;
            case 5 -> NOTICE;
            case 6 -> LEFT;
            default -> UNKNOWN;
        };
    }
}
