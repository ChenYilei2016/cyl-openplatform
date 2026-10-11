package io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.IncomingReview;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.IncomingReleaseRepository;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.dataobject.IncomingReleaseDO;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.mapper.IncomingReleaseMapper;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Repository;

import tools.jackson.databind.json.JsonMapper;

import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class IncomingReleaseRepositoryImpl implements IncomingReleaseRepository {
    private final ReleaseEnvironment environment;
    private final IncomingReleaseMapper mapper;
    private final JsonMapper json;
    private final io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinitionCodec definitions;

    @Override
    public Optional<IncomingRelease> find(String sourceEnvironment, String transferId) {
        return Optional.ofNullable(
                        mapper.selectOne(
                                new QueryWrapper<IncomingReleaseDO>().eq("environment_id", environment.environmentId())
                                        .eq("source_environment", sourceEnvironment)
                                        .eq("transfer_id", transferId)))
                .map(this::model);
    }

    @Override
    public Optional<IncomingRelease> findRelease(String releaseId) {
        return Optional.ofNullable(
                        mapper.selectOne(
                                new QueryWrapper<IncomingReleaseDO>().eq("environment_id", environment.environmentId()).eq("release_id", releaseId)))
                .map(this::model);
    }

    @Override
    public void insert(IncomingRelease receipt) {
        var row = new IncomingReleaseDO();
        row.setEnvironmentId(environment.environmentId());
        row.setId(receipt.id());
        row.setSourceEnvironment(receipt.sourceEnvironment());
        row.setTransferId(receipt.transferId());
        row.setRequestDigest(receipt.requestDigest());
        row.setApiId(receipt.apiId());
        row.setReleaseId(receipt.releaseId());
        var review = receipt.review();
        row.setSourceReleaseId(review.sourceReleaseId());
        row.setOperatorTenantId(review.operatorTenantId());
        row.setOperatorEmployeeNo(review.operatorEmployeeNo());
        row.setBeforeJson(review.before() == null ? null : definitions.encode(review.before()));
        row.setAfterJson(definitions.encode(review.after()));
        row.setChangedFieldsJson(json.writeValueAsString(review.changedFields()));
        mapper.insert(row);
    }

    private IncomingRelease model(IncomingReleaseDO row) {
        return new IncomingRelease(
                row.getId(),
                row.getSourceEnvironment(),
                row.getTransferId(),
                row.getRequestDigest(),
                row.getApiId(),
                row.getReleaseId(),
                new IncomingReview(
                        row.getSourceEnvironment(),
                        row.getSourceReleaseId(),
                        row.getOperatorTenantId(),
                        row.getOperatorEmployeeNo(),
                        row.getBeforeJson() == null
                                ? null
                                : definitions.decode(row.getBeforeJson()),
                        definitions.decode(row.getAfterJson()),
                        java.util.List.of(
                                json.readValue(row.getChangedFieldsJson(), String[].class))));
    }
}
