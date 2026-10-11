package io.github.chenyilei2016.openplatform.infrastructure.administration.dal.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.administration.Administrator;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorAudit;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorAuditQuery;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorQuery;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorRepository;
import io.github.chenyilei2016.openplatform.domain.administration.AdministratorStatus;
import io.github.chenyilei2016.openplatform.domain.administration.OperatorRef;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.dataobject.AdministratorAuditDO;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.dataobject.AdministratorDO;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.dataobject.AdministratorPermissionDO;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper.AdministratorAuditMapper;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper.AdministratorControlMapper;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper.AdministratorMapper;
import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper.AdministratorPermissionMapper;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Repository;

import tools.jackson.databind.ObjectMapper;

import java.util.Collection;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Repository
@RequiredArgsConstructor
public class AdministratorRepositoryImpl implements AdministratorRepository {
    private final AdministratorMapper administrators;
    private final AdministratorPermissionMapper permissions;
    private final AdministratorAuditMapper audits;
    private final AdministratorControlMapper control;
    private final ObjectMapper json;

    @Override
    public Optional<Administrator> find(String id) {
        AdministratorDO row = administrators.selectById(id);
        return row == null
                ? Optional.empty()
                : Optional.of(withPermissions(List.of(row)).getFirst());
    }

    @Override
    public Optional<Administrator> findByIdentity(String tenantId, String employeeNo) {
        AdministratorDO row =
                administrators.selectOne(
                        Wrappers.<AdministratorDO>lambdaQuery()
                                .eq(AdministratorDO::getTenantId, tenantId)
                                .eq(AdministratorDO::getEmployeeNo, employeeNo));
        return row == null
                ? Optional.empty()
                : Optional.of(withPermissions(List.of(row)).getFirst());
    }

    @Override
    public PageResult<Administrator> page(AdministratorQuery query) {
        LambdaQueryWrapper<AdministratorDO> filter =
                Wrappers.<AdministratorDO>lambdaQuery()
                        .and(
                                query.search() != null && !query.search().isBlank(),
                                any -> any.apply("display_name LIKE {0} ESCAPE '!'", SqlPatterns.contains(query.search().trim()))
                                        .or().eq(AdministratorDO::getEmployeeNo, query.search().trim()))
                        .apply(
                                query.name() != null && !query.name().isBlank(),
                                "display_name LIKE {0} ESCAPE '!'",
                                SqlPatterns.contains(query.name()))
                        .eq(
                                query.tenantId() != null && !query.tenantId().isBlank(),
                                AdministratorDO::getTenantId,
                                query.tenantId())
                        .eq(
                                query.employeeNo() != null && !query.employeeNo().isBlank(),
                                AdministratorDO::getEmployeeNo,
                                query.employeeNo())
                        .eq(query.enabled() != null, AdministratorDO::getEnabled, query.enabled())
                        .eq(
                                query.superAdministrator() != null,
                                AdministratorDO::getSuperAdministrator,
                                query.superAdministrator())
                        .orderByAsc(
                                AdministratorDO::getTenantId,
                                AdministratorDO::getEmployeeNo,
                                AdministratorDO::getId);
        Page<AdministratorDO> page =
                administrators.selectPage(new Page<>(query.page(), query.pageSize()), filter);
        return new PageResult<>(
                withPermissions(page.getRecords()),
                page.getTotal(),
                query.page(),
                query.pageSize());
    }

    @Override
    public Map<OperatorRef, String> displayNames(Collection<OperatorRef> operators) {
        if (operators.isEmpty()) return Map.of();
        if (operators.size() > 300) throw new IllegalArgumentException("操作人展示批次最多300项");
        LambdaQueryWrapper<AdministratorDO> filter = Wrappers.<AdministratorDO>lambdaQuery()
                .select(AdministratorDO::getTenantId, AdministratorDO::getEmployeeNo, AdministratorDO::getDisplayName);
        filter.and(any -> operators.forEach(operator -> any.or(one -> one
                .eq(AdministratorDO::getTenantId, operator.tenantId())
                .eq(AdministratorDO::getEmployeeNo, operator.employeeNo()))));
        Map<OperatorRef, String> names = new HashMap<>();
        administrators.selectList(filter).forEach(row -> names.put(
                new OperatorRef(row.getTenantId(), row.getEmployeeNo()), row.getDisplayName()));
        return names;
    }

    @Override
    public PageResult<AdministratorAudit> audit(AdministratorAuditQuery query) {
        Page<AdministratorAuditDO> page =
                audits.selectPage(
                        new Page<>(query.page(), query.pageSize()),
                        Wrappers.<AdministratorAuditDO>lambdaQuery()
                                .eq(
                                        query.administratorId() != null
                                                && !query.administratorId().isBlank(),
                                        AdministratorAuditDO::getAdministratorId,
                                        query.administratorId())
                                .orderByDesc(
                                        AdministratorAuditDO::getOccurredAt,
                                        AdministratorAuditDO::getId));
        List<AdministratorAudit> entries =
                page.getRecords().stream()
                        .map(
                                row ->
                                        new AdministratorAudit(
                                                row.getId(),
                                                row.getAdministratorId(),
                                                row.getOperatorTenantId(),
                                                row.getOperatorEmployeeNo(),
                                                row.getAction(),
                                                row.getReason(),
                                                row.getBeforeJson() == null
                                                        ? null
                                                        : json.readValue(
                                                                row.getBeforeJson(),
                                                                Administrator.class),
                                                json.readValue(
                                                        row.getAfterJson(), Administrator.class),
                                                row.getRequestId(),
                                                row.getOccurredAt()))
                        .toList();
        return new PageResult<>(entries, page.getTotal(), query.page(), query.pageSize());
    }

    @Override
    public AdministratorStatus status() {
        return new AdministratorStatus(countEnabledSuperAdministrators());
    }

    @Override
    public void lockControl() {
        if (control.lock() == null) throw new IllegalStateException("管理员控制行不存在，请先执行受控DDL");
    }

    @Override
    public long countEnabledSuperAdministrators() {
        return administrators.selectCount(
                Wrappers.<AdministratorDO>lambdaQuery()
                        .eq(AdministratorDO::getEnabled, true)
                        .eq(AdministratorDO::getSuperAdministrator, true));
    }

    @Override
    public void createAll(List<Administrator> values) {
        if (values.isEmpty()) return;
        administrators.insertAll(values.stream().map(AdministratorRepositoryImpl::toRow).toList());
        List<AdministratorPermissionDO> grants =
                values.stream()
                        .flatMap(
                                value ->
                                        value.permissions().stream()
                                                .map(
                                                        permission ->
                                                                new AdministratorPermissionDO(
                                                                        value.id(),
                                                                        permission.name())))
                        .toList();
        if (!grants.isEmpty()) permissions.insertAll(grants);
    }

    @Override
    public void update(Administrator value, long expectedRevision) {
        int affected =
                administrators.update(
                        toRow(value),
                        Wrappers.<AdministratorDO>lambdaUpdate()
                                .eq(AdministratorDO::getId, value.id())
                                .eq(AdministratorDO::getRevision, expectedRevision));
        if (affected != 1) throw new PlatformException(ErrorCode.CONFLICT, "管理员权限已变更，请刷新后重试");
        permissions.deleteForAdministrator(value.id());
        List<AdministratorPermissionDO> grants =
                value.permissions().stream()
                        .map(
                                permission ->
                                        new AdministratorPermissionDO(
                                                value.id(), permission.name()))
                        .toList();
        if (!grants.isEmpty()) permissions.insertAll(grants);
    }

    @Override
    public void appendAudits(List<AdministratorAudit> entries) {
        if (entries.isEmpty()) return;
        audits.insertAll(
                entries.stream()
                        .map(
                                entry ->
                                        new AdministratorAuditDO(
                                                entry.id(),
                                                entry.administratorId(),
                                                entry.operatorTenantId(),
                                                entry.operatorEmployeeNo(),
                                                entry.action(),
                                                entry.reason(),
                                                entry.before() == null
                                                        ? null
                                                        : json.writeValueAsString(entry.before()),
                                                json.writeValueAsString(entry.after()),
                                                entry.requestId(),
                                                entry.occurredAt()))
                        .toList());
    }

    private List<Administrator> withPermissions(List<AdministratorDO> rows) {
        if (rows.isEmpty()) return List.of();
        Map<String, Set<AdminPermission>> grants = new HashMap<>();
        for (AdministratorPermissionDO row :
                permissions.selectForAdministrators(
                        rows.stream().map(AdministratorDO::getId).toList())) {
            grants.computeIfAbsent(
                            row.getAdministratorId(),
                            ignored -> EnumSet.noneOf(AdminPermission.class))
                    .add(AdminPermission.valueOf(row.getPermissionCode()));
        }
        return rows.stream()
                .map(
                        row ->
                                new Administrator(
                                        row.getId(),
                                        row.getTenantId(),
                                        row.getUserId(),
                                        row.getEmployeeId(),
                                        row.getEmployeeNo(),
                                        row.getDisplayName(),
                                        row.getEnabled(),
                                        row.getSuperAdministrator(),
                                        row.getRevision(),
                                        grants.getOrDefault(row.getId(), Set.of())))
                .toList();
    }

    private static AdministratorDO toRow(Administrator value) {
        return new AdministratorDO(
                value.id(),
                value.tenantId(),
                value.userId(),
                value.employeeId(),
                value.employeeNo(),
                value.displayName(),
                value.enabled(),
                value.superAdministrator(),
                value.revision());
    }
}
