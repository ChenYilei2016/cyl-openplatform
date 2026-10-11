package io.github.chenyilei2016.openplatform.domain.sdk;

import java.io.InputStream;

/** 有界验证人工构建的ZIP，不解压到磁盘或执行包内代码。 */
public interface SdkArchiveReader {
    SdkArchive read(InputStream input);
}
