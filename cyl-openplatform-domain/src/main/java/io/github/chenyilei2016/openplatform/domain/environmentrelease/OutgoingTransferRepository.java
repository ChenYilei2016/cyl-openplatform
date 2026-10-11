package io.github.chenyilei2016.openplatform.domain.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiOperation;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.OutgoingTransfer;
import java.util.Optional;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.TransferSummary;

public interface OutgoingTransferRepository {
    void create(OutgoingTransfer transfer);
    Optional<OutgoingTransfer> find(String id);
    /** operation 非空时只列出该 API（service/version/method 精确匹配）的发送记录。 */
    PageResult<TransferSummary> page(CatalogPageQuery query, ApiOperation operation);
    boolean update(OutgoingTransfer transfer, long expectedVersion);
}
