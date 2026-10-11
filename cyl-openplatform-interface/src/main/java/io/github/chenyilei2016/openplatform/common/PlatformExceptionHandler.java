package io.github.chenyilei2016.openplatform.common;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRejected;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;

import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@Slf4j
@RestControllerAdvice
public class PlatformExceptionHandler {
    public record GovernanceFailure(GovernanceDecision.Reason reason, long retryAfterSeconds) {}

    @ExceptionHandler(GovernanceRejected.class)
    public ResponseEntity<ApiResponse<GovernanceFailure>> handleGovernance(GovernanceRejected exception) {
        boolean deniedIp = exception.getReason() == GovernanceDecision.Reason.IP_DENIED;
        ResponseEntity.BodyBuilder response = ResponseEntity.status(deniedIp ? 403 : 429).header("Cache-Control", "no-store");
        if (!deniedIp) response.header("Retry-After", Long.toString(exception.getRetryAfterSeconds()));
        return response.body(new ApiResponse<>(exception.getErrorCode().getCode(), exception.getMessage(),
                new GovernanceFailure(exception.getReason(), deniedIp ? 0 : exception.getRetryAfterSeconds()), org.slf4j.MDC.get("requestId")));
    }

    @ExceptionHandler(io.github.chenyilei2016.openplatform.domain.common.FieldValidation.Failure.class)
    public ResponseEntity<ApiResponse<?>> handleFieldValidation(
            io.github.chenyilei2016.openplatform.domain.common.FieldValidation.Failure failure,
            jakarta.servlet.http.HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        // 仅管理/门户表单扩展错误data，正式客户调用保持原有信封契约。
        Object details = path.startsWith("/admin-api/") || path.startsWith("/portal-api/") ? failure.problems() : null;
        return ResponseEntity.badRequest().body(new ApiResponse<>(ErrorCode.INVALID_REQUEST.getCode(),
                failure.getMessage(), details, org.slf4j.MDC.get("requestId")));
    }

    @ExceptionHandler(PlatformException.class)
    public ResponseEntity<ApiResponse<Void>> handlePlatform(PlatformException exception, jakarta.servlet.http.HttpServletRequest request) {
        if (exception instanceof io.github.chenyilei2016.openplatform.application.runtime.InvocationFailure failure
                && failure.diagnostics().providerResponse().available())
            request.setAttribute(io.github.chenyilei2016.openplatform.web.shared.observability.CallObservation.PROVIDER_RESPONSE,
                    failure.diagnostics().providerResponse().value());
        int status = switch (exception.getErrorCode()) {
            case INVALID_REQUEST -> 400;
            case UNAUTHENTICATED, INVALID_CREDENTIALS, INVALID_TOKEN, INVALID_SIGNATURE -> 401;
            case FORBIDDEN -> 403;
            case NOT_FOUND -> 404;
            case METHOD_NOT_ALLOWED -> 405;
            case CONFLICT, IDEMPOTENT_REPLAY -> 409;
            case API_RETIRED -> 410;
            case REQUEST_TOO_LARGE -> 413;
            case UNSUPPORTED_MEDIA_TYPE -> 415;
            case RATE_LIMITED -> 429;
            case DOWNSTREAM_FAILED, PROVIDER_BUSINESS_REJECTED -> 502;
            case DEPENDENCY_UNAVAILABLE -> 503;
            case DOWNSTREAM_TIMEOUT -> 504;
            default -> 500;
        };
        if (status >= 500) {
            log.error("平台请求处理失败 errorCode={}", exception.getErrorCode(), exception);
        } else if (exception.getCause() != null) {
            log.warn("平台请求被拒绝 errorCode={}", exception.getErrorCode(), exception);
        }
        return ResponseEntity.status(status)
                .body(ApiResponse.failure(exception.getErrorCode(), exception.getMessage()));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, ConstraintViolationException.class,
            HttpMessageNotReadableException.class, HandlerMethodValidationException.class,
            MethodArgumentTypeMismatchException.class, MissingServletRequestParameterException.class})
    public ResponseEntity<ApiResponse<Void>> handleInvalidRequest(Exception exception) {
        return ResponseEntity.badRequest().body(ApiResponse.failure(
                ErrorCode.INVALID_REQUEST, ErrorCode.INVALID_REQUEST.getMessage()));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(NoResourceFoundException exception) {
        return ResponseEntity.status(404).body(ApiResponse.failure(
                ErrorCode.NOT_FOUND, ErrorCode.NOT_FOUND.getMessage()));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> handleUnsupportedMethod(HttpRequestMethodNotSupportedException exception) {
        return ResponseEntity.status(405).body(ApiResponse.failure(
                ErrorCode.METHOD_NOT_ALLOWED, ErrorCode.METHOD_NOT_ALLOWED.getMessage()));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> handleUnsupportedMediaType(HttpMediaTypeNotSupportedException exception) {
        return ResponseEntity.status(415).body(ApiResponse.failure(
                ErrorCode.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception exception) {
        // 日志转换器保留异常栈与 cause，统一屏蔽外部异常消息。
        log.error("平台请求发生未分类异常", exception);
        return ResponseEntity.internalServerError().body(ApiResponse.failure(
                ErrorCode.INTERNAL_ERROR, ErrorCode.INTERNAL_ERROR.getMessage()));
    }
}
