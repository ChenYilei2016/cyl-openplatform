package io.github.chenyilei2016.openplatform.web.shared.token;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;

/** Token、文档及后续网关共用的单一Authorization头读取规则。 */
public final class BearerToken {
    private BearerToken() {}
    public static String read(HttpServletRequest request) {
        var headers = Collections.list(request.getHeaders("Authorization"));
        if (headers.size() != 1 || !headers.getFirst().regionMatches(true, 0, "Bearer ", 0, 7)) {
            throw new PlatformException(ErrorCode.INVALID_TOKEN, "请提供有效Bearer Token");
        }
        return headers.getFirst().substring(7);
    }
}
