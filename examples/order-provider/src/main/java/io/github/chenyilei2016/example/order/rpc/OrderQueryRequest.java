package io.github.chenyilei2016.example.order.rpc;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Dubbo 默认泛化转换使用无参构造和属性 setter。 */
@Getter
@Setter
@NoArgsConstructor
public class OrderQueryRequest {
    private String orderNo;
    private String tenantId;
}
