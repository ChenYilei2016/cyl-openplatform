package io.github.chenyilei2016.openplatform.application.token;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.TransientDataAccessResourceException;
import java.sql.SQLNonTransientConnectionException;
import java.sql.SQLTimeoutException;
import java.sql.SQLTransientConnectionException;

/** MyBatis可能包裹连接异常，只转换明确的连接/超时故障，不掩盖SQL编程错误。 */
final class TokenDependencyFailures {
    private TokenDependencyFailures() {}

    static RuntimeException translate(RuntimeException failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof DataAccessResourceFailureException || cause instanceof TransientDataAccessResourceException
                    || cause instanceof QueryTimeoutException || cause instanceof SQLTimeoutException
                    || cause instanceof SQLTransientConnectionException || cause instanceof SQLNonTransientConnectionException) {
                return new PlatformException(ErrorCode.DEPENDENCY_UNAVAILABLE, "Token依赖服务暂不可用", failure);
            }
            if (cause == cause.getCause()) break;
        }
        return failure;
    }
}
