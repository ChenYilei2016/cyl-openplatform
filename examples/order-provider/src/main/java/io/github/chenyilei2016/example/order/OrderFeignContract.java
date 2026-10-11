package io.github.chenyilei2016.example.order;

import io.github.chenyilei2016.openplatform.provider.RequireOpenPlatformEmployee;
import jakarta.validation.Valid;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;

/** 可与调用方共享的Feign契约；提供方仅复用MVC实现，不启用Feign客户端扫描。 */
@FeignClient(name = "example-order-provider")
public interface OrderFeignContract {
    @RequireOpenPlatformEmployee
    @PostMapping(path = "/internal/orders/{orderNo}/lookup", consumes = "application/json", produces = "application/json")
    OrderResponse lookupByPath(@PathVariable("orderNo") String orderNo, @RequestParam("tenantId") String tenantId,
                              @Valid @RequestBody OrderQueryController.OrderQuery query);
}
