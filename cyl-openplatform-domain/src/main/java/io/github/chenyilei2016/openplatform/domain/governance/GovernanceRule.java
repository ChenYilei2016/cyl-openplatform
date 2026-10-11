package io.github.chenyilei2016.openplatform.domain.governance;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import java.util.List;

/** 当前生效配置的运行时快照；id绑定目标，version只作为配置水位，不参与计数键。 */
public record GovernanceRule(String id, long version, Target target, boolean enabled, Mode mode, Rate rate,
                             long dailyQuota, GovernanceRule.IpMode ipMode, List<String> ipAddresses) {
    public enum Type { APPLICATION, API, TENANT, TENANT_API, APPLICATION_API }
    public enum Mode { ENFORCE, OBSERVE }
    public enum IpMode {
        UNRESTRICTED, ALLOWLIST, DENYLIST;
        public boolean allows(boolean listed) {
            return switch (this) { case UNRESTRICTED -> true; case ALLOWLIST -> listed; case DENYLIST -> !listed; };
        }
    }
    public enum Algorithm {
        NONE(0), TOKEN_BUCKET(2);
        private final int wireCode;
        Algorithm(int wireCode) { this.wireCode = wireCode; }
        public int wireCode() { return wireCode; }
        public static Algorithm fromWireCode(int code) {
            return java.util.Arrays.stream(values()).filter(value -> value.wireCode == code).findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("未知治理算法代码"));
        }
    }

    public record Target(Type type, String tenantId, String applicationId, String apiId) {
        public Target {
            tenantId = tenantId == null || tenantId.isEmpty() ? null : tenantId;
            applicationId = applicationId == null || applicationId.isEmpty() ? null : applicationId;
            apiId = apiId == null || apiId.isEmpty() ? null : apiId;
            if (type == null || tenantId != null && !tenantId.matches("[A-Za-z0-9_-]{1,64}")
                    || applicationId != null && !applicationId.matches("[A-Za-z0-9_-]{1,36}")
                    || apiId != null && !apiId.matches("[A-Za-z0-9_-]{1,36}")) invalid();
            boolean valid = switch (type) {
                case APPLICATION -> tenantId == null && applicationId != null && apiId == null;
                case API -> tenantId == null && applicationId == null && apiId != null;
                case TENANT -> tenantId != null && applicationId == null && apiId == null;
                case TENANT_API -> tenantId != null && applicationId == null && apiId != null;
                case APPLICATION_API -> tenantId == null && applicationId != null && apiId != null;
            };
            if (!valid) invalid();
        }

        public boolean matches(GovernanceRequest request) {
            return (tenantId == null || tenantId.equals(request.tenantId()))
                    && (applicationId == null || applicationId.equals(request.applicationId()))
                    && (apiId == null || apiId.equals(request.apiId()));
        }

        public String stableId() {
            if (type == Type.APPLICATION) return "APPLICATION:" + applicationId;
            if (type == Type.API) return "API:" + apiId;
            String tenant = tenantId == null ? "" : tenantId;
            String application = applicationId == null ? "" : applicationId;
            String api = apiId == null ? "" : apiId;
            return CredentialSecrets.digest(type.name() + ":" + tenant.length() + ":" + tenant
                    + application.length() + ":" + application + api.length() + ":" + api);
        }
    }

    public record Rate(Algorithm algorithm, int perSecond, int burst) {
        public Rate {
            if (algorithm == null || perSecond < 0
                    || perSecond > 1_000_000 || burst < 0 || burst > 1_000_000) invalid();
            boolean valid = switch (algorithm) {
                case NONE -> perSecond == 0 && burst == 0;
                case TOKEN_BUCKET -> perSecond > 0 && burst > 0;
            };
            if (!valid) invalid();
        }
    }

    public GovernanceRule {
        if (id == null || !id.matches("[A-Za-z0-9:_-]{1,240}") || version < 0 || version > 9_007_199_254_740_991L
                || target == null || mode == null || rate == null || dailyQuota < 0 || dailyQuota > 100_000_000
                || ipMode == null || ipAddresses == null || ipAddresses.size() > 100
                || ipMode == GovernanceRule.IpMode.UNRESTRICTED && !ipAddresses.isEmpty()) invalid();
        ipAddresses = ipAddresses.stream().map(value -> IpNetwork.parse(value).toString()).distinct().toList();
    }

    public boolean allowsIp(String clientIp) {
        return ipMode.allows(ipAddresses.stream().anyMatch(value -> IpNetwork.parse(value).contains(clientIp)));
    }

    private static void invalid() { throw new PlatformException(ErrorCode.INVALID_REQUEST, "治理运行时规则字段或范围不合法"); }
}
