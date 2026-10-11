package io.github.chenyilei2016.openplatform.infrastructure.token.dal.impl;

import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.AuthorizationSubject;
import io.github.chenyilei2016.openplatform.domain.access.AuthorizationVersions;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.token.StoredToken;
import io.github.chenyilei2016.openplatform.domain.token.TokenListing;
import io.github.chenyilei2016.openplatform.domain.token.TokenRepository;
import io.github.chenyilei2016.openplatform.domain.token.TokenStatus;
import io.github.chenyilei2016.openplatform.domain.token.TokenFilter;
import java.time.Instant;
import com.baomidou.mybatisplus.core.metadata.IPage;
import io.github.chenyilei2016.openplatform.infrastructure.token.dal.dataobject.TokenDO;
import io.github.chenyilei2016.openplatform.infrastructure.token.dal.mapper.TokenMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class TokenRepositoryImpl implements TokenRepository {
    private final TokenMapper mapper;

    @Override public Optional<StoredToken> findByDigest(String digest) {
        return Optional.ofNullable(mapper.selectByDigest(digest)).map(this::toDomain);
    }
    @Override public Optional<StoredToken> find(String id) {
        return Optional.ofNullable(mapper.selectById(id)).map(this::toDomain);
    }
    @Override public StoredToken lock(String id) {
        return Optional.ofNullable(mapper.selectForUpdate(id)).map(this::toDomain)
                .orElseThrow(() -> new PlatformException(ErrorCode.INVALID_TOKEN, "Token无效或已失效"));
    }
    @Override public void create(StoredToken token, String digest) {
        TokenDO row = new TokenDO();
        row.setId(token.id()); row.setTokenDigest(digest);
        row.setApplicationId(token.subject().applicationId()); row.setAppKey(token.subject().appKey());
        row.setTenantGrantId(token.subject().tenantGrantId()); row.setTenantId(token.subject().tenantId());
        row.setUserGrantId(token.subject().userGrantId()); row.setUserId(token.subject().userId());
        row.setEmployeeId(token.subject().employeeId()); row.setEmployeeNo(token.subject().employeeNo());
        row.setApplicationVersion(token.versions().application()); row.setTenantVersion(token.versions().tenant()); row.setUserVersion(token.versions().user());
        // Scope代码的契约字符集不含空格，快照最多100个，使用固定分隔符避免额外JSON序列化依赖。
        row.setScopeCodes(String.join(" ", token.scopeCodes()));
        row.setStatus(token.status().name()); row.setIssuedAt(token.issuedAt()); row.setExpiresAt(token.expiresAt());
        mapper.insert(row);
    }
    @Override public void revoke(String id) { mapper.revoke(id); }
    @Override public PageResult<TokenListing> page(String applicationId, AccessPageQuery query, TokenFilter filter, Instant now) {
        IPage<TokenDO> page = mapper.selectByApplication(new Page<>(query.page(), query.pageSize()), applicationId, filter, now);
        return new PageResult<>(page.getRecords().stream().map(row -> new TokenListing(toDomain(row), Boolean.TRUE.equals(row.getAuthorizationValid()))).toList(),
                page.getTotal(), query.page(), query.pageSize());
    }
    private StoredToken toDomain(TokenDO row) {
        return new StoredToken(row.getId(), new AuthorizationSubject(row.getApplicationId(), row.getAppKey(), row.getTenantGrantId(), row.getTenantId(),
                row.getUserGrantId(), row.getUserId(), row.getEmployeeId(), row.getEmployeeNo()),
                new AuthorizationVersions(row.getApplicationVersion(), row.getTenantVersion(), row.getUserVersion()),
                row.getScopeCodes().isEmpty() ? List.of() : Arrays.asList(row.getScopeCodes().split(" ")),
                TokenStatus.valueOf(row.getStatus()), row.getIssuedAt(), row.getExpiresAt());
    }
}
