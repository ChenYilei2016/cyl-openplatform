package io.github.chenyilei2016.openplatform.domain.token;

import java.time.Instant;

public record TokenAudit(String id, TokenAction action, TokenAuditActor actor, TokenAuditTarget target,
                         String outcome, String reason, String requestId, Instant occurredAt) {}
