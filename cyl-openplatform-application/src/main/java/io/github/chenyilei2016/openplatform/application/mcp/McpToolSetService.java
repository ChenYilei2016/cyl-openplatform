package io.github.chenyilei2016.openplatform.application.mcp;

import io.github.chenyilei2016.openplatform.application.access.AccessAuditService;
import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.catalog.CatalogPageQuery;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.domain.common.PageResult;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolRepository;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolSet;
import io.github.chenyilei2016.openplatform.domain.mcp.McpToolSetRepository;
import java.util.HashSet;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class McpToolSetService {
    private final McpToolSetRepository sets;
    private final McpToolRepository tools;
    private final AccessAuditService audit;

    public record Detail(McpToolSet toolSet, List<String> apiIds, java.util.Map<String, String> apiNames) {}
    public PageResult<McpToolSet> page(CatalogPageQuery query) { return sets.page(query); }
    public Detail detail(String id) { return detailOf(require(id), sets.members(id)); }

    public Detail create(String code, String name, String description, boolean enabled, List<String> apiIds, AccessOperator operator) {
        McpToolSet set = new McpToolSet(ObjectIdType.MCP_TOOL_SET.nextId(), code, name, description, enabled, 0);
        return audit.change("CREATE_MCP_TOOL_SET", null, null, set.id(), operator, () -> {
            validateMembers(apiIds, List.of());
            sets.create(set);
            sets.replaceMembers(set.id(), apiIds);
            return detailOf(set, apiIds);
        });
    }

    public Detail update(String id, String name, String description, boolean enabled, List<String> apiIds, long revision, AccessOperator operator) {
        return audit.change("UPDATE_MCP_TOOL_SET", null, null, id, operator, () -> {
            McpToolSet current = sets.lock(id).orElseThrow(McpToolSetService::missing);
            validateMembers(apiIds, sets.members(id));
            McpToolSet next = new McpToolSet(id, current.code(), name, description, enabled, revision + 1);
            if (!sets.update(next, revision)) throw conflict();
            sets.replaceMembers(id, apiIds);
            return detailOf(next, apiIds);
        });
    }

    public void delete(String id, long revision, AccessOperator operator) {
        audit.change("DELETE_MCP_TOOL_SET", null, null, id, operator, () -> {
            sets.lock(id).orElseThrow(McpToolSetService::missing);
            if (!sets.delete(id, revision)) throw conflict();
            return null;
        });
    }

    /** 总地址返回null；分类地址必须仍启用，不以客户端游标决定地址范围。 */
    public String requireActiveId(String code) {
        return code == null ? null : sets.findByCode(code).filter(McpToolSet::enabled).orElseThrow(McpToolSetService::missing).id();
    }

    private McpToolSet require(String id) { return sets.find(id).orElseThrow(McpToolSetService::missing); }
    private Detail detailOf(McpToolSet set, List<String> apiIds) { return new Detail(set, List.copyOf(apiIds), tools.apiNames(apiIds)); }

    private void validateMembers(List<String> apiIds, List<String> existing) {
        if (apiIds == null || apiIds.size() > 200 || new HashSet<>(apiIds).size() != apiIds.size())
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "工具集成员不可重复，最多200项");
        List<String> additions = apiIds.stream().filter(id -> !existing.contains(id)).toList();
        if (tools.availableApiIds(additions).size() != additions.size())
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "新增成员必须是当前已发布且可用的MCP工具");
    }
    private static PlatformException missing() { return new PlatformException(ErrorCode.NOT_FOUND, "工具集不存在或已停用"); }
    private static PlatformException conflict() { return new PlatformException(ErrorCode.CONFLICT, "工具集已变化，请刷新后重试"); }
}
