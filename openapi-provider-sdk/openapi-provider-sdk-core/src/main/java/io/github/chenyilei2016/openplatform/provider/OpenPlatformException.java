package io.github.chenyilei2016.openplatform.provider;

/** 仅携带稳定原因，不包含认证值、身份正文或业务参数。 */
public final class OpenPlatformException extends RuntimeException {
    public enum Reason {
        INVALID_CREDENTIAL(403),
        INVALID_IDENTITY(400),
        EMPLOYEE_REQUIRED(403),
        CONTEXT_REQUIRED(403),
        INVALID_INVOCATION(400);
        private final int status;

        Reason(int status) {
            this.status = status;
        }

        public int getStatus() {
            return status;
        }
    }

    private final Reason reason;

    public OpenPlatformException(Reason reason) {
        super(reason.name());
        this.reason = reason;
    }

    public Reason getReason() {
        return reason;
    }
}
