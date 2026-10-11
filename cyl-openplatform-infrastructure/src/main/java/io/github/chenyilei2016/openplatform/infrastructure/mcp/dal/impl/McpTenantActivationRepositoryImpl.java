package io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.mcp.McpActivationStatus;
import io.github.chenyilei2016.openplatform.domain.mcp.McpTenantActivation;
import io.github.chenyilei2016.openplatform.domain.mcp.McpTenantActivationRepository;
import io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.dataobject.McpTenantActivationDO;
import io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.mapper.McpTenantActivationMapper;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class McpTenantActivationRepositoryImpl implements McpTenantActivationRepository {
    private final McpTenantActivationMapper mapper;

    @Override
    public Optional<McpTenantActivation> find(String id) {
        return Optional.ofNullable(mapper.selectById(id)).map(McpTenantActivationRepositoryImpl::toDomain);
    }

    @Override
    public Optional<McpTenantActivation> findByTenant(String tenantId) {
        return Optional.ofNullable(mapper.selectOne(Wrappers.<McpTenantActivationDO>lambdaQuery()
                .eq(McpTenantActivationDO::getTenantId, tenantId))).map(McpTenantActivationRepositoryImpl::toDomain);
    }

    @Override
    public void create(McpTenantActivation activation) {
        try {
            mapper.insert(new McpTenantActivationDO(activation.id(), activation.tenantId(), activation.keyCode(),
                    activation.status().name(), activation.disabledByPlatform(), activation.activatedByEmployeeNo(),
                    activation.createdAt(), activation.updatedAt(), activation.revision()));
        } catch (DuplicateKeyException duplicate) {
            throw new PlatformException(ErrorCode.CONFLICT, "本租户已开通 MCP，不能重复开通", duplicate);
        }
    }

    @Override
    public boolean updateStatus(McpTenantActivation activation, long expectedRevision) {
        return mapper.updateStatus(activation.id(), activation.status().name(), activation.disabledByPlatform(),
                activation.updatedAt(), expectedRevision) == 1;
    }

    @Override
    public PageResult<McpTenantActivation> page(AccessPageQuery query, McpActivationStatus status) {
        String tenantId = query.query() == null || query.query().isBlank() ? null : query.query().trim();
        var page = mapper.selectPage(new Page<>(query.page(), query.pageSize()), Wrappers.<McpTenantActivationDO>lambdaQuery()
                .eq(tenantId != null, McpTenantActivationDO::getTenantId, tenantId)
                .eq(status != null, McpTenantActivationDO::getStatus, status == null ? null : status.name())
                .orderByDesc(McpTenantActivationDO::getCreatedAt, McpTenantActivationDO::getId));
        return new PageResult<>(page.getRecords().stream().map(McpTenantActivationRepositoryImpl::toDomain).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }

    private static McpTenantActivation toDomain(McpTenantActivationDO row) {
        return new McpTenantActivation(row.getId(), row.getTenantId(), row.getKeyCode(), McpActivationStatus.valueOf(row.getStatus()),
                Boolean.TRUE.equals(row.getDisabledByPlatform()), row.getActivatedByEmployeeNo(),
                row.getCreatedAt(), row.getUpdatedAt(), row.getRevision());
    }
}
