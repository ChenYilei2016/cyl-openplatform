package io.github.chenyilei2016.openplatform.domain.runtime;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

/** 已知提供方响应与尚不确定的网络结果分别记录；不保留远端错误正文。 */
public final class ProviderCallFailure extends PlatformException {
    public enum Rejection {
        INVALID_CREDENTIAL, INVALID_IDENTITY, INVALID_INVOCATION, EMPLOYEE_REQUIRED;
        public String summary() {
            return switch (this) {
                case INVALID_CREDENTIAL -> "提供方未接受环境证明：请核对环境、公钥keyId与SDK签名版本，无需为API填写credential";
                case INVALID_IDENTITY -> "提供方收到的身份不完整，请核对当前租户与人员委托";
                case INVALID_INVOCATION -> "提供方入口或参数不符合SDK约定，请核对方法、参数类型和映射";
                case EMPLOYEE_REQUIRED -> "提供方要求人员身份，请准备员工Token，并在API声明中开启人员要求";
            };
        }
        static Rejection fromWire(String value) {
            try { return value == null ? null : valueOf(value); }
            catch (IllegalArgumentException unknown) { return null; }
        }
    }
    private final InvocationDiagnostics.Dispatch dispatch;
    private final Rejection rejection;
    public ProviderCallFailure(ErrorCode error, String message, InvocationDiagnostics.Dispatch dispatch, String sdkReason) {
        super(error, message);
        this.dispatch = dispatch;
        rejection = Rejection.fromWire(sdkReason);
    }
    public InvocationDiagnostics.Dispatch dispatch() { return dispatch; }
    public Rejection rejection() { return rejection; }
}
