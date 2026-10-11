package io.github.chenyilei2016.openplatform.domain.runtime;

/** 正式调用的跨实例幂等占位；仅保存唯一号摘要与原请求号，有效期三小时。 */
public interface IdempotencyGuard {
    record Reservation(String tenantId, String apiId, String valueDigest, String requestId) {}

    /** 原子占位；已存在时拒绝并给出原请求号，依赖不可用时禁止继续调用提供方。 */
    void reserve(Reservation reservation);

    /** 只释放仍属于该请求的占位，不能删除过期后其他请求的新占位。 */
    void release(Reservation reservation);
}
