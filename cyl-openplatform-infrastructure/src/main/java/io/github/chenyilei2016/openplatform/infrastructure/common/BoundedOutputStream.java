package io.github.chenyilei2016.openplatform.infrastructure.common;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.io.ByteArrayOutputStream;

/** 在写入时约束出站缓冲区，不能先完整生成再判断大小。 */
public final class BoundedOutputStream extends ByteArrayOutputStream {
    private final int limit;

    public BoundedOutputStream(int limit) {
        super(Math.min(limit, 1024));
        this.limit = limit;
    }

    @Override
    public synchronized void write(int value) {
        if (count >= limit) {
            throw new PlatformException(ErrorCode.REQUEST_TOO_LARGE, "出站请求超出大小限制");
        }
        super.write(value);
    }

    @Override
    public synchronized void write(byte[] bytes, int offset, int length) {
        java.util.Objects.checkFromIndexSize(offset, length, bytes.length);
        if (length > limit - count) {
            throw new PlatformException(ErrorCode.REQUEST_TOO_LARGE, "出站请求超出大小限制");
        }
        super.write(bytes, offset, length);
    }
}
