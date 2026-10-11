package io.github.chenyilei2016.openplatform.domain.access;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.regex.Pattern;

/**
 * 凭据列表主搜索框：32 位小写十六进制按 AK 精确匹配，其余按名称包含。Token 记录 ID 量大且语义不同，
 * 走单独的 tokenId 条件，不在这里猜测。完整 Token 明文（43 位 base64url 或 Bearer 前缀）一律拒绝，避免秘密进入查询条件。
 */
public record CredentialSearch(String nameContains, String appKey) {
    private static final Pattern APP_KEY = Pattern.compile("[a-f0-9]{32}");
    private static final Pattern RAW_TOKEN = Pattern.compile("(?i)bearer\\s+.*|[A-Za-z0-9_-]{43}");

    public static CredentialSearch parse(String keyword) {
        String text = keyword == null ? "" : keyword.strip();
        if (text.isEmpty()) return new CredentialSearch(null, null);
        if (APP_KEY.matcher(text).matches()) return new CredentialSearch(null, text);
        if (RAW_TOKEN.matcher(text).matches())
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "搜索不接受完整 Token，请在“Token 记录 ID”中输入记录 ID（TOK_ 开头）");
        return new CredentialSearch(text, null);
    }
}
