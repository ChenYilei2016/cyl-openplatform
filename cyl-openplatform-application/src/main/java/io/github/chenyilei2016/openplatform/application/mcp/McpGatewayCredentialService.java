package io.github.chenyilei2016.openplatform.application.mcp;

import io.github.chenyilei2016.openplatform.application.access.AccessAuditService;
import io.github.chenyilei2016.openplatform.application.signature.SigningKeyService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationKind;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationStatus;
import io.github.chenyilei2016.openplatform.domain.access.ClientApplication;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKey;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKeyRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 每环境唯一的 MCP 网关凭据：只证明“这是MCP 网关”，不配置权限组、不绑定租户、不建人员委托。
 * 签名密钥复用 {@link SigningKeyService}（加密保存、单活轮换）；凭据的 AppSecret 不交付，也不能换 Token。
 */
@Service
@RequiredArgsConstructor
public class McpGatewayCredentialService {
    static final String NAME = "MCP 网关";
    private final ApplicationRepository applications;
    private final SigningKeyService signingKeys;
    private final SigningKeyRepository keys;
    private final AccessAuditService audit;
    private final CallRecordRepository callRecords;

    /** 网关凭据当前状态；credential 为空表示本环境尚未创建。 */
    public record Overview(boolean signingConfigured, CredentialView credential) {}

    /** 不含任何秘密；lastCalledAt 为网关凭据最近一次正式调用（MCP 入口记录）。 */
    public record CredentialView(String id, String appKey, String name, String status, SigningKey key, Instant lastCalledAt) {}

    /** 一次性交付：签名密钥只出现在创建或轮换的响应中。 */
    public record IssuedCredential(CredentialView credential, String keyId, String signingSecret) {
        @Override public String toString() { return "IssuedCredential[keyId=" + keyId + ", signingSecret=REDACTED]"; }
    }

    public Overview overview() {
        return new Overview(signingKeys.configured(), applications.findMcpGateway().map(this::view).orElse(null));
    }

    /** 凭据与首个签名密钥同一事务创建；并发重复创建由数据库唯一约束拒绝。 */
    public IssuedCredential create(AccessOperator operator) {
        if (!signingKeys.configured()) throw new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "签名密钥服务尚未配置");
        String id = ObjectIdType.APPLICATION.nextId();
        return audit.change("CREATE_MCP_GATEWAY_CREDENTIAL", id, null, id, operator, () -> {
            if (applications.findMcpGateway().isPresent())
                throw new PlatformException(ErrorCode.CONFLICT, "MCP 网关凭据已存在，每个环境只能创建一个");
            ClientApplication app = new ClientApplication(id, UUID.randomUUID().toString().replace("-", ""), NAME, "",
                    ApplicationStatus.ENABLED, 0, List.of(), ApplicationKind.MCP_GATEWAY);
            // AppSecret 只为满足凭据存储结构，不交付；MCP_GATEWAY 也不能用它换取 Token。
            applications.create(app, CredentialSecrets.digest(CredentialSecrets.generate()));
            var issued = signingKeys.issue(id, ApplicationKind.MCP_GATEWAY, 0, false, operator);
            return new IssuedCredential(new CredentialView(app.id(), app.appKey(), app.name(), app.status().name(), issued.key(), null),
                    issued.key().keyId(), issued.signingSecret());
        });
    }

    /** 立即轮换：旧签名密钥随即失效，网关需在维护窗口内更新配置。 */
    public IssuedCredential rotate(long expectedRevision, AccessOperator operator) {
        ClientApplication app = requireGateway();
        var issued = signingKeys.issue(app.id(), ApplicationKind.MCP_GATEWAY, expectedRevision, true, operator);
        return new IssuedCredential(view(applications.find(app.id()).orElseThrow()), issued.key().keyId(), issued.signingSecret());
    }

    /** 停用即关闭整个 MCP 渠道：MCP 入口按凭据状态拒绝新调用。 */
    public CredentialView setStatus(boolean enabled, AccessOperator operator) {
        ClientApplication app = requireGateway();
        return audit.change("SET_MCP_GATEWAY_STATUS", app.id(), null, app.id(), operator, () -> {
            applications.lock(app.id()).requireKind(ApplicationKind.MCP_GATEWAY);
            applications.changeStatus(app.id(), enabled ? ApplicationStatus.ENABLED : ApplicationStatus.DISABLED);
            return view(applications.find(app.id()).orElseThrow());
        });
    }

    /**
     * 供 MCP 入口在验签通过后调用：签名密钥必须属于启用中的 MCP_GATEWAY 凭据。
     * 普通凭据的密钥按签名无效拒绝，不提示其类型；网关凭据停用时拒绝为无权限。
     */
    public ClientApplication requireActiveGateway(SigningKey key) {
        ClientApplication app = applications.find(key.applicationId())
                .filter(found -> found.kind() == ApplicationKind.MCP_GATEWAY)
                .orElseThrow(() -> new PlatformException(ErrorCode.INVALID_SIGNATURE, "签名无效或密钥已失效"));
        if (app.status() != ApplicationStatus.ENABLED) throw new PlatformException(ErrorCode.FORBIDDEN, "MCP 网关凭据已停用");
        return app;
    }

    private ClientApplication requireGateway() {
        return applications.findMcpGateway()
                .orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "本环境尚未创建 MCP 网关凭据"));
    }

    private CredentialView view(ClientApplication app) {
        return new CredentialView(app.id(), app.appKey(), app.name(), app.status().name(),
                keys.findByApplication(app.id()).orElse(null), callRecords.latestProductionCalls(List.of(app.id())).get(app.id()));
    }
}
