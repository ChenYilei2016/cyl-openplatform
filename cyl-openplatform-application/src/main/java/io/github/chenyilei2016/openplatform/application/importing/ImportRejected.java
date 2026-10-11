package io.github.chenyilei2016.openplatform.application.importing;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.List;

/** 已知校验或并发冲突；抛出事务后由HTTP边界呈现整批未写入及逐项原因。 */
public class ImportRejected extends PlatformException {
    private final List<ImportModels.ItemResult> items;

    public ImportRejected(ErrorCode errorCode, List<ImportModels.ItemResult> items) {
        super(errorCode, "导入未写入，请检查逐项结果后重新预览");
        this.items = List.copyOf(items);
    }

    public List<ImportModels.ItemResult> items() { return items; }
}
