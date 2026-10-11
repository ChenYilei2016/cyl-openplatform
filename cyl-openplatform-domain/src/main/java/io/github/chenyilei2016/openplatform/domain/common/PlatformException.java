package io.github.chenyilei2016.openplatform.domain.common;

import lombok.Getter;

@Getter
public class PlatformException extends RuntimeException {
    private final ErrorCode errorCode;

    public PlatformException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }
    public PlatformException(ErrorCode errorCode, String message, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }
}
