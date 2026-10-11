package io.github.chenyilei2016.openplatform.domain.token;

/** DEBUG_AS_APP：后台以所选凭据当前授权代换身份执行草稿调试（不签发 Token）。 */
public enum TokenAction { ISSUE, REFRESH, REVOKE, DEBUG_AS_APP }
