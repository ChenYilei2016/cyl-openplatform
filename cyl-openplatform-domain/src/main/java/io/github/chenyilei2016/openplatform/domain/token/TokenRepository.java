package io.github.chenyilei2016.openplatform.domain.token;

import io.github.chenyilei2016.openplatform.domain.access.AccessPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import java.util.Optional;
import java.time.Instant;

public interface TokenRepository {
    Optional<StoredToken> findByDigest(String digest);
    Optional<StoredToken> find(String id);
    StoredToken lock(String id);
    void create(StoredToken token, String digest);
    void revoke(String id);
    PageResult<TokenListing> page(String applicationId, AccessPageQuery query, TokenFilter filter, Instant now);
}
