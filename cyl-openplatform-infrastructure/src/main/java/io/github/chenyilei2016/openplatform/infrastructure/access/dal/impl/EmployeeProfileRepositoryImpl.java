package io.github.chenyilei2016.openplatform.infrastructure.access.dal.impl;

import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import java.util.HashMap;
import java.util.Map;
import java.util.Collection;
import java.util.stream.Collectors;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.access.*;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.EmployeeProfileDO;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper.EmployeeProfileMapper;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

@Repository
@RequiredArgsConstructor
public class EmployeeProfileRepositoryImpl implements EmployeeProfileRepository {
    // 列表补名的单批上限：一页最多100条，每条至多3个租户或人员引用。
    private static final int MAX_DISPLAY_BATCH = 300;
    private final EmployeeProfileMapper mapper;

    @Override
    public void remember(EmployeeProfile profile, Instant refreshBefore) {
        mapper.remember(
                new EmployeeProfileDO(
                        ObjectIdType.EMPLOYEE_PROFILE.nextId(),
                        profile.tenantId(),
                        profile.tenantName(),
                        profile.employeeId(),
                        profile.userId(),
                        profile.employeeNo(),
                        profile.displayName(),
                        profile.lastSeenAt()),
                refreshBefore);
    }

    @Override
    public PageResult<EmployeeProfile> page(EmployeeProfileQuery query) {
        Page<EmployeeProfileDO> page =
                mapper.selectPage(
                        new Page<>(query.page(), query.pageSize()),
                        Wrappers.<EmployeeProfileDO>lambdaQuery()
                                .eq(EmployeeProfileDO::getTenantId, query.tenantId())
                                .eq(
                                        query.employeeNo() != null,
                                        EmployeeProfileDO::getEmployeeNo,
                                        query.employeeNo())
                                .apply(
                                        query.name() != null,
                                        "display_name LIKE {0} ESCAPE '!'",
                                        SqlPatterns.contains(query.name()))
                                .orderByAsc(
                                        EmployeeProfileDO::getDisplayName,
                                        EmployeeProfileDO::getEmployeeNo,
                                        EmployeeProfileDO::getEmployeeId));
        return new PageResult<>(
                page.getRecords().stream().map(EmployeeProfileRepositoryImpl::toDomain).toList(),
                page.getTotal(),
                query.page(),
                query.pageSize());
    }

    @Override
    public java.util.Optional<EmployeeProfile> find(String tenantId,String employeeId) {
        return java.util.Optional.ofNullable(mapper.selectOne(Wrappers.<EmployeeProfileDO>lambdaQuery()
                .eq(EmployeeProfileDO::getTenantId,tenantId).eq(EmployeeProfileDO::getEmployeeId,employeeId)))
                .map(EmployeeProfileRepositoryImpl::toDomain);
    }

    @Override
    public List<EmployeeProfile> search(String keyword, int limit) {
        if (limit < 1 || limit > 20) throw new IllegalArgumentException("人员搜索最多返回20条");
        // 不统计总数：全局搜索只取前 limit 条。
        return mapper.selectPage(new Page<EmployeeProfileDO>(1, limit, false),
                        Wrappers.<EmployeeProfileDO>lambdaQuery()
                                .and(where -> where.eq(EmployeeProfileDO::getEmployeeNo, keyword).or()
                                        .apply("display_name LIKE {0} ESCAPE '!'", SqlPatterns.contains(keyword)))
                                .orderByAsc(EmployeeProfileDO::getDisplayName, EmployeeProfileDO::getEmployeeNo, EmployeeProfileDO::getId))
                .getRecords().stream().map(EmployeeProfileRepositoryImpl::toDomain).toList();
    }

    @Override
    public Map<String,EmployeeProfile> findByIds(Collection<String> ids) {
        if (ids.isEmpty()) return Map.of();
        if (ids.size() > 100) throw new IllegalArgumentException("人员引用最多100项");
        return mapper.selectByIds(ids).stream().map(EmployeeProfileRepositoryImpl::toDomain)
                .collect(Collectors.toMap(EmployeeProfile::id, value -> value));
    }

    @Override
    public String tenantName(String tenantId) {
        List<EmployeeProfileDO> values =
                mapper.selectList(
                        Wrappers.<EmployeeProfileDO>lambdaQuery()
                                .select(EmployeeProfileDO::getTenantName)
                                .eq(EmployeeProfileDO::getTenantId, tenantId)
                                .isNotNull(EmployeeProfileDO::getTenantName)
                                .orderByDesc(EmployeeProfileDO::getLastSeenAt)
                                .last("LIMIT 1"));
        return values.isEmpty() ? null : values.getFirst().getTenantName();
    }

    private static EmployeeProfile toDomain(EmployeeProfileDO value) {
        return new EmployeeProfile(value.getId(),
                value.getTenantId(),
                value.getTenantName(),
                value.getEmployeeId(),
                value.getUserId(),
                value.getEmployeeNo(),
                value.getDisplayName(),
                value.getLastSeenAt());
    }

    @Override
    public Map<String, String> tenantNames(Collection<String> tenantIds) {
        if (tenantIds.isEmpty()) return Map.of();
        if (tenantIds.size() > MAX_DISPLAY_BATCH) throw new IllegalArgumentException("租户展示批次最多300项");
        return mapper.tenantNames(tenantIds).stream().collect(Collectors.toMap(
                EmployeeProfileDO::getTenantId, EmployeeProfileDO::getTenantName));
    }

    @Override
    public Map<EmployeeNumberRef, String> displayNames(Collection<EmployeeNumberRef> employees) {
        if (employees.isEmpty()) return Map.of();
        if (employees.size() > MAX_DISPLAY_BATCH) throw new IllegalArgumentException("人员展示批次最多300项");
        // 一次条件查询；按最近核验时间升序放入，同一（租户, 工号）保留最近一次的姓名。
        Map<EmployeeNumberRef, String> names = new HashMap<>();
        mapper.selectList(Wrappers.<EmployeeProfileDO>lambdaQuery()
                        .select(EmployeeProfileDO::getTenantId, EmployeeProfileDO::getEmployeeNo,
                                EmployeeProfileDO::getDisplayName, EmployeeProfileDO::getLastSeenAt)
                        .and(any -> employees.forEach(employee -> any.or(one -> one
                                .eq(EmployeeProfileDO::getTenantId, employee.tenantId())
                                .eq(EmployeeProfileDO::getEmployeeNo, employee.employeeNo()))))
                        .orderByAsc(EmployeeProfileDO::getLastSeenAt, EmployeeProfileDO::getId))
                .forEach(row -> names.put(new EmployeeNumberRef(row.getTenantId(), row.getEmployeeNo()), row.getDisplayName()));
        return names;
    }
}
