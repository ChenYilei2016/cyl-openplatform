package io.github.chenyilei2016.openplatform.infrastructure.importing.dal;

import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import io.github.chenyilei2016.openplatform.application.importing.ApiImportReceiptRepository;
import io.github.chenyilei2016.openplatform.application.importing.ImportModels.Confirmation;
import io.github.chenyilei2016.openplatform.application.importing.ImportModels.Change;
import io.github.chenyilei2016.openplatform.application.importing.ImportModels.ItemResult;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import java.util.Optional;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

@Repository
@RequiredArgsConstructor
public class ApiImportReceiptRepositoryImpl implements ApiImportReceiptRepository {
    private final ReleaseEnvironment environment;
    private final ApiImportReceiptMapper requests;
    private final JsonMapper json;

    @Override public Receipt reserve(AccessOperator operator, String key, String digest, String kind, String source) {
        requests.reserve(environment.environmentId(), operator.tenantId(), operator.employeeNo(), key, digest, kind, source);
        return receipt(requests.lock(environment.environmentId(), operator.tenantId(), operator.employeeNo(), key));
    }
    @Override public void complete(AccessOperator operator, String key, Confirmation result) {
        requests.complete(environment.environmentId(), operator.tenantId(), operator.employeeNo(), key, json.writeValueAsString(result));
        List<ItemResult> changed = result.items().stream().filter(item -> item.change() == Change.CREATE || item.change() == Change.UPDATE).toList();
        if (!changed.isEmpty()) requests.linkRevisions(environment.environmentId(), operator.tenantId(), operator.employeeNo(), key, changed);
    }
    @Override public Optional<Receipt> find(AccessOperator operator, String key) {
        return Optional.ofNullable(requests.find(environment.environmentId(), operator.tenantId(), operator.employeeNo(), key)).map(this::receipt);
    }
    @Override public Optional<SourceInfo> provenance(String apiId, long revision) {
        return Optional.ofNullable(requests.provenance(environment.environmentId(), apiId, revision)).map(source -> new SourceInfo(source.apiId(), source.revision(),
                source.sourceKind(), SourceKind.valueOf(source.sourceKind()).label(), source.sourceDigest()));
    }
    private Receipt receipt(ApiImportReceiptMapper.StoredReceipt value) {
        return new Receipt(value.contentDigest(), value.resultJson() == null ? null : json.readValue(value.resultJson(), Confirmation.class));
    }
}
