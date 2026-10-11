package io.github.chenyilei2016.openplatform.domain.common;

/**
 * 业务对象及记录的ID入口：类型前缀 + "_" + 完整UUIDv7（32位hex），不承担凭据或幂等键生成。
 * 早期类型使用3字母前缀（总长36）；2026-10 起新增类型使用可读的长前缀（如 TENANTSCOPE），对应ID列为 VARCHAR(64)。
 */
public enum ObjectIdType {
    API("API"),
    API_CATEGORY("CAT"),
    APPLICATION("APP"),
    DUBBO_CONNECTION("CON"),
    SCOPE("SCP"),
    TENANT_GRANT("TGR"),
    TENANT_SCOPE_GRANT("TENANTSCOPE"),
    USER_GRANT("UGR"),
    EMPLOYEE_PROFILE("EMP"),
    ADMINISTRATOR("ADM"),
    ADMINISTRATOR_AUDIT("ADA"),
    ACCESS_AUDIT("ACA"),
    CATALOG_AUDIT("CTA"),
    PUBLICATION_AUDIT("PBA"),
    TOKEN_AUDIT("TKA"),
    API_RELEASE("REL"),
    GOVERNANCE_RELEASE("GRL"),
    SDK_ASSET("SDK"),
    ALERT_EVENT("ALT"),
    CALL_RECORD("CAL"),
    TOKEN_RECORD("TOK"),
    INCOMING_RELEASE("RCV"),
    MCP_TENANT_ACTIVATION("MCPTENANT"),
    MCP_TOOL_SET("MCPTOOLSET");

    private static final String LEGACY_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    private final String prefix;

    ObjectIdType(String prefix) { this.prefix = prefix; }

    public String nextId() { return prefix + "_" + UuidV7.nextId().replace("-", ""); }

    /** 外部边界接受本类型的新ID及已有UUID，不把其他类型前缀当作有效对象。 */
    public boolean accepts(String value) {
        return value != null && (value.matches(prefix + "_[0-9a-f]{32}") || value.matches(LEGACY_UUID));
    }
}
