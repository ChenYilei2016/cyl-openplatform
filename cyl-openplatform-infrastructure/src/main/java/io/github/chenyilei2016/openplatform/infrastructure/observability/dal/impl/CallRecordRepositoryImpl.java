package io.github.chenyilei2016.openplatform.infrastructure.observability.dal.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.core.metadata.IPage;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.observability.ObservationQuery;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository;
import io.github.chenyilei2016.openplatform.infrastructure.observability.dal.dataobject.CallRecordDO;
import io.github.chenyilei2016.openplatform.infrastructure.observability.dal.mapper.CallRecordMapper;
import io.github.chenyilei2016.openplatform.infrastructure.operations.metrics.dal.mapper.CallMinuteMapper;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

@Repository
@RequiredArgsConstructor
public class CallRecordRepositoryImpl implements CallRecordRepository {
    private final CallRecordMapper mapper;
    private final CallMinuteMapper minutes;
    private final tools.jackson.databind.json.JsonMapper json;

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 2)
    public void append(CallRecord record) {
        mapper.insert(new CallRecordDO(
                record.id(), record.requestId(), record.mode(), record.apiId(),
                record.service(), record.version(), record.method(), record.protocol(),
                record.applicationId(), record.tenantId(), record.userId(), record.employeeId(), record.identityKind(),
                record.governance() != null && !record.governance().allowed(), record.governance() != null && record.governance().observed(),
                record.governance() == null ? null : record.governance().denialReason(), record.employeeNo(),
                record.clientIp(), record.releaseId(), record.draftRevision(), record.operatorTenantId(),
                record.operatorEmployeeNo(), record.outcome(), record.errorCode(), record.httpStatus(),
                record.durationMillis(), record.occurredAt(), record.governance() == null ? null : json.writeValueAsString(record.governance()),
                record.channel(), record.toolName()));
        // 仅唯一记录插入成功后计数；任一步异常使明细与聚合一起回滚。
        minutes.increment(record, Math.floorDiv(record.occurredAt().getEpochSecond(), 60));
        if (record.governance() != null && !record.governance().hits().isEmpty()) {
            if (record.governance().hits().size() > 6) throw new IllegalArgumentException("单次调用最多记录6条治理评估");
            mapper.insertRuleFacts(record.id(), record.governance().hits());
            minutes.incrementRules(record, Math.floorDiv(record.occurredAt().getEpochSecond(), 60));
        }
    }

    @Override
    public PageResult<CallRecord> page(ObservationQuery query) {
        IPage<CallRecordDO> result = mapper.selectPage(new Page<>(query.page(), query.pageSize()), Wrappers.<CallRecordDO>lambdaQuery()
                .ge(CallRecordDO::getOccurredAt, query.from()).lt(CallRecordDO::getOccurredAt, query.to())
                .eq(query.id() != null, CallRecordDO::getId, query.id())
                .eq(query.employeeNo() != null, CallRecordDO::getEmployeeNo, query.employeeNo())
                .eq(query.employeeId() != null, CallRecordDO::getEmployeeId, query.employeeId())
                .eq(query.identityKind() != null, CallRecordDO::getIdentityKind, query.identityKind())
                .eq(query.governanceOutcome() == ObservationQuery.GovernanceOutcome.REJECTED, CallRecordDO::isGovernanceRejected, true)
                .eq(query.governanceOutcome() == ObservationQuery.GovernanceOutcome.OBSERVED, CallRecordDO::isObserved, true)
                .eq(query.denialReason() != null, CallRecordDO::isGovernanceRejected, true)
                .eq(query.denialReason() != null && query.ruleId() == null, CallRecordDO::getGovernanceDenialReason, query.denialReason())
                .apply(query.denialReason() != null && query.ruleId() != null,
                        "EXISTS(SELECT 1 FROM platform_call_rule_record h WHERE h.record_id=platform_call_record.id AND h.rule_id={0} AND h.rule_mode='ENFORCE' AND h.reason={1} AND ({2} IS NULL OR h.rule_version={2}))",
                        query.ruleId(), query.denialReason() == null ? null : query.denialReason().name(), query.ruleVersion())
                .apply(query.ruleId() != null, "EXISTS(SELECT 1 FROM platform_call_rule_record h WHERE h.record_id=platform_call_record.id AND h.rule_id={0})", query.ruleId())
                .apply(query.ruleVersion() != null, "EXISTS(SELECT 1 FROM platform_call_rule_record h WHERE h.record_id=platform_call_record.id AND h.rule_id={0} AND h.rule_version={1})", query.ruleId(), query.ruleVersion())
                .apply(query.ruleId() != null && query.governanceOutcome() == ObservationQuery.GovernanceOutcome.REJECTED,
                        "EXISTS(SELECT 1 FROM platform_call_rule_record h WHERE h.record_id=platform_call_record.id AND h.rule_id={0} AND h.rule_mode='ENFORCE' AND h.reason!='NONE')", query.ruleId())
                .apply(query.ruleId() != null && query.governanceOutcome() == ObservationQuery.GovernanceOutcome.OBSERVED,
                        "EXISTS(SELECT 1 FROM platform_call_rule_record h WHERE h.record_id=platform_call_record.id AND h.rule_id={0} AND h.rule_mode='OBSERVE' AND h.reason!='NONE')", query.ruleId())
                .eq(query.requestId() != null, CallRecordDO::getRequestId, query.requestId())
                .eq(query.apiId() != null, CallRecordDO::getApiId, query.apiId())
                .eq(query.applicationId() != null, CallRecordDO::getApplicationId, query.applicationId())
                .eq(query.tenantId() != null, CallRecordDO::getTenantId, query.tenantId())
                .eq(query.channel() != null, CallRecordDO::getChannel, query.channel())
                .eq(query.toolName() != null, CallRecordDO::getToolName, query.toolName())
                .in(!query.modes().isEmpty(), CallRecordDO::getMode, query.modes())
                .in(!query.outcomes().isEmpty(), CallRecordDO::getOutcome, query.outcomes())
                .ge(query.durationMin() != null, CallRecordDO::getDurationMillis, query.durationMin())
                .le(query.durationMax() != null, CallRecordDO::getDurationMillis, query.durationMax())
                .orderByDesc(CallRecordDO::getOccurredAt, CallRecordDO::getId));
        return new PageResult<>(result.getRecords().stream().map(row -> new CallRecord(
                row.getId(), row.getRequestId(), row.getMode(), row.getApiId(),
                row.getService(), row.getVersion(), row.getMethod(), row.getProtocol(),
                row.getApplicationId(), row.getTenantId(), row.getUserId(), row.getEmployeeId(), row.getEmployeeNo(),
                row.getClientIp(), row.getReleaseId(), row.getDraftRevision(), row.getOperatorTenantId(),
                row.getOperatorEmployeeNo(), row.getOutcome(), row.getErrorCode(), row.getHttpStatus(),
                row.getDurationMillis(), row.getOccurredAt(), row.getGovernanceJson() == null ? null : json.readValue(row.getGovernanceJson(), io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision.class),
                row.getChannel(), row.getToolName())).toList(), result.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public Map<String, Instant> latestProductionCalls(Collection<String> applicationIds) {
        if (applicationIds.isEmpty()) return Map.of();
        if (applicationIds.size() > 100) throw new IllegalArgumentException("最近调用时间每次最多查询100个凭据");
        Map<String, Instant> latest = new HashMap<>();
        mapper.selectLatestProductionCalls(List.copyOf(applicationIds)).stream()
                .filter(row -> row.getLastCalledAt() != null)
                .forEach(row -> latest.put(row.getApplicationId(), row.getLastCalledAt()));
        return latest;
    }

    @Override
    @Transactional
    public int deleteExpired(Instant before, int batchSize) {
        if (batchSize < 1 || batchSize > 1000) throw new IllegalArgumentException("清理批次需在1至1000内");
        List<String> ids = mapper.expiredIds(before, batchSize);
        if (ids.isEmpty()) return 0;
        mapper.deleteRuleFacts(ids);
        return mapper.deleteByIds(ids);
    }
}
