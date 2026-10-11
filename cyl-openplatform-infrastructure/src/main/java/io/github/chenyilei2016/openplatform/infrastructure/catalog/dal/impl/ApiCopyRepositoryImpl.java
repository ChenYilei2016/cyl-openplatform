package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.impl;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCopyRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.ApiDefinitionJson;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiCopyRequestDO;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper.ApiCopyRequestMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class ApiCopyRepositoryImpl implements ApiCopyRepository {
    private final ReleaseEnvironment environment;
    private final ApiCopyRequestMapper requests;
    private final ApiDefinitionJson json;

    @Override public Receipt reserve(String tenantId, String employeeNo, String creationKey, String digest) {
        requests.reserve(environment.environmentId(), tenantId, employeeNo, creationKey, digest);
        return receipt(requests.lock(environment.environmentId(), tenantId, employeeNo, creationKey));
    }
    @Override public void complete(String tenantId, String employeeNo, String creationKey, ApiDefinition result) {
        requests.complete(environment.environmentId(), tenantId, employeeNo, creationKey, json.encode(result));
    }
    @Override public Optional<Receipt> find(String tenantId, String employeeNo, String creationKey) {
        return Optional.ofNullable(requests.find(environment.environmentId(), tenantId, employeeNo, creationKey)).map(this::receipt);
    }
    private Receipt receipt(ApiCopyRequestDO value) {
        return new Receipt(value.getContentDigest(), value.getResultJson() == null ? null : json.decode(value.getResultJson()));
    }
}
