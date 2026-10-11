package io.github.chenyilei2016.openplatform.domain.sdk;

/** 已完成大小、ZIP路径及清单验证的上传内容，不自动输出二进制正文。 */
public record SdkArchive(SdkManifest manifest, String sha256, byte[] content) {
    public static final int MAX_CONTENT_BYTES = 2 * 1024 * 1024;

    @Override public String toString() { return "SdkArchive[sha256=" + sha256 + ",size=" + content.length + "]"; }
}
