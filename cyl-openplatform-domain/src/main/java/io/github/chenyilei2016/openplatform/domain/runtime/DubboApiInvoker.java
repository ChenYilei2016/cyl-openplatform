package io.github.chenyilei2016.openplatform.domain.runtime;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;
import java.util.Map;

/** Dubbo提供方边界；有序参数组装、远程引用及附件留在基础设施层。 */
public interface DubboApiInvoker {
    Object invoke(ApiBinding binding, Map<String, Object> parameters, InvocationContext context, String requestId);
}
