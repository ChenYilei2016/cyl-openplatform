package io.github.chenyilei2016.openplatform.web.shared.observability;

import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import jakarta.servlet.http.HttpServletRequest;

/** 同一HTTP请求内由入口和运行链补充可信字段，不跨线程传递可变状态。 */
public final class CallObservation {
    public static final String PROVIDER_RESPONSE = CallObservation.class.getName() + ".providerResponse";
    static final String ATTRIBUTE = CallObservation.class.getName();
    private CallObservation() {}

    public static CallRecord.CallRecordBuilder current(HttpServletRequest request) {
        if (request.getAttribute(ATTRIBUTE) instanceof CallRecord.CallRecordBuilder observation) return observation;
        throw new IllegalStateException("调用观察器未初始化");
    }
}
