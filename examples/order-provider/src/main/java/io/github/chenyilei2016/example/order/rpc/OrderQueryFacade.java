package io.github.chenyilei2016.example.order.rpc;

import io.github.chenyilei2016.example.order.OrderResult;
import io.github.chenyilei2016.example.order.OrderResponse;
import io.github.chenyilei2016.openplatform.provider.RequireOpenPlatformEmployee;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformApi;

/** version=1.0.0，group=order-example；租户及人员附件必须经过提供方认证。 */
public interface OrderQueryFacade {
    @OpenPlatformApi
    OrderResult query(OrderQueryRequest request);

    @OpenPlatformApi
    OrderResponse lookup(OrderQueryRequest request);

    @RequireOpenPlatformEmployee
    OrderResult mine(OrderQueryRequest request);
}
