package io.github.chenyilei2016.openplatform.application.connection;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiOperation;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnection;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository.RevisionKey;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRevision;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 管理保存、批量导入和发布共用连接事实校验，批量边界只读取一次连接及修订。 */
@Service
@RequiredArgsConstructor
public class DubboBindingPolicy {
    public record Candidate(ApiDefinition definition, ApiDefinition before) {}
    private final DubboConnectionRepository connections;
    private final ReleaseEnvironment environment;

    public void validate(ApiDefinition definition, ApiDefinition before) {
        String error = errors(List.of(new Candidate(definition, before))).get(ApiOperation.of(definition));
        if (error != null) throw io.github.chenyilei2016.openplatform.domain.common.FieldValidation.invalid("/binding/dubbo/connectionId",
                io.github.chenyilei2016.openplatform.domain.common.FieldValidation.Reason.REFERENCE_UNAVAILABLE, error);
    }

    public Map<ApiOperation, String> errors(List<Candidate> candidates) {
        Set<RevisionKey> keys = candidates.stream().map(Candidate::definition)
                .map(api -> api.binding().dubbo()).filter(Objects::nonNull)
                .filter(binding -> binding.connectionId() != null && binding.connectionRevision() != null)
                .map(binding -> new RevisionKey(binding.connectionId(), binding.connectionRevision())).collect(Collectors.toSet());
        Map<String, DubboConnection> headers = keys.isEmpty() ? Map.of() : connections.findAll(keys.stream()
                .map(RevisionKey::connectionId).collect(Collectors.toSet()));
        Map<RevisionKey, DubboConnectionRevision> revisions = keys.isEmpty() ? Map.of() : connections.findRevisions(keys);
        Map<ApiOperation, String> errors = new LinkedHashMap<>();
        for (Candidate candidate : candidates) {
            ApiBinding.Dubbo binding = candidate.definition().binding().dubbo();
            if (binding == null) continue;
            ApiBinding.Dubbo previous = candidate.before() == null ? null : candidate.before().binding().dubbo();
            String error = null;
            if (binding.connectionId() == null) {
                error = "请选择Dubbo服务连接及修订";
            } else {
                DubboConnection connection = headers.get(binding.connectionId());
                DubboConnectionRevision revision = binding.connectionRevision() == null ? null
                        : revisions.get(new RevisionKey(binding.connectionId(), binding.connectionRevision()));
                boolean sameReference = previous != null && Objects.equals(previous.connectionId(), binding.connectionId())
                        && Objects.equals(previous.connectionRevision(), binding.connectionRevision());
                if (connection == null || !environment.environmentId().equals(connection.environmentId()) || !connection.enabled())
                    error = "Dubbo服务连接不属于当前环境、不存在或已停用";
                else if (revision == null || (!sameReference && !Objects.equals(connection.activeRevision(), binding.connectionRevision())))
                    error = "所选连接修订不可选，请刷新目录；已保存的旧修订可继续使用";

            }
            if (error != null) errors.put(ApiOperation.of(candidate.definition()), error);
        }
        return errors;
    }
}
