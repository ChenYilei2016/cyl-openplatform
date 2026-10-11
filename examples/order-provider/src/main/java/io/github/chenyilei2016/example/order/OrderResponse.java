package io.github.chenyilei2016.example.order;

import lombok.Getter;

/** 提供方自己的业务Response；平台显式使用code=0判断成功、提取data。 */
@Getter
public final class OrderResponse {
    public enum Code {
        SUCCESS(0, "成功"), NOT_FOUND(40401, "当前租户内无此订单");
        private final int value;
        private final String message;
        Code(int value, String message) { this.value = value; this.message = message; }
        public int value() { return value; }
        public String message() { return message; }
    }
    private final int code;
    private final String message;
    private final OrderResult data;
    public OrderResponse(Code code, OrderResult data) {
        this.code = code.value();
        this.message = code.message();
        this.data = data;
    }
}
