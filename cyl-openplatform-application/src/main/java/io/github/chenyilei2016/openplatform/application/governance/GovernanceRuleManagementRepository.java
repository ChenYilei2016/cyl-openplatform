package io.github.chenyilei2016.openplatform.application.governance;

import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.Optional;
import java.util.List;
import java.util.Set;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRule;
import static io.github.chenyilei2016.openplatform.application.governance.GovernanceRuleManagement.*;

public interface GovernanceRuleManagementRepository {
    PageResult<Draft> page(Query query);
    List<AssociationCount> associationCounts(GovernanceRule.Type targetType, List<String> targetIds,
                                            Set<GovernanceRule.Type> allowedTypes);
    Optional<Draft> find(String id);
    Optional<Draft> lock(String id);
    void create(Draft draft);
    void save(Draft draft, long expectedDraftRevision, long expectedStateVersion);
    void append(Release release);
    Optional<Release> release(String ruleId, String releaseId);
    Optional<Release> result(String ruleId, String previewDigest);
    PageResult<Release> releases(String ruleId, int page, int pageSize);
    boolean hasPublished(String id);
}
