package io.github.chenyilei2016.example.order.rpc;

import io.github.chenyilei2016.example.order.OrderResult;
import io.github.chenyilei2016.example.order.OrderResponse;
import io.github.chenyilei2016.example.order.OrderService;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformContext;

import org.apache.dubbo.rpc.RpcContext;
import org.springframework.stereotype.Component;

/** 协议适配只传递经过认证的身份，并把业务拒绝转为固定响应状态。 */
@Component
public class OrderQueryFacadeImpl implements OrderQueryFacade {
    private final OrderService orders;

    public OrderQueryFacadeImpl(OrderService orders) {
        this.orders = orders;
    }

    @Override
    public OrderResult query(OrderQueryRequest request) {
        return withStatus(() -> orders.query(orderNo(request), tenantId(request), OpenPlatformContext.requireIdentity()));
    }

    @Override
    public OrderResponse lookup(OrderQueryRequest request) {
        return withStatus(() -> orders.lookup(orderNo(request), tenantId(request), OpenPlatformContext.requireIdentity()));
    }

    @Override
    public OrderResult mine(OrderQueryRequest request) {
        return query(request);
    }

    /** Dubbo附件与HTTP状态保持一致；业务Response失败仍是一次正常传输。 */
    private <T> T withStatus(java.util.function.Supplier<T> operation) {
        try {
            T result = operation.get();
            RpcContext.getServerResponseContext().setAttachment("x-open-platform-status", "200");
            return result;
        } catch (OrderService.QueryRejected rejected) {
            RpcContext.getServerResponseContext().setAttachment("x-open-platform-status", Integer.toString(rejected.status()));
            return null;
        }
    }

    private String orderNo(OrderQueryRequest request) { return request == null ? null : request.getOrderNo(); }
    private String tenantId(OrderQueryRequest request) { return request == null ? null : request.getTenantId(); }
}
