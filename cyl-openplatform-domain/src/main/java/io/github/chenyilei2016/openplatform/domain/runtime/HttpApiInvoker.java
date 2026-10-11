package io.github.chenyilei2016.openplatform.domain.runtime;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiBinding;

/** HTTP提供方边界；返回原始JSON值，由应用层验证已发布的返回契约。 */
public interface HttpApiInvoker {
    Object invoke(ApiBinding binding, HttpParameters parameters, InvocationContext context, String requestId);
}
