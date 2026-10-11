package io.github.chenyilei2016.example.order;

import io.github.chenyilei2016.openplatform.provider.OpenPlatformIdentity;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.Map;

/** 两种接入协议共用同一租户隔离和订单归属规则。 */
@Service
public class OrderService {
    private final Map<String, Map<String, Order>> orders;

    public OrderService(
            @Value("${example.order.data.primary-tenant-id:101}") String tenantId,
            @Value("${example.order.data.primary-employee-no:E101}") String primaryEmployeeNo,
            @Value("${example.order.data.secondary-employee-no:E102}") String secondaryEmployeeNo) {
        if (tenantId.isBlank()
                || tenantId.length() > 128
                || "202".equals(tenantId)
                || primaryEmployeeNo.isBlank()
                || primaryEmployeeNo.length() > 128
                || secondaryEmployeeNo.isBlank()
                || secondaryEmployeeNo.length() > 128) {
            throw new IllegalArgumentException("示例租户/工号必须为 1–128 字符，主租户不可与保留租户 202 相同");
        }
        orders =
                Map.of(
                        tenantId,
                        Map.of(
                                "COMMON-001",
                                        new Order(
                                                "COMMON-001",
                                                tenantId,
                                                new BigDecimal("101.25"),
                                                "PAID",
                                                primaryEmployeeNo),
                                "PRIVATE-002",
                                        new Order(
                                                "PRIVATE-002",
                                                tenantId,
                                                new BigDecimal("15.00"),
                                                "CREATED",
                                                secondaryEmployeeNo)),
                        "202",
                        Map.of(
                                "COMMON-001",
                                new Order(
                                        "COMMON-001",
                                        "202",
                                        new BigDecimal("202.50"),
                                        "CREATED",
                                        "E202")));
    }

    public OrderResult query(String orderNo, String tenantId, OpenPlatformIdentity identity) {
        if (orderNo == null
                || orderNo.isBlank()
                || orderNo.length() > 128
                || tenantId == null
                || tenantId.isBlank()
                || tenantId.length() > 128) throw new QueryRejected(QueryFailure.INVALID_INPUT);
        if (identity == null || !identity.getTenantId().equals(tenantId))
            throw new QueryRejected(QueryFailure.FORBIDDEN);
        Order order = orders.getOrDefault(identity.getTenantId(), Map.of()).get(orderNo);
        if (order == null) throw new QueryRejected(QueryFailure.NOT_FOUND);
        if (identity.getEmployeeNo() != null
                && !identity.getEmployeeNo().equals(order.ownerEmployeeNo())) {
            throw new QueryRejected(QueryFailure.FORBIDDEN);
        }
        return new OrderResult(order.orderNo(), order.tenantId(), order.amount(), order.status());
    }

    /** 查询型业务外壳只把“订单不存在”表示为业务失败，权限拒绝仍由协议层返回403。 */
    public OrderResponse lookup(String orderNo, String tenantId, OpenPlatformIdentity identity) {
        try {
            return new OrderResponse(OrderResponse.Code.SUCCESS, query(orderNo, tenantId, identity));
        } catch (QueryRejected failure) {
            if (failure.reason() == QueryFailure.NOT_FOUND) return new OrderResponse(OrderResponse.Code.NOT_FOUND, null);
            throw failure;
        }
    }

    public enum QueryFailure {
        INVALID_INPUT(400), FORBIDDEN(403), NOT_FOUND(404);
        private final int status;
        QueryFailure(int status) { this.status = status; }
        public int status() { return status; }
    }

    public static final class QueryRejected extends RuntimeException {
        private final QueryFailure reason;
        private QueryRejected(QueryFailure reason) {
            super("订单查询被拒绝");
            this.reason = reason;
        }
        public QueryFailure reason() { return reason; }
        public int status() { return reason.status(); }
    }

    private record Order(
            String orderNo,
            String tenantId,
            BigDecimal amount,
            String status,
            String ownerEmployeeNo) {}
}
