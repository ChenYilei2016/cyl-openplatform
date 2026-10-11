package io.github.chenyilei2016.openplatform.application.governance;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.application.access.AccessAuditService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogRepository;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRule;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Objects;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import static io.github.chenyilei2016.openplatform.application.governance.GovernanceRuleManagement.*;

/** 草稿、发布指针和审计同事务；确认只取固定数据库候选，不接受客户端替换策略。 */
@Service
@RequiredArgsConstructor
public class GovernanceRuleManagementService {
    private static final long MAX_VERSION = 9_007_199_254_740_991L;
    private final GovernanceRuleManagementRepository repository;
    private final ApplicationRepository applications;
    private final ApiCatalogRepository apis;
    private final AccessAuditService audits;

    public PageResult<Draft> page(Query query) {
        validatePage(query.page(), query.pageSize());
        if (query.nameContains() != null && query.nameContains().length() > 100
                || query.tenantId() != null && !query.tenantId().matches("[A-Za-z0-9_-]{1,64}")
                || query.appKey() != null && !query.appKey().matches("[a-f0-9]{32}")
                || query.apiId() != null && !query.apiId().matches("[A-Za-z0-9_-]{1,36}")) throw invalid("治理查询字段不合法");
        return repository.page(query);
    }

    public Map<String, Long> associationCounts(GovernanceRule.Type targetType, List<String> targetIds,
                                               Set<GovernanceRule.Type> allowedTypes) {
        int idLimit = targetType == GovernanceRule.Type.TENANT ? 64 : 36;
        if (targetType != GovernanceRule.Type.API && targetType != GovernanceRule.Type.APPLICATION && targetType != GovernanceRule.Type.TENANT
                || targetIds == null || targetIds.isEmpty() || targetIds.size() > 100
                || targetIds.stream().anyMatch(id -> id == null || !id.matches("[A-Za-z0-9_-]{1," + idLimit + "}")))
            throw invalid("关联规则统计需要API、凭据或租户维度及1至100个有效对象ID");
        return repository.associationCounts(targetType, targetIds.stream().distinct().toList(), allowedTypes).stream()
                .collect(Collectors.toMap(AssociationCount::targetId, AssociationCount::ruleCount));
    }

    public Draft find(String id) {
        if (id == null || !id.matches("[A-Za-z0-9:_-]{1,240}")) throw invalid("治理规则编号不合法");
        return repository.find(id).orElseThrow(() -> missing("治理规则不存在"));
    }

    public Draft create(String name, Config config, AccessOperator operator) {
        String title = title(name);
        if (config == null) throw invalid("必须提供完整策略配置");
        String id = config.target().stableId();
        return audits.change("CREATE_GOVERNANCE_DRAFT", config.target().applicationId(), config.target().tenantId(), id, operator, () -> {
            lockTarget(config.target());
            if (repository.find(id).isPresent()) throw conflict("此目标已存在治理规则，请编辑原规则");
            Draft draft = new Draft(id, title, config, 1, 0, null, null, null, null);
            try { repository.create(draft); }
            catch (DataIntegrityViolationException failure) { throw conflict("此目标已存在治理规则，请重新查询"); }
            return find(id);
        });
    }

    public Draft save(String id, String name, Config config, long expectedDraftRevision, AccessOperator operator) {
        Draft existing = find(id);
        String title = title(name);
        if (config == null || !config.target().equals(existing.config().target())) throw invalid("治理目标不可修改，请为新目标新增规则");
        return audits.change("SAVE_GOVERNANCE_DRAFT", config.target().applicationId(), config.target().tenantId(), id, operator, () -> {
            Draft current = repository.lock(id).orElseThrow(() -> missing("治理规则不存在"));
            if (current.draftRevision() != expectedDraftRevision) throw conflict("草稿修订已变化，请重新读取");
            if (current.name().equals(title) && current.config().equals(config)) return find(id);
            if (current.draftRevision() >= MAX_VERSION) throw conflict("草稿修订已达上限");
            Draft updated = new Draft(id, title, config, current.draftRevision() + 1, current.stateVersion(), current.liveReleaseId(), current.liveRule(), current.targetDisplay(), current.liveName());
            repository.save(updated, current.draftRevision(), current.stateVersion());
            return find(id);
        });
    }

    @Transactional(readOnly = true)
    public Preview preview(String id, String sourceReleaseId) { return preview(find(id), sourceReleaseId); }

    public Release publish(String id, long expectedDraftRevision, long expectedStateVersion, String sourceReleaseId,
                           String previewDigest, AccessOperator operator) {
        Draft initial = find(id);
        return audits.change(sourceReleaseId == null ? "PUBLISH_GOVERNANCE" : "ROLLBACK_GOVERNANCE",
                initial.config().target().applicationId(), initial.config().target().tenantId(), id, operator, () -> {
            // 目标行与草稿行按固定顺序加锁，发布时再次核对预览基线。
            lockTarget(initial.config().target());
            Draft current = repository.lock(id).orElseThrow(() -> missing("治理规则不存在"));
            if (current.draftRevision() != expectedDraftRevision || current.stateVersion() != expectedStateVersion)
                throw conflict("草稿或生效状态已变化，请重新预览");
            Preview preview = preview(current, sourceReleaseId);
            if (!preview.digest().equals(previewDigest)) throw conflict("预览基线或策略内容已变化，请重新预览");
            if (!preview.change()) throw conflict("策略与当前生效内容一致，无需重复发布");
            Release release = new Release(ObjectIdType.GOVERNANCE_RELEASE.nextId(), id, preview.after(), preview.name(), Instant.now(), sourceReleaseId,
                    operator.tenantId(), operator.employeeNo(), preview.digest());
            repository.append(release);
            repository.save(new Draft(id, current.name(), current.config(), current.draftRevision(), preview.after().version(), release.id(), release.rule(), current.targetDisplay(), release.name()),
                    current.draftRevision(), current.stateVersion());
            return release;
        });
    }

    public PageResult<Release> releases(String id, int page, int pageSize) {
        find(id); validatePage(page, pageSize); return repository.releases(id, page, pageSize);
    }
    public Release result(String id, String previewDigest) {
        find(id);
        if (previewDigest == null || !previewDigest.matches("[0-9a-f]{64}")) throw invalid("预览摘要不合法");
        return repository.result(id, previewDigest).orElseThrow(() -> missing("此预览尚无发布结果，可核对原基线后重试"));
    }

    private Preview preview(Draft current, String sourceReleaseId) {
        if (current.stateVersion() >= MAX_VERSION) throw conflict("生效状态版本已达上限");
        Release source = sourceReleaseId == null ? null : repository.release(current.id(), sourceReleaseId)
                .orElseThrow(() -> missing("此规则下的历史发布不存在"));
        Config candidate = source == null ? current.config() : Config.from(source.rule());
        String candidateName = source == null ? current.name() : source.name();
        Release live = current.liveReleaseId() == null ? null : repository.release(current.id(), current.liveReleaseId())
                .orElseThrow(() -> new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "生效发布记录缺失"));
        GovernanceRule before = current.liveRule();
        GovernanceRule after = candidate.runtime(current.stateVersion() + 1);
        String beforeName = live == null ? null : live.name();
        boolean change = live == null || before == null || !candidate.equals(Config.from(before)) || !candidateName.equals(beforeName);
        List<String> warnings = new ArrayList<>();
        warnings.add("所有命中规则取交集；本次只发布治理策略，不进入API审核队列。正式额度按通过治理准入次数计，日界为Redis时间UTC自然日。");
        warnings.add("停用、重新启用、调额和回滚不重置已有计数；调大容量不瞬间补满，调小按新容量钳制。");
        if (after.mode() == GovernanceRule.Mode.OBSERVE)
            warnings.add("观察 · 只记录，不拦截：使用独立影子计数，不绕过其他执行策略；不等于精确重放历史流量。");
        else warnings.add("执行 · 超限即拦截：从观察切换时不复制影子余额，沿用正式计数状态；新建令牌桶从突发容量开始，调整容量不额外赠送余额。");
        if (!after.enabled()) warnings.add("停用只停止本规则拦截，其他命中规则仍生效；当日计数保持。");
        String digest = CredentialSecrets.digest(Stream.of(current.id(), Long.toString(current.draftRevision()), Long.toString(current.stateVersion()),
                        Objects.toString(sourceReleaseId, ""), candidateName, candidate.toString(), Objects.toString(beforeName, ""),
                        Objects.toString(before, ""))
                .map(value -> value.length() + ":" + value).collect(Collectors.joining()));
        return new Preview(current.id(), current.draftRevision(), current.stateVersion(), sourceReleaseId, digest, candidateName, beforeName, before, after, change, warnings);
    }

    private void lockTarget(GovernanceRule.Target target) {
        if (target.applicationId() != null) applications.lock(target.applicationId());
        if (target.apiId() != null) apis.lock(target.apiId()).orElseThrow(() -> missing("目标API不存在"));
    }
    private static String title(String name) {
        if (name == null || name.strip().isEmpty() || name.strip().length() > 100) throw invalid("策略名称必填且最多100字符");
        return name.strip();
    }
    public static void validatePage(int page, int pageSize) {
        if (page < 1 || pageSize < 1 || pageSize > 100 || (long) (page - 1) * pageSize > 100_000) throw invalid("分页大小1–100，偏移最多100000");
    }
    private static PlatformException invalid(String message) { return new PlatformException(ErrorCode.INVALID_REQUEST, message); }
    private static PlatformException conflict(String message) { return new PlatformException(ErrorCode.CONFLICT, message); }
    private static PlatformException missing(String message) { return new PlatformException(ErrorCode.NOT_FOUND, message); }
}
