package io.github.chenyilei2016.openplatform.logging;

import ch.qos.logback.classic.pattern.ThrowableProxyConverter;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.classic.spi.ThrowableProxy;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.CoreConstants;
import java.sql.SQLException;

/** 异常消息可能携带 SQL 参数、HTTP 正文和凭据；只输出类型、调用栈和因果关系。 */
public final class DiagnosticThrowableConverter extends ThrowableProxyConverter {
    @Override
    protected String throwableProxyToString(IThrowableProxy throwable) {
        StringBuilder output = new StringBuilder();
        append(output, "", ThrowableProxyUtil.REGULAR_EXCEPTION_INDENT, throwable);
        return output.toString();
    }

    private void append(StringBuilder output, String prefix, int indent, IThrowableProxy throwable) {
        if (throwable == null) return;
        ThrowableProxyUtil.indent(output, indent - 1);
        output.append(prefix).append(throwable.getClassName());
        if (throwable instanceof ThrowableProxy proxy && proxy.getThrowable() instanceof SQLException failure) {
            String sqlState = failure.getSQLState();
            output.append(" [sqlState=").append(sqlState != null && sqlState.matches("[A-Z0-9]{5}") ? sqlState : "unknown")
                    .append(", vendorErrorCode=").append(failure.getErrorCode()).append(']');
        }
        if (throwable.isCyclic()) output.append(" [CIRCULAR REFERENCE]");
        output.append(CoreConstants.LINE_SEPARATOR);
        subjoinSTEPArray(output, indent, throwable);
        IThrowableProxy[] suppressed = throwable.getSuppressed();
        if (suppressed != null) {
            for (IThrowableProxy failure : suppressed) {
                append(output, CoreConstants.SUPPRESSED,
                        indent + ThrowableProxyUtil.SUPPRESSED_EXCEPTION_INDENT, failure);
            }
        }
        append(output, CoreConstants.CAUSED_BY, indent, throwable.getCause());
    }
}
