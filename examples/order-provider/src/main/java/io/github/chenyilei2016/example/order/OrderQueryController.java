package io.github.chenyilei2016.example.order;

import io.github.chenyilei2016.openplatform.provider.CurrentOpenPlatformIdentity;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformApi;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformIdentity;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import io.github.chenyilei2016.openplatform.provider.RequireOpenPlatformEmployee;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** HTTP 订单入口；数据及权限判断交给共享订单服务。 */
@RestController
public class OrderQueryController implements OrderFeignContract {
    private final OrderService orders;

    public OrderQueryController(OrderService orders) {
        this.orders = orders;
    }

    @OpenPlatformApi
    @PostMapping(
            path = "/internal/orders/query",
            consumes = "application/json",
            produces = "application/json")
    public OrderResult query(
            @Valid @RequestBody OrderQuery query,
            @CurrentOpenPlatformIdentity OpenPlatformIdentity identity) {
        return orders.query(query.orderNo(), query.tenantId(), identity);
    }

    /** 展示业务外壳：不存在的订单返回code=40401，不伪装成成功数据。 */
    @OpenPlatformApi
    @PostMapping(path = "/internal/orders/lookup", consumes = "application/json", produces = "application/json")
    public OrderResponse lookup(@Valid @RequestBody OrderQuery query,
                                @CurrentOpenPlatformIdentity OpenPlatformIdentity identity) {
        return orders.lookup(query.orderNo(), query.tenantId(), identity);
    }

    /** 路径、查询条件与正文必须指向同一订单/租户，可信身份仍由SDK验证。 */
    @Override
    public OrderResponse lookupByPath(String orderNo, String tenantId, OrderQuery query) {
        if (!orderNo.equals(query.orderNo()) || !tenantId.equals(query.tenantId()))
            throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, "路径、查询条件与正文不一致");
        return orders.lookup(orderNo, tenantId, io.github.chenyilei2016.openplatform.provider.OpenPlatformContext.requireIdentity());
    }

    /** 只允许受委托员工查询自己的订单；人员身份由SDK注入。 */
    @RequireOpenPlatformEmployee
    @PostMapping(path = "/internal/orders/mine", consumes = "application/json", produces = "application/json")
    public OrderResult mine(@Valid @RequestBody OrderQuery query,
                            @CurrentOpenPlatformIdentity OpenPlatformIdentity identity) {
        return orders.query(query.orderNo(), query.tenantId(), identity);
    }

    @ExceptionHandler(OrderService.QueryRejected.class)
    public ResponseEntity<Void> rejected(OrderService.QueryRejected failure) {
        return ResponseEntity.status(failure.status()).build();
    }

    public record OrderQuery(
            @NotBlank @Size(max = 128) String orderNo,
            @NotBlank @Size(max = 128) String tenantId) {}
}
