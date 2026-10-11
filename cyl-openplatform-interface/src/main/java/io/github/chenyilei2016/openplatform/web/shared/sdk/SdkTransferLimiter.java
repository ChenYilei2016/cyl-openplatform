package io.github.chenyilei2016.openplatform.web.shared.sdk;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/** 上传解析/写入、发布复核与下载读取共用容量，不积压携带ZIP内容的等待请求。 */
@Component
public class SdkTransferLimiter {
    private final Semaphore permits = new Semaphore(4);

    public <T> T execute(Supplier<T> operation) {
        if (!permits.tryAcquire()) throw new PlatformException(ErrorCode.RATE_LIMITED, "SDK文件处理繁忙，请稍后重试");
        try {
            return operation.get();
        } finally {
            permits.release();
        }
    }
}
