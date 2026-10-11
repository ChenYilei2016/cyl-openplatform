package io.github.chenyilei2016.openplatform.application.token;

import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.access.ApplicationRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.token.TokenRepository;
import io.github.chenyilei2016.openplatform.domain.token.TokenFilter;
import io.github.chenyilei2016.openplatform.domain.token.TokenListing;
import java.time.Instant;
import java.util.Map;
import java.util.stream.Collectors;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.time.Clock;

@Service
@RequiredArgsConstructor
public class TokenQueryService {
    private final TokenRepository tokens;
    private final ApplicationRepository applications;
    private final Clock tokenClock;
    private final EmployeeProfileRepository profiles;

    public PageResult<TokenSummary> page(String applicationId, AccessPageQuery query, TokenFilter filter) {
        applications.find(applicationId).orElseThrow(() -> new PlatformException(ErrorCode.NOT_FOUND, "应用不存在"));
        Instant now = tokenClock.instant();
        PageResult<TokenListing> page = tokens.page(applicationId, query, filter, now);
        // 租户展示名称按页一次批量投影。
        Map<String, String> tenantNames = profiles.tenantNames(page.items().stream()
                .map(item -> item.token().subject().tenantId()).collect(Collectors.toSet()));
        return new PageResult<>(page.items().stream().map(item -> TokenSummary.from(item.token(),
                item.token().effectiveStatus(now, item.authorizationValid()),
                tenantNames.get(item.token().subject().tenantId()))).toList(), page.total(), page.page(), page.pageSize());
    }
}
