package io.github.chenyilei2016.openplatform.domain.token;

public interface TokenAuditRepository {
    void append(TokenAudit audit);
}
