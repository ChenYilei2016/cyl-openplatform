package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.Set;

/** 同维度多选取并集，各维度组合取交集；空集合表示不限。 */
public record ApiCatalogFilter(Set<ApiProtocol> protocols, String category, Set<Publication> publications,
                               Set<Review> reviews, Set<Access> access, String internalClass, MatchMode internalMatch,
                               String internalMethod, String ownerId, Sort sort, Set<McpTool> mcpTools) {
    public enum MatchMode { CONTAINS, EXACT; public boolean exact() { return this == EXACT; } }
    /** 列表排序：IDENTITY 为 service/version/method 稳定顺序；更新时间取当前草稿修订的记录时间。 */
    public enum Sort { IDENTITY, UPDATED_DESC, UPDATED_ASC, NAME_ASC, NAME_DESC }
    public enum Publication { PUBLISHED, UNPUBLISHED }
    public enum Review { NOT_SUBMITTED, PENDING_REVIEW, APPROVED, REJECTED, NOT_REQUIRED, UNKNOWN }
    public enum Access { ENABLED, DISABLED }
    /** 按当前草稿是否打开“可作为MCP工具”筛选；发布后才对网关生效。 */
    public enum McpTool { ENABLED, DISABLED }

    public ApiCatalogFilter(Set<ApiProtocol> protocols, String category, Set<Publication> publications, Set<Review> reviews, Set<Access> access) {
        this(protocols, category, publications, reviews, access, null, null, null, null, null, null);
    }

    public ApiCatalogFilter {
        protocols = protocols == null ? Set.of() : Set.copyOf(protocols);
        publications = publications == null ? Set.of() : Set.copyOf(publications);
        reviews = reviews == null ? Set.of() : Set.copyOf(reviews);
        access = access == null ? Set.of() : Set.copyOf(access);
        mcpTools = mcpTools == null ? Set.of() : Set.copyOf(mcpTools);
        if (category != null && category.length() > 100) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "分类不能超过100字符");
        }
        category = category == null || category.isEmpty() ? null : category;
        internalClass = text(internalClass, 1024); internalMethod = text(internalMethod, 128);
        ownerId = text(ownerId, 36);
        internalMatch = internalMatch == null ? MatchMode.CONTAINS : internalMatch;
        sort = sort == null ? Sort.IDENTITY : sort;
    }

    private static String text(String value, int limit) {
        if (value != null && value.length() > limit) throw new PlatformException(ErrorCode.INVALID_REQUEST, "内部定位条件超出长度限制");
        return value == null || value.isBlank() ? null : value.trim();
    }
    public boolean simpleClassExact() { return internalClass != null && internalMatch.exact() && !internalClass.contains("."); }
}
