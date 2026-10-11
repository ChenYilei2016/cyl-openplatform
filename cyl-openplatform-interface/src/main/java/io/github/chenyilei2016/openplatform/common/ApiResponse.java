package io.github.chenyilei2016.openplatform.common;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;

import org.slf4j.MDC;

/** 统一 HTTP 响应，requestId 用于排障关联。 */
public record ApiResponse<T>(int code, String resultMsg, T data, String requestId) {
    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(200, "成功", data, MDC.get("requestId"));
    }

    public static ApiResponse<Void> failure(ErrorCode error, String message) {
        return new ApiResponse<>(error.getCode(), message, null, MDC.get("requestId"));
    }
}
