package io.github.chenyilei2016.openplatform.web.admin.debug;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;

/** 管理预检/离线预览共用本机容量，不排队持有正文，也不计入业务配额。 */
@Component
public final class PreparationLimiter {
    private static final int MAX_PER_MINUTE = 120;
    private final Semaphore permits = new Semaphore(4);
    private long started = System.nanoTime();
    private int requests;
    public synchronized Permit acquire() {
        long now = System.nanoTime();
        if (now - started >= TimeUnit.MINUTES.toNanos(1)) { started = now; requests = 0; }
        if (requests >= MAX_PER_MINUTE || !permits.tryAcquire())
            throw new PlatformException(ErrorCode.RATE_LIMITED, "预检或预览繁忙，请稍后重试");
        requests++;
        return new Permit();
    }
    public final class Permit implements AutoCloseable {
        private boolean closed;
        private Permit() {}
        @Override public void close() { if (!closed) { closed = true; permits.release(); } }
    }
}
