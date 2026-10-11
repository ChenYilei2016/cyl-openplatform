package io.github.chenyilei2016.openplatform.application.runtime;

import io.github.chenyilei2016.openplatform.domain.catalog.ResponseAdapter;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.runtime.ResponseAdaptation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** 运行规模独立于编辑器示例规模，预览与双协议执行共享同一配置。 */
@Service
public class ProviderResponseService {
    private final ResponseAdaptation adaptation;
    public ProviderResponseService(@Value("${open-platform.runtime.response.max-nodes:20000}") int maxNodes,
                                   @Value("${open-platform.runtime.response.max-depth:32}") int maxDepth) {
        adaptation = new ResponseAdaptation(maxNodes, maxDepth);
    }
    public ResponseAdaptation.Result adapt(ResponseAdapter adapter, SchemaNode schema, Object sample) {
        return adaptation.apply(adapter == null ? ResponseAdapter.DIRECT : adapter, schema, sample);
    }
}
