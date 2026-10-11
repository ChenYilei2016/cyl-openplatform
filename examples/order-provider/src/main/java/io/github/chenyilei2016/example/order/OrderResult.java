package io.github.chenyilei2016.example.order;

import java.math.BigDecimal;
import lombok.AllArgsConstructor;
import lombok.Getter;

/** 保持 JavaBean getter，供 Dubbo 泛化结果及 HTTP JSON 使用同一字段。 */
@Getter
@AllArgsConstructor
public class OrderResult {
    private final String orderNo;
    private final String tenantId;
    private final BigDecimal amount;
    private final String status;
}
