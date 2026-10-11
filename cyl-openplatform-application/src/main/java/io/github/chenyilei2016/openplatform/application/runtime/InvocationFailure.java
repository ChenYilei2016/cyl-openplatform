package io.github.chenyilei2016.openplatform.application.runtime;

import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationDiagnostics;

/** 管理入口可读取过程；正式入口仅沿用原错误码和消息，不序列化此对象。 */
public final class InvocationFailure extends PlatformException {
    private final InvocationDiagnostics diagnostics;
    public InvocationFailure(PlatformException failure, InvocationDiagnostics diagnostics) {
        super(failure.getErrorCode(), failure.getMessage());
        this.diagnostics = diagnostics;
    }
    public InvocationDiagnostics diagnostics() { return diagnostics; }
}
