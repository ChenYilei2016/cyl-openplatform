package io.github.chenyilei2016.openplatform.domain.common;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum ErrorCode {
    INVALID_REQUEST(40000001, "请求参数不合法"),
    UNAUTHENTICATED(40100001, "请先登录"),
    INVALID_CREDENTIALS(40100002, "应用凭据无效"),
    INVALID_TOKEN(40100003, "Token无效或已失效"),
    INVALID_SIGNATURE(40100004, "签名无效或已失效"),
    FORBIDDEN(40300001, "无操作权限"),
    NOT_FOUND(40400001, "请求的资源不存在"),
    METHOD_NOT_ALLOWED(40500001, "不支持的请求方法"),
    CONFLICT(40900001, "资源状态冲突"),
    IDEMPOTENT_REPLAY(40900002, "已提交过"),
    API_RETIRED(41000001, "API版本已退出，请查阅生效公告迁移"),
    REQUEST_TOO_LARGE(41300001, "请求体超出大小限制"),
    UNSUPPORTED_MEDIA_TYPE(41500001, "仅支持JSON请求体"),
    RATE_LIMITED(42900001, "请求过于频繁"),
    INTERNAL_ERROR(50000001, "服务处理失败"),
    DOWNSTREAM_FAILED(50200001, "下游服务调用失败"),
    PROVIDER_BUSINESS_REJECTED(50200002, "提供方业务拒绝"),
    DEPENDENCY_UNAVAILABLE(50300001, "依赖服务暂不可用"),
    DOWNSTREAM_TIMEOUT(50400001, "下游服务调用超时");

    private final int code;
    private final String message;

    public int httpStatus() { return code / 100000; }
}
