package io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiOperation;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.OutgoingTransferRepository;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.*;
import io.github.chenyilei2016.openplatform.infrastructure.common.SqlPatterns;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.dataobject.OutgoingTransferDO;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.mapper.OutgoingTransferMapper;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

@Repository
@RequiredArgsConstructor
public class OutgoingTransferRepositoryImpl implements OutgoingTransferRepository {
    private final ReleaseEnvironment environment;
    private final OutgoingTransferMapper mapper;
    private final JsonMapper json;

    @Override public void create(OutgoingTransfer transfer) {
        OutgoingTransferDO row = observation(transfer);
        SendRequest request = transfer.request();
        row.setSourceEnvironment(request.sourceEnvironment());
        row.setSourceReleaseId(request.sourceReleaseId()); row.setTargetId(request.targetEnvironment());
        row.setService(request.definition().service()); row.setVersion(request.definition().version());
        row.setMethod(request.definition().method()); row.setCreatedAt(transfer.createdAt());
        byte[] encoded = json.writeValueAsBytes(request);
        if (encoded.length > 262_144) throw new PlatformException(ErrorCode.REQUEST_TOO_LARGE, "传输请求超过256KiB，请精简契约");
        try (var parser = json.createParser(encoded)) {
            while (parser.nextToken() != null) { /* 与持久化后的读取使用同一结构限额。 */ }
        } catch (tools.jackson.core.exc.StreamConstraintsException invalid) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "传输正文超出结构限制，请精简契约");
        }
        row.setRequestJson(new String(encoded, java.nio.charset.StandardCharsets.UTF_8));
        mapper.insert(row);
    }
    @Override public Optional<OutgoingTransfer> find(String id) {
        return Optional.ofNullable(mapper.selectOne(new QueryWrapper<OutgoingTransferDO>().eq("environment_id", environment.environmentId()).eq("id", id))).map(row -> new OutgoingTransfer(row.getId(),
                json.readValue(row.getRequestJson(), SendRequest.class), DeliveryState.valueOf(row.getDeliveryState()),
                row.getError(), row.getReceiptJson() == null ? null : json.readValue(row.getReceiptJson(), Receipt.class),
                List.of(json.readValue(row.getObservationsJson(), NodeObservation[].class)),
                row.getCreatedAt(), row.getUpdatedAt(), row.getRecordVersion()));
    }
    @Override public PageResult<TransferSummary> page(CatalogPageQuery query, ApiOperation operation) {
        if ((long) (query.page() - 1) * query.pageSize() > 100_000)
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "查询偏移过大，请缩小范围");
        String pattern = SqlPatterns.contains(query.query());
        var filter = new QueryWrapper<OutgoingTransferDO>().eq("environment_id", environment.environmentId())
                .select("id", "source_environment", "source_release_id", "target_id", "service", "version", "method", "delivery_state", "error", "receipt_json", "observations_json", "created_at", "updated_at")
                .apply("(service LIKE {0} ESCAPE '!' OR target_id LIKE {0} ESCAPE '!')", pattern)
                .eq(operation != null, "service", operation == null ? null : operation.service())
                .eq(operation != null, "version", operation == null ? null : operation.version())
                .eq(operation != null, "method", operation == null ? null : operation.method())
                .orderByDesc("created_at", "id");
        var page = mapper.selectPage(new Page<>(query.page(), query.pageSize()), filter);
        return new PageResult<>(page.getRecords().stream().map(row -> new TransferSummary(row.getId(), row.getSourceEnvironment(),
                row.getSourceReleaseId(), row.getTargetId(), row.getService(), row.getVersion(), row.getMethod(),
                DeliveryState.valueOf(row.getDeliveryState()), row.getError(),
                row.getReceiptJson() == null ? null : json.readValue(row.getReceiptJson(), Receipt.class),
                List.of(json.readValue(row.getObservationsJson(), NodeObservation[].class)),
                row.getCreatedAt(), row.getUpdatedAt())).toList(), page.getTotal(), query.page(), query.pageSize());
    }
    @Override public boolean update(OutgoingTransfer transfer, long expectedVersion) {
        return mapper.updateObservation(observation(transfer), expectedVersion) == 1;
    }
    private OutgoingTransferDO observation(OutgoingTransfer transfer) {
        OutgoingTransferDO row = new OutgoingTransferDO();
        row.setEnvironmentId(environment.environmentId());
        row.setId(transfer.id()); row.setDeliveryState(transfer.deliveryState().name()); row.setError(transfer.error());
        row.setReceiptJson(transfer.receipt() == null ? null : json.writeValueAsString(transfer.receipt()));
        row.setObservationsJson(json.writeValueAsString(transfer.observations()));
        row.setUpdatedAt(transfer.updatedAt()); row.setRecordVersion(transfer.version());
        return row;
    }
}
