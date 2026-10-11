package io.github.chenyilei2016.openplatform.infrastructure.access.dal.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationFilter;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationListing;
import io.github.chenyilei2016.openplatform.domain.access.GrantStatus;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ApplicationSummaryDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ApplicationGrantSummaryDO;
import java.util.stream.Collectors;
import com.baomidou.mybatisplus.core.metadata.IPage;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationKind;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationStatus;
import io.github.chenyilei2016.openplatform.domain.access.ClientApplication;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ApplicationDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper.ApplicationMapper;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper.ApplicationScopeMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class ApplicationRepositoryImpl implements ApplicationRepository {
    private final ApplicationMapper mapper;
    private final ApplicationScopeMapper scopeMapper;

    @Override
    public PageResult<ApplicationListing> page(AccessPageQuery query, ApplicationFilter filter) {
        IPage<ApplicationSummaryDO> page = mapper.selectByQuery(new Page<>(query.page(), query.pageSize()),
                SqlPatterns.contains(query.query()), filter);
        Map<String, ClientApplication> applications = new HashMap<>();
        withScopes(page.getRecords()).forEach(app -> applications.put(app.id(), app));
        Map<String, List<ApplicationGrantSummaryDO>> relations = page.getRecords().isEmpty() ? Map.of()
                : mapper.selectGrantSummaries(page.getRecords().stream().map(ApplicationDO::getId).toList(), filter)
                    .stream().collect(Collectors.groupingBy(ApplicationGrantSummaryDO::getApplicationId));
        return new PageResult<>(page.getRecords().stream().map(row -> {
            List<ApplicationGrantSummaryDO> previews = relations.getOrDefault(row.getId(), List.of());
            return new ApplicationListing(applications.get(row.getId()),
                    row.getSelectedTenantGrantStatus() == null ? null : GrantStatus.valueOf(row.getSelectedTenantGrantStatus()),
                    previews.isEmpty() ? 0 : previews.getFirst().getTotalCount(),
                    previews.isEmpty() ? 0 : previews.getFirst().getMatchedCount(),
                    previews.stream().filter(ApplicationGrantSummaryDO::isMatched)
                            .map(item -> new ApplicationListing.TenantRelation(item.getTenantId(), GrantStatus.valueOf(item.getStatus()))).toList());
        }).toList(), page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public Optional<ClientApplication> find(String id) {
        return Optional.ofNullable(mapper.selectById(id)).map(row -> withScopes(List.of(row)).getFirst());
    }

    @Override
    public Optional<ClientApplication> findByKey(String appKey) {
        return Optional.ofNullable(mapper.selectOne(Wrappers.<ApplicationDO>lambdaQuery().eq(ApplicationDO::getAppKey, appKey)))
                .map(row -> withScopes(List.of(row)).getFirst());
    }

    @Override
    public Optional<ClientApplication> findMcpGateway() {
        return Optional.ofNullable(mapper.selectOne(Wrappers.<ApplicationDO>lambdaQuery()
                        .eq(ApplicationDO::getKind, ApplicationKind.MCP_GATEWAY.name())))
                .map(row -> withScopes(List.of(row)).getFirst());
    }

    @Override
    public ClientApplication lock(String id) {
        ApplicationDO application = mapper.selectForUpdate(id);
        if (application == null) throw new PlatformException(ErrorCode.NOT_FOUND, "应用不存在");
        return withScopes(List.of(application)).getFirst();
    }

    @Override
    public String secretDigest(String id) {
        return mapper.selectSecretDigest(id);
    }

    @Override
    public void create(ClientApplication app, String secretDigest) {
        try {
            mapper.insert(new ApplicationDO(app.id(), app.appKey(), app.name(), app.ownerTenantId(),
                    ApplicationStatus.ENABLED.name(), 0L, secretDigest, app.kind().name()));
        } catch (DuplicateKeyException duplicate) {
            if (app.kind() == ApplicationKind.MCP_GATEWAY)
                throw new PlatformException(ErrorCode.CONFLICT, "MCP 网关凭据已存在，每个环境只能创建一个", duplicate);
            throw duplicate;
        }
        if (!app.scopeCodes().isEmpty()) scopeMapper.insertScopes(app.id(), app.scopeCodes());
    }

    @Override
    public void rename(String id, String name) {
        mapper.update(null, Wrappers.<ApplicationDO>lambdaUpdate()
                .eq(ApplicationDO::getId, id).set(ApplicationDO::getName, name));
    }

    @Override
    public void replaceScopes(String id, List<String> codes) {
        scopeMapper.deleteByApplication(id);
        if (!codes.isEmpty()) scopeMapper.insertScopes(id, codes);
        mapper.incrementVersion(id);
    }

    @Override
    public void changeStatus(String id, ApplicationStatus status) {
        mapper.changeStatus(id, status.name());
    }

    @Override
    public void incrementScopeVersion(String code) {
        mapper.incrementScopeVersion(code);
    }

    @Override
    public void rotateSecret(String id, String secretDigest) {
        mapper.rotateSecret(id, secretDigest);
    }

    private List<ClientApplication> withScopes(List<? extends ApplicationDO> applications) {
        if (applications.isEmpty()) return List.of();
        Map<String, List<String>> scopes = new HashMap<>();
        scopeMapper.selectByApplications(applications.stream().map(ApplicationDO::getId).toList())
                .forEach(relation -> scopes.computeIfAbsent(relation.getApplicationId(), ignored -> new ArrayList<>())
                        .add(relation.getScopeCode()));
        return applications.stream().map(app -> new ClientApplication(app.getId(), app.getAppKey(), app.getName(),
                app.getOwnerTenantId(), ApplicationStatus.valueOf(app.getStatus()), app.getAuthorizationVersion(),
                scopes.getOrDefault(app.getId(), List.of()), ApplicationKind.valueOf(app.getKind()))).toList();
    }
}
