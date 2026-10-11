package io.github.chenyilei2016.openplatform.infrastructure.documentation.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDocument;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiLifecycle;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.documentation.*;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.ApiDefinitionJson;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import io.github.chenyilei2016.openplatform.infrastructure.documentation.dal.dataobject.DocumentCategoryDO;
import io.github.chenyilei2016.openplatform.infrastructure.documentation.dal.mapper.DocumentCatalogMapper;
import io.github.chenyilei2016.openplatform.infrastructure.publication.dal.dataobject.PublicationReleaseDO;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class DocumentCatalogRepositoryImpl implements DocumentCatalogRepository {
    private final DocumentCatalogMapper mapper;
    private final ReleaseEnvironment environment;
    private final ApiDefinitionJson json;

    @Override
    public boolean projectionReady() { return mapper.projectionReady(environment.environmentId()); }

    @Override
    public PageResult<DocumentSummary> page(DocumentQuery query, DocumentAudience audience, List<String> scopeCodes, String tenantId) {
        IPage<PublicationReleaseDO> page = mapper.selectDocuments(environment.environmentId(), new Page<>(query.page(), query.pageSize()), query,
                SqlPatterns.contains(query.query()), audience, scopeCodes, tenantId);
        return new PageResult<>(page.getRecords().stream().map(row -> new DocumentSummary(row.getApiId(), row.getId(),
                row.getEffectiveStateVersion(), row.getDraftRevision(), row.getName(), row.getCategory(), row.getService(),
                row.getVersion(), row.getMethod(), ApiLifecycle.Status.valueOf(row.getLifecycleStatus()), Boolean.TRUE.equals(row.getMcpToolEnabled()) && !"RETIRED".equals(row.getLifecycleStatus()))).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public PageResult<DocumentCategory> categories(DocumentQuery query, DocumentAudience audience, List<String> scopeCodes, String tenantId) {
        IPage<DocumentCategoryDO> page = mapper.selectCategories(environment.environmentId(), new Page<>(query.page(), query.pageSize()), query,
                SqlPatterns.contains(query.query()), audience, scopeCodes, tenantId);
        return new PageResult<>(page.getRecords().stream().map(row -> new DocumentCategory(row.getCategory(), row.getApiCount())).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public Optional<DocumentView> visibleDocument(String service, String version, String method, String tenantId) {
        return Optional.ofNullable(mapper.selectVisibleDocument(environment.environmentId(), service, version, method, tenantId)).map(row -> {
            ApiDefinition api = json.decode(row.getSnapshotJson());
            return new DocumentView(row.getId(), row.getEffectiveStateVersion(), api.service(), api.version(),
                    api.method(), row.getCategory(), ApiDocument.from(api, api.name()));
        });
    }
}
