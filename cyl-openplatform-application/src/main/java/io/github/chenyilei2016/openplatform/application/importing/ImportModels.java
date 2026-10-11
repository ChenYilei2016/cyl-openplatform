package io.github.chenyilei2016.openplatform.application.importing;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiOperation;
import java.util.List;

/** 导入解析、预览与明确确认共享的有界用例数据。 */
public final class ImportModels {
    private ImportModels() {}

    public enum Change {
        CREATE, UPDATE, UNCHANGED, ERROR;

        public boolean selectable() { return this == CREATE || this == UPDATE; }
    }

    public record ParsedDocument(String digest, List<SourceItem> items) {}
    /** operation 仅供错误定位；契约未通过解析时 definition 仍为空，不得据此写入。 */
    public record SourceItem(int index, ApiOperation operation, ApiDefinition definition, List<String> errors) {}
    public record Preview(String documentDigest, List<PreviewItem> items) {}
    public record PreviewItem(int index, ApiOperation operation, Change change, long expectedRevision,
                              List<String> changedFields, ApiDefinition before, ApiDefinition after,
                              List<String> errors, List<String> warnings) {}
    public record Selection(int index, long expectedRevision) {}
    public record Confirmation(boolean committed, List<ItemResult> items) {}
    public record ItemResult(int index, Change change, String apiId, Long revision, List<String> errors) {}
}
