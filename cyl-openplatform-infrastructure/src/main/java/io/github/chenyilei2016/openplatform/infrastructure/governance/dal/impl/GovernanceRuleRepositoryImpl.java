package io.github.chenyilei2016.openplatform.infrastructure.governance.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.application.governance.GovernanceRuleManagementRepository;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRequest;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRule;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRuleRepository;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import io.github.chenyilei2016.openplatform.infrastructure.governance.dal.dataobject.GovernanceReleaseDO;
import io.github.chenyilei2016.openplatform.infrastructure.governance.dal.dataobject.GovernanceRuleDO;
import io.github.chenyilei2016.openplatform.infrastructure.governance.dal.mapper.GovernanceReleaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.governance.dal.mapper.GovernanceRuleMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;
import static io.github.chenyilei2016.openplatform.application.governance.GovernanceRuleManagement.*;

@Repository
@RequiredArgsConstructor
public class GovernanceRuleRepositoryImpl implements GovernanceRuleManagementRepository, GovernanceRuleRepository {
    private final ReleaseEnvironment environment;
    private final GovernanceRuleMapper rules;
    private final GovernanceReleaseMapper releases;
    private final JsonMapper json;

    @Override public PageResult<Draft> page(Query query) {
        if (query.allowedTypes().isEmpty()) return new PageResult<>(List.of(), 0, query.page(), query.pageSize());
        IPage<GovernanceRuleDO> result = rules.pageRules(environment.environmentId(), new Page<>(query.page(), query.pageSize()), query, SqlPatterns.contains(query.nameContains()));
        return new PageResult<>(result.getRecords().stream().map(this::draft).toList(), result.getTotal(), query.page(), query.pageSize());
    }
    @Override public List<AssociationCount> associationCounts(GovernanceRule.Type targetType, List<String> targetIds,
                                                              Set<GovernanceRule.Type> allowedTypes) {
        if (targetIds.isEmpty() || allowedTypes.isEmpty()) return List.of();
        return rules.associationCounts(environment.environmentId(), targetType, targetIds, allowedTypes);
    }
    @Override public Optional<Draft> find(String id) { return Optional.ofNullable(rules.detail(environment.environmentId(), id)).map(this::draft); }
    @Override public Optional<Draft> lock(String id) { return Optional.ofNullable(rules.lock(environment.environmentId(), id)).map(this::draft); }
    @Override public void create(Draft draft) { rules.insert(row(draft)); }
    @Override public void save(Draft draft, long expectedDraftRevision, long expectedStateVersion) {
        if (rules.updateChecked(environment.environmentId(), row(draft), expectedDraftRevision, expectedStateVersion) != 1)
            throw new OptimisticLockingFailureException("治理草稿或生效状态并发变化");
    }
    @Override public boolean hasPublished(String id) {
        GovernanceRuleDO row = rules.detail(environment.environmentId(), id);
        return row != null && row.getLiveReleaseId() != null;
    }
    @Override public void append(Release release) {
        GovernanceReleaseDO row = new GovernanceReleaseDO();
        row.setId(release.id()); row.setRuleId(release.ruleId()); row.setStateVersion(release.rule().version());
        row.setName(release.name()); row.setRuleJson(json.writeValueAsString(release.rule())); row.setPublishedAt(release.publishedAt());
        row.setSourceReleaseId(release.sourceReleaseId()); row.setOperatorTenantId(release.operatorTenantId());
        row.setOperatorEmployeeNo(release.operatorEmployeeNo()); row.setPreviewDigest(release.previewDigest()); releases.insert(row);
    }
    @Override public Optional<Release> release(String ruleId, String releaseId) {
        return Optional.ofNullable(releases.selectById(releaseId)).filter(row -> row.getRuleId().equals(ruleId)).map(this::release);
    }
    @Override public Optional<Release> result(String ruleId, String previewDigest) {
        return Optional.ofNullable(releases.selectOne(Wrappers.<GovernanceReleaseDO>lambdaQuery()
                .eq(GovernanceReleaseDO::getRuleId, ruleId).eq(GovernanceReleaseDO::getPreviewDigest, previewDigest))).map(this::release);
    }
    @Override public PageResult<Release> releases(String ruleId, int page, int pageSize) {
        Page<GovernanceReleaseDO> result = releases.selectPage(new Page<>(page, pageSize), Wrappers.<GovernanceReleaseDO>lambdaQuery()
                .eq(GovernanceReleaseDO::getRuleId, ruleId).orderByDesc(GovernanceReleaseDO::getStateVersion));
        return new PageResult<>(result.getRecords().stream().map(this::release).toList(), result.getTotal(), page, pageSize);
    }
    @Override public List<GovernanceRule> findApplicable(GovernanceRequest request) {
        List<GovernanceRule.Target> targets = List.of(
                new GovernanceRule.Target(GovernanceRule.Type.APPLICATION, null, request.applicationId(), null),
                new GovernanceRule.Target(GovernanceRule.Type.API, null, null, request.apiId()),
                new GovernanceRule.Target(GovernanceRule.Type.TENANT, request.tenantId(), null, null),
                new GovernanceRule.Target(GovernanceRule.Type.TENANT_API, request.tenantId(), null, request.apiId()),
                new GovernanceRule.Target(GovernanceRule.Type.APPLICATION_API, null, request.applicationId(), request.apiId()));
        Map<String, GovernanceRuleDO> found = rules.selectByIds(targets.stream().map(GovernanceRule.Target::stableId).toList())
                .stream().collect(Collectors.toMap(GovernanceRuleDO::getId, Function.identity()));
        List<GovernanceRule> result = new ArrayList<>();
        found.values().stream().filter(row -> row.getLiveRuleJson() != null)
                .map(row -> json.readValue(row.getLiveRuleJson(), GovernanceRule.class)).forEach(result::add);
        return List.copyOf(result);
    }
    private Draft draft(GovernanceRuleDO row) {
        return new Draft(row.getId(), row.getName(), json.readValue(row.getConfigJson(), Config.class), row.getDraftRevision(), row.getStateVersion(),
                row.getLiveReleaseId(), row.getLiveRuleJson() == null ? null : json.readValue(row.getLiveRuleJson(), GovernanceRule.class),
                new TargetDisplay(row.getApplicationName(), row.getAppKey(), row.getApiName(), row.getApiService(), row.getApiVersion(), row.getApiMethod()), row.getLiveName());
    }
    private Release release(GovernanceReleaseDO row) {
        return new Release(row.getId(), row.getRuleId(), json.readValue(row.getRuleJson(), GovernanceRule.class), row.getName(), row.getPublishedAt(),
                row.getSourceReleaseId(), row.getOperatorTenantId(), row.getOperatorEmployeeNo(), row.getPreviewDigest());
    }
    private GovernanceRuleDO row(Draft draft) {
        GovernanceRuleDO row = new GovernanceRuleDO();
        row.setId(draft.id()); row.setName(draft.name()); row.setTargetType(draft.config().target().type().name());
        row.setTenantId(draft.config().target().tenantId()); row.setApplicationId(draft.config().target().applicationId()); row.setApiId(draft.config().target().apiId());
        row.setLiveMode(draft.liveRule() == null ? null : draft.liveRule().mode().name()); row.setConfigJson(json.writeValueAsString(draft.config()));
        row.setDraftRevision(draft.draftRevision()); row.setStateVersion(draft.stateVersion()); row.setLiveReleaseId(draft.liveReleaseId());
        row.setLiveRuleJson(draft.liveRule() == null ? null : json.writeValueAsString(draft.liveRule())); return row;
    }
}
